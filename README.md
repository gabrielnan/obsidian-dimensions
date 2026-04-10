# Attribute Views

An Obsidian plugin that lets you tag any node in your vault — folder, file, heading, non-bulleted label, or bullet — with inherited attributes like **priority** or **timeframe**, then re-project the unified hierarchy along those axes via group-by views and in-editor line coloring.

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

Every level is a node. Every node can carry **attribute** values. Descendants inherit them; any descendant can override.

| Concept | Meaning |
|---|---|
| **Attribute** (a.k.a. dimension) | A named orthogonal axis (`priority`, `timeframe`, `owner`). |
| **Value** | A specific assignment within an attribute (`p0`, `week`, `naka`). |
| **Effective value** | A node's declared value, or — if absent — the nearest ancestor's. |
| **Scope** | Any semantic node can be the root of a view. |

## Declaration syntax

| Node type | How to declare | Example |
|---|---|---|
| **Bullet** | Inline nested tag | `- distillation #p/p0 #t/week` |
| **Heading** | Inline nested tag | `## Current #t/week` |
| **Label** (non-bulleted group marker like `**TODAY**` or `Learning`) | Inline nested tag | `**TODAY** #t/today` |
| **File** | YAML frontmatter `av:` block | `av:\n  priority: p1` |
| **Folder** | `av:` block in the folder's `_context.md` frontmatter | `av:\n  priority: p2` |

Tag prefixes are configurable per attribute. The seed attributes use `#p/...` for priority and `#t/...` for timeframe.

### Seed attributes (Phase 1)

| Attribute | Prefix | Values |
|---|---|---|
| **Priority** | `#p/` | `p0` (must-win), `p1` (high), `p2` (normal), `p3` (low) |
| **Timeframe** | `#t/` | `today`, `week`, `month`, `quarter`, `year` |

## What you get

- **Group-by view** (right sidebar): pick an attribute, pick a scope (vault root / any folder / the active file), and see every matching node grouped by value, with breadcrumbs showing the full semantic path (`Craft › Zipline › Zipline Planning › ## Current › **TODAY** › distillation`). Click to jump.
- **In-editor line coloring**: the active attribute paints a left-border + subtle background on every tagged line based on its effective value. Works for bullets, headings, and labels.
- **Label detection**: non-bulleted lines that act as group markers (`**TODAY**`, `Learning`, `MUST-WIN`) are first-class nodes, not just decoration. Tag them and everything beneath inherits.
- **Automatic inheritance**: tag a folder's `_context.md` once and every bullet in every file under it inherits that attribute unless it's explicitly overridden.

## Commands

- **Attribute Views: Open group-by view**
- **Attribute Views: Cycle active coloring attribute**
- **Attribute Views: Reindex vault**

## Install (for development)

This plugin isn't in the community directory. To run it:

```bash
cd <your-vault>/.obsidian/plugins/
git clone https://github.com/gabrielnan/obsidian-attribute-views.git
cd obsidian-attribute-views
npm install
npm run build
```

Then enable "Attribute Views" in Obsidian's Community Plugins settings.

## Status

**Phase 1** — core engine + group-by view + in-editor coloring. The attribute list is hardcoded (`priority`, `timeframe`).

Planned next:

- **Phase 2**: filter view with multi-axis attribute + semantic scope filters; settings tab for user-defined attributes; scope presets (e.g. `**/*Planning.md`); an "assign attribute to current node" command.
- **Phase 3**: integration with obsidian-zoom; persisted expand/collapse state; effective-attribute badges in-editor.

## Why the name

"Views" over "attributes" — you don't consume the attribute directly, you consume the re-projection it enables. "Attribute Views" makes both halves explicit.
