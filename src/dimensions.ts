// Hardcoded seed attributes for Phase 1.
// In Phase 2 these become user-editable in the settings tab.

import { Dimension } from "./model";

export const SEED_DIMENSIONS: Dimension[] = [
  {
    id: "priority",
    label: "Priority",
    tagPrefix: "p",
    frontmatterKey: "priority",
    values: [
      { id: "p0", label: "P0 — must-win", color: "#ef4444", order: 0 },
      { id: "p1", label: "P1 — high",     color: "#f59e0b", order: 1 },
      { id: "p2", label: "P2 — normal",   color: "#eab308", order: 2 },
      { id: "p3", label: "P3 — low",      color: "#94a3b8", order: 3 },
    ],
  },
  {
    id: "timeframe",
    label: "Timeframe",
    tagPrefix: "t",
    frontmatterKey: "timeframe",
    values: [
      { id: "today",   label: "Today",   color: "#22c55e", order: 0 },
      { id: "week",    label: "Week",    color: "#06b6d4", order: 1 },
      { id: "month",   label: "Month",   color: "#6366f1", order: 2 },
      { id: "quarter", label: "Quarter", color: "#a855f7", order: 3 },
      { id: "year",    label: "Year",    color: "#ec4899", order: 4 },
    ],
  },
];
