// CodeMirror 6 ViewPlugin that paints line decorations for nodes
// whose effective value on the active dimension is set.

import { Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { AtlasIndex } from "./index-store";
import { Dimension } from "./model";

export interface ColoringContext {
  index: AtlasIndex;
  dimensions: Dimension[];
  activeDimensionId: string | null;
  getActiveFilePath: () => string | null;
}

export function createColoringExtension(ctx: ColoringContext): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.geometryChanged) {
          this.decorations = this.build(update.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const activeDim = ctx.dimensions.find((d) => d.id === ctx.activeDimensionId);
        const filePath = ctx.getActiveFilePath();
        if (!activeDim || !filePath) return builder.finish();

        const nodes = ctx.index.nodesInFile(filePath);
        if (nodes.length === 0) return builder.finish();

        // Map line → value on active dim (only nodes with a line)
        const byLine = new Map<number, string>();
        for (const node of nodes) {
          if (node.line === null) continue;
          const v = node.effectiveDimensions.get(activeDim.id);
          if (v) byLine.set(node.line, v);
        }
        if (byLine.size === 0) return builder.finish();

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            const lineIdx = line.number - 1; // CodeMirror is 1-indexed
            const valueId = byLine.get(lineIdx);
            if (valueId) {
              builder.add(
                line.from,
                line.from,
                Decoration.line({ class: `atlas-dim-${activeDim.id}-${valueId}` }),
              );
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
  return plugin;
}
