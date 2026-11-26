// A room turn ("build the dashboard", "connect everything in this room") is
// about the devices that are really here. Two rules hold whatever the model
// wrote — on-device draft, Gemini improvement or a Gemini handoff alike:
//
//  1. The model is told about every device that answers right now: the
//     managed WiZ lamps the bridge really found (not a remembered bulb that
//     is "Not reachable"), the speaker, and any other device in the store.
//  2. A rebuild never drops a device tile that is still real. A device tile
//     the board already had (its device is still in the device list) is put
//     back when the reply left it out; a device that answers but is on no
//     tile gets one; the gimbal tile stays (or joins, while the paired
//     iPhone reports a stand). What was put back is listed, so the review
//     can say so — the diff against the old board stays honest.
import type { DeviceHint } from './aiTurn';
import { isManagedLampId } from './realLamps';
import { GIMBAL_TILE_LABEL } from './gimbalTile';
import { MAX_TILES, type DeviceState, type SurfacePlan, type TileSpec } from './surfacePlan';

/** What a board shows, as keys: device ids, and 'gimbal'. */
export function tileKeys(p: SurfacePlan | null): string[] {
  return p ? leafTiles(p.tiles).flatMap((t) => (t.type === 'gimbal' ? ['gimbal'] : 'deviceId' in t ? [t.deviceId] : [])) : [];
}

/** Which board changes are hers (and so can take a tile off for good): a
 *  change she made herself (by 'her': a tile sent to a phone, an edit), or
 *  a review she kept. A Gemini self-check fix or a morph patch is applied
 *  without that review, so a tile it drops is not a dismissal. */
export function isHerChange(e: { by: string; kind?: string }, o: { kept?: boolean } = {}): boolean {
  if (e.kind && e.kind !== 'surface') return false;
  return e.by === 'her' || !!o.kept;
}

/** The tiles she took off a board (a narrowed rebuild she kept, a tile sent
 *  to a phone, an edit): a later rebuild never puts them back. Only a tile
 *  whose device was real at that moment counts — a lamp that went missing
 *  while it was unreachable comes back once it answers again.
 *  Not remembered: undoing a change (undo restores the old board without a
 *  new history push), so a tile the floor added and she then undid can be
 *  added again by the next rebuild — say "without the …" to keep it off. */
export function createDismissals(initial: Record<string, readonly string[]> = {}) {
  const byFrame = new Map<string, Set<string>>();
  for (const [frameId, keys] of Object.entries(initial)) {
    if (Array.isArray(keys)) byFrame.set(frameId, new Set(keys.filter((k): k is string => typeof k === 'string' && k.length <= 64).slice(0, 64)));
  }
  return {
    /** For storage, beside the surfaces: frame id → keys (only frames in `keep`). */
    toJSON(keep: (frameId: string) => boolean = () => true): Record<string, string[]> {
      const out: Record<string, string[]> = {};
      for (const [frameId, set] of byFrame) if (set.size && keep(frameId)) out[frameId] = [...set];
      return out;
    },
    /** A board changed from `before` to `after`. */
    note(frameId: string, before: SurfacePlan | null, after: SurfacePlan | null, real: (key: string) => boolean): void {
      if (!before || !after) return;
      const set = byFrame.get(frameId) ?? new Set<string>();
      const now = new Set(tileKeys(after));
      for (const k of tileKeys(before)) if (!now.has(k) && real(k)) set.add(k);
      for (const k of now) set.delete(k);
      byFrame.set(frameId, set);
    },
    /** What stays off this board (never what it shows now). */
    of(frameId: string, current: SurfacePlan | null): Set<string> {
      const now = new Set(tileKeys(current));
      return new Set([...(byFrame.get(frameId) ?? [])].filter((k) => !now.has(k)));
    },
  };
}

type DeviceTile = Extract<TileSpec, { deviceId: string }>;
const isDeviceTile = (t: TileSpec): t is DeviceTile => t.type === 'lamp' || t.type === 'music' || t.type === 'switch';

