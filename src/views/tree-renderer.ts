// Shared helper for rendering a list of AttrNodes into a DOM container,
// preserving local sub-hierarchy where children also match the current filter.

import { App, MarkdownView, WorkspaceLeaf } from "obsidian";
import { AttrNode } from "../model";
import { AttrIndex } from "../index-store";

export interface RenderOptions {
  showBreadcrumbs?: boolean;
}

export function renderNodeList(
  app: App,
  index: AttrIndex,
  container: HTMLElement,
  nodes: AttrNode[],
  options: RenderOptions = {},
): void {
  // Group by file for readability. Nodes without a file (folder nodes) go under a synthetic group.
  const matchSet = new Set(nodes.map((n) => n.id));

  // Identify top-level matches: a node is "top-level" if none of its ancestors are also in the match set.
  const topLevel: AttrNode[] = [];
  for (const node of nodes) {
    let anc = node.parentId ? index.getNode(node.parentId) : undefined;
    let covered = false;
    while (anc) {
      if (matchSet.has(anc.id)) {
        covered = true;
        break;
      }
      anc = anc.parentId ? index.getNode(anc.parentId) : undefined;
    }
    if (!covered) topLevel.push(node);
  }

  if (topLevel.length === 0) {
    const empty = container.createDiv({ cls: "av-empty" });
    empty.setText("No matches.");
    return;
  }

  for (const node of topLevel) {
    renderOne(app, index, container, node, matchSet, options);
  }
}

function renderOne(
  app: App,
  index: AttrIndex,
  container: HTMLElement,
  node: AttrNode,
  matchSet: Set<string>,
  options: RenderOptions,
): void {
  const el = container.createDiv({ cls: `av-node av-node-type-${node.type}` });

  if (options.showBreadcrumbs) {
    const crumb = buildBreadcrumb(index, node);
    if (crumb) {
      el.createDiv({ cls: "av-node-breadcrumb", text: crumb });
    }
  }

  const title = el.createSpan({ cls: "av-node-title" });
  title.setText(prefixForType(node) + node.title);

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    openNode(app, node);
  });

  // Render children that also matched (preserve local sub-hierarchy)
  const childMatches = node.childIds
    .map((cid) => index.getNode(cid))
    .filter((c): c is AttrNode => !!c && matchSet.has(c.id));
  if (childMatches.length > 0) {
    const childContainer = el.createDiv({ cls: "av-node-children" });
    for (const child of childMatches) {
      renderOne(app, index, childContainer, child, matchSet, { ...options, showBreadcrumbs: false });
    }
  }
}

function prefixForType(node: AttrNode): string {
  switch (node.type) {
    case "heading":
      return "#".repeat(node.depth || 1) + " ";
    case "bullet":
      return "• ";
    case "label":
      return "";
    case "file":
      return "📄 ";
    case "folder":
      return "📁 ";
  }
}

export function buildBreadcrumb(index: AttrIndex, node: AttrNode): string {
  const ancestors = index.getAncestors(node.id);
  // Drop the vault root for cleanliness.
  const parts: string[] = [];
  for (const anc of ancestors) {
    if (anc.type === "folder" && anc.title === "(vault)") continue;
    parts.push(anc.title);
  }
  return parts.join(" › ");
}

export async function openNode(app: App, node: AttrNode): Promise<void> {
  if (!node.filePath) return;
  const file = app.vault.getAbstractFileByPath(node.filePath);
  if (!file || !("extension" in file)) return;

  const leaf: WorkspaceLeaf = app.workspace.getLeaf(false);
  // @ts-expect-error — openFile exists on TFile leaves in runtime
  await leaf.openFile(file);

  if (node.line !== null) {
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      const editor = view.editor;
      editor.setCursor({ line: node.line, ch: 0 });
      editor.scrollIntoView({ from: { line: node.line, ch: 0 }, to: { line: node.line, ch: 0 } }, true);
    }
  }
}
