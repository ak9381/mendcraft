// A spoken / typed edit to the floor plan that is ALREADY on a board ("add a
// study next to bedroom 2", "make the kitchen bigger"). The model only
// DECIDES — one tiny JSON object naming an action, a room from the list and
// maybe a side, a name and a size — and everything else (coordinates, walls,
// doors, ids) is worked out here, deterministically, on a copy of the current
// drawing. The result is a whole new drawing that goes to review; nothing is
// applied until she approves it. A reply that cannot become a valid edit is
// refused with one plain line and nothing changes.
//
//   {"a":"add","r":"Bedroom 2","n":"Study"}
//   {"a":"resize","r":"Kitchen","s":"e","m":1}
import { extractJson } from '../ai/cloudJson';
import { CloudCallError } from '../ai/cloudErrors';
import { PlanEngine } from '../plan/engine';
import { wallDir, wallLength, pointAlong, type Opening, type PlanDoc, type Point, type Room, type Wall } from '../plan/doc';
import { stairStepCount } from '../plan/fixtures';
import { DEFAULTS, validatePlanOp } from '../plan/ops';
import { GEMINI_TIMEOUT_MS, NANO_LOAD_MAX_MS, NANO_QUEUE_WAIT_MS, NANO_TIMEOUT_MS, geminiFailLine, withTimeoutRetry, type EngineId, type NanoLoadState, type SentInfo, type StreamOptions, type SurfaceEngine } from './aiTurn';

/** Said (and shown) when no valid edit came back. Nothing changed. */
export const PLAN_EDIT_FAIL = 'I couldn’t change the plan — try drawing it with your hand or say it another way.';

export const PLAN_EDIT_ACTIONS = ['add', 'remove', 'rename', 'resize', 'move', 'door', 'window', 'stairs', 'none'] as const;
export type PlanEditAction = (typeof PLAN_EDIT_ACTIONS)[number];
export type Side = 'n' | 'e' | 's' | 'w';
const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const SIDE_WORD: Record<Side, string> = { n: 'north', e: 'east', s: 'south', w: 'west' };

export interface PlanEdit { a: PlanEditAction; r?: string; n?: string; s?: Side; m?: number }
/** A room's axis-aligned box, mm. */
export interface RoomBox { id: string; name: string; x: number; y: number; w: number; h: number }

// ---- what she might be asking ---------------------------------------------

/** Verbs that clearly edit a plan when a plan word comes with them. */
const EDIT_VERB = /\b(add|put|insert|place|build|remove|delete|take\s+out|get\s+rid\s+of|move|shift|slide|widen|enlarge|extend|stretch|lengthen|shrink|narrow|make|rename|convert)\b|\bturn\b[^.?!]*\binto\b/i;
/** On the plan board with no plan word: only verbs that cannot be small talk
 *  ("call my daughter", "turn the tv on", "put on the news" never qualify). */
const BARE_VERB = /\b(add|insert|remove|delete|move|shift|slide|widen|enlarge|extend|stretch|lengthen|shrink|narrow|make|rename)\b/i;
const PLAN_NOUN = /\b(rooms?|bed\s*rooms?|study|studies|office|kitchen|bath\s*rooms?|bath|toilet|wc|living\s*room|lounge|hall(way)?|corridor|walls?|doors?|doorway|windows?|stairs?|stair\s*case|staircase|closet|wardrobe|garage|dining(\s*room)?|utility|laundry|nursery|den|balcony|porch|pantry|store\s*room|guest\s*room|playroom)\b/i;
/** Devices, boards and media: never a plan edit (device / connect routes own them). */
const NOT_A_PLAN_EDIT = /\b(dashboards?|control\s+panels?|remote\s+controls?|boards?|lamps?|lights?|bulbs?|speakers?|music|songs?|volume|brightness|fans?|tvs?|television|thermostats?|plugs?|sockets?|ac|air\s*con\w*|heaters?|heating|cameras?|locks?|blinds?|curtains?|news|weather|radio)\b/i;
/** A question or a wish is not an edit request ("what if I move the bedroom",
 *  "tell me how to make my bathroom safer", "I want to build a nursery
 *  someday"). A polite ask ("can you make the kitchen bigger?") is. */
const NOT_AN_ASK = /^\s*(what|how|why|when|where|who|which|whose|is|are|does|did|should|shall|was|were)\b|\b(tell\s+me|explain|what\s+if|how\s+(to|do|can|would|should|does)|someday|some\s+day|one\s+day|eventually|in\s+the\s+future|i\s+(wish|hope|dream|wonder))\b/i;
/** A NEW floor plan ("make a floor plan with two bedrooms and a kitchen"). */
const NEW_FLOOR_PLAN = /\b(make|build|create|new|draw|start|design|generate|sketch|give\s+me)\b[^.?!]*\bfloor\s*plans?\b|\bfloor\s*plans?\b[^.?!]*\b(with|of)\b/i;
const SIZE_OR_SIDE = /\b(bigger|smaller|larger|wider|narrower|longer|shorter|left|right|north|south|east|west|up|down|metres?|meters?|\d+(\.\d+)?\s*m)\b/i;
const IT_ROOM = /\b(it|this\s+room|that\s+room|this\s+one|that\s+one)\b/i;

function notAnEdit(text: string): boolean {
  return NOT_A_PLAN_EDIT.test(text) || NOT_AN_ASK.test(text) || NEW_FLOOR_PLAN.test(text);
}

