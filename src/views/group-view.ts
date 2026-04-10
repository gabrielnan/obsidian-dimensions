// Group-by view: renders the unified vault tree re-grouped by the values
// of a chosen dimension, constrained to a selected scope (vault / folder / file).

import { ItemView, WorkspaceLeaf, TFolder, TFile } from "obsidian";
import { VaultNode, Dimension, NodeFilter, VAULT_ROOT_ID, fileId, folderId } from "../model";
import { VaultIndex } from "../index-store";
import { renderNodeList } from "./tree-renderer";

export const GROUP_VIEW_TYPE = "dim-group-view";

interface ViewState {
  scopeId: string;
  dimensionId: string;
  nodeTypeFilter: "all" | "bullets" | "bullets-headings-labels";
}

export class GroupByView extends ItemView {
  private index: VaultIndex;
  private dimensions: Dimension[];
  private state: ViewState;
  private unsubscribe: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    index: VaultIndex,
    dimensions: Dimension[],
    initialDimensionId: string,
  ) {
    super(leaf);
    this.index = index;
    this.dimensions = dimensions;
    this.state = {
      scopeId: VAULT_ROOT_ID,
      dimensionId: initialDimensionId,
      nodeTypeFilter: "bullets-headings-labels",
    };
  }

  getViewType(): string {
    return GROUP_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Dimensions — Group by";
  }
  getIcon(): string {
    return "layers";
  }

  async onOpen(): Promise<void> {
    this.unsubscribe = this.index.onChange(() => this.refresh());
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  setDimensions(dimensions: Dimension[]): void {
    this.dimensions = dimensions;
    if (!this.dimensions.some((d) => d.id === this.state.dimensionId)) {
      this.state.dimensionId = this.dimensions[0]?.id ?? "";
    }
    this.refresh();
  }

  refresh(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("dim-view");

    this.renderControls(container);
    this.renderGroups(container);
  }

  private renderControls(container: HTMLElement): void {
    const controls = container.createDiv({ cls: "dim-controls" });

    // Dimension selector
    const dimRow = controls.createDiv({ cls: "dim-control-row" });
    dimRow.createEl("label", { text: "Group by" });
    const dimSelect = dimRow.createEl("select");
    for (const dim of this.dimensions) {
      const opt = dimSelect.createEl("option", { text: dim.label, value: dim.id });
      if (dim.id === this.state.dimensionId) opt.selected = true;
    }
    dimSelect.addEventListener("change", () => {
      this.state.dimensionId = dimSelect.value;
      this.refresh();
    });

    // Scope selector
    const scopeRow = controls.createDiv({ cls: "dim-control-row" });
    scopeRow.createEl("label", { text: "Scope" });
    const scopeSelect = scopeRow.createEl("select");

    const options = this.collectScopeOptions();
    for (const opt of options) {
      const el = scopeSelect.createEl("option", { text: opt.label, value: opt.id });
      if (opt.id === this.state.scopeId) el.selected = true;
    }
    scopeSelect.addEventListener("change", () => {
      this.state.scopeId = scopeSelect.value;
      this.refresh();
    });

    // Node type filter
    const typeRow = controls.createDiv({ cls: "dim-control-row" });
    typeRow.createEl("label", { text: "Show" });
    const typeSelect = typeRow.createEl("select");
    for (const [value, label] of [
      ["bullets-headings-labels", "Bullets + headings + labels"],
      ["bullets", "Bullets only"],
      ["all", "All nodes"],
    ] as const) {
      const opt = typeSelect.createEl("option", { text: label, value });
      if (value === this.state.nodeTypeFilter) opt.selected = true;
    }
    typeSelect.addEventListener("change", () => {
      this.state.nodeTypeFilter = typeSelect.value as ViewState["nodeTypeFilter"];
      this.refresh();
    });
  }

  private collectScopeOptions(): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [{ id: VAULT_ROOT_ID, label: "Vault root" }];

    // Add all folders
    const root = this.app.vault.getRoot();
    const walk = (folder: TFolder, prefix: string) => {
      if (!folder.isRoot()) {
        out.push({ id: folderId(folder.path), label: "📁 " + folder.path });
      }
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child, prefix + "  ");
      }
    };
    walk(root, "");

    // Add the currently active file (fast path)
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === "md") {
      out.push({ id: fileId(activeFile.path), label: "📄 " + activeFile.path + " (active)" });
    }

    return out;
  }

  private renderGroups(container: HTMLElement): void {
    const dim = this.dimensions.find((d) => d.id === this.state.dimensionId);
    if (!dim) {
      container.createDiv({ cls: "dim-empty", text: "No dimensions configured." });
      return;
    }

    const filter: NodeFilter = {
      scopeId: this.state.scopeId,
      nodeTypes:
        this.state.nodeTypeFilter === "bullets"
          ? ["bullet"]
          : this.state.nodeTypeFilter === "bullets-headings-labels"
            ? ["bullet", "heading", "label"]
            : undefined,
    };

    const buckets = this.index.groupByDimension(dim.id, filter);

    // Render groups in declared value order; put __unset__ last.
    const ordered = [...dim.values].sort((a, b) => a.order - b.order);
    let anyRendered = false;
    for (const value of ordered) {
      const nodes = buckets.get(value.id) ?? [];
      if (nodes.length === 0) continue;
      anyRendered = true;
      this.renderGroup(container, dim, value.id, value.label, value.color, nodes);
    }
    const unset = buckets.get("__unset__") ?? [];
    if (unset.length > 0) {
      anyRendered = true;
      this.renderGroup(container, dim, "__unset__", "(unset)", "#666", unset);
    }
    if (!anyRendered) {
      container.createDiv({ cls: "dim-empty", text: "No nodes in this scope." });
    }
  }

  private renderGroup(
    container: HTMLElement,
    _dim: Dimension,
    valueId: string,
    label: string,
    color: string,
    nodes: VaultNode[],
  ): void {
    const group = container.createDiv({ cls: "dim-group" });
    const header = group.createDiv({ cls: "dim-group-header" });
    const swatch = header.createSpan({ cls: "dim-group-swatch" });
    swatch.style.background = color;
    header.createSpan({ text: label });
    header.createSpan({ cls: "dim-group-count", text: String(nodes.length) });

    const body = group.createDiv({ cls: "dim-group-body" });

    header.addEventListener("click", () => {
      group.toggleClass("is-collapsed", !group.hasClass("is-collapsed"));
    });

    renderNodeList(this.app, this.index, body, nodes, { showBreadcrumbs: true });
    // Mark the valueId to satisfy the linter about unused identifier
    group.dataset.valueId = valueId;
  }
}
