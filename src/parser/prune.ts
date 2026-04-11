// Lean-indexing post-parse step.
//
// parseFile always returns the full heading/label/bullet tree for a file.
// selectRetainedNodes decides which of those nodes actually go into the
// VaultIndex, based on two simple rules:
//
//   1. keepAll: if the file is opted-in (dim-index: true) or the file node
//      itself carries dimensions via `tags:` frontmatter, every node is kept.
//
//   2. otherwise: only "tag roots" (non-file nodes with explicit ownDimensions)
//      and all their descendants are kept. Untagged ancestors — headings,
//      labels, intermediate bullets — are dropped. Surviving tag roots are
//      reparented directly to the file node so the tree remains connected.
//
// If nothing is retained, returns []. The caller then skips the file entirely
// (no file node is inserted into the index either).
//
// Inheritance correctness: a tag root is, by definition, the seed for its
// dimension within the retained subtree, so dropping untagged ancestors can't
// change any descendant's effective value. Folder dimensions still flow in
// because the file node's parentId still points at its folder.

import { VaultNode } from "../model";

export function selectRetainedNodes(
  fileNode: VaultNode,
  allNodes: VaultNode[],
  opts: { keepAll: boolean },
): VaultNode[] {
  if (opts.keepAll) return allNodes;

  const byId = new Map<string, VaultNode>();
  for (const n of allNodes) byId.set(n.id, n);

  // Tag roots: non-file nodes with their own explicit dimension value(s).
  const tagRoots: VaultNode[] = [];
  for (const n of allNodes) {
    if (n.type === "file") continue;
    if (n.ownDimensions.size > 0) tagRoots.push(n);
  }
  if (tagRoots.length === 0) return [];

  // Collect each tag root + every descendant via childIds.
  const retainedIds = new Set<string>();
  const stack: VaultNode[] = [...tagRoots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (retainedIds.has(node.id)) continue;
    retainedIds.add(node.id);
    for (const childId of node.childIds) {
      const child = byId.get(childId);
      if (child) stack.push(child);
    }
  }

  // Drop any tag root that is itself a descendant of another tag root — it's
  // already captured under its ancestor and shouldn't be double-reparented.
  const topLevelTagRoots: VaultNode[] = [];
  for (const root of tagRoots) {
    let p = root.parentId;
    let nested = false;
    while (p) {
      // If any ancestor up to the file is also a tag root, this one is nested.
      const parent = byId.get(p);
      if (!parent) break;
      if (parent.type === "file") break;
      if (parent.ownDimensions.size > 0) {
        nested = true;
        break;
      }
      p = parent.parentId;
    }
    if (!nested) topLevelTagRoots.push(root);
  }

  // Reparent top-level tag roots directly to the file node.
  for (const root of topLevelTagRoots) {
    root.parentId = fileNode.id;
  }
  fileNode.childIds = topLevelTagRoots.map((r) => r.id);

  // For retained non-root nodes, filter their childIds to only retained ones
  // (descendants stay connected; dropped siblings get pruned out).
  for (const id of retainedIds) {
    const node = byId.get(id);
    if (!node) continue;
    if (topLevelTagRoots.includes(node)) continue; // already rewritten above
    node.childIds = node.childIds.filter((cid) => retainedIds.has(cid));
  }

  const retained: VaultNode[] = [fileNode];
  for (const n of allNodes) {
    if (retainedIds.has(n.id)) retained.push(n);
  }
  return retained;
}
