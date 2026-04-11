// CodeMirror 6 extension that paints line decorations for nodes whose
// effective value on the active dimension is set, plus a top-of-editor
// control bar for picking which dimension to color by.
//
// The active dimension is held in a per-editor StateField so the panel and
// the ViewPlugin can read/write it reactively, without rebuilding the whole
// extension on every change.

import { Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  Panel,
  ViewPlugin,
  ViewUpdate,
  showPanel,
} from "@codemirror/view";
import { VaultIndex } from "./index-store";
import { Dimension } from "./model";

// StateEffects dispatched by the plugin / panel.
export const setActiveDimEffect = StateEffect.define<string | null>();
export const dimensionsChangedEffect = StateEffect.define<void>();
export const refreshEffect = StateEffect.define<void>();

// Per-editor active dimension id ("off" = null).
export const activeDimField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setActiveDimEffect)) return e.value;
    }
    return value;
  },
});

export interface ColoringContext {
  index: VaultIndex;
  // Mutable reference — the plugin swaps this out on config reload and
  // dispatches `dimensionsChangedEffect` to notify open panels.
  dimensions: Dimension[];
  initialActiveDimensionId: string | null;
  getActiveFilePath: () => string | null;
  // Called when the user picks a new dimension from the panel so the plugin
  // can persist it to settings.
  onChange: (newId: string | null) => void;
}

export function createColoringExtension(ctx: ColoringContext): Extension {
  const field = activeDimField.init(() => ctx.initialActiveDimensionId);

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        const triggered = update.transactions.some((t) =>
          t.effects.some(
            (e) =>
              e.is(setActiveDimEffect) ||
              e.is(dimensionsChangedEffect) ||
              e.is(refreshEffect),
          ),
        );
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.geometryChanged ||
          update.selectionSet ||
          triggered
        ) {
          this.decorations = this.build(update.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const activeDimId = view.state.field(activeDimField);
        const activeDim = ctx.dimensions.find((d) => d.id === activeDimId);
        const filePath = ctx.getActiveFilePath();

        // Line coloring map. Built only when there's an active dim with
        // indexed nodes; otherwise coloring is skipped but tag-hiding still
        // runs below.
        let byLine: Map<number, string> | null = null;
        if (activeDim && filePath) {
          const nodes = ctx.index.nodesInFile(filePath);
          if (nodes.length > 0) {
            byLine = new Map();
            for (const node of nodes) {
              if (node.line === null) continue;
              const v = node.effectiveDimensions.get(activeDim.id);
              if (v) byLine.set(node.line, v);
            }
            if (byLine.size === 0) byLine = null;
          }
        }

        // Lines containing a cursor — tags on these lines stay visible so
        // the user can read/edit them. Multi-selection aware.
        const cursorLines = new Set<number>();
        for (const r of view.state.selection.ranges) {
          cursorLines.add(view.state.doc.lineAt(r.head).number);
        }

        const hideRegex = buildAllDimsRegex(ctx.dimensions);

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            const lineIdx = line.number - 1; // CodeMirror is 1-indexed

            // Line decoration first (same-position decorations need line
            // class to land before inline ranges).
            const valueId = byLine?.get(lineIdx);
            if (activeDim && valueId) {
              builder.add(
                line.from,
                line.from,
                Decoration.line({ class: `dim-${activeDim.id}-${valueId}` }),
              );
            }

            // Hide every dimension tag on lines that don't host a cursor.
            // Replace (not mark) so the hidden span takes no layout space —
            // the line reads clean as if the tag weren't there.
            if (hideRegex && !cursorLines.has(line.number)) {
              const text = line.text;
              hideRegex.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = hideRegex.exec(text)) !== null) {
                const start = line.from + m.index;
                const end = start + m[0].length;
                builder.add(start, end, Decoration.replace({}));
              }
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

  const panel = showPanel.of((view) => createDimPanel(view, ctx));

  return [field, plugin, panel];
}

function createDimPanel(view: EditorView, ctx: ColoringContext): Panel {
  const dom = document.createElement("div");
  dom.className = "dim-panel";

  const label = document.createElement("span");
  label.className = "dim-panel-label";
  label.textContent = "Color by";
  dom.appendChild(label);

  const select = document.createElement("select");
  select.className = "dim-panel-select";
  dom.appendChild(select);

  function renderOptions() {
    while (select.firstChild) select.removeChild(select.firstChild);
    const off = document.createElement("option");
    off.value = "";
    off.textContent = "off";
    select.appendChild(off);
    for (const dim of ctx.dimensions) {
      const opt = document.createElement("option");
      opt.value = dim.id;
      opt.textContent = dim.label;
      select.appendChild(opt);
    }
    const current = view.state.field(activeDimField) ?? "";
    // If the current value no longer exists in the list, fall back to "off".
    const exists = Array.from(select.options).some((o) => o.value === current);
    select.value = exists ? current : "";
  }

  renderOptions();

  select.addEventListener("change", () => {
    const next = select.value === "" ? null : select.value;
    view.dispatch({ effects: setActiveDimEffect.of(next) });
    ctx.onChange(next);
  });

  return {
    dom,
    top: true,
    update(update) {
      const dimsChanged = update.transactions.some((t) =>
        t.effects.some((e) => e.is(dimensionsChangedEffect)),
      );
      if (dimsChanged) {
        renderOptions();
        return;
      }
      // Re-sync if the field was updated from elsewhere (e.g. cycle command).
      const current = update.state.field(activeDimField) ?? "";
      if (select.value !== current) select.value = current;
    },
  };
}

// Union regex over every registered dimension value id, used to find tag
// spans to hide on non-cursor lines. Matches `#<id>` with optional leading
// whitespace so replacing the range also absorbs the space in front of the
// tag — keeps trailing text like `- foo #p0` from leaving a dangling space
// after the replace. Tags not belonging to any dimension are ignored.
function buildAllDimsRegex(dimensions: Dimension[]): RegExp | null {
  const ids = dimensions
    .flatMap((d) => d.values.map((v) => v.id))
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  if (ids.length === 0) return null;
  return new RegExp(`\\s?#(?:${ids.join("|")})(?=\\s|$|[^\\w-])`, "g");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