/** Clearly an edit to a floor plan: an edit verb AND a plan word ("add a
 *  study next to bedroom 2"), never about devices, never a question or a
 *  wish, never a request for a new floor plan. */
export function isPlanEditAsk(text: string): boolean {
  return EDIT_VERB.test(text) && PLAN_NOUN.test(text) && !notAnEdit(text);
}

/** Does the sentence name one of these rooms ("bedroom two" names "Bedroom 2")? */
export function mentionsRoom(text: string, roomNames: readonly string[]): boolean {
  const t = ` ${normName(text)} `;
  return roomNames.some((n) => { const k = normName(n); return !!k && t.includes(` ${k} `); });
}

/** On the floor-plan board itself, without a plan word: an edit verb plus a
 *  room from THIS plan, or "it / this room" plus a size or side ("make it
 *  bigger", "move it to the right"). */
export function isPlanEditOnPlanBoard(text: string, roomNames: readonly string[] = []): boolean {
  if (notAnEdit(text) || !BARE_VERB.test(text)) return false;
  return mentionsRoom(text, roomNames) || (IT_ROOM.test(text) && SIZE_OR_SIDE.test(text));
}

// ---- the plan as rooms -----------------------------------------------------

const EPS = 1;
const near = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

function roomWalls(room: Room, doc: PlanDoc): Wall[] {
  return room.wallIds.map((id) => doc.walls.find((w) => w.id === id)).filter((w): w is Wall => !!w);
}

/** Every room with at least one wall, as its bounding box. */
export function planRooms(doc: PlanDoc): RoomBox[] {
  const out: RoomBox[] = [];
  for (const room of doc.rooms ?? []) {
    const walls = roomWalls(room, doc);
    if (!walls.length) continue;
    const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    if (w < EPS || h < EPS) continue;
    out.push({ id: room.id, name: room.name, x, y, w, h });
  }
  return out;
}

