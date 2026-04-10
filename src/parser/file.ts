// Parse a single markdown file into a subtree of VaultNodes.
// (Vault-wide unified tree: folder → file → heading → label → bullet.)
// Handles YAML frontmatter (for file-level dimensions), headings, "label" lines,
// and bullet lists with inheritance-friendly parent/child linking.

import { VaultNode, Dimension, DimensionId, ValueId, fileId, lineNodeId, newNode } from "../model";

export interface FileParseResult {
  fileNode: VaultNode;
  nodes: VaultNode[]; // all nodes created for this file, including fileNode
}

interface StackEntry {
  node: VaultNode;
  headingLevel?: number; // only for heading nodes
  bulletDepth?: number; // only for bullet nodes
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/;
const FRONTMATTER_FENCE = /^---\s*$/;
// Label heuristic: a non-blank, non-heading, non-bullet line is a label when it
// (a) is short (<= LABEL_MAX_LEN chars after stripping tags)
// (b) contains no mid-line prose punctuation (periods, commas, question/exclamation, semicolons, colons)
// (c) is immediately followed — through any blank lines — by a bullet.
// This catches things like `**TODAY**`, `MUST-WIN`, `Learning`, `Goals`.
const LABEL_MAX_LEN = 80;
const PROSE_PUNCT_RE = /[.,;:?!]/;

export function parseFile(
  path: string,
  content: string,
  dimensions: Dimension[],
  options: { detectLabels: boolean } = { detectLabels: true },
): FileParseResult {
  const lines = content.split("\n");

  // ---- Frontmatter extraction (file-level dimensions) ----
  let bodyStart = 0;
  const ownDims = new Map<DimensionId, ValueId>();
  if (lines.length > 0 && FRONTMATTER_FENCE.test(lines[0])) {
    for (let i = 1; i < lines.length; i++) {
      if (FRONTMATTER_FENCE.test(lines[i])) {
        bodyStart = i + 1;
        parseDimensionsFrontmatter(lines.slice(1, i), dimensions, ownDims);
        break;
      }
    }
  }

  const fileBasename = path.split("/").pop() ?? path;
  const fileNode = newNode({
    id: fileId(path),
    type: "file",
    title: fileBasename.replace(/\.md$/, ""),
    rawText: path,
    filePath: path,
  });
  fileNode.ownDimensions = ownDims;

  const nodes: VaultNode[] = [fileNode];

  // ---- Body walk ----
  const stack: StackEntry[] = [{ node: fileNode }];

  const peek = () => stack[stack.length - 1];

  const attachUnderCurrent = (child: VaultNode) => {
    const parent = peek().node;
    child.parentId = parent.id;
    parent.childIds.push(child.id);
  };

  // Find the nearest ancestor on the stack with headingLevel < level (for headings)
  const popToHeadingLevel = (level: number) => {
    while (stack.length > 1) {
      const top = peek();
      if (top.headingLevel !== undefined && top.headingLevel < level) break;
      // Also pop non-heading intermediate nodes (bullets, labels) so new heading
      // attaches to the file or a shallower heading.
      if (top.headingLevel !== undefined && top.headingLevel >= level) {
        stack.pop();
        continue;
      }
      if (top.headingLevel === undefined && top.node.type !== "file") {
        stack.pop();
        continue;
      }
      break;
    }
  };

  const popToBulletDepth = (depth: number) => {
    while (stack.length > 1) {
      const top = peek();
      if (top.bulletDepth !== undefined && top.bulletDepth < depth) break;
      if (top.bulletDepth !== undefined && top.bulletDepth >= depth) {
        stack.pop();
        continue;
      }
      // A non-bullet node (heading, label, file) is a valid bullet parent when depth is the minimum.
      break;
    }
  };

  const popNonHeadingNonFile = () => {
    while (stack.length > 1) {
      const top = peek();
      if (top.node.type === "heading" || top.node.type === "file") break;
      stack.pop();
    }
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    // Heading
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      popToHeadingLevel(level);

      const node = newNode({
        id: lineNodeId(path, i),
        type: "heading",
        title: stripTags(text, dimensions),
        rawText: line,
        filePath: path,
        line: i,
        depth: level,
      });
      node.ownDimensions = extractTags(text, dimensions);
      attachUnderCurrent(node);
      nodes.push(node);
      stack.push({ node, headingLevel: level });
      continue;
    }

    // Bullet
    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      const indent = bulletMatch[1];
      const text = bulletMatch[2].trim();
      const depth = computeIndentDepth(indent);

      popToBulletDepth(depth);

      const node = newNode({
        id: lineNodeId(path, i),
        type: "bullet",
        title: stripTags(text, dimensions),
        rawText: line,
        filePath: path,
        line: i,
        depth,
      });
      node.ownDimensions = extractTags(text, dimensions);
      attachUnderCurrent(node);
      nodes.push(node);
      stack.push({ node, bulletDepth: depth });
      continue;
    }