function childrenOf(t: TileSpec): TileSpec[] | null {
  switch (t.type) {
    case 'row': case 'grid': case 'card': return t.children;
    case 'tabs': return t.tabs.flatMap((tab) => tab.children);
    case 'split': return [...t.first, ...t.second];
    default: return null;
  }
}

/** Every leaf tile, in reading order, through every group. */
export function leafTiles(tiles: readonly TileSpec[]): TileSpec[] {
  const out: TileSpec[] = [];
  const walk = (ts: readonly TileSpec[]): void => {
    for (const t of ts) { const kids = childrenOf(t); if (kids) walk(kids); else out.push(t); }
  };
  walk(tiles);
  return out;
}

/** The devices that answer right now, for a room turn's prompt. A managed
 *  lamp counts only while it is reachable (and, on a live canvas, only once
 *  the bridge has really found it — a remembered SIM placeholder does not);
 *  every other device in the store (the speaker, a switch) counts. */
export function answeringDevices(all: Record<string, DeviceState>, o: { label: (id: string) => string; kind: (id: string) => string; live: boolean }): DeviceHint[] {
  const out: DeviceHint[] = [];
  for (const [id, d] of Object.entries(all)) {
    if (isManagedLampId(id) && (d.unreachable || (o.live && d.sim))) continue;
    out.push({ id, label: o.label(id), kind: o.kind(id) });
  }
  return out;
}

function tileTypeFor(kind: string): 'lamp' | 'music' | 'switch' {
  const k = kind.toLowerCase();
  if (k === 'music' || k === 'speaker') return 'music';
  if (k === 'switch' || k === 'plug' || k === 'fan' || k === 'tv' || k === 'ac') return 'switch';
  return 'lamp';
}

export type RoomKind = 'lamp' | 'music' | 'switch' | 'gimbal';
const KIND_WORDS: ReadonlyArray<[string, RoomKind]> = [
  ['lamps?|lights?|bulbs?|wiz', 'lamp'],
  ['speakers?|music|spotify|player', 'music'],
  ['switch(?:es)?|plugs?|fans?|tvs?', 'switch'],
  ['gimbal|stand|dock', 'gimbal'],
];
/** She narrowed the board: "only the lamps", "just the speaker", "without
 *  the gimbal", "remove the desk lamp". Kinds and device ids she named. */
