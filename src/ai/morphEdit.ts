// MORPH EDIT: the pure, scoped edit pipeline behind "pinch-hold a tile and
// speak a change". The cloud leg only ever sees the redacted utterance, ONE
// tile's JSON (device ids masked with the session's "Device N" placeholders)
// and a one-line board context — never the other tiles. The reply is a whole
// replacement tile addressed by the host-resolved path (the JSON Whisperer
// lesson: never let the model address tiles by array index), validated by the
// same per-tile coercion the board plan uses, and spliced in with every other
// tile left reference-equal.

import { extractJson } from './cloudJson';
import { fillVisible } from '../privacy/directory';
import { redactDeviceIds, restoreDeviceIds, type DeviceIdSession } from '../privacy/deviceRedact';
import { TILE_SCHEMA_LINE } from '../canvas/aiTurn';
import { coerceTileSpec, type Coerced, type SurfacePlan, type TileSpec } from '../canvas/surfacePlan';

/** Device ids mentioned anywhere in one tile's sub-tree. */
export function collectDeviceIds(t: TileSpec): string[] {
  const out: string[] = [];
  const visit = (n: TileSpec): void => {
    if (n.type === 'lamp' || n.type === 'music' || n.type === 'switch') out.push(n.deviceId);
    else if (n.type === 'row' || n.type === 'grid' || n.type === 'card') n.children.forEach(visit);
    else if (n.type === 'tabs') n.tabs.forEach((tab) => tab.children.forEach(visit));
    else if (n.type === 'split') { n.first.forEach(visit); n.second.forEach(visit); }
  };
  visit(t);
  return out;
}

/** "Board: Living room · 5 tiles" — the only board context the cloud gets. */
export function morphBoardLine(plan: SurfacePlan): string {
  const n = plan.tiles.length;
  return `Board: ${plan.title} · ${n} tile${n === 1 ? '' : 's'}`;
}

export interface MorphPromptOptions {
  /** Masks real device ids as this session's "Device N" placeholders before
   *  the tile JSON goes near the cloud (buildSurfacePrompt's pattern). */
  deviceIdSession?: DeviceIdSession;
}

/** The single-tile edit prompt: redacted utterance + this one tile verbatim
 *  (so the model revises rather than reinvents) + one line of board context. */
export function buildMorphPrompt(spec: TileSpec, redactedUtterance: string, boardLine: string, opts: MorphPromptOptions = {}): string {
  let tileJson = JSON.stringify(spec);
  if (opts.deviceIdSession) tileJson = redactDeviceIds(tileJson, collectDeviceIds(spec), opts.deviceIdSession);
  return [
    'You edit ONE tile on a smart canvas board. Reply with JSON only: the revised tile, nothing else.',
    TILE_SCHEMA_LINE,
    'Keep the same "type" and (for device tiles) the same deviceId as the current tile. Change only what she asked for.',
    boardLine,
    `Current tile: ${tileJson}`,
    `She said: "${redactedUtterance}"`,
  ].join('\n');
}

/** Unwrap the envelopes models like to add around a single tile. */
export function normalizeMorphRaw(raw: unknown, depth = 0): unknown {
  if (!raw || typeof raw !== 'object' || depth > 3) return raw;
  const r = raw as Record<string, unknown>;
  if (typeof r.type === 'string') return raw;
  for (const key of ['tile', 'revised', 'value', 'data', 'result']) {
    if (r[key] && typeof r[key] === 'object') return normalizeMorphRaw(r[key], depth + 1);
  }
  if (Array.isArray(r.tiles) && r.tiles.length >= 1) return normalizeMorphRaw(r.tiles[0], depth + 1);
  return raw;
}

/** One revised tile, validated like any board tile, scope-checked: the type
 *  (and a device tile's deviceId) must survive — a reply that swaps the tile
 *  for something else entirely is refused, not applied. */
export function coerceMorphTile(raw: unknown, original: TileSpec): Coerced<TileSpec> {
  const tile = coerceTileSpec(normalizeMorphRaw(raw));
  if (!tile.ok) return tile;
  if (tile.value.type !== original.type) {
    return { ok: false, error: `the reply changed the tile type (${original.type} → ${tile.value.type})` };
  }
  if ((original.type === 'lamp' || original.type === 'music' || original.type === 'switch') &&
      (tile.value as { deviceId?: string }).deviceId !== original.deviceId) {
    return { ok: false, error: 'the reply pointed the tile at a different device' };
  }
  return tile;
}