const m1 = (mm: number): string => (Math.round(mm / 100) / 10).toFixed(1).replace(/\.0$/, '');
/** Text that goes inside a prompt: no quotes, no newlines, no separators. */
const promptSafe = (s: string, max = 40): string => s.replace(/[\r\n\t"“”\\;]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** "Bedroom 1 4x3 m at (0,3); …" — the compact context both models get. */
export function planRoomsContext(rooms: readonly RoomBox[]): string {
  return rooms.map((r) => `${promptSafe(r.name)} ${m1(r.w)}x${m1(r.h)} m at (${m1(r.x)},${m1(r.y)})`).join('; ') || 'none';
}

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', first: '1', second: '2', third: '3' };
const normName = (s: string): string => s.toLowerCase().replace(/[’']s\b/g, '').replace(/\b(one|two|three|four|five|six|first|second|third)\b/g, (w) => NUMBER_WORDS[w])
  .replace(/\bthe\b/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+room$/, '').replace(/\s+/g, ' ').trim();

/** Every room a model or a sentence could mean by `name` ("bedroom two", "the kitchen"). */
export function roomsNamed(rooms: readonly RoomBox[], name: string | undefined): RoomBox[] {
  if (!name) return [];
  const want = normName(name);
  if (!want) return [];
  const exact = rooms.filter((r) => normName(r.name) === want);
  return exact.length ? exact : rooms.filter((r) => normName(r.name).replace(/\s+/g, '') === want.replace(/\s+/g, ''));
}
export function findRoom(rooms: readonly RoomBox[], name: string | undefined): RoomBox | null {
  return roomsNamed(rooms, name)[0] ?? null;
}

// ---- the prompt ------------------------------------------------------------

export const PLAN_EDIT_SYSTEM = [
  'You edit a floor plan on a smart home canvas.',
  'Reply with JSON only: {"a": action, "r": room, "n": name, "s": side, "m": metres}',
  'a = add (a new room named n beside room r), remove (room r), rename (room r to n), resize (room r grows m metres on side s; negative m shrinks it), move (room r moves m metres toward side s), door or window (on side s of room r), stairs (inside room r), none (anything else).',
  'r is a room from the list. s is n, e, s or w (n is up, e is right). Leave out keys you do not need.',
].join('\n');

export interface PlanEditRequest { prompt: string; system: string; user: string; constraint: Record<string, unknown> }

export function planEditConstraint(rooms: readonly RoomBox[]): Record<string, unknown> {
  const names = [...new Set(rooms.map((r) => promptSafe(r.name)).filter(Boolean))];
  return {
    type: 'object', additionalProperties: false, required: ['a'],
    properties: {
      a: { type: 'string', enum: [...PLAN_EDIT_ACTIONS] },
      ...(names.length ? { r: { type: 'string', enum: names } } : {}),
      n: { type: 'string', maxLength: 24 },
      s: { type: 'string', enum: [...SIDES] },
      m: { type: 'number' },
    },
  };
}

export function buildPlanEditRequest(text: string, rooms: readonly RoomBox[]): PlanEditRequest {
  const user = `Rooms: ${planRoomsContext(rooms)}\nShe said: "${promptSafe(text, 300)}"`;
  return { prompt: `${PLAN_EDIT_SYSTEM}\n${user}`, system: PLAN_EDIT_SYSTEM, user, constraint: planEditConstraint(rooms) };
}

// ---- the reply -------------------------------------------------------------

const cleanName = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[<>{}"“”\\\r\n\t;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  return s ? s.replace(/^./, (c) => c.toUpperCase()) : undefined;
};

export type ParsedPlanEdit =
  | { ok: true; edit: PlanEdit }
  | { ok: false; error: string; declined?: boolean; ambiguous?: { name: string; count: number } };

/** A model's text → an edit naming a real room, or why it was refused. */
export function parsePlanEdit(text: string, rooms: readonly RoomBox[]): ParsedPlanEdit {
  const json = extractJson(text);
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, error: 'the reply was not an edit' };
  const r = json as Record<string, unknown>;
  const a = String(r.a ?? r.action ?? '').toLowerCase() as PlanEditAction;
  if (!(PLAN_EDIT_ACTIONS as readonly string[]).includes(a)) return { ok: false, error: 'no known action' };
  if (a === 'none') return { ok: false, error: 'the model said it could not make that edit', declined: true };
  const said = typeof (r.r ?? r.room) === 'string' ? String(r.r ?? r.room) : undefined;
  const matches = roomsNamed(rooms, said);
  if (!matches.length) return { ok: false, error: 'no room from the plan was named' };
  if (matches.length > 1) return { ok: false, error: `${matches.length} rooms are called ${matches[0].name}`, ambiguous: { name: matches[0].name, count: matches.length } };
  const room = matches[0];
  const sideRaw = String(r.s ?? r.side ?? '').toLowerCase()[0] as Side | undefined;
  const s = sideRaw && (SIDES as readonly string[]).includes(sideRaw) ? sideRaw : undefined;
  const mNum = typeof r.m === 'number' ? r.m : typeof r.m === 'string' ? Number(r.m) : NaN;
  const m = Number.isFinite(mNum) ? mNum : undefined;
  const n = cleanName(r.n ?? r.name);
  if ((a === 'add' || a === 'rename') && !n) return { ok: false, error: 'no name for the room' };
  return { ok: true, edit: { a, r: room.name, ...(n ? { n } : {}), ...(s ? { s } : {}), ...(m !== undefined ? { m } : {}) } };
}

/** What to ask when two rooms share the name she used. */
export const ambiguousRoomLine = (name: string, count: number): string =>
  `There are ${count} rooms called ${name}, so I didn’t change anything. Rename one first, or say which one by its size or where it is.`;

// ---- walls: shared, never stacked ------------------------------------------

type Rect = { x: number; y: number; w: number; h: number };
const MIN_ROOM = 1500;
const MAX_ROOM = 12_000;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const samePt = (p: Point, q: Point): boolean => Math.hypot(p.x - q.x, p.y - q.y) < EPS;

/** Two walls on one line that overlap along it (a wall drawn on top of another). */
function stacked(a: Wall, b: Wall): boolean {
  const ha = near(a.a.y, a.b.y), hb = near(b.a.y, b.b.y);
  const va = near(a.a.x, a.b.x), vb = near(b.a.x, b.b.x);
  if (ha && hb && near(a.a.y, b.a.y)) {
    const lo = Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x)), hi = Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x));
    return hi - lo > 10;
  }
  if (va && vb && near(a.a.x, b.a.x)) {
    const lo = Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)), hi = Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y));
    return hi - lo > 10;
  }
  return false;
}
/** How many pairs of walls lie on top of each other. */
export function stackedWallPairs(doc: PlanDoc): number {
  let n = 0;
  for (let i = 0; i < doc.walls.length; i++) for (let j = i + 1; j < doc.walls.length; j++) if (stacked(doc.walls[i], doc.walls[j])) n++;
  return n;
}

function idMaker(doc: PlanDoc): (prefix: string) => string {
  let top = 0;
  for (const g of [doc.walls, doc.openings, doc.rooms, doc.dims, doc.fixtures, doc.texts]) {
    for (const o of g ?? []) { const k = Number(/(\d+)$/.exec(String((o as { id?: unknown }).id ?? ''))?.[1]); if (Number.isFinite(k) && k > top) top = k; }
  }
  return (prefix) => `${prefix}${++top}`;
}

/** Position of `p` along the line a→b, mm from a (p assumed on the line). */
const along = (a: Point, b: Point, p: Point): number => { const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L; };
const onLine = (a: Point, b: Point, w: Wall): boolean => {
  if (near(a.y, b.y)) return near(w.a.y, a.y) && near(w.b.y, a.y);
  if (near(a.x, b.x)) return near(w.a.x, a.x) && near(w.b.x, a.x);
  return false;
};

/** Split wall `id` at point `p` (on it, strictly inside): the wall keeps
 *  a→p, a new wall p→b joins every room loop next to it, openings move to
 *  the half they stand on, and a dimension keeps measuring the old span. */
