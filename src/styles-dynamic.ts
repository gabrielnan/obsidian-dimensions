// Inject per-dimension/value CSS at runtime, so users can define new
// dimensions in `.dimensions.json` and get coloring without editing styles.css.

import { Dimension } from "./model";

const STYLE_ID = "dim-dynamic-styles";

export function applyDynamicStyles(dimensions: Dimension[]): void {
  removeDynamicStyles();
  const css = generateCss(dimensions);
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

export function removeDynamicStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
}

function generateCss(dimensions: Dimension[]): string {
  const rules: string[] = [];
  for (const dim of dimensions) {
    for (const value of dim.values) {
      const bg = hexToRgba(value.color, 0.06);
      rules.push(
        `.dim-${dim.id}-${value.id} { box-shadow: inset 4px 0 0 ${value.color}; background: ${bg}; }`,
      );
    }
  }
  return rules.join("\n");
}

function hexToRgba(color: string, alpha: number): string {
  const h = color.trim().replace(/^#/, "");
  if (h.length !== 3 && h.length !== 6) return color; // not a hex — let the browser handle it
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return color;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
