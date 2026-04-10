// Folder parser: creates folder nodes and reads folder-level dimensions
// from a `dimensions:` block in `_context.md` frontmatter (or a `_dimensions.yaml` sidecar later).

import { Vault, TFile, TFolder } from "obsidian";
import { VaultNode, Dimension, VAULT_ROOT_ID, folderId, newNode } from "../model";
import { parseDimensionsFrontmatterForFolder } from "./folder-frontmatter";

export async function parseFolder(
  folder: TFolder,
  vault: Vault,
  dimensions: Dimension[],
  parentId: string | null,
): Promise<VaultNode> {
  const isRoot = folder.isRoot();
  const id = isRoot ? VAULT_ROOT_ID : folderId(folder.path);

  const node = newNode({
    id,
    type: "folder",
    title: isRoot ? "(vault)" : folder.name,
    rawText: folder.path,
  });
  node.parentId = parentId;

  // Look for a _context.md sibling
  const contextFile = folder.children.find(
    (c): c is TFile => c instanceof TFile && c.name === "_context.md",
  );
  if (contextFile) {
    try {
      const content = await vault.cachedRead(contextFile);
      node.ownDimensions = parseDimensionsFrontmatterForFolder(content, dimensions);
    } catch {
      // ignore
    }
  }

  return node;
}
