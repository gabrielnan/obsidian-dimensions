// Top-down inheritance pass over the unified node tree.
// For each node, effectiveDimensions = parent.effectiveDimensions merged with node.ownDimensions
// (node's own value overrides inherited).

import { AttrNode } from "../model";

export function propagate(
  root: AttrNode,
  getNode: (id: string) => AttrNode | undefined,
): void {
  walk(root, new Map(), getNode);
}

function walk(
  node: AttrNode,
  inherited: Map<string, string>,
  getNode: (id: string) => AttrNode | undefined,
): void {
  const effective = new Map(inherited);
  for (const [k, v] of node.ownDimensions) effective.set(k, v);
  node.effectiveDimensions = effective;

  for (const childId of node.childIds) {
    const child = getNode(childId);
    if (child) walk(child, effective, getNode);
  }
}
