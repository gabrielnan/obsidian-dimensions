// Vault-wide index: builds a unified Node tree, reacts to vault events,
// exposes a simple query API.

import { App, TFile, TFolder, debounce } from "obsidian";
import {
  AttrNode,
  Dimension,
  DimensionId,
  NodeFilter,
  NodeType,
  ValueId,
  VAULT_ROOT_ID,
  fileId,
  folderId,
} from "./model";
import { parseFile } from "./parser/file";
import { parseFolder } from "./parser/folder";
import { propagate } from "./parser/inheritance";
import { parseAvFrontmatterForFolder } from "./parser/folder-frontmatter";

type ChangeListener = () => void;

export class AttrIndex {
  private nodes = new Map<string, AttrNode>();
  private rootId = VAULT_ROOT_ID;
  private dimensions: Dimension[];
  private listeners = new Set<ChangeListener>();
  private notify: () => void;

  constructor(private app: App, dimensions: Dimension[]) {
    this.dimensions = dimensions;
    this.notify = debounce(() => {
      for (const l of this.listeners) l();
    }, 80, true);
  }

  setDimensions(dimensions: Dimension[]): void {
    this.dimensions = dimensions;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRoot(): AttrNode | undefined {
    return this.nodes.get(this.rootId);
  }

  getNode(id: string): AttrNode | undefined {
    return this.nodes.get(id);
  }

  getChildren(id: string): AttrNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return node.childIds.map((cid) => this.nodes.get(cid)).filter((n): n is AttrNode => !!n);
  }

  getAncestors(id: string): AttrNode[] {
    const out: AttrNode[] = [];
    let cur = this.nodes.get(id);
    while (cur && cur.parentId) {
      const parent = this.nodes.get(cur.parentId);
      if (!parent) break;
      out.push(parent);
      cur = parent;
    }
    return out.reverse();
  }

  nodeAtLine(filePath: string, line: number): AttrNode | undefined {
    // Linear scan over the file's nodes. Fine for small files; can be indexed later.
    for (const node of this.nodes.values()) {
      if (node.filePath === filePath && node.line === line) return node;
    }
    return undefined;
  }