    // Label detection: a non-blank, non-heading, non-bullet line is a label when
    // a bullet follows it (through any blank lines), the stripped body is short,
    // and it doesn't look like prose.
    if (options.detectLabels) {
      const strippedForMatch = stripTags(line, dimensions);
      // Unwrap surrounding bold/italic markers for display purposes: **TODAY** → TODAY
      const labelBody = strippedForMatch
        .replace(/^[*_]{1,3}(.+?)[*_]{1,3}$/, "$1")
        .trim();
      const isShortEnough = labelBody.length > 0 && labelBody.length <= LABEL_MAX_LEN;
      const looksProseFree = !PROSE_PUNCT_RE.test(labelBody);
      if (isShortEnough && looksProseFree) {
        // Look ahead: next non-blank line must be a bullet.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        const next = lines[j] ?? "";
        if (BULLET_RE.test(next)) {
          // Labels attach at heading level — pop any open bullets/labels first.
          popNonHeadingNonFile();
          const node = newNode({
            id: lineNodeId(path, i),
            type: "label",
            title: labelBody,
            rawText: line,
            filePath: path,
            line: i,
            depth: 0,
          });
          node.ownDimensions = extractTags(line, dimensions);
          attachUnderCurrent(node);
          nodes.push(node);
          stack.push({ node });
          continue;
        }
      }
    }
    // Otherwise: plain prose line, ignored (not indexed as a node).
  }

  return { fileNode, nodes };
}

function computeIndentDepth(indent: string): number {
  // Tabs count as one unit; 2-4 spaces also count as one unit.
  let depth = 0;
  let spaces = 0;
  for (const ch of indent) {
    if (ch === "\t") {
      if (spaces > 0) {
        depth += 1;
        spaces = 0;
      }
      depth += 1;
    } else if (ch === " ") {
      spaces += 1;
      if (spaces >= 2) {
        depth += 1;
        spaces = 0;
      }
    }
  }
  return depth + 1; // depth=1 is the shallowest bullet
}

export function extractTags(text: string, dimensions: Dimension[]): Map<DimensionId, ValueId> {
  const result = new Map<DimensionId, ValueId>();
  for (const dim of dimensions) {
    const re = new RegExp(`(?:^|\\s)#${escapeRegex(dim.tagPrefix)}/([\\w\\-]+)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const valueId = m[1];
      if (dim.values.some((v) => v.id === valueId)) {
        result.set(dim.id, valueId);
      }
    }
  }
  return result;
}

export function stripTags(text: string, dimensions: Dimension[]): string {
  let out = text;
  for (const dim of dimensions) {
    const re = new RegExp(`(?:^|\\s)#${escapeRegex(dim.tagPrefix)}/[\\w\\-]+`, "g");
    out = out.replace(re, "");
  }
  return out.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Minimal, tolerant YAML subset parser for frontmatter's `dimensions:` block.
// Supports either inline form `dimensions: { priority: p0 }` or nested form:
//   dimensions:
//     priority: p0
//     timeframe: week
function parseDimensionsFrontmatter(
  fmLines: string[],
  dimensions: Dimension[],
  out: Map<DimensionId, ValueId>,
): void {
  let inBlock = false;
  for (const raw of fmLines) {
    const line = raw.replace(/\r$/, "");
    if (!inBlock) {
      // Inline form
      const inlineMatch = line.match(/^dimensions\s*:\s*\{(.+)\}\s*$/);
      if (inlineMatch) {
        parseInlinePairs(inlineMatch[1], dimensions, out);
        continue;
      }
      if (/^dimensions\s*:\s*$/.test(line)) {
        inBlock = true;
        continue;
      }
      continue;
    }
    // In block: indented key:value pairs
    const kvMatch = line.match(/^\s+([a-zA-Z0-9_\-]+)\s*:\s*([a-zA-Z0-9_\-]+)\s*$/);
    if (kvMatch) {
      assignByFrontmatterKey(kvMatch[1], kvMatch[2], dimensions, out);
      continue;
    }
    // Non-indented line ends the block
    if (/^\S/.test(line)) {
      inBlock = false;
    }
  }
}

function parseInlinePairs(inner: string, dimensions: Dimension[], out: Map<DimensionId, ValueId>): void {
  for (const pair of inner.split(",")) {
    const m = pair.match(/^\s*([a-zA-Z0-9_\-]+)\s*:\s*([a-zA-Z0-9_\-]+)\s*$/);
    if (m) assignByFrontmatterKey(m[1], m[2], dimensions, out);
  }
}

function assignByFrontmatterKey(
  key: string,
  value: string,
  dimensions: Dimension[],
  out: Map<DimensionId, ValueId>,
): void {
  const dim = dimensions.find((d) => d.frontmatterKey === key);
  if (!dim) return;
  if (!dim.values.some((v) => v.id === value)) return;
  out.set(dim.id, value);
}