function splitWall(doc: PlanDoc, id: string, p: Point, newId: string): PlanDoc | string {
  const w = doc.walls.find((x) => x.id === id)!;
  const cut = along(w.a, w.b, p);
  for (const o of doc.openings.filter((x) => x.wallId === id)) {
    if (o.offset < cut - EPS && o.offset + o.width > cut + EPS) return 'a door or window stands where a wall would have to be split';
  }
  const first: Wall = { ...w, b: { ...p } };
  const second: Wall = { ...w, id: newId, a: { ...p }, b: { ...w.b } };
  const rooms = doc.rooms.map((r) => {
    const i = r.wallIds.indexOf(id);
    if (i < 0) return r;
    const prev = doc.walls.find((x) => x.id === r.wallIds[(i - 1 + r.wallIds.length) % r.wallIds.length]);
    const prevAtA = !!prev && (samePt(prev.a, w.a) || samePt(prev.b, w.a));
    const ids = [...r.wallIds];
    ids.splice(i, 1, ...(prevAtA ? [id, newId] : [newId, id]));
    return { ...r, wallIds: ids };
  });
  return {
    ...doc,
    walls: doc.walls.flatMap((x) => (x.id === id ? [first, second] : [x])),
    openings: doc.openings.map((o) => (o.wallId === id && o.offset >= cut - EPS ? { ...o, wallId: newId, offset: Math.max(0, o.offset - cut) } : o)),
    dims: doc.dims.map((d) => (d.wallId === id ? { id: d.id, a: { ...w.a }, b: { ...w.b } } : d)),
    rooms,
  };
}

/** Draw room `rect` named `name` into a copy of `doc`, SHARING every wall
 *  already on its outline: a wall that runs past a corner is split there,
 *  covered stretches reuse the wall that is there, and only the gaps get new
 *  walls — so no wall is ever drawn on top of another. */
export function addRoomShared(doc: PlanDoc, rect: Rect, name: string): { doc: PlanDoc; roomId: string } | string {
  const id = idMaker(doc);
  const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
  const edges: Array<[Point, Point]> = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];
  let work: PlanDoc = structuredClone(doc);
  // 1. A wall on an edge's line that runs past one of its ends: split it there.
  for (const [p, q] of edges) {
    for (const c of [p, q]) {
      for (let guard = 0; guard < 8; guard++) {
        const w = work.walls.find((x) => onLine(p, q, x) && (() => { const t = along(x.a, x.b, c); return t > EPS && t < wallLength(x) - EPS; })());
        if (!w) break;
        const r = splitWall(work, w.id, c, id('w'));
        if (typeof r === 'string') return r;
        work = r;
      }
    }
  }
  // 2. Each edge: reuse walls lying on it, fill the gaps with new walls.
  const wallIds: string[] = [];
  const fresh: Wall[] = [];
  for (const [p, q] of edges) {
    const L = Math.hypot(q.x - p.x, q.y - p.y);
    const on = work.walls
      .filter((w) => onLine(p, q, w))
      .map((w) => { const t0 = along(p, q, w.a), t1 = along(p, q, w.b); return { w, lo: Math.min(t0, t1), hi: Math.max(t0, t1) }; })
      .filter((s) => s.lo > -EPS && s.hi < L + EPS && s.hi - s.lo > EPS)
      .sort((a, b) => a.lo - b.lo);
    const pt = (t: number): Point => ({ x: p.x + ((q.x - p.x) * t) / L, y: p.y + ((q.y - p.y) * t) / L });
    let cursor = 0;
    const gap = (to: number) => { const w: Wall = { id: id('w'), a: pt(cursor), b: pt(to), thickness: DEFAULTS.thickness }; fresh.push(w); wallIds.push(w.id); };
    for (const s of on) {
      if (s.lo < cursor - EPS) continue; // a wall already doubled in the drawing: leave it be
      if (s.lo > cursor + EPS) gap(s.lo);
      wallIds.push(s.w.id);
      cursor = s.hi;
    }
    if (cursor < L - EPS) gap(L);
  }
  const roomId = id('r');
  work = { ...work, walls: [...work.walls, ...fresh], rooms: [...work.rooms, { id: roomId, name, wallIds }], selectedId: null, selectedIds: [] };
  return { doc: work, roomId };
}

/** The room's walls that lie along side `s` of its box, longest first. */
function sideWalls(doc: PlanDoc, roomId: string, box: Rect, s: Side): Wall[] {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const on = (w: Wall): boolean => {
    if (s === 'n') return near(w.a.y, box.y + box.h) && near(w.b.y, box.y + box.h);
    if (s === 's') return near(w.a.y, box.y) && near(w.b.y, box.y);
    if (s === 'e') return near(w.a.x, box.x + box.w) && near(w.b.x, box.x + box.w);
    return near(w.a.x, box.x) && near(w.b.x, box.x);
  };
  return roomWalls(room, doc).filter(on).sort((p, q) => wallLength(q) - wallLength(p));
}

function beside(box: Rect, s: Side, depth: number): Rect {
  if (s === 'e') return { x: box.x + box.w, y: box.y, w: depth, h: box.h };
  if (s === 'w') return { x: box.x - depth, y: box.y, w: depth, h: box.h };
  if (s === 'n') return { x: box.x, y: box.y + box.h, w: box.w, h: depth };
  return { x: box.x, y: box.y - depth, w: box.w, h: depth };
}
const facing: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

const sameBoxes = (a: readonly RoomBox[], b: readonly RoomBox[], skip: string | null): boolean => {
  const key = (r: RoomBox) => `${r.name}|${Math.round(r.x)}|${Math.round(r.y)}|${Math.round(r.w)}|${Math.round(r.h)}`;
  const B = new Set(b.map(key));
  return a.filter((r) => r.id !== skip).every((r) => B.has(key(r)));
};

