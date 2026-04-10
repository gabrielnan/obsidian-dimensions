// Dimensions — plugin entry point.

import { Plugin, TFile, WorkspaceLeaf, Notice } from "obsidian";
import { Extension } from "@codemirror/state";
import { VaultIndex } from "./src/index-store";
import { SEED_DIMENSIONS } from "./src/dimensions";
import { Dimension } from "./src/model";
import { createColoringExtension } from "./src/decorations";
import { GroupByView, GROUP_VIEW_TYPE } from "./src/views/group-view";
import {
  CONFIG_PATH,
  configExists,
  loadConfig,
  writeDefaultConfig,
} from "./src/config";
import { applyDynamicStyles, removeDynamicStyles } from "./src/styles-dynamic";

interface DimensionsSettings {
  activeColoringDimension: string | null;
}

const DEFAULT_SETTINGS: DimensionsSettings = {
  activeColoringDimension: "priority",
};

export default class DimensionsPlugin extends Plugin {
  settings!: DimensionsSettings;
  index!: VaultIndex;
  private dimensions: Dimension[] = SEED_DIMENSIONS;
  private editorExtensions: Extension[] = [];

  async onload(): Promise<void> {
    console.log("[Dimensions] loading");
    await this.loadSettings();

    // Load the user's dimensions config (or write defaults if missing).
    await this.loadDimensionsFromConfig({ isInitial: true });

    this.index = new VaultIndex(this.app, this.dimensions);

    // Register the group-by view.
    this.registerView(
      GROUP_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new GroupByView(leaf, this.index, this.dimensions, this.dimensions[0]?.id ?? ""),
    );

    // Editor extension for in-editor line coloring.
    const coloringExt = createColoringExtension({
      index: this.index,
      dimensions: this.dimensions,
      activeDimensionId: this.settings.activeColoringDimension,
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
    });
    this.editorExtensions.push(coloringExt);
    this.registerEditorExtension(this.editorExtensions);

    // Inject per-dimension/value CSS classes from the loaded config.
    applyDynamicStyles(this.dimensions);

    // Build the index once the vault has booted its metadata cache.
    this.app.workspace.onLayoutReady(async () => {
      await this.index.rebuildAll();
      this.refreshEditors();
    });

    // Vault event wiring.
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile) {
          await this.index.handleFileModified(file);
          this.refreshEditors();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", async (file) => {
        if (file instanceof TFile) {
          await this.index.handleFileCreated(file);
          this.refreshEditors();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.index.handleFileDeleted(file.path);
          this.refreshEditors();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile) {
          await this.index.handleFileRenamed(file, oldPath);
          this.refreshEditors();
        }
      }),
    );

    // Refresh decorations when the active file changes.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.refreshEditors()),
    );

    // Commands
    this.addCommand({
      id: "open-group-by-view",
      name: "Open group-by view",
      callback: () => this.activateGroupView(),
    });
    this.addCommand({
      id: "cycle-coloring-dimension",
      name: "Cycle active coloring dimension",
      callback: () => this.cycleColoringDimension(),
    });
    this.addCommand({
      id: "reindex-vault",
      name: "Reindex vault",
      callback: async () => {
        await this.index.rebuildAll();
        new Notice("Dimensions: reindexed");
        this.refreshEditors();
      },
    });
    this.addCommand({
      id: "reload-dimensions-config",
      name: `Reload ${CONFIG_PATH}`,
      callback: () => this.reloadDimensionsConfig(),
    });

    // Ribbon icon for quick access
    this.addRibbonIcon("layers", "Dimensions: Group by", () => this.activateGroupView());
  }

  async onunload(): Promise<void> {
    console.log("[Dimensions] unloading");
    removeDynamicStyles();
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Read `.dimensions.json` from vault root. On first run, create it with defaults.
  // On parse error: show a notice and fall back — to seeds on initial load,
  // or keep the current in-memory dimensions on reload.
  private async loadDimensionsFromConfig(opts: { isInitial: boolean }): Promise<void> {
    try {
      if (!(await configExists(this.app))) {
        await writeDefaultConfig(this.app);
        this.dimensions = SEED_DIMENSIONS;
        if (opts.isInitial) {
          new Notice(`Dimensions: created ${CONFIG_PATH} with defaults`);
        }
        return;
      }
      this.dimensions = await loadConfig(this.app);
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[Dimensions] config load error", e);
      new Notice(`Dimensions: ${msg}`);
      if (opts.isInitial) {
        this.dimensions = SEED_DIMENSIONS;
      }
      // On reload, leave this.dimensions untouched so the user keeps working state.
    }
  }

  private async reloadDimensionsConfig(): Promise<void> {
    await this.loadDimensionsFromConfig({ isInitial: false });

    // Propagate the new dimensions through every piece of state that depends on them.
    applyDynamicStyles(this.dimensions);
    this.index.setDimensions(this.dimensions);
    await this.index.rebuildAll();

    // Rebuild the editor extension with the new dimensions so line coloring picks them up.
    const ext = createColoringExtension({
      index: this.index,
      dimensions: this.dimensions,
      activeDimensionId: this.settings.activeColoringDimension,
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
    });
    this.editorExtensions.length = 0;
    this.editorExtensions.push(ext);
    this.app.workspace.updateOptions();

    // Notify open group-by views so their dropdowns and groupings refresh.
    this.app.workspace.getLeavesOfType(GROUP_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof GroupByView) view.setDimensions(this.dimensions);
    });

    this.refreshEditors();
    new Notice("Dimensions: config reloaded");
  }

  private async activateGroupView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(GROUP_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: GROUP_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private cycleColoringDimension(): void {
    const ids = [null as string | null, ...this.dimensions.map((d) => d.id)];
    const current = this.settings.activeColoringDimension;
    const idx = ids.indexOf(current);
    const next = ids[(idx + 1) % ids.length];
    this.settings.activeColoringDimension = next;
    void this.saveSettings();

    // Rebuild editor extension so the new active dimension is picked up.
    const ext = createColoringExtension({
      index: this.index,
      dimensions: this.dimensions,
      activeDimensionId: next,
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
    });
    this.editorExtensions.length = 0;
    this.editorExtensions.push(ext);
    this.app.workspace.updateOptions();
    this.refreshEditors();
    new Notice(`Dimensions: coloring = ${next ?? "off"}`);
  }

  private refreshEditors(): void {
    // Nudge CodeMirror to rebuild decorations by dispatching a no-op on every markdown view.
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as unknown as {
        editor?: {
          cm?: { dispatch: (tr: unknown) => void };
        };
      };
      const cm = view?.editor?.cm;
      if (cm) {
        try {
          cm.dispatch({ userEvent: "dim-refresh" });
        } catch {
          // no-op
        }
      }
    });
  }
}
