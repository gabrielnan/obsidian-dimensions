// Dimensions — plugin entry point.

import { Plugin, TFile, WorkspaceLeaf, Notice } from "obsidian";
import { Extension } from "@codemirror/state";
import { VaultIndex } from "./src/index-store";
import { SEED_DIMENSIONS } from "./src/dimensions";
import { createColoringExtension } from "./src/decorations";
import { GroupByView, GROUP_VIEW_TYPE } from "./src/views/group-view";

interface DimensionsSettings {
  activeColoringDimension: string | null;
}

const DEFAULT_SETTINGS: DimensionsSettings = {
  activeColoringDimension: "priority",
};

export default class DimensionsPlugin extends Plugin {
  settings!: DimensionsSettings;
  index!: VaultIndex;
  private editorExtensions: Extension[] = [];

  async onload(): Promise<void> {
    console.log("[Dimensions] loading");
    await this.loadSettings();

    this.index = new VaultIndex(this.app, SEED_DIMENSIONS);

    // Register the group-by view.
    this.registerView(
      GROUP_VIEW_TYPE,
      (leaf: WorkspaceLeaf) =>
        new GroupByView(leaf, this.index, SEED_DIMENSIONS, SEED_DIMENSIONS[0].id),
    );

    // Editor extension for in-editor line coloring.
    const coloringExt = createColoringExtension({
      index: this.index,
      dimensions: SEED_DIMENSIONS,
      activeDimensionId: this.settings.activeColoringDimension,
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
    });
    this.editorExtensions.push(coloringExt);
    this.registerEditorExtension(this.editorExtensions);

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

    // Ribbon icon for quick access
    this.addRibbonIcon("layers", "Dimensions: Group by", () => this.activateGroupView());
  }

  async onunload(): Promise<void> {
    console.log("[Dimensions] unloading");
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    const ids = [null as string | null, ...SEED_DIMENSIONS.map((d) => d.id)];
    const current = this.settings.activeColoringDimension;
    const idx = ids.indexOf(current);
    const next = ids[(idx + 1) % ids.length];
    this.settings.activeColoringDimension = next;
    void this.saveSettings();

    // Rebuild editor extension so the new active dimension is picked up.
    const ext = createColoringExtension({
      index: this.index,
      dimensions: SEED_DIMENSIONS,
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