/** Remove a room: its own walls go, walls it shares with another room stay. */
function withoutRoom(doc: PlanDoc, roomId: string): { doc: PlanDoc; removedWalls: Wall[] } {
  const room = doc.rooms.find((r) => r.id === roomId)!;
  const usedElsewhere = new Set(doc.rooms.filter((r) => r.id !== roomId).flatMap((r) => r.wallIds));
  const gone = new Set(room.wallIds.filter((id) => !usedElsewhere.has(id)));
  return {
    removedWalls: doc.walls.filter((w) => gone.has(w.id)),
    doc: {
      ...doc,
      walls: doc.walls.filter((w) => !gone.has(w.id)),
      openings: doc.openings.filter((o) => !gone.has(o.wallId)),
      dims: doc.dims.filter((d) => !d.wallId || !gone.has(d.wallId)),
      rooms: doc.rooms.filter((r) => r.id !== roomId),
      selectedId: null, selectedIds: [],
    },
  };
}

const inside = (p: { x: number; y: number }, r: Rect): boolean => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

function applyRaw(engine: PlanEngine, raw: Record<string, unknown>): string | null {
  // Same untrusted-input gate as every other plan op.
  const v = validatePlanOp(raw);
  if (!v.ok) return v.error;
  const r = engine.apply(v.op);
  return r.ok ? null : r.error ?? 'the plan refused that edit';
}

// ---- the edit, on a copy ---------------------------------------------------

export interface AppliedPlanEdit { doc: PlanDoc; summary: string }
export type PlanEditResult = { ok: true; value: AppliedPlanEdit } | { ok: false; error: string };

/** Apply one edit to a COPY of the drawing. Other rooms never change shape,
 *  and no wall ends up drawn on top of another. */
export function applyPlanEdit(doc: PlanDoc, edit: PlanEdit): PlanEditResult {
  const rooms = planRooms(doc);
  const named = roomsNamed(rooms, edit.r);
  if (!named.length) return { ok: false, error: 'that room is not on the plan' };
  if (named.length > 1) return { ok: false, error: `${named.length} rooms are called ${named[0].name}` };
  const box = named[0];
  const others = rooms.filter((r) => r.id !== box.id);
  const engine = new PlanEngine();
  const start = structuredClone(doc);
  const run = (base: PlanDoc, ops: Record<string, unknown>[]): string | null => {
    engine.restore(base);
    for (const raw of ops) { const r = applyRaw(engine, raw); if (r) return r; }
    return null;
  };
  const free = (r: Rect, skip: RoomBox | null = null): boolean => !rooms.some((o) => o !== skip && overlaps(r, o));
  let summary: string;
  let targetId: string | null = box.id;

  switch (edit.a) {
    case 'add': {
      const name = edit.n!;
      if (findRoom(rooms, name)) return { ok: false, error: `there is already a ${name}` };
      const depth = (edit.m && edit.m > 0 ? edit.m : 3) * 1000;
      if (depth < MIN_ROOM || depth > 8000) return { ok: false, error: 'a room must be between 1.5 and 8 m deep' };
      const order: Side[] = edit.s ? [edit.s, ...(['e', 'w', 'n', 's'] as Side[]).filter((s) => s !== edit.s)] : ['e', 'w', 'n', 's'];
      const side = order.find((s) => free(beside(box, s, depth)));
      if (!side) return { ok: false, error: `there is no free side next to ${box.name}` };
      const rect = beside(box, side, depth);
      if (rect.w < MIN_ROOM || rect.h < MIN_ROOM) return { ok: false, error: 'the new room would be smaller than 1.5 m' };
      const added = addRoomShared(start, rect, name);
      if (typeof added === 'string') return { ok: false, error: added };
      engine.restore(added.doc);
      // A door into it, on the wall it shares with the room she named.
      // (Its walls on that side are the named room's own walls, reused.)
      const shared = sideWalls(added.doc, added.roomId, rect, facing[side]).find((w) => wallLength(w) >= 900 && start.walls.some((x) => x.id === w.id));
      if (shared) applyRaw(engine, { op: 'add_door', target: shared.id, nums: { width: 800 } });
      summary = `Add ${name} (${m1(rect.w)} × ${m1(rect.h)} m) ${SIDE_WORD[side]} of ${box.name}`;
      targetId = null;
      break;
    }
    case 'remove': {
      const cut = withoutRoom(start, box.id);
      cut.doc.fixtures = cut.doc.fixtures.filter((f) => !inside(f, box));
      engine.restore(cut.doc);
      summary = `Remove ${box.name}`;
      break;
    }
    case 'rename': {
      const name = edit.n!;
      if (normName(name) === normName(box.name)) return { ok: false, error: 'that is already its name' };
      if (findRoom(others, name)) return { ok: false, error: `there is already a ${name}` };
      const err = run(start, [{ op: 'rename', target: box.id, name }]);
      if (err) return { ok: false, error: err };
      summary = `Rename ${box.name} to ${name}`;
      break;
    }
    case 'resize': case 'move': {
      const s = edit.s ?? 'e';
      const by = (edit.m ?? 1) * 1000;
      if (!Number.isFinite(by) || Math.abs(by) < 100 || Math.abs(by) > 8000) return { ok: false, error: 'that size change is out of range' };
      let rect: Rect = { x: box.x, y: box.y, w: box.w, h: box.h };
      if (edit.a === 'resize') {
        if (s === 'e') rect.w += by; else if (s === 'w') { rect.x -= by; rect.w += by; }
        else if (s === 'n') rect.h += by; else { rect.y -= by; rect.h += by; }
        if (rect.w < MIN_ROOM || rect.h < MIN_ROOM || rect.w > MAX_ROOM || rect.h > MAX_ROOM) return { ok: false, error: 'the room would be smaller than 1.5 m or bigger than 12 m' };
      } else {
        const dx = s === 'e' ? by : s === 'w' ? -by : 0;
        const dy = s === 'n' ? by : s === 's' ? -by : 0;
        rect = { ...rect, x: rect.x + dx, y: rect.y + dy };
      }
      if (!free(rect, box)) return { ok: false, error: `${box.name} would run into another room` };
      const built = rebuildRoom(start, box, rect, edit.a === 'move');
      if (typeof built === 'string') return { ok: false, error: built };
      engine.restore(built.doc);
      for (const op of built.openings) applyRaw(engine, op);
      summary = edit.a === 'move'
        ? `Move ${box.name} ${m1(Math.abs(by))} m ${SIDE_WORD[s]}`
        : `Make ${box.name} ${m1(Math.abs(by))} m ${by > 0 ? 'bigger' : 'smaller'} on the ${SIDE_WORD[s]} side`;
      targetId = box.id;
      break;
    }
    case 'door': case 'window': {
      const s = edit.s ?? pickOuterSide(start, box, others);
      const wall = sideWalls(start, box.id, box, s)[0];
      if (!wall) return { ok: false, error: `${box.name} has no ${SIDE_WORD[s]} wall` };
      const err = run(start, [{ op: edit.a === 'door' ? 'add_door' : 'add_window', target: wall.id, nums: { width: edit.a === 'door' ? 800 : 1000 } }]);
      if (err) return { ok: false, error: err };
      summary = `Add a ${edit.a} to ${box.name} (${SIDE_WORD[s]} wall)`;
      break;
    }
    case 'stairs': {
      const lengthwise = box.w >= box.h;
      const run1 = Math.min(3000, (lengthwise ? box.w : box.h) - 400);
      const wide = Math.min(1000, (lengthwise ? box.h : box.w) - 400);
      if (run1 < 900 || wide < 600) return { ok: false, error: `${box.name} is too small for stairs` };
      const err = run(start, [{ op: 'add_fixture', kind: 'stairs', nums: { x: box.x + box.w / 2, y: box.y + box.h / 2, w: run1, d: wide, rotation: lengthwise ? 0 : 90, steps: stairStepCount(run1) } }]);
      if (err) return { ok: false, error: err };
      summary = `Add stairs in ${box.name}`;
      break;
    }
    default:
      return { ok: false, error: 'no edit' };
  }
  const out: PlanDoc = { ...structuredClone(engine.getState()), selectedId: null, selectedIds: [] };
  // Nobody else's room may change shape or name, and no wall may be doubled.
  const resized = edit.a === 'resize' || edit.a === 'move';
  const keep = resized ? planRooms(doc).filter((r) => r.id !== box.id) : planRooms(doc);
  if (!sameBoxes(keep, planRooms(out), resized ? null : targetId)) return { ok: false, error: 'the edit would change another room' };
  if (stackedWallPairs(out) > stackedWallPairs(doc)) return { ok: false, error: 'the edit would draw a wall on top of another' };
  return { ok: true, value: { doc: out, summary } };
}