  nodesInFile(filePath: string): AttrNode[] {
    const result: AttrNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.filePath === filePath && node.line !== null) result.push(node);
    }
    return result;
  }

  // ---- Build ----

  async rebuildAll(): Promise<void> {
    this.nodes.clear();
    const root = this.app.vault.getRoot();
    await this.walkFolder(root, null);
    this.runInheritance();
    this.notify();
  }

  private async walkFolder(folder: TFolder, parentId: string | null): Promise<void> {
    const folderNode = await parseFolder(folder, this.app.vault, this.dimensions, parentId);
    if (parentId) {
      const parent = this.nodes.get(parentId);
      if (parent) parent.childIds.push(folderNode.id);
    }
    this.nodes.set(folderNode.id, folderNode);

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        await this.walkFolder(child, folderNode.id);
      } else if (child instanceof TFile && child.extension === "md") {
        // Skip the folder's own _context.md from being indexed as a regular file subtree
        // (its frontmatter is already read at the folder level, and indexing bullets inside
        //  it as content nodes just adds noise).
        if (child.name === "_context.md") continue;
        await this.ingestFile(child, folderNode.id);
      }
    }
  }

  private async ingestFile(file: TFile, folderParentId: string): Promise<void> {
    const content = await this.app.vault.cachedRead(file);
    const { fileNode, nodes } = parseFile(file.path, content, this.dimensions);
    fileNode.parentId = folderParentId;
    const parent = this.nodes.get(folderParentId);
    if (parent && !parent.childIds.includes(fileNode.id)) {
      parent.childIds.push(fileNode.id);
    }
    for (const n of nodes) this.nodes.set(n.id, n);
  }

  // ---- Incremental updates ----

  async handleFileModified(file: TFile): Promise<void> {
    if (file.extension !== "md") return;

    // Special case: a folder's _context.md changed → re-read folder dims only.
    if (file.name === "_context.md") {
      const folder = file.parent;
      if (!folder) return;
      const fId = folder.isRoot() ? VAULT_ROOT_ID : folderId(folder.path);
      const folderNode = this.nodes.get(fId);
      if (folderNode) {
        const content = await this.app.vault.cachedRead(file);
        folderNode.ownDimensions = parseAvFrontmatterForFolder(content, this.dimensions);
        this.runInheritance();
        this.notify();
      }
      return;
    }

    // Drop the existing file subtree, reparse, splice back in.
    this.dropFileSubtree(file.path);
    const parentFolderPath = file.parent?.path ?? "/";
    const parentId =
      file.parent && !file.parent.isRoot() ? folderId(parentFolderPath) : VAULT_ROOT_ID;
    await this.ingestFile(file, parentId);
    this.runInheritance();
    this.notify();
  }

  async handleFileCreated(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    if (file.name === "_context.md") {
      // Same as modify: update folder dims
      return this.handleFileModified(file);
    }
    const parentId =
      file.parent && !file.parent.isRoot() ? folderId(file.parent.path) : VAULT_ROOT_ID;
    // Ensure the parent folder exists in the index.
    if (!this.nodes.has(parentId) && file.parent) {
      const folderNode = await parseFolder(file.parent, this.app.vault, this.dimensions, null);
      this.nodes.set(folderNode.id, folderNode);
    }
    await this.ingestFile(file, parentId);
    this.runInheritance();
    this.notify();
  }

  handleFileDeleted(path: string): void {
    this.dropFileSubtree(path);
    this.runInheritance();
    this.notify();
  }

  async handleFileRenamed(file: TFile, oldPath: string): Promise<void> {
    // Easiest correct path: drop by oldPath, ingest by new path.
    this.dropFileSubtree(oldPath);
    if (file.extension === "md") {
      const parentId =
        file.parent && !file.parent.isRoot() ? folderId(file.parent.path) : VAULT_ROOT_ID;
      if (file.name === "_context.md") {
        await this.handleFileModified(file);
      } else {
        await this.ingestFile(file, parentId);
      }
    }
    this.runInheritance();
    this.notify();
  }

  private dropFileSubtree(path: string): void {
    const fId = fileId(path);
    const fileNode = this.nodes.get(fId);
    if (!fileNode) return;

    // Remove from parent's childIds
    if (fileNode.parentId) {
      const parent = this.nodes.get(fileNode.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter((c) => c !== fId);
      }
    }

    // Drop every node whose filePath matches this file + the file node itself
    const toDrop: string[] = [fId];
    for (const [id, node] of this.nodes) {
      if (node.filePath === path && id !== fId) toDrop.push(id);
    }
    for (const id of toDrop) this.nodes.delete(id);
  }

  private runInheritance(): void {
    const root = this.nodes.get(this.rootId);
    if (!root) return;
    propagate(root, (id) => this.nodes.get(id));
  }

  // ---- Query API ----

  query(filter: NodeFilter): AttrNode[] {
    const scopeId = filter.scopeId ?? this.rootId;
    const scope = this.nodes.get(scopeId);
    if (!scope) return [];

    const result: AttrNode[] = [];
    const visit = (node: AttrNode) => {
      if (this.matches(node, filter)) result.push(node);
      for (const childId of node.childIds) {
        const child = this.nodes.get(childId);
        if (child) visit(child);
      }
    };
    visit(scope);
    return result;
  }

  private matches(node: AttrNode, filter: NodeFilter): boolean {
    if (filter.nodeTypes && !filter.nodeTypes.includes(node.type)) return false;
    if (filter.dimensionFilters) {
      for (const [dimId, values] of Object.entries(filter.dimensionFilters)) {
        if (values.length === 0) continue;
        const effective = node.effectiveDimensions.get(dimId);
        if (!effective || !values.includes(effective)) return false;
      }
    }
    return true;
  }

  // Bucket matching nodes by the value they have on a given dimension.
  groupByDimension(
    dimensionId: DimensionId,
    filter: NodeFilter,
  ): Map<ValueId | "__unset__", AttrNode[]> {
    const out = new Map<ValueId | "__unset__", AttrNode[]>();
    for (const node of this.query(filter)) {
      const v = node.effectiveDimensions.get(dimensionId) ?? "__unset__";
      const arr = out.get(v) ?? [];
      arr.push(node);
      out.set(v, arr);
    }
    return out;
  }
}