export interface Narrowing { mode: 'only' | 'without'; kinds: Set<RoomKind>; ids: Set<string> }
const NARROW_RE = /\b(only|just|without|except|no|remove|drop|minus)\b/g;
/** At most a determiner / possessive between the word and what it names. */
const DET = '(?:(?:the|my|our|a|any)\\s+)?';
/** "don't / do not / never" (one word may sit between) cancels the word. */
const NEGATED = /\b(?:don['’]?t|do not|never)\s+(?:\w+\s+)?$/;
const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What her words narrow the board to, or null (a plain "build the
 *  dashboard": the reply only forgot tiles, so they are put back). The
 *  narrowing word must be followed straight away (at most a determiner or
 *  possessive between) by a device or a kind: "only the lamps", "no
 *  speaker". "just build me a dashboard for my lights" and "no problem, …"
 *  are not narrowings, and "don't remove the speaker" is cancelled. "…, the
 *  speaker" / "and the speaker" after the first name extends the list. */
export function narrowingOf(utterance: string, devices: readonly { id: string; label: string }[] = []): Narrowing | null {
  const text = utterance.toLowerCase().replace(/\s+/g, ' ');
  // Device names (longest first: "desk lamp" before the kind "lamp"), then
  // kinds. Whole words: "the lamps" is the kind, not the device "Lamp".
  const names: Array<{ re: RegExp; kind?: RoomKind; id?: string }> = [
    ...[...devices].filter((d) => d.label).sort((x, y) => y.label.length - x.label.length)
      .map((d) => ({ re: new RegExp(`${DET}${esc(d.label.toLowerCase())}\\b`, 'y'), id: d.id })),
    ...KIND_WORDS.map(([w, kind]) => ({ re: new RegExp(`${DET}(?:${w})\\b`, 'y'), kind })),
  ];
  const nameAt = (pos: number): { end: number; kind?: RoomKind; id?: string } | null => {
    for (const n of names) {
      n.re.lastIndex = pos;
      const m = n.re.exec(text);
      if (m) return { end: pos + m[0].length, kind: n.kind, id: n.id };
    }
    return null;
  };
  for (const m of text.matchAll(NARROW_RE)) {
    const at = m.index ?? 0;
    if (NEGATED.test(text.slice(0, at))) continue;
    const mode = m[1] === 'only' || m[1] === 'just' ? 'only' as const : 'without' as const;
    const kinds = new Set<RoomKind>();
    const ids = new Set<string>();
    let pos = at + m[0].length;
    while (text[pos] === ' ') {
      const hit = nameAt(pos + 1);
      if (!hit) break;
      if (hit.id) ids.add(hit.id); else if (hit.kind) kinds.add(hit.kind);
      pos = hit.end;
      const more = /^(?:,(?: and| or)?| and| or| &)(?= )/.exec(text.slice(pos));
      if (!more) break;
      pos += more[0].length;
    }
    if (kinds.size || ids.size) return { mode, kinds, ids };
  }
  return null;
}
const kindOfTile = (t: TileSpec): RoomKind | null => (t.type === 'lamp' || t.type === 'music' || t.type === 'switch' || t.type === 'gimbal' ? t.type : null);
/** May the floor put this tile on her board, given how she narrowed it? */
function allowedBy(n: Narrowing | null, t: TileSpec): boolean {
  if (!n) return true;
  const kind = kindOfTile(t);
  // A device she named by its label is that device, not its whole kind
  // ("only the desk lamp" is not "only the lamps").
  const named = isDeviceTile(t) ? (n.ids.size ? n.ids.has(t.deviceId) : !!kind && n.kinds.has(kind)) : !!kind && n.kinds.has(kind);
  return n.mode === 'only' ? named : !named;
}

export interface KeepRoomDevicesInput {
  /** The board as it is now (null: a blank board). */
  before: SurfacePlan | null;
  /** The devices that answer now (answeringDevices). Only these count as
   *  "still real": a board tile for an unreachable lamp is not put back. */
  answering: readonly DeviceHint[];
  /** The paired iPhone reports a stand right now (the gimbal tile is kept
   *  or added only then). */
  stand: boolean;
  /** Her words: a narrowing ("only the lamps") limits what is put back. */
  utterance?: string;
  /** Device ids (and 'gimbal') that were on this board before and that she
   *  has since taken off: never put back. */
  dismissed?: ReadonlySet<string>;
  /** Fit the result to what can be shown (fitLampTiles…); the kept/added
   *  lists name only tiles that survive it. */
  fit?: (plan: SurfacePlan) => SurfacePlan;
}

export interface KeptRoom {
  plan: SurfacePlan;
  /** Tiles the board had that the reply left out, put back (their labels). */
  restored: string[];
  /** Devices that answer but were on no tile, given one (their labels). */
  added: string[];
}

/** The most tiles one row holds when extras join it; past that they go in a grid. */
export const ROW_MAX_CHILDREN = MAX_TILES;

/** The model's room plan with every real device tile kept (see the header).
 *  The same plan object when nothing had to change; never touches a floor
 *  plan. Extra tiles go after the reply's own tiles, before its Connect
 *  button; when the board has no top-level room left they share one row. */
export function keepRoomDevices(proposed: SurfacePlan, i: KeepRoomDevicesInput): KeptRoom {
  const fit = i.fit ?? ((p: SurfacePlan) => p);
  if (proposed.kind !== 'room') return { plan: fit(proposed), restored: [], added: [] };
  const narrow = narrowingOf(i.utterance ?? '', i.answering);
  const dismissed = i.dismissed ?? new Set<string>();
  const real = new Set(i.answering.map((d) => d.id));
  const leaves = leafTiles(proposed.tiles);
  const shown = new Set(leaves.filter(isDeviceTile).map((t) => t.deviceId));
  const hasGimbal = leaves.some((t) => t.type === 'gimbal');
  const extra: TileSpec[] = [];
  const restored: Array<{ key: string; label: string }> = [];
  const added: Array<{ key: string; label: string }> = [];
  const beforeLeaves = i.before ? leafTiles(i.before.tiles) : [];
  for (const t of beforeLeaves) {
    if (!isDeviceTile(t) || shown.has(t.deviceId) || !real.has(t.deviceId) || !allowedBy(narrow, t)) continue;
    shown.add(t.deviceId);
    extra.push(t);
    restored.push({ key: t.deviceId, label: t.label });
  }
  for (const d of i.answering) {
    if (shown.has(d.id) || dismissed.has(d.id)) continue;
    const tile: TileSpec = { type: tileTypeFor(d.kind), deviceId: d.id, label: d.label };
    if (!allowedBy(narrow, tile)) continue;
    shown.add(d.id);
    extra.push(tile);
    added.push({ key: d.id, label: d.label });
  }
  const oldGimbal = beforeLeaves.find((t) => t.type === 'gimbal');
  const gimbalTile: TileSpec = oldGimbal ?? { type: 'gimbal', label: GIMBAL_TILE_LABEL };
  if (!hasGimbal && i.stand && allowedBy(narrow, gimbalTile) && (oldGimbal || !dismissed.has('gimbal'))) {
    extra.push(gimbalTile);
    (oldGimbal ? restored : added).push({ key: 'gimbal', label: GIMBAL_TILE_LABEL });
  }
  if (!extra.length) return { plan: fit(proposed), restored: [], added: [] };

  let tiles = [...proposed.tiles];
  // Real devices are on the board now: a Connect button stays only if there
  // is room for it (it is the one tile that can go).
  const connectAt = tiles.findIndex((t) => t.type === 'connect');
  const room = MAX_TILES - tiles.length;
  if (extra.length <= room) {
    tiles.splice(connectAt < 0 ? tiles.length : connectAt, 0, ...extra);
  } else {
    if (room <= 0 && connectAt >= 0) tiles.splice(connectAt, 1);
    const at = tiles.findIndex((t) => t.type === 'connect');
    if (tiles.length < MAX_TILES) tiles.splice(at < 0 ? tiles.length : at, 0, { type: 'row', children: extra });
    else {
      // Still full: the extras join the last top-level tile. A row is
      // extended (never a row inside a row); past ROW_MAX_CHILDREN, a grid.
      const last = tiles[tiles.length - 1];
      const children = last.type === 'row' ? [...last.children, ...extra] : [last, ...extra];
      const joined: TileSpec = children.length <= ROW_MAX_CHILDREN ? { type: 'row', children } : { type: 'grid', columns: 3, children };
      tiles = [...tiles.slice(0, -1), joined];
    }
  }
  const plan = fit({ ...proposed, tiles });
  // Name only what she will see after fitting.
  const after = leafTiles(plan.tiles);
  const visible = (k: { key: string }): boolean => (k.key === 'gimbal' ? after.some((t) => t.type === 'gimbal') : after.some((t) => isDeviceTile(t) && t.deviceId === k.key));
  return { plan, restored: restored.filter(visible).map((k) => k.label), added: added.filter(visible).map((k) => k.label) };
}

/** One plain line for the terminal / review: what was put back or added. */
export function keptRoomLine(k: Pick<KeptRoom, 'restored' | 'added'>): string {
  const list = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const parts: string[] = [];
  if (k.restored.length) parts.push(`kept ${list(k.restored)} (the reply left ${k.restored.length === 1 ? 'it' : 'them'} out)`);
  if (k.added.length) parts.push(`added ${list(k.added)} (${k.added.length === 1 ? 'it answers' : 'they answer'} here)`);
  if (!parts.length) return '';
  const s = parts.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