/** An outside wall of the room (no other room on that side), else south. */
function pickOuterSide(doc: PlanDoc, box: RoomBox, others: readonly RoomBox[]): Side {
  for (const s of ['n', 'e', 'w', 's'] as Side[]) if (!others.some((o) => overlaps(beside(box, s, 10), o)) && sideWalls(doc, box.id, box, s).length) return s;
  return 's';
}

/** Resize / move: the room is taken out (its own walls only) and drawn again
 *  at `rect`, sharing walls; its doors and windows go back where they stood
 *  (on whichever wall is there now), and a moved room takes its things along. */
function rebuildRoom(doc: PlanDoc, box: RoomBox, rect: Rect, moving: boolean): { doc: PlanDoc; openings: Record<string, unknown>[] } | string {
  const dx = moving ? rect.x - box.x : 0;
  const dy = moving ? rect.y - box.y : 0;
  const room = doc.rooms.find((r) => r.id === box.id)!;
  const cut = withoutRoom(doc, box.id);
  const removed = new Set(cut.removedWalls.map((w) => w.id));
  if (moving && room.wallIds.some((id) => !removed.has(id))) return `${box.name} shares a wall with another room, so it can’t move on its own`;
  // Openings on the walls that go: where they stood, carried with their side
  // of the room (a north window rides the north wall when it moves out).
  const shiftOf = (w: Wall): Point => {
    if (near(w.a.y, box.y + box.h) && near(w.b.y, box.y + box.h)) return { x: dx, y: rect.y + rect.h - (box.y + box.h) };
    if (near(w.a.y, box.y) && near(w.b.y, box.y)) return { x: dx, y: rect.y - box.y };
    if (near(w.a.x, box.x + box.w) && near(w.b.x, box.x + box.w)) return { x: rect.x + rect.w - (box.x + box.w), y: dy };
    if (near(w.a.x, box.x) && near(w.b.x, box.x)) return { x: rect.x - box.x, y: dy };
    return { x: dx, y: dy };
  };
  const carry: Array<{ o: Opening; from: Point; to: Point }> = [];
  for (const wall of cut.removedWalls) {
    const sh = shiftOf(wall);
    for (const o of doc.openings.filter((x) => x.wallId === wall.id)) {
      const p = pointAlong(wall, o.offset), q = pointAlong(wall, o.offset + o.width);
      carry.push({ o, from: { x: p.x + sh.x, y: p.y + sh.y }, to: { x: q.x + sh.x, y: q.y + sh.y } });
    }
  }
  if (moving) cut.doc.fixtures = cut.doc.fixtures.map((f) => (inside(f, box) ? { ...f, x: f.x + dx, y: f.y + dy } : f));
  const added = addRoomShared(cut.doc, rect, box.name);
  if (typeof added === 'string') return added;
  // Keep the room's own id (history, labels) on the redrawn room.
  const next: PlanDoc = { ...added.doc, rooms: added.doc.rooms.map((r) => (r.id === added.roomId ? { ...r, id: box.id } : r)) };
  const own = next.rooms.find((r) => r.id === box.id)!;
  const ops: Record<string, unknown>[] = [];
  for (const c of carry) {
    const wall = roomWalls(own, next).find((w) => {
      if (!onLine(w.a, w.b, { ...w, a: c.from, b: c.to })) return false;
      const t1 = along(w.a, w.b, c.from), t2 = along(w.a, w.b, c.to);
      return Math.min(t1, t2) > -EPS && Math.max(t1, t2) < wallLength(w) + EPS;
    });
    if (!wall) continue; // the diff shows the door/window count change: never silent
    const d = wallDir(wall);
    const t1 = (c.from.x - wall.a.x) * d.x + (c.from.y - wall.a.y) * d.y;
    const t2 = (c.to.x - wall.a.x) * d.x + (c.to.y - wall.a.y) * d.y;
    const op = c.o.kind === 'door' ? 'add_door' : c.o.kind === 'window' ? 'add_window' : 'add_opening';
    ops.push({ op, target: wall.id, nums: { offset: Math.max(0, Math.min(t1, t2)), width: c.o.width }, ...(c.o.swing ? { swing: c.o.swing } : {}) });
  }
  return { doc: next, openings: ops };
}

