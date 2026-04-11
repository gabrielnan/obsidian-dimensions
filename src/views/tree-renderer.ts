// Shared helper for rendering a list of VaultNodes into a DOM container,
// preserving local sub-hierarchy where children also match the current filter.

import { App, MarkdownView, WorkspaceLeaf } from "obsidian";
import { VaultNode } from "../model";
import { VaultIndex } from "../index-store";

export interface RenderOptions {
  showBreadcrumbs?: boolean;
}

export function renderNodeList(
  app: App,
  index: VaultIndex,
  container: HTMLElement,
  nodes: VaultNode[],
  options: RenderOptions = {},
): void {
  // Group by file for readability. Nodes without a file (folder nodes) go under a synthetic group.
  const matchSet = new Set(nodes.map((n) => n.id));

  // Identify top-level matches: a node is "top-level" if none of its ancestors are also in the match set.
  const topLevel: VaultNode[] = [];
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
    const empty = container.createDiv({ cls: "dim-empty" });
    empty.setText("No matches.");
    return;
  }

  if (options.showBreadcrumbs === false) {
    // Flat render without breadcrumb grouping
    for (const node of topLevel) {
      renderOne(app, index, container, node, matchSet, options);
    }
    return;
  }

  // Build a trie keyed by ancestor node id so that matches sharing a breadcrumb
  // prefix (e.g. "a › b › c") collapse into nested display groups instead of
  // each rendering its own redundant full path.
  const trie = buildPathTrie(topLevel, index);
  const groups = collectDisplayGroups(trie);
  for (const g of groups) {
    renderDisplayGroup(app, index, container, g, matchSet, options);
  }
}

// ---- Path-prefix grouping ----

interface TrieNode {
  ancestor: VaultNode | null; // null only for root
  matches: VaultNode[]; // top-level matches whose path ends here
  children: Map<string, TrieNode>; // keyed by ancestor node id
}

interface DisplayGroup {
  segments: VaultNode[]; // collapsed ancestor chain; each segment is clickable
  matches: VaultNode[];
  children: DisplayGroup[];
}

function buildPathTrie(topLevel: VaultNode[], index: VaultIndex): TrieNode {
  const root: TrieNode = { ancestor: null, matches: [], children: new Map() };
  for (const match of topLevel) {
    const ancestors = index
      .getAncestors(match.id)
      .filter((a) => !(a.type === "folder" && a.title === "(vault)"));
    let cur = root;
    for (const anc of ancestors) {
      let child = cur.children.get(anc.id);
      if (!child) {
        child = { ancestor: anc, matches: [], children: new Map() };
        cur.children.set(anc.id, child);
      }
      cur = child;
    }
    cur.matches.push(match);
  }
  return root;
}

// Collapse a single-child chain with no matches into one display label
// (e.g. a → b → c becomes "a › b › c" when there's nothing to emit mid-chain).
function descendCollapsed(node: TrieNode, accumulated: VaultNode[]): DisplayGroup {
  const nextSegments = node.ancestor ? [...accumulated, node.ancestor] : accumulated;
  const hasMatches = node.matches.length > 0;
  const childCount = node.children.size;
  const isBranchOrLeaf = hasMatches || childCount !== 1;
  if (isBranchOrLeaf) {
    return {
      segments: nextSegments,
      matches: node.matches,
      children: [...node.children.values()].map((c) => descendCollapsed(c, [])),
    };
  }
  // Exactly one child, no matches → absorb it into this display label.
  const onlyChild = node.children.values().next().value as TrieNode;
  return descendCollapsed(onlyChild, nextSegments);
}

function collectDisplayGroups(root: TrieNode): DisplayGroup[] {
  // The root itself never contributes a segment. If it has one child and no
  // matches, start collapsing from there. Otherwise emit each child as its
  // own top-level group.
  if (root.matches.length === 0 && root.children.size === 1) {
    const only = root.children.values().next().value as TrieNode;
    return [descendCollapsed(only, [])];
  }
  const groups: DisplayGroup[] = [];
  if (root.matches.length > 0) {
    groups.push({ segments: [], matches: root.matches, children: [] });
  }
  for (const child of root.children.values()) {
    groups.push(descendCollapsed(child, []));
  }
  return groups;
}

function renderDisplayGroup(
  app: App,
  index: VaultIndex,
  container: HTMLElement,
  group: DisplayGroup,
  matchSet: Set<string>,
  options: RenderOptions,
): void {
  const el = container.createDiv({ cls: "dim-pathgroup" });
  const hasLabel = group.segments.length > 0;

  if (hasLabel) {
    const row = el.createDiv({ cls: "dim-node dim-pathgroup-label" });
    // Clicking anywhere on the row opens the deepest segment (the file or
    // heading closest to the matches below).
    const deepest = group.segments[group.segments.length - 1];
    row.addEventListener("click", () => openNode(app, deepest));
    row.createSpan({
      cls: "dim-node-title",
      text: group.segments.map((s) => s.title).join(" › "),
    });
  }

  // Matches and nested subgroups share one body wrapper so the label's hover
  // state can highlight the whole block below it via CSS adjacent-sibling.
  // The body is only indented when there's a label above it; a top-level
  // group with no label renders flat.
  const body = el.createDiv({
    cls: hasLabel ? "dim-pathgroup-body is-indented" : "dim-pathgroup-body",
  });
  for (const match of group.matches) {
    renderOne(app, index, body, match, matchSet, { ...options, showBreadcrumbs: false });
  }
  for (const child of group.children) {
    renderDisplayGroup(app, index, body, child, matchSet, options);
  }
}

function renderOne(
  app: App,
  index: VaultIndex,
  container: HTMLElement,
  node: VaultNode,
  matchSet: Set<string>,
  options: RenderOptions,
): void {
  const el = container.createDiv({ cls: `dim-node dim-node-type-${node.type}` });

  if (options.showBreadcrumbs) {
    const crumb = buildBreadcrumb(index, node);
    if (crumb) {
      el.createDiv({ cls: "dim-node-breadcrumb", text: crumb });
    }
  }

  const title = el.createSpan({ cls: "dim-node-title" });
  title.setText(prefixForType(node) + node.title);

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    openNode(app, node);
  });

  // Render children that also matched (preserve local sub-hierarchy)
  const childMatches = node.childIds
    .map((cid) => index.getNode(cid))
    .filter((c): c is VaultNode => !!c && matchSet.has(c.id));
  if (childMatches.length > 0) {
    const childContainer = el.createDiv({ cls: "dim-node-children" });
    for (const child of childMatches) {
      renderOne(app, index, childContainer, child, matchSet, { ...options, showBreadcrumbs: false });
    }
  }
}

function prefixForType(node: VaultNode): string {
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

export function buildBreadcrumb(index: VaultIndex, node: VaultNode): string {
  const ancestors = index.getAncestors(node.id);
  // Drop the vault root for cleanliness.
  const parts: string[] = [];
  for (const anc of ancestors) {
    if (anc.type === "folder" && anc.title === "(vault)") continue;
    parts.push(anc.title);
  }
  return parts.join(" › ");
}

export async function openNode(app: App, node: VaultNode): Promise<void> {
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
