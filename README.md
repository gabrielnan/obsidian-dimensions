# Dimensions

An Obsidian plugin that lets you tag any node in your vault — folder, file, heading, non-bulleted label, or bullet — with inherited **dimensions** like *priority* or *timeframe*, then re-project the unified hierarchy along those axes via group-by views and in-editor line coloring.

## The problem

Planning notes tend to be deeply nested bullet hierarchies. The hierarchy is semantically useful — "this bullet lives under `## Current` under `**TODAY**` under `Zipline Planning.md`" — but it forces two ugly workarounds:

1. **Priority gets smuggled into section names**: `MUST-WIN`, `high priority`, `NOW`. You can't ask "show me every p0 across the whole folder."
2. **Time horizon gets flattened into headings**: `TODAY`, `THIS WEEK`, `By Q1`. When a project spans a month but has parts that must land this week, you physically split the subtree and duplicate parents.

Neither Dataview, Tasks, Bases, nor nested tags address this: they're file-level or task-level, with no inheritance from a parent bullet (let alone a parent folder) to its children.

## The model

One unified semantic tree spans the whole vault:

```
folder → file → heading → label → bullet → sub-bullet
```

Every level is a node. Every node can carry **dimension** values. Descendants inherit them; any descendant can override.

| Concept | Meaning |
|---|---|
| **Dimension** | A named orthogonal axis (`priority`, `timeframe`, `owner`). |
| **Value** | A specific assignment within a dimension (`p0`, `week`, `naka`). |
| **Effective value** | A node's declared value, or — if absent — the nearest ancestor's. |
| **Scope** | Any semantic node can be the root of a view. |

Priority and timeframe aren't a list of checkboxes — they're independent axes. A bullet can be `p0` on the priority dimension AND `week` on the timeframe dimension, simultaneously, and you can slice by either.

## Declaration syntax

| Node type | How to declare | Example |
|---|---|---|
| **Bullet** | Inline tag | `- distillation #p0 #sw` |
| **Heading** | Inline tag | `## Current #sw` |
| **Label** (non-bulleted group marker like `**TODAY**` or `Learning`) | Inline tag | `**TODAY** #st` |
| **File** | Obsidian `tags` frontmatter property | `tags:\n  - p1\n  - sw` |
| **Folder** | `tags` property in the folder's `_context.md` frontmatter | `tags:\n  - p2` |

For files and folders, use Obsidian's built-in **tags** property — add a `tags` property in the Properties UI, type the value id (e.g. `p0`), press Enter, and you get a native chip. The parser reads that list and resolves each entry against the same id→dimension map it uses for inline tags. Non-matching entries are ignored, so you can freely mix dimension tags with regular tags.

A value's `id` is also the tag you type: a value with id `p0` is declared by writing `#p0`. Value ids must be globally unique across all dimensions so the parser can resolve `#p0` to exactly one value.

## Configuration

Dimensions are defined in `.dimensions.json` at the **root of your vault**. On first load the plugin creates an empty stub (`{"dimensions": []}`); you fill it in with whatever axes you want.

```json
{
  "dimensions": [
    {
      "id": "priority",
      "label": "Priority",
      "frontmatterKey": "priority",
      "values": [
        { "id": "p0", "label": "P0", "color": "#ef4444" },
        { "id": "p1", "label": "P1", "color": "#f59e0b" },
        { "id": "p2", "label": "P2", "color": "#eab308" },
        { "id": "p3", "label": "P3", "color": "#94a3b8" }
      ]
    },
    {
      "id": "schedule",
      "label": "Schedule",
      "frontmatterKey": "schedule",
      "values": [
        { "id": "st", "label": "Today",   "color": "#ef4444" },
        { "id": "sw", "label": "Week",    "color": "#f59e0b" },
        { "id": "sm", "label": "Month",   "color": "#eab308" },
        { "id": "sq", "label": "Quarter", "color": "#94a3b8" }
      ]
    }
  ]
}
```

Per dimension:

| Field | Meaning |
|---|---|
| `id` | Stable identifier; used in CSS classes and as fallback for `frontmatterKey`. |
| `label` | Display name in the group-by view (optional; defaults to `id`). |
| `frontmatterKey` | Key under the `dimensions:` block in file/folder frontmatter (optional; defaults to `id`). |
| `values` | Ordered array of possible values. Array order determines display order. |

Per value: `id` and `color` are required; `label` is optional. The `id` is the literal tag name — `{id: "p0"}` means you type `#p0` in markdown. Value ids must be unique across all dimensions. Colors should be hex (`#rrggbb` or `#rgb`) so the plugin can generate the left-border + tinted background pair.

After editing `.dimensions.json`, run **Dimensions: Reload .dimensions.json** — Obsidian's vault events don't fire for dot-files, so the reload has to be explicit. The command re-parses the config, regenerates the CSS, reindexes the vault, and refreshes any open group-by views.

## What you get

- **Group-by view** (right sidebar): pick a dimension, pick a scope (vault root / any folder / the active file), and see every matching node grouped by value, with breadcrumbs showing the full semantic path (`Craft › Zipline › Zipline Planning › ## Current › **TODAY** › distillation`). Click to jump.
- **In-editor line coloring**: the active dimension paints a left-border + subtle background on every tagged line based on its effective value. Works for bullets, headings, and labels.
- **Label detection**: non-bulleted lines that act as group markers (`**TODAY**`, `Learning`, `MUST-WIN`) are first-class nodes, not just decoration. Tag them and everything beneath inherits.
- **Automatic inheritance**: tag a folder's `_context.md` once and every bullet in every file under it inherits that dimension unless it's explicitly overridden.

## Commands

- **Dimensions: Open group-by view**
- **Dimensions: Cycle active coloring dimension**
- **Dimensions: Reindex vault**
- **Dimensions: Reload .dimensions.json**

## Install (for development)

This plugin isn't in the community directory. To run it:

```bash
cd <your-vault>/.obsidian/plugins/
git clone https://github.com/gabrielnan/obsidian-dimensions.git
cd obsidian-dimensions
npm install
npm run build
```

Then enable "Dimensions" in Obsidian's Community Plugins settings.

## Status

**Phase 1** — core engine + group-by view + in-editor coloring. Dimensions are user-configurable via `.dimensions.json` at the vault root.

Planned next:

- **Phase 2**: filter view with multi-axis dimension + semantic scope filters; a settings-tab editor for `.dimensions.json`; scope presets (e.g. `**/*Planning.md`); an "assign dimension to current node" command.
- **Phase 3**: integration with obsidian-zoom; persisted expand/collapse state; effective-dimension badges in-editor.

## Why the name

Borrowed from dimensional modeling in data warehousing: the tree is the fact, dimensions are the orthogonal axes you slice along. "Group by dimension", "pivot along a dimension" — the vocabulary travels.