/** Model text -> one validated replacement tile. Mirrors parseModelPlan's
 *  reverse order: real device ids back first, then visible name tokens. */
export function parseMorphTile(text: string, original: TileSpec, session?: DeviceIdSession): Coerced<TileSpec> {
  const raw = extractJson(text);
  if (raw == null) return { ok: false, error: 'The reply was not a tile.' };
  let parsed: unknown = raw;
  const stringified = JSON.stringify(raw);
  const restored = session ? restoreDeviceIds(stringified, session) : stringified;
  const filled = fillVisible(restored);
  if (filled.text !== stringified) {
    try { parsed = JSON.parse(filled.text); } catch { parsed = raw; }
  }
  return coerceMorphTile(parsed, original);
}

/** The tile at an expandPlan path, or null when the path doesn't exist. */
export function tileAtPath(plan: SurfacePlan, path: number[]): TileSpec | null {
  const fromList = (list: readonly TileSpec[], p: number[]): TileSpec | null => {
    const [i, ...rest] = p;
    if (i === undefined || i < 0 || i >= list.length) return null;
    const cur = list[i];
    if (!rest.length) return cur;
    return fromNode(cur, rest);
  };
  const fromNode = (t: TileSpec, rest: number[]): TileSpec | null => {
    if (t.type === 'row' || t.type === 'grid' || t.type === 'card') return fromList(t.children, rest);
    if (t.type === 'tabs') {
      const [ti, ...r2] = rest;
      if (ti === undefined || ti < 0 || ti >= t.tabs.length || !r2.length) return null;
      return fromList(t.tabs[ti].children, r2);
    }
    if (t.type === 'split') {
      const [side, ...r2] = rest;
      if ((side !== 0 && side !== 1) || !r2.length) return null;
      return fromList(side === 0 ? t.first : t.second, r2);
    }
    return null; // leaf with path left over
  };
  return fromList(plan.tiles, path);
}

/** Splice `tile` at `path`, structurally sharing everything else: tiles off
 *  the path stay reference-equal — the plan DIFF is one tile, which is what
 *  "in place" means here. Null when the path doesn't resolve. */
export function applyMorphPatch(plan: SurfacePlan, path: number[], tile: TileSpec): SurfacePlan | null {
  const patchList = (list: readonly TileSpec[], p: number[]): TileSpec[] | null => {
    const [i, ...rest] = p;
    if (i === undefined || i < 0 || i >= list.length) return null;
    const next = rest.length ? patchNode(list[i], rest) : tile;
    if (next === null) return null;
    const out = list.slice();
    out[i] = next;
    return out;
  };
  const patchNode = (t: TileSpec, rest: number[]): TileSpec | null => {
    if (t.type === 'row' || t.type === 'grid' || t.type === 'card') {
      const children = patchList(t.children, rest);
      return children && { ...t, children };
    }
    if (t.type === 'tabs') {
      const [ti, ...r2] = rest;
      if (ti === undefined || ti < 0 || ti >= t.tabs.length || !r2.length) return null;
      const children = patchList(t.tabs[ti].children, r2);
      if (!children) return null;
      const tabs = t.tabs.slice();
      tabs[ti] = { ...tabs[ti], children };
      return { ...t, tabs };
    }
    if (t.type === 'split') {
      const [side, ...r2] = rest;
      if ((side !== 0 && side !== 1) || !r2.length) return null;
      const next = patchList(side === 0 ? t.first : t.second, r2);
      if (!next) return null;
      return side === 0 ? { ...t, first: next } : { ...t, second: next };
    }
    return null;
  };
  const tiles = patchList(plan.tiles, path);
  return tiles && { ...plan, tiles };
}

/** Meta-commands intercepted while the morph card is open — handled locally,
 *  never sent to a model. 'undo' falls through to the canvas's own undo. */
export function morphMeta(text: string): 'cancel' | 'undo' | null {
  const t = text.trim().toLowerCase();
  if (/^(cancel|never ?mind|stop|close|forget it|leave it)[.!]?$/.test(t)) return 'cancel';
  if (/^undo( that| it)?[.!]?$/.test(t)) return 'undo';
  return null;
}

/** History summary for one morph: "morph: Desk lamp — change color". */
export function morphSummary(label: string, utterance: string): string {
  return `morph: ${label} — ${utterance}`;
}