// ---- SIM: a rules guess, labelled SIM -------------------------------------

// ---- the turn --------------------------------------------------------------

export interface PlanEditTurnUi {
  /** A receipt for each engine that is really tried (the ledger books it). */
  onSent?(si: SentInfo): void;
  /** Nano couldn't make a valid edit; Gemini takes over (its own receipt). */
  onHandoff?(si: SentInfo, why: string): void;
  onCloudSend?(si: SentInfo): void;
  onCloudRetract?(si: SentInfo): void;
  onNanoLoading?(state: NanoLoadState): void;
  onText?(full: string): void;
  /** Why an engine's reply was refused (for its terminal). */
  onNote?(engine: EngineId, note: string): void;
}
export interface PlanEditTurnOptions {
  /** False when the cloud can't be reached (offline): no cloud call at all. */
  canHandoff?: () => boolean;
  /** What really goes to the cloud (names redacted on this device). */
  cloudPrompt?: (prompt: string) => string;
  /** A cloud reply may carry the redaction tokens back: real names return here. */
  restoreReply?: (reply: string) => string;
  nanoTimeoutMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
export type PlanEditOutcome =
  | { ok: true; value: AppliedPlanEdit; edit: PlanEdit; si: SentInfo; handedOff: boolean; nanoSi?: SentInfo }
  | { ok: false; why: string; si: SentInfo | null; offline: boolean; /** A question to say instead of the failure line. */ ask?: string };

const NANO_ROUTE = 'Nano · on device — nothing left this device';
const GEMINI_SENT = 'your words (names redacted) and the plan’s room names and sizes';

function receipt(eng: SurfaceEngine, prompt: string, line?: string): SentInfo {
  const cloud = eng.id === 'gemini';
  const base = line ?? eng.routeLine ?? (cloud ? 'Gemini · cloud — sent your words and the room list to edit the plan' : NANO_ROUTE);
  return { engine: eng.id, prompt, sent: cloud ? GEMINI_SENT : null, routeLine: eng.sim && !base.startsWith('SIM') ? `SIM · ${base}` : base, sim: eng.sim };
}

/** One plan-edit turn: Nano on this device first (one short constrained
 *  prompt, one repair), Gemini only when Nano couldn't produce an edit and
 *  the cloud is reachable — never when Nano itself said no. Returns the
 *  edited copy of the drawing, or why not. */
export async function runPlanEditTurn(text: string, doc: PlanDoc, engine: SurfaceEngine, ui: PlanEditTurnUi = {}, opts: PlanEditTurnOptions = {}): Promise<PlanEditOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rooms = planRooms(doc);
  if (!rooms.length) return { ok: false, why: 'the plan has no rooms yet', si: null, offline: false };
  const req = buildPlanEditRequest(text, rooms);
  const cloudOk = (): boolean => !opts.canHandoff || opts.canHandoff();
  type Tried = { ok: true; edit: PlanEdit; value: AppliedPlanEdit } | { ok: false; error: string; declined?: boolean; ask?: string };
  const tryReply = (reply: string): Tried => {
    const p = parsePlanEdit(reply, rooms);
    if (!p.ok) return { ok: false, error: p.error, declined: p.declined, ...(p.ambiguous ? { ask: ambiguousRoomLine(p.ambiguous.name, p.ambiguous.count) } : {}) };
    const a = applyPlanEdit(doc, p.edit);
    return a.ok ? { ok: true, edit: p.edit, value: a.value } : a;
  };
  const fail = (why: string, si: SentInfo | null, extra: { offline?: boolean; ask?: string } = {}): PlanEditOutcome =>
    ({ ok: false, why, si, offline: !!extra.offline, ...(extra.ask ? { ask: extra.ask } : {}) });

