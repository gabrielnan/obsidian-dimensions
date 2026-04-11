// Dimensions — plugin entry point.

import { Editor, Plugin, TFile, WorkspaceLeaf, Notice } from "obsidian";
import { TransactionSpec } from "@codemirror/state";
import { VaultIndex } from "./src/index-store";
import { Dimension, ValueId } from "./src/model";
import {
  ColoringContext,
  createColoringExtension,
  dimensionsChangedEffect,
  refreshEffect,
  setActiveDimEffect,
} from "./src/decorations";
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
  private dimensions: Dimension[] = [];
  private coloringCtx!: ColoringContext;

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

    // Editor extension for in-editor line coloring + top-of-file control bar.
    // We hold the context as a plugin field so config reloads can swap the
    // dimension list in place (it's a mutable reference).
    this.coloringCtx = {
      index: this.index,
      dimensions: this.dimensions,
      initialActiveDimensionId: this.settings.activeColoringDimension,
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      onChange: (next) => {
        this.settings.activeColoringDimension = next;
        void this.saveSettings();
      },
    };
    this.registerEditorExtension(createColoringExtension(this.coloringCtx));

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
      name: "Cycle active coloring dimension (next)",
      callback: () => this.cycleColoringDimension(1),
    });
    this.addCommand({
      id: "cycle-coloring-dimension-prev",
      name: "Cycle active coloring dimension (previous)",
      callback: () => this.cycleColoringDimension(-1),
    });
    this.addCommand({
      id: "cycle-line-value-next",
      name: "Cycle current line value (next)",
      editorCallback: (editor) => this.cycleLineValue(editor, 1),
    });
    this.addCommand({
      id: "cycle-line-value-prev",
      name: "Cycle current line value (previous)",
      editorCallback: (editor) => this.cycleLineValue(editor, -1),
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

  // Read `.dimensions.json` from vault root. On first run, create an empty stub.
  // On parse error: show a notice and fall back — to empty on initial load,
  // or keep the current in-memory dimensions on reload.
  private async loadDimensionsFromConfig(opts: { isInitial: boolean }): Promise<void> {
    try {
      if (!(await configExists(this.app))) {
        await writeDefaultConfig(this.app);
        this.dimensions = [];
        if (opts.isInitial) {
          new Notice(`Dimensions: created empty ${CONFIG_PATH}`);
        }
        return;
      }
      this.dimensions = await loadConfig(this.app);
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[Dimensions] config load error", e);
      new Notice(`Dimensions: ${msg}`);
      if (opts.isInitial) {
        this.dimensions = [];
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

    // Swap the mutable dimension list the editor extension reads from, then
    // notify open panels so they re-render their option list. If the active
    // dim was removed, reset the active coloring to "off".
    this.coloringCtx.dimensions = this.dimensions;
    const activeId = this.settings.activeColoringDimension;
    const activeStillExists =
      activeId === null || this.dimensions.some((d) => d.id === activeId);
    if (!activeStillExists) {
      this.settings.activeColoringDimension = null;
      void this.saveSettings();
      this.dispatchToEditors({ effects: setActiveDimEffect.of(null) });
    }
    this.dispatchToEditors({ effects: dimensionsChangedEffect.of() });

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

  private cycleColoringDimension(direction: 1 | -1): void {
    const ids = [null as string | null, ...this.dimensions.map((d) => d.id)];
    const current = this.settings.activeColoringDimension;
    const idx = ids.indexOf(current);
    const next = ids[(idx + direction + ids.length) % ids.length];
    this.settings.activeColoringDimension = next;
    void this.saveSettings();
    this.dispatchToEditors({ effects: setActiveDimEffect.of(next) });
    new Notice(`Dimensions: coloring = ${next ?? "off"}`);
  }

  // Cycle the inline tag for the active coloring dimension on the cursor's
  // current line. The cycle sequence is [unset, v0, v1, ...] in declared
  // order; direction = +1 for next, -1 for previous. Only edits the current
  // line — frontmatter-level dims (file tags) must be set via Obsidian's
  // Properties UI.
  private cycleLineValue(editor: Editor, direction: 1 | -1): void {
    const activeId = this.settings.activeColoringDimension;
    if (!activeId) {
      new Notice("Dimensions: no active coloring dimension");
      return;
    }
    const dim = this.dimensions.find((d) => d.id === activeId);
    if (!dim || dim.values.length === 0) {
      new Notice(`Dimensions: no values defined for "${activeId}"`);
      return;
    }

    const cursor = editor.getCursor();
    const lineNum = cursor.line;
    const lineText = editor.getLine(lineNum);

    const sequence: (ValueId | null)[] = [null, ...dim.values.map((v) => v.id)];
    const current = extractDimTag(lineText, dim);
    const curIdx = sequence.indexOf(current);
    const nextIdx = (curIdx + direction + sequence.length) % sequence.length;
    const next = sequence[nextIdx];

    // Strip any existing tag for this dimension, then append the new one
    // (if any) at end of line.
    const stripped = stripDimTags(lineText, dim).replace(/[ \t]+$/, "");
    const newLine = next ? `${stripped} #${next}` : stripped;
    editor.setLine(lineNum, newLine);

    const label = dim.values.find((v) => v.id === next)?.label ?? next ?? "(unset)";
    new Notice(`${dim.label}: ${label}`);
  }

  private refreshEditors(): void {
    // Trigger a decoration rebuild on every open editor.
    this.dispatchToEditors({ effects: refreshEffect.of() });
  }

  private dispatchToEditors(spec: TransactionSpec): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as unknown as {
        editor?: {
          cm?: { dispatch: (tr: TransactionSpec) => void };
        };
      };
      const cm = view?.editor?.cm;
      if (cm) {
        try {
          cm.dispatch(spec);
        } catch {
          // no-op
        }
      }
    });
  }
}

// ---- Inline tag rewriting helpers (used by cycleLineValue) ----

// Find the first value tag on `text` that belongs to `dim`. Returns its id
// (e.g. "p0") or null if no tag for this dimension is present.
function extractDimTag(text: string, dim: Dimension): ValueId | null {
  const re = buildDimTagRegex(dim);
  if (!re) return null;
  const m = re.exec(text);
  return m ? m[1] : null;
}

// Remove every tag on `text` whose value id belongs to `dim`. Other tags
// (including those from other dimensions) are preserved. Leading whitespace
// is consumed together with the tag so the result doesn't end up with
// orphaned double spaces.
function stripDimTags(text: string, dim: Dimension): string {
  const ids = dim.values
    .map((v) => v.id)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  if (ids.length === 0) return text;
  const re = new RegExp(`\\s*#(?:${ids.join("|")})(?=\\s|$|[^\\w-])`, "g");
  return text.replace(re, "");
}

function buildDimTagRegex(dim: Dimension): RegExp | null {
  const ids = dim.values
    .map((v) => v.id)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  if (ids.length === 0) return null;
  return new RegExp(`(?:^|\\s)#(${ids.join("|")})(?=\\s|$|[^\\w-])`, "g");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
