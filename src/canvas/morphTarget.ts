// MORPH TARGET: which tile a hold is about. Resolution happens at ARM time
// (the frozen pre-pinch point), not at fire time: the selection snapshot is
// bound to the gesture moment (Put-That-There). The walk crosses open shadow
// roots the way handPointer's interactiveAncestor does, lands on the nearest
// tile host stamped `data-mc-tile="<tileComponentId>"`, and falls back to a
// bubble-cursor snap (pickNearest, snapPx 56) when the point is in a gutter
// between tiles. Background, panels, drag handles: no target, nothing arms.
//
// Structural element/document types (not lib.dom's Document) so the whole
// resolver unit-tests in Vitest's node environment with a tiny fake DOM.

import { pickNearest, type Rect } from './handPointer';
import { tileComponentId, type SurfacePlan, type TileSpec } from './surfacePlan';

export const MORPH_SNAP_PX = 56;

/** Starting a hold on any of these never arms a morph: drag/resize handles
 *  (panel + Edit-mode moves win), the floating panels and chrome around the
 *  boards, and anything inside an open modal. */
export const MORPH_BLOCKERS =
  '[data-mc-drag-handle], [data-mc-resize-handle], .mc-ai, .mc-terminal, .mc-bar, .mc-dock, .mc-fab-mic, .mc-review, .mc-palette, .mc-phone-menu, .mc-morph-card, [aria-modal=true]';

export interface MorphEl {
  matches?(selector: string): boolean;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): Rect;
  parentElement: MorphEl | null;
  getRootNode?(): unknown;
  shadowRoot?: { elementFromPoint?(x: number, y: number): MorphEl | null } | null;
}

export interface MorphDoc {
  elementFromPoint(x: number, y: number): MorphEl | null;
  querySelectorAll(selector: string): ArrayLike<MorphEl>;
}

export interface MorphTargetRef {
  tileId: string;
  /** Index chain from the plan root, expandPlan's path scheme — resolved
   *  host-side so the model never addresses tiles by array index. */
  path: number[];
  spec: TileSpec;
  label: string;
  rect: Rect;
  host: MorphEl;
}

/** The human name a morph card calls this tile. */
export function morphTileLabel(t: TileSpec): string {
  if (t.type === 'lamp' || t.type === 'music' || t.type === 'switch' || t.type === 'scene' || t.type === 'stat') return t.label;
  if (t.type === 'connect') return t.label ?? 'Connect a device';
  if (t.type === 'plan') return 'Floor plan';
  if (t.type === 'chart' || t.type === 'table' || t.type === 'form' || t.type === 'visual') return t.title;
  if (t.type === 'card') return t.title || 'Card';
  if (t.type === 'row') return 'Row';
  if (t.type === 'grid') return 'Grid';
  if (t.type === 'tabs') return 'Tabs';
  return 'Split';
}

export interface MorphTileEntry {
  id: string;
  path: number[];
  spec: TileSpec;
  label: string;
}

/** Every tile in the plan (leaf and container, any depth) with its stable
 *  component id and expandPlan path — the host-side id→path map. */
export function enumerateMorphTiles(plan: SurfacePlan): MorphTileEntry[] {
  const out: MorphTileEntry[] = [];
  const visit = (t: TileSpec, path: number[]): void => {
    out.push({ id: tileComponentId(t, path), path, spec: t, label: morphTileLabel(t) });
    if (t.type === 'row' || t.type === 'grid' || t.type === 'card') {
      t.children.forEach((c, i) => visit(c, [...path, i]));
    } else if (t.type === 'tabs') {
      t.tabs.forEach((tab, i) => tab.children.forEach((c, j) => visit(c, [...path, i, j])));
    } else if (t.type === 'split') {
      t.first.forEach((c, i) => visit(c, [...path, 0, i]));
      t.second.forEach((c, i) => visit(c, [...path, 1, i]));
    }
  };
  plan.tiles.forEach((t, i) => visit(t, [i]));
  return out;
}

/** Deepest element at a point, walking into open shadow roots (same contract
 *  as handPointer's deepElementFromPoint, over structural types). */
function deepAt(doc: MorphDoc, x: number, y: number): MorphEl | null {
  let el: MorphEl | null = doc.elementFromPoint(x, y);
  while (el?.shadowRoot?.elementFromPoint) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** Nearest ancestor (crossing shadow boundaries) matching `selector`. */
function ancestorMatching(el: MorphEl | null, selector: string): MorphEl | null {
  let cur: MorphEl | null = el;
  while (cur) {
    if (cur.matches?.(selector)) return cur;
    cur = cur.parentElement ?? ((cur.getRootNode?.() as { host?: MorphEl } | null)?.host ?? null);
  }
  return null;
}

/** Nearest ancestor with a data-mc-tile stamp, crossing shadow boundaries. */
function tileHostOf(el: MorphEl | null): MorphEl | null {
  let cur: MorphEl | null = el;
  while (cur) {
    if (cur.getAttribute('data-mc-tile')) return cur;
    cur = cur.parentElement ?? ((cur.getRootNode?.() as { host?: MorphEl } | null)?.host ?? null);
  }
  return null;
}

export interface ResolveMorphOptions {
  /** Only hosts stamped for this frame count (data-mc-frame). */
  frameId?: string;
  snapPx?: number;
  /** Test hook: the stamped tile hosts, instead of a querySelectorAll. */
  hosts?: readonly MorphEl[];
}

/** The tile under (or nearest, within snapPx of) the frozen point — or null,
 *  in which case the hold classifier never arms and nothing happens. */
export function resolveMorphTarget(
  doc: MorphDoc,
  pt: { x: number; y: number },
  plan: SurfacePlan,
  opts: ResolveMorphOptions = {},
): MorphTargetRef | null {
  const hit = deepAt(doc, pt.x, pt.y);
  // Drag handles, panels and modal chrome win outright — before any snap, so
  // a handle sitting 20px from a tile can never gutter-snap into a morph.
  if (ancestorMatching(hit, MORPH_BLOCKERS)) return null;

  const entries = enumerateMorphTiles(plan);
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const okHost = (host: MorphEl | null): host is MorphEl => {
    if (!host) return false;
    if (opts.frameId && host.getAttribute('data-mc-frame') !== opts.frameId) return false;
    return byId.has(host.getAttribute('data-mc-tile') ?? '');
  };

  let host = tileHostOf(hit);
  if (!okHost(host)) {
    // Gutter landing: bubble-cursor snap over the stamped tile rects.
    const all = opts.hosts ?? Array.from(doc.querySelectorAll('[data-mc-tile]'));
    const candidates = Array.from(all).filter((h) => okHost(h));
    host = pickNearest(
      pt,
      candidates.map((h) => ({ item: h, rect: h.getBoundingClientRect() })),
      opts.snapPx ?? MORPH_SNAP_PX,
    );
  }
  if (!okHost(host)) return null;
  const entry = byId.get(host.getAttribute('data-mc-tile') ?? '')!;
  return { tileId: entry.id, path: entry.path, spec: entry.spec, label: entry.label, rect: host.getBoundingClientRect(), host };
}
