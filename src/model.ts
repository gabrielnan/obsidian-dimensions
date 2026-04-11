// Core data model for Dimensions.
// A single unified semantic tree spans the whole vault:
//   folder → file → heading → label → bullet
// Every node can carry dimension values; descendants inherit them.

export type NodeType = "folder" | "file" | "heading" | "label" | "bullet";
export type DimensionId = string;
export type ValueId = string;

export interface DimensionValue {
  id: ValueId; // e.g. "p0" — also the inline tag written in markdown (#p0)
  label: string; // e.g. "P0"
  color: string; // CSS color, e.g. "#ff4d4d"
  order: number; // sort order within the dimension
}

export interface Dimension {
  id: DimensionId; // e.g. "priority"
  label: string; // e.g. "Priority"
  frontmatterKey: string; // e.g. "priority" under the `dimensions:` block
  values: DimensionValue[];
}

export interface VaultNode {
  id: string; // stable id: "folder:<path>" | "file:<path>" | "<path>#L<line>"
  type: NodeType;
  title: string; // display text
  rawText: string; // raw line content (or file/folder name for roots)

  // Semantic tree
  parentId: string | null;
  childIds: string[];

  // Source location
  filePath: string | null; // null for folder nodes
  line: number | null; // 0-indexed, null for folder/file roots
  depth: number; // bullet indent depth (0 for non-bullet)

  // Dimensions
  ownDimensions: Map<DimensionId, ValueId>;
  effectiveDimensions: Map<DimensionId, ValueId>;
}

export interface NodeFilter {
  scopeId?: string;
  dimensionFilters?: Record<DimensionId, ValueId[]>; // AND across dims, OR within a dim
  nodeTypes?: NodeType[];
}

export const VAULT_ROOT_ID = "folder:/";

export function folderId(path: string): string {
  const p = path === "" || path === "/" ? "/" : path;
  return `folder:${p}`;
}

export function fileId(path: string): string {
  return `file:${path}`;
}

export function lineNodeId(path: string, line: number): string {
  return `${path}#L${line}`;
}

export function newNode(partial: Partial<VaultNode> & { id: string; type: NodeType; title: string }): VaultNode {
  return {
    rawText: partial.title,
    parentId: null,
    childIds: [],
    filePath: null,
    line: null,
    depth: 0,
    ownDimensions: new Map(),
    effectiveDimensions: new Map(),
    ...partial,
  };
}
