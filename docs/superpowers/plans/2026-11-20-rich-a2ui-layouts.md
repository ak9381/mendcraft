# Rich A2UI Layouts & Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> This run is autonomous (no human checkpoint) — the task-issuing instructions already constitute approval. Proceeding straight to superpowers:executing-plans, self (Native), no subagent-driven ceremony, given the heavy cross-file coupling (one person must hold the whole type graph).

**Goal:** Let Gemini (and Nano) compose nested, multi-section A2UI boards — layouts (Row/Grid/Card/Tabs/Split), general widgets (Stat/Chart/Table/Form), and a sandboxed custom VisualTile — instead of only a flat Column of 6 device tiles, while keeping the existing 6-beat demo plans byte-identical in behavior.

**Architecture:** `TileSpec` (src/canvas/surfacePlan.ts) becomes a recursive union: existing leaf device tiles + new leaf widgets (stat/chart/table/form/visual) + new container tiles (row/grid/card/tabs/split) whose children are `TileSpec[]`. `coerceSurfacePlan` validates recursively with a node-count + depth cap. `expandPlan` walks the tree and emits one A2UI component per node (container components carry a `children: string[]` array of child component ids, exactly like today's root Column), so `fallbackRenderer.ts`'s existing generic child-linking (any component with a `children` array gets linked, not just Column) already works unmodified. Each new layout/widget gets: a Zod schema in `catalogApi.ts`, a `CATALOG_SCHEMAS` entry, a Lit custom element in `widgets.ts` (own component, not the vendored `@a2ui/web_core` Row/Card/Tabs — avoids coupling to a different base class and gives full control over palette/ARIA), and a `fallbackRenderer.ts` DOM branch. Edit mode's top-level-item discovery changes from "all matching descendants" to "matching elements with no matching ancestor" (a containment filter), so nested children never get their own move/resize chrome.

**Tech Stack:** TypeScript, Lit (`@a2ui/lit`), Zod, Vitest, existing warm-paper CSS custom properties.

**Spec:** the task instructions in this conversation (no separate spec file — the user's message is the spec of record).

## Global Constraints

- Palette only: canvas `#F7F5F0`, cards `#FFFFFF`, borders `#E4E0D8`, text `#2B2B2B`, secondary `#6E6A63`, sage `#6B8F71`, slate `#5A7BA6`, amber `#C98B3C`. No neon, no glow, no tinted AI boxes.
- Every interactive control is a real `button`/`[role=tab]`/`[role=button]` etc. — matches `handPointer.ts`'s existing `INTERACTIVE` selector; no new selector needed if widgets stick to real buttons.
- Device IDs never reach Gemini unredacted (`redactDeviceIds`/`restoreDeviceIds` in `aiTurn.ts`) — new planner paths must reuse the same two call sites, not add a parallel path.
- `MAX_TILES = 6` stays the cap on **top-level** `plan.tiles.length` (unchanged error message shape) — nesting is capped separately (depth + total node count) so Gemini can't explode the tree.
- Existing 6-beat demo fixtures/tests must keep passing with no changes to their expected output.
- `npx tsc --noEmit`, full `npm test`, and `npm run hands:reach` must all be clean before done.

## Review Focus

- **Gemini emits a tree deeper/wider than any sane UI** (e.g. Tabs nested 10 deep, or 200 leaf nodes) — `coerceSurfacePlan` must reject with a clear error (`MAX_DEPTH`, `MAX_NODES`), not hang or silently truncate. Test: a plan with depth 6 and a plan with 60 leaf nodes both get `ok:false`.
- **VisualTile markup carries `<script>`, `onload=`, `javascript:` href, `<iframe>`, external `<use href="https://...">`** — must come out of `sanitizeVisualMarkup` with those fully removed, not escaped-but-present. Test: one assertion per vector in Global Constraints' threat list.
- **A device ID leaks through a new container/widget path** — e.g. a `card` title or `table` cell containing a raw device id string, or a VisualTile markup template built from device state before redaction. Test: build a prompt with a nested plan containing a lamp inside a Card, assert the redacted prompt text contains no real device id.
- **Edit mode double-wraps or orphans nested children** — a Card containing a StatTile: only the Card gets `.mc-edit-item` chrome; the StatTine inside is never independently returned by `getItems`/`collectTileEls`. Test: a DOM fixture with a `.mc-fb-card` containing a nested `.mc-fb-tile` asserts only the card is top-level.
- **Old demo fixtures silently change rendering** — flat lamp/music/switch/scene/plan/connect plans must `expandPlan` to the exact same component/message shape as before. Test: snapshot-style equality check against the pre-existing `smartCanvasSpike.test.ts` fixtures (same assertions, unmodified).

---

## File Map

- Modify `src/canvas/surfacePlan.ts` — recursive `TileSpec`, `FormField`, depth/node caps, `coerceSurfacePlan`, `expandPlan`, `tileComponentId`.
- Modify `src/canvas/catalogApi.ts` — `RowApi/GridApi/CardApi/TabsApi/SplitApi/StatTileApi/ChartTileApi/TableTileApi/FormTileApi/VisualTileApi`, extend `CATALOG_SCHEMAS`.
- Modify `src/canvas/widgets.ts` — one `A2uiLitElement` subclass per new component, registered in `smartCanvasCatalog`.
- Modify `src/canvas/fallbackRenderer.ts` — one `renderNodeToDom` branch per new component type.
- Create `src/canvas/visualSanitize.ts` — pure `sanitizeVisualMarkup(raw: string): { html: string; removedTags: string[] }`.
- Create `src/canvas/visualMount.ts` — tiny DOM-touching helper `mountVisualActions(host: HTMLElement, onAction)` shared by widgets.ts + fallbackRenderer.ts.
- Modify `src/canvas/canvasApp.ts` — `collectTileEls` containment filter, `tileEditLabel` new branches, new widget action branches in the `onAction.subscribe` handler.
- Modify `src/canvas/aiTurn.ts` — `SCHEMA_LINE`/prompt text teaches the nested shape; `buildSurfacePrompt`'s redaction call sites untouched (same two lines, just now redacting a bigger JSON blob).
- Create `src/canvas/showcaseFixture.ts` — the home energy/room dashboard `SurfacePlan` fixture + a `?showcase=energy` opt-in read in `canvasMain.ts`/`spikeMain.ts` entry (whichever boots `canvas.html`) — never on by default.
- Tests: `tests/canvas/surfacePlanNested.test.ts`, `tests/canvas/visualSanitize.test.ts`, `tests/canvas/richWidgets.test.ts` (fallback render of Stat/Chart/Table/Form/Visual), `tests/canvas/editBoardNesting.test.ts`, extend `tests/canvas/aiTurn.test.ts` for redaction-on-nested-plan.

## Interfaces Locked Now

```ts
// surfacePlan.ts
export type FormField =
  | { kind: 'toggle'; id: string; label: string; value?: boolean }
  | { kind: 'slider'; id: string; label: string; value?: number; min?: number; max?: number }
  | { kind: 'choice'; id: string; label: string; options: string[]; value?: string };

export type LeafTileSpec =
  | { type: 'lamp'; deviceId: string; label: string }
  | { type: 'plan'; boardId: string; template: PlanTemplate }
  | { type: 'music'; deviceId: string; label: string }
  | { type: 'switch'; deviceId: string; label: string }
  | { type: 'scene'; sceneId: string; label: string }
  | { type: 'connect'; label?: string }
  | { type: 'stat'; label: string; value: string; delta?: string; trend?: 'up' | 'down' | 'neutral'; spark?: number[] }
  | { type: 'chart'; title: string; chartType: 'bar' | 'line' | 'ring'; series: { label: string; value: number }[] }
  | { type: 'table'; title: string; columns: string[]; rows: string[][]; sortable?: boolean; rowActionLabel?: string }
  | { type: 'form'; title: string; fields: FormField[]; submitLabel: string }
  | { type: 'visual'; title: string; markup: string };

export type TileSpec =
  | LeafTileSpec
  | { type: 'row'; children: TileSpec[] }
  | { type: 'grid'; columns: 2 | 3 | 4; children: TileSpec[] }
  | { type: 'card'; title: string; children: TileSpec[] }
  | { type: 'tabs'; tabs: { label: string; children: TileSpec[] }[] }
  | { type: 'split'; direction: 'row' | 'column'; first: TileSpec[]; second: TileSpec[] };

export const MAX_DEPTH = 4;   // root tiles = depth 0
export const MAX_NODES = 48;  // total nodes across the whole tree, root included
```

`tileComponentId` gains a `path` parameter (e.g. `card-${idx}`, `row-${idx}-${childIdx}`) since container tiles have no natural device id — IDs are positional and deterministic (stable across re-render of the same plan, which is all `expandPlan`'s determinism contract requires).

`expandPlan` produces, per container node, one component `{ id, component: 'Row'|'Grid'|'Card'|'Tabs'|'Split', children: [...ids] }` (Tabs: `{ id, component: 'Tabs', tabs: [{label, childId}] }` since each tab panel is itself one child id, not a flat list) and recurses into `children`/`tabs[].children`/`first`/`second` before returning to the parent — same flattening style already used for the single-level tiles loop, just made recursive.

## Tasks

### Task 1: Recursive TileSpec + validation + expansion (surfacePlan.ts)
**Test:** `tests/canvas/surfacePlanNested.test.ts` — valid nested tree (Tabs > Grid > 3 Stat + Chart, Card > Form, Row of 2 lamps) coerces and expands to a flat component list with correct `children` wiring; depth-6 tree rejected; 60-leaf tree rejected; existing flat fixtures from `smartCanvasSpike.test.ts` still pass unmodified (run that file too).
**Steps:** write failing tests → implement types/coerce/expand/tileComponentId → `npx vitest run tests/canvas/surfacePlanNested.test.ts tests/canvas/smartCanvasSpike.test.ts` green → commit.

### Task 2: Catalog schemas (catalogApi.ts)
**Test:** covered by Task 1's gate-check path (`gateMessages` with `CATALOG_SCHEMAS`) plus a schema-level unit test asserting a malformed container (e.g. `Grid` with `columns: 7`) is rejected by its Zod schema.
**Steps:** add schemas → extend `CATALOG_SCHEMAS` → test → commit (can fold into Task 1's commit; same review gate).

### Task 3: Sanitizer (visualSanitize.ts) — written/tested before any VisualTile wiring
**Test:** `tests/canvas/visualSanitize.test.ts` — one case per: `<script>`, `onload=`/`onclick=`/any `on*`, `javascript:` href, `data:text/html`, `<iframe>`, `<foreignObject>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, external `<use href="https://...">`, external `<img src="http://...">`; plus positive cases that legitimate inline SVG shapes + `data-action`/`data-label` survive and get promoted (`role="button"`, `tabindex="0"`, `aria-label` filled from `data-label`/`data-action`).
**Steps:** TDD — tests first, then implement with DOMParser-based allowlist walk. Commit.

### Task 4: Widgets + layouts DOM (widgets.ts, fallbackRenderer.ts, visualMount.ts)
**Test:** `tests/canvas/richWidgets.test.ts` — fallback-render each new component type from a hand-built `RenderTree`, assert real `button`/`[role=tab]` elements exist with aria-labels, Tabs hides inactive panels (not rendered at all, mirroring the chosen "only render active child" strategy — confirm no inactive-panel DOM node exists), Table sort button + row action button present, Form toggle/slider/submit present, VisualTile mounts sanitized markup and wires `[data-action]` clicks to `onAction`.
**Steps:** implement Lit elements + fallback branches + visualMount helper → tests green → `npx tsc --noEmit` → commit.

### Task 5: Edit mode containment filter (canvasApp.ts)
**Test:** `tests/canvas/editBoardNesting.test.ts` — a fake DOM tree with a top-level `.mc-fb-card` containing a nested `.mc-fb-tile`, alongside a sibling top-level `.mc-fb-tile`: containment-filtered `collectTileEls` returns exactly the card + the sibling, never the nested tile.
**Steps:** implement containment filter + `tileEditLabel` branches + widget action branches → test green → run full `editBoard.test.ts` unmodified → commit.

### Task 6: Planner prompt wiring (aiTurn.ts)
**Test:** extend `tests/canvas/aiTurn.test.ts` — prompt built from a request whose `req.current` is a nested plan (Card containing a lamp) redacts the lamp's device id in the emitted prompt text; `parseModelPlan` round-trips a nested plan through redact→restore correctly. Existing flat-plan prompt tests untouched.
**Steps:** update `SCHEMA_LINE`/prompt instructions for nesting + new widget types → tests green → commit.

### Task 7: Showcase fixture + opt-in entry
**Test:** a small test or just a manual `?showcase=energy` smoke check (no new automated gate required beyond "doesn't break default boot") — assert default `?fresh=1&sim=1` boot is unaffected (existing hands:reach arc run is the gate here).
**Steps:** write `showcaseFixture.ts` plan (home energy dashboard: stats row, chart, tabs with a table + a form, a VisualTile room-zone diagram, one lamp tile) → wire opt-in param → manual boot check → commit.

### Task 8: Full verification + screenshots + report
**Steps:** `npx tsc --noEmit`; `npm test` (record before/after counts); `npm run hands:reach` (record N/N, violations, misses; extend the script only if the showcase needs a new audited state, carefully, without touching existing states); screenshots to `/workspace/hackathon/firebase-hybrid/screens/sim-main/arc/`; kill leftover headless Chrome; commits pushed to `sim-main` and `main`; `firebase-tools hosting:channel:deploy sim-main`; write `/workspace/hackathon/firebase-hybrid/builder-relay/rich-layouts-report.md`.
