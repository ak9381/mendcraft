// The review window's "THE PLAN" list: what a proposal will actually change
// on the board, in plain words. Pure — no DOM. Compares the board's current
// SurfacePlan (null for a blank board) with the proposed one, matching tiles
// by their stable id (deviceId / sceneId / boardId, else a widget's own
// title/label) and falling back to the visible label when ids differ.

import type { DeviceState, SurfacePlan, TileSpec } from './surfacePlan';
import { buildPlanTemplate, isPlanTemplateName } from '../plan/templates';

export type PlanChangeOp = 'add' | 'change' | 'remove';

export interface PlanChange {
  op: PlanChangeOp;
  label: string;
  detail?: string;
}

/** The single line shown when a proposal changes nothing she could see. */
export const NO_VISIBLE_CHANGE = 'No visible change';

export interface PlanDiffContext {
  /** Live device state, so an added lamp reads "lamp · 70%" not just "lamp". */
  devices?: Record<string, Partial<DeviceState>>;
}

interface Item {
  key: string;
  /** Kind word used for matching by label ("lamp", "chart", "group"…). */
  kind: string;
  label: string;
  /** What an add shows next to the label. */
  detail?: string;
  /** Everything that, if different, makes this a "change". */
  facts: Record<string, string>;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "5 rooms (Bedroom 1, …) · 5 doors · 5 windows" for a floor-plan template. */
export function floorPlanSummary(template: string): string {
  if (!isPlanTemplateName(template)) return 'floor plan';
  let ops: Record<string, unknown>[] = [];
  try { ops = buildPlanTemplate(template); } catch { return 'floor plan'; }
  const rooms = ops.filter((o) => o.op === 'add_room').map((o) => String(o.name ?? 'Room'));
  const doors = ops.filter((o) => o.op === 'add_door').length;
  const windows = ops.filter((o) => o.op === 'add_window').length;
  const parts = [`${plural(rooms.length, 'room')}${rooms.length ? ` (${rooms.join(', ')})` : ''}`];
  if (doors) parts.push(plural(doors, 'door'));
  if (windows) parts.push(plural(windows, 'window'));
  return parts.join(' · ');
}

function deviceDetail(kind: 'lamp' | 'music' | 'switch', st: Partial<DeviceState> | undefined): string {
  if (kind === 'music') {
    if (st?.trackTitle) return `music · ${st.trackTitle}`;
    return 'music';
  }
  if (!st) return kind;
  if (st.on === false) return `${kind} · off`;
  if (kind === 'lamp' && typeof st.brightness === 'number') return `lamp · ${Math.round(st.brightness)}%`;
  return `${kind} · on`;
}

function countLeaves(tiles: TileSpec[]): number {
  let n = 0;
  for (const t of tiles) {
    const kids = childrenOf(t);
    n += kids ? countLeaves(kids) : 1;
  }
  return n;
}

function childrenOf(t: TileSpec): TileSpec[] | null {
  switch (t.type) {
    case 'row': case 'grid': case 'card': return t.children;
    case 'tabs': return t.tabs.flatMap((tab) => tab.children);
    case 'split': return [...t.first, ...t.second];
    default: return null;
  }
}

function leafItem(t: TileSpec, ctx: PlanDiffContext): Item | null {
  switch (t.type) {
    case 'lamp': case 'music': case 'switch':
      return {
        key: `device:${t.deviceId}`, kind: t.type, label: t.label,
        detail: deviceDetail(t.type, ctx.devices?.[t.deviceId]),
        facts: { name: t.label, kind: t.type },
      };
    case 'plan': {
      const summary = floorPlanSummary(t.template);
      const room = /room-plan/.test(t.boardId) || t.template === 'oneRoom';
      return { key: `plan:${t.boardId}`, kind: 'plan', label: room ? 'Room plan' : 'Floor plan', detail: summary, facts: { layout: summary } };
    }
    case 'scene':
      return { key: `scene:${t.sceneId}`, kind: 'scene', label: t.label, detail: 'scene', facts: { name: t.label } };
    case 'connect':
      return { key: 'connect', kind: 'connect', label: t.label || 'Connect a device', detail: 'button', facts: { name: t.label ?? '' } };
    case 'stat':
      return {
        key: `stat:${t.label}`, kind: 'stat', label: t.label, detail: [t.value, t.delta].filter(Boolean).join(' · '),
        facts: { value: t.value, delta: t.delta ?? '', trend: t.trend ?? '' },
      };
    case 'chart':
      return {
        key: `chart:${t.title}`, kind: 'chart', label: t.title, detail: `${t.chartType} chart · ${plural(t.series.length, 'point')}`,
        facts: { type: t.chartType, data: t.series.map((s) => `${s.label}=${s.value}`).join(', ') },
      };
    case 'table':
      return {
        key: `table:${t.title}`, kind: 'table', label: t.title, detail: `table · ${plural(t.rows.length, 'row')}`,
        facts: { columns: t.columns.join(', '), rows: plural(t.rows.length, 'row'), data: JSON.stringify(t.rows) },
      };
    case 'form':
      return {
        key: `form:${t.title}`, kind: 'form', label: t.title, detail: `form · ${plural(t.fields.length, 'field')}`,
        facts: { fields: t.fields.map((f) => f.label).join(', '), button: t.submitLabel, values: JSON.stringify(t.fields) },
      };
    case 'visual':
      return { key: `visual:${t.title}`, kind: 'visual', label: t.title, detail: 'picture', facts: { picture: t.markup } };
    default:
      return null;
  }
}

/** Flatten a plan into comparable items (leaves + titled groups/tabs) and a
 *  layout signature (the container skeleton, leaves left out). */
function flatten(plan: SurfacePlan | null, ctx: PlanDiffContext): { items: Item[]; layout: string } {
  const items: Item[] = [];
  const seen = new Map<string, number>();
  const push = (it: Item) => {
    const n = seen.get(it.key) ?? 0;
    seen.set(it.key, n + 1);
    items.push(n ? { ...it, key: `${it.key}#${n}` } : it);
  };
  const shape: string[] = [];
  const walk = (tiles: TileSpec[]) => {
    for (const t of tiles) {
      if (t.type === 'card') {
        if (t.title) push({ key: `group:${t.title}`, kind: 'group', label: `Group “${t.title}”`, detail: plural(countLeaves(t.children), 'tile'), facts: { tiles: plural(countLeaves(t.children), 'tile') } });
        shape.push('card(');
        walk(t.children);
        shape.push(')');
      } else if (t.type === 'tabs') {
        const labels = t.tabs.map((x) => x.label).join(' · ');
        push({ key: `tabs:${labels}`, kind: 'tabs', label: 'Tabs', detail: labels, facts: { tabs: labels } });
        shape.push('tabs(');
        for (const tab of t.tabs) walk(tab.children);
        shape.push(')');
      } else if (t.type === 'row' || t.type === 'grid') {
        shape.push(`${t.type}${t.type === 'grid' ? t.columns : ''}(`);
        walk(t.children);
        shape.push(')');
      } else if (t.type === 'split') {
        shape.push(`split-${t.direction}(`);
        walk(t.first);
        shape.push('|');
        walk(t.second);
        shape.push(')');
      } else {
        const it = leafItem(t, ctx);
        if (it) push(it);
      }
    }
  };
  if (plan) walk(plan.tiles);
  return { items, layout: shape.join(' ') };
}

const FACT_WORDS: Record<string, string> = { name: 'name', kind: 'type', layout: 'layout', value: 'value', delta: 'change', trend: 'trend', type: 'chart', data: 'data', columns: 'columns', rows: 'rows', fields: 'fields', button: 'button', values: 'values', picture: 'picture', tiles: 'size', tabs: 'tabs' };
/** Facts whose raw value is too long or too technical to print as "a → b". */
const OPAQUE = new Set(['data', 'values', 'picture']);

function describeChange(a: Item, b: Item): string | null {
  const parts: string[] = [];
  for (const k of Object.keys({ ...a.facts, ...b.facts })) {
    const x = a.facts[k] ?? '';
    const y = b.facts[k] ?? '';
    if (x === y) continue;
    if (OPAQUE.has(k)) parts.push(`new ${FACT_WORDS[k] ?? k}`);
    else if (k === 'name') parts.push(`renamed to ${y || '—'}`);
    else parts.push(`${FACT_WORDS[k] ?? k} ${x || '—'} → ${y || '—'}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** BEFORE vs AFTER, in plain words, in the order she'll read the new board. */
export function diffPlans(before: SurfacePlan | null, after: SurfacePlan, ctx: PlanDiffContext = {}): PlanChange[] {
  const out: PlanChange[] = [];
  if (!before) out.push({ op: 'add', label: 'Title', detail: after.title });
  else if (before.title !== after.title) out.push({ op: 'change', label: 'Title', detail: `${before.title} → ${after.title}` });

  const a = flatten(before, ctx);
  const b = flatten(after, ctx);
  const byKey = new Map(a.items.map((it) => [it.key, it]));
  const matched = new Map<Item, Item>(); // after -> before
  const usedBefore = new Set<Item>();
  for (const it of b.items) {
    const prev = byKey.get(it.key);
    if (prev) { matched.set(it, prev); usedBefore.add(prev); }
  }
  // Fallback: same kind + same visible label (an id that changed under it).
  for (const it of b.items) {
    if (matched.has(it)) continue;
    const prev = a.items.find((p) => !usedBefore.has(p) && p.kind === it.kind && p.label === it.label);
    if (prev) { matched.set(it, prev); usedBefore.add(prev); }
  }

  for (const it of b.items) {
    const prev = matched.get(it);
    if (!prev) { out.push({ op: 'add', label: it.label, ...(it.detail ? { detail: it.detail } : {}) }); continue; }
    const what = describeChange(prev, it);
    if (what) out.push({ op: 'change', label: prev.label, detail: what });
  }
  for (const p of a.items) {
    if (!usedBefore.has(p)) out.push({ op: 'remove', label: p.label, ...(p.detail ? { detail: p.detail } : {}) });
  }

  // Same tiles, new arrangement (grouped, reordered, split…): say so once.
  if (before) {
    const sameSet = a.items.length === b.items.length && b.items.every((it) => matched.has(it));
    const reordered = sameSet && a.items.map((x) => x.key).join(' ') !== b.items.map((x) => matched.get(x)!.key).join(' ');
    if (a.layout !== b.layout) out.push({ op: 'change', label: 'Layout', detail: 'tiles regrouped' });
    else if (reordered) out.push({ op: 'change', label: 'Layout', detail: 'tiles reordered' });
  }

  return out.length ? out : [{ op: 'change', label: NO_VISIBLE_CHANGE }];
}

/** The Kannada (or any language) pack proposal, as one plan line. */
export function languagePackChanges(language: string, labelCount: number): PlanChange[] {
  return [{ op: 'change', label: `Switch the interface to ${language} (${plural(labelCount, 'label')})` }];
}

/** One tile swapped in place (self-check fix / morph): a whole-plan diff
 *  between the plan with the old tile and the plan with the new one. */
export function diffTile(before: TileSpec | null, after: TileSpec, ctx: PlanDiffContext = {}): PlanChange[] {
  const wrap = (tiles: TileSpec[]): SurfacePlan => ({ kind: 'room', title: '', tiles });
  return diffPlans(wrap(before ? [before] : []), wrap([after]), ctx);
}
