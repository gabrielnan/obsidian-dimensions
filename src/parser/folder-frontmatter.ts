// Shared helper: extract the `av:` frontmatter block from a markdown file's content.
// Used by the folder parser to read folder-level dimensions from _context.md.

import { Dimension, DimensionId, ValueId } from "../model";

export function parseAvFrontmatterForFolder(
  content: string,
  dimensions: Dimension[],
): Map<DimensionId, ValueId> {
  const out = new Map<DimensionId, ValueId>();
  const lines = content.split("\n");
  if (lines.length === 0 || !/^---\s*$/.test(lines[0])) return out;

  const fmEnd = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  if (fmEnd < 0) return out;

  const fmLines = lines.slice(1, fmEnd);
  let inBlock = false;
  for (const raw of fmLines) {
    const line = raw.replace(/\r$/, "");
    if (!inBlock) {
      const inline = line.match(/^av\s*:\s*\{(.+)\}\s*$/);
      if (inline) {
        for (const pair of inline[1].split(",")) {
          const m = pair.match(/^\s*([a-zA-Z0-9_\-]+)\s*:\s*([a-zA-Z0-9_\-]+)\s*$/);
          if (m) assign(m[1], m[2], dimensions, out);
        }
        continue;
      }
      if (/^av\s*:\s*$/.test(line)) {
        inBlock = true;
        continue;
      }
      continue;
    }
    const kv = line.match(/^\s+([a-zA-Z0-9_\-]+)\s*:\s*([a-zA-Z0-9_\-]+)\s*$/);
    if (kv) {
      assign(kv[1], kv[2], dimensions, out);
      continue;
    }
    if (/^\S/.test(line)) inBlock = false;
  }
  return out;
}

function assign(
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
