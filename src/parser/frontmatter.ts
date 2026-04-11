// Extract file/folder dimension assignments from markdown YAML frontmatter.
//
// Primary form: use Obsidian's built-in `tags:` list. Each entry is a value id
// (e.g. "p0", "sw"); the parser looks it up in the global id→dimension map
// (same map used for inline `#p0` tags). Non-matching tags are silently ignored
// so you can mix dimension tags with regular tags freely.
//
// Legacy fallback: `dimensions: { ... }` or `dimensions:\n  key: value` block,
// keyed by each dimension's frontmatterKey. Kept so existing vaults don't
// break; the legacy block wins if both forms set the same dimension.

import { Dimension, DimensionId, ValueId } from "../model";

const FRONTMATTER_FENCE = /^---\s*$/;

export function parseFrontmatterDimensions(
  content: string,
  dimensions: Dimension[],
): Map<DimensionId, ValueId> {
  const out = new Map<DimensionId, ValueId>();
  const fm = extractFrontmatter(content);
  if (!fm) return out;

  const idToDim = new Map<string, string>();
  for (const d of dimensions) for (const v of d.values) idToDim.set(v.id, d.id);

  // Primary: tags list. Legacy form can still override if both are present.
  parseTags(fm, idToDim, out);
  parseLegacyDimensionsBlock(fm, dimensions, out);

  return out;
}

function extractFrontmatter(content: string): string[] | null {
  const lines = content.split("\n");
  if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0])) return null;
  const end = lines.findIndex((l, i) => i > 0 && FRONTMATTER_FENCE.test(l));
  if (end < 0) return null;
  return lines.slice(1, end).map((l) => l.replace(/\r$/, ""));
}

function parseTags(
  fm: string[],
  idToDim: Map<string, string>,
  out: Map<DimensionId, ValueId>,
): void {
  for (let i = 0; i < fm.length; i++) {
    const line = fm[i];

    // Inline list form: `tags: [p0, sw]`
    const inlineList = line.match(/^tags\s*:\s*\[(.*)\]\s*$/);
    if (inlineList) {
      for (const item of inlineList[1].split(",")) {
        resolve(cleanItem(item), idToDim, out);
      }
      continue;
    }

    // Block list form: `tags:` followed by indented `- item` lines.
    if (/^tags\s*:\s*$/.test(line)) {
      for (let j = i + 1; j < fm.length; j++) {
        const next = fm[j];
        const itemMatch = next.match(/^\s+-\s*(.*)$/);
        if (itemMatch) {
          resolve(cleanItem(itemMatch[1]), idToDim, out);
          continue;
        }
        if (next.trim() === "") continue; // blank lines allowed inside
        break; // first non-blank, non-indented-dash line ends the list
      }
      continue;
    }

    // Scalar form: `tags: p0` (single value on one line)
    const scalar = line.match(/^tags\s*:\s*([^\s\[].*)$/);
    if (scalar) {
      resolve(cleanItem(scalar[1]), idToDim, out);
    }
  }
}

// Strip surrounding whitespace, optional quotes, and a leading `#`
// (Obsidian's Properties UI writes tags without `#`, but some people add it).
function cleanItem(s: string): string {
  return s
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(/^#/, "");
}

function resolve(
  tagName: string,
  idToDim: Map<string, string>,
  out: Map<DimensionId, ValueId>,
): void {
  if (!tagName) return;
  const dimId = idToDim.get(tagName);
  if (dimId !== undefined) out.set(dimId, tagName);
}

function parseLegacyDimensionsBlock(
  fm: string[],
  dimensions: Dimension[],
  out: Map<DimensionId, ValueId>,
): void {
  let inBlock = false;
  for (const line of fm) {
    if (!inBlock) {
      const inline = line.match(/^dimensions\s*:\s*\{(.+)\}\s*$/);
      if (inline) {
        for (const pair of inline[1].split(",")) {
          const m = pair.match(/^\s*([a-zA-Z0-9_\-]+)\s*:\s*([a-zA-Z0-9_\-]+)\s*$/);
          if (m) assignByKey(m[1], m[2], dimensions, out);
        }
        continue;
      }
      if (/^dimensions\s*:\s*$/.test(line)) {
        inBlock = true;
      }
      continue;
    }
    const kv = line.match(/^\s+([a-zA-Z0-9_\-]+)\s*:\s*([a-zA-Z0-9_\-]+)\s*$/);
    if (kv) {
      assignByKey(kv[1], kv[2], dimensions, out);
      continue;
    }
    if (/^\S/.test(line)) inBlock = false;
  }
}

function assignByKey(
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
