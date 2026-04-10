// User-facing dimensions config at the vault root: `.dimensions.json`.
//
// Schema (loose — extra keys are ignored):
// {
//   "dimensions": [
//     {
//       "id": "priority",               // required, used as CSS class suffix
//       "label": "Priority",            // optional, defaults to id
//       "tagPrefix": "p",               // required, matches #p/<value> in markdown
//       "frontmatterKey": "priority",   // optional, defaults to id
//       "values": [
//         { "id": "p0", "label": "P0 — must-win", "color": "#ef4444" },
//         ...
//       ]
//     }
//   ]
// }
//
// Value order is implicit: the array position determines display order.
// Colors should be hex (#rrggbb or #rgb); other CSS colors work for the
// left-border but background-tinting won't apply.

import { App } from "obsidian";
import { Dimension, DimensionValue } from "./model";
import { SEED_DIMENSIONS } from "./dimensions";

export const CONFIG_PATH = ".dimensions.json";

interface RawValue {
  id: string;
  label?: string;
  color: string;
}

interface RawDimension {
  id: string;
  label?: string;
  tagPrefix: string;
  frontmatterKey?: string;
  values: RawValue[];
}

interface RawConfig {
  dimensions: RawDimension[];
}

export async function configExists(app: App): Promise<boolean> {
  return app.vault.adapter.exists(CONFIG_PATH);
}

export async function loadConfig(app: App): Promise<Dimension[]> {
  const raw = await app.vault.adapter.read(CONFIG_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${CONFIG_PATH} is not valid JSON: ${(e as Error).message}`);
  }
  return normalizeConfig(parsed);
}

export async function writeDefaultConfig(app: App): Promise<void> {
  const content = JSON.stringify(serializeConfig(SEED_DIMENSIONS), null, 2) + "\n";
  await app.vault.adapter.write(CONFIG_PATH, content);
}

function normalizeConfig(raw: unknown): Dimension[] {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${CONFIG_PATH} must be a JSON object`);
  }
  const cfg = raw as Partial<RawConfig>;
  if (!Array.isArray(cfg.dimensions)) {
    throw new Error(`${CONFIG_PATH} must have a "dimensions" array at the top level`);
  }
  const out: Dimension[] = [];
  cfg.dimensions.forEach((d, i) => {
    if (!d || typeof d !== "object") {
      throw new Error(`dimensions[${i}] must be an object`);
    }
    if (typeof d.id !== "string" || !d.id) {
      throw new Error(`dimensions[${i}].id must be a non-empty string`);
    }
    if (typeof d.tagPrefix !== "string" || !d.tagPrefix) {
      throw new Error(`dimensions[${i}] ("${d.id}").tagPrefix must be a non-empty string`);
    }
    if (!Array.isArray(d.values) || d.values.length === 0) {
      throw new Error(`dimensions[${i}] ("${d.id}").values must be a non-empty array`);
    }
    const values: DimensionValue[] = d.values.map((v, j) => {
      if (!v || typeof v !== "object") {
        throw new Error(`dimensions[${i}] ("${d.id}").values[${j}] must be an object`);
      }
      if (typeof v.id !== "string" || !v.id) {
        throw new Error(`dimensions[${i}] ("${d.id}").values[${j}].id must be a non-empty string`);
      }
      if (typeof v.color !== "string" || !v.color) {
        throw new Error(`dimensions[${i}] ("${d.id}").values[${j}] ("${v.id}").color must be a non-empty string`);
      }
      return {
        id: v.id,
        label: typeof v.label === "string" && v.label ? v.label : v.id,
        color: v.color,
        order: j,
      };
    });
    out.push({
      id: d.id,
      label: typeof d.label === "string" && d.label ? d.label : d.id,
      tagPrefix: d.tagPrefix,
      frontmatterKey: typeof d.frontmatterKey === "string" && d.frontmatterKey ? d.frontmatterKey : d.id,
      values,
    });
  });
  return out;
}

function serializeConfig(dimensions: Dimension[]): RawConfig {
  return {
    dimensions: dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      tagPrefix: d.tagPrefix,
      frontmatterKey: d.frontmatterKey,
      values: d.values.map((v) => ({ id: v.id, label: v.label, color: v.color })),
    })),
  };
}