  /** A cloud receipt carries the prompt that really leaves (redacted). */
  const cloudReceipt = (eng: SurfaceEngine, line?: string): SentInfo => receipt(eng, opts.cloudPrompt ? opts.cloudPrompt(req.prompt) : req.prompt, line);
  const runCloud = async (eng: SurfaceEngine, si: SentInfo): Promise<PlanEditOutcome> => {
    try {
      const so: StreamOptions = { shape: 'json', onCloudSend: () => ui.onCloudSend?.(si), onCloudRetract: () => ui.onCloudRetract?.(si) };
      const raw = eng.sim
        ? await eng.stream(si.prompt, (f) => ui.onText?.(f), { shape: 'json' })
        : await withTimeoutRetry(() => eng.stream(si.prompt, (f) => ui.onText?.(f), so), { timeoutMs: opts.timeoutMs ?? GEMINI_TIMEOUT_MS, retries: 1, sleep, shouldRetry: (e) => !(e instanceof CloudCallError) || e.kind === 'timeout' || e.kind === 'busy' });
      const reply = eng.id === 'gemini' && opts.restoreReply ? opts.restoreReply(raw) : raw;
      const got = tryReply(reply);
      if (got.ok) return { ok: true, value: got.value, edit: got.edit, si, handedOff: false };
      ui.onNote?.(eng.id, `refused: ${got.error}`);
      return fail(got.error, si, { ask: got.ask });
    } catch (e) {
      const why = eng.id === 'gemini' ? geminiFailLine(e) : `Nano didn’t answer: ${e instanceof Error ? e.message : String(e)}`;
      ui.onNote?.(eng.id, why);
      return fail(why, si);
    }
  };

  const liveNano = engine.id === 'nano' && !engine.sim;
  if (!liveNano) {
    // A "Nano" step that is really Gemini (no Nano here) never runs offline.
    if (engine.id === 'gemini' && !engine.sim && !cloudOk()) return fail('offline, and Nano isn’t on this device', null, { offline: true });
    const si = engine.id === 'gemini' && !engine.sim ? cloudReceipt(engine) : receipt(engine, req.prompt);
    ui.onSent?.(si);
    return runCloud(engine, si);
  }

  // ---- on device: one constrained call + one repair, inside one budget
  const si = receipt(engine, req.prompt);
  ui.onSent?.(si);
  const budgetMs = opts.nanoTimeoutMs ?? NANO_TIMEOUT_MS;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let begin!: () => void;
  const began = new Promise<void>((r) => { begin = r; });
  let started = false;
  void sleep(NANO_QUEUE_WAIT_MS).then(() => { if (!started) begin(); });
  const onStart = (): void => { if (started) return; started = true; void sleep(NANO_LOAD_MAX_MS + 1_000).then(begin); };
  let over = false;
  const TIMED_OUT = Symbol('timeout');
  const deadline = began.then(() => sleep(budgetMs)).then(() => { if (!over) ctl?.abort(); return TIMED_OUT; });
  const timed = async (p: Promise<string>): Promise<string> => {
    p.catch(() => undefined);
    const got = await Promise.race([p, deadline]);
    if (got === TIMED_OUT) throw new Error(`took longer than ${Math.round(budgetMs / 1000)} s`);
    return got as string;
  };
  const so: StreamOptions = { constraint: req.constraint, signal: ctl?.signal, onStart, onReady: () => begin(), onLoading: (s) => ui.onNanoLoading?.(s), system: req.system };
  let why: string;
  try {
    let reply = await timed(engine.stream(req.prompt, (f) => ui.onText?.(f), { ...so, user: req.user }));
    let got = tryReply(reply);
    if (!got.ok && !got.declined && !got.ask) {
      ui.onNote?.('nano', `Nano’s edit was refused (${got.error}); asking once more.`);
      const user = `${req.user}\nYour last reply was refused: ${got.error}. Reply again with the JSON object only.`;
      reply = await timed(engine.stream(`${req.system}\n${user}`, (f) => ui.onText?.(f), { ...so, user }));
      got = tryReply(reply);
    }
    over = true;
    if (got.ok) return { ok: true, value: got.value, edit: got.edit, si, handedOff: false };
    // Nano said it can't (or the room name is ambiguous): that is an answer,
    // not a failure — the turn ends here and nothing goes to the cloud.
    if (got.declined || got.ask) { ctl?.abort(); ui.onNote?.('nano', got.error); return fail(got.error, si, { ask: got.ask }); }
    why = got.error;
  } catch (e) {
    over = true;
    why = e instanceof Error ? e.message : String(e);
  }
  ctl?.abort();
  ui.onNote?.('nano', `couldn’t make the edit: ${why}`);
  const cloud = engine.handoff;
  if (!cloud) return fail(why, si);
  if (!cloudOk()) return fail(why, si, { offline: true });
  const handed = cloudReceipt(cloud, `Gemini · cloud — Nano couldn’t make the edit (${why}), so Gemini made it`);
  handed.handoffWhy = why;
  ui.onHandoff?.(handed, why);
  const out = await runCloud(cloud, handed);
  return out.ok ? { ...out, handedOff: true, nanoSi: si } : out;
}
