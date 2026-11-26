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
import { pointAlong, wallDir, type Opening, type PlanDoc, type Room, type Wall } from '../plan/doc';
import { stairStepCount } from '../plan/fixtures';
import { validatePlanOp } from '../plan/ops';
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

const EDIT_VERB = /\b(add|put|insert|place|build|remove|delete|take\s+out|get\s+rid\s+of|move|shift|slide|widen|enlarge|extend|stretch|lengthen|shrink|narrow|make|rename|call|change|turn|convert)\b/i;
const PLAN_NOUN = /\b(rooms?|bed\s*rooms?|study|studies|office|kitchen|bath\s*rooms?|bath|toilet|wc|living\s*room|lounge|hall(way)?|corridor|walls?|doors?|doorway|windows?|stairs?|stair\s*case|staircase|closet|wardrobe|garage|dining(\s*room)?|utility|laundry|nursery|den|balcony|porch|pantry|store\s*room|guest\s*room|playroom)\b/i;
const NOT_A_PLAN_EDIT = /\b(dashboards?|control\s+panels?|remote\s+controls?|lamps?|lights?|bulbs?|speakers?|music|songs?|volume|brightness)\b/i;

/** Clearly an edit to a floor plan: an edit verb AND a plan word ("add a
 *  study next to bedroom 2"), never about lamps or dashboards. */
export function isPlanEditAsk(text: string): boolean {
  return EDIT_VERB.test(text) && PLAN_NOUN.test(text) && !NOT_A_PLAN_EDIT.test(text);
}
/** On the floor-plan board itself an edit verb is enough ("make it bigger"),
 *  unless she is asking for a new plan ("make a floor plan"). */
export function isPlanEditOnPlanBoard(text: string): boolean {
  if (NOT_A_PLAN_EDIT.test(text)) return false;
  if (/\bfloor\s*plans?\b/i.test(text) && !PLAN_NOUN.test(text)) return false;
  return EDIT_VERB.test(text);
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
/** "Bedroom 1 4x3 m at (0,3); …" — the compact context both models get. */
export function planRoomsContext(rooms: readonly RoomBox[]): string {
  return rooms.map((r) => `${r.name} ${m1(r.w)}x${m1(r.h)} m at (${m1(r.x)},${m1(r.y)})`).join('; ') || 'none';
}

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', first: '1', second: '2', third: '3' };
const normName = (s: string): string => s.toLowerCase().replace(/[’']s\b/g, '').replace(/\b(one|two|three|four|five|six|first|second|third)\b/g, (w) => NUMBER_WORDS[w])
  .replace(/\bthe\b/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+room$/, '').replace(/\s+/g, ' ').trim();

/** The room a model or a sentence named, forgivingly ("bedroom two", "the kitchen"). */
export function findRoom(rooms: readonly RoomBox[], name: string | undefined): RoomBox | null {
  if (!name) return null;
  const want = normName(name);
  if (!want) return null;
  return rooms.find((r) => normName(r.name) === want)
    ?? rooms.find((r) => normName(r.name).replace(/\s+/g, '') === want.replace(/\s+/g, ''))
    ?? null;
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
  const names = [...new Set(rooms.map((r) => r.name))];
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
  const user = `Rooms: ${planRoomsContext(rooms)}\nShe said: "${text}"`;
  return { prompt: `${PLAN_EDIT_SYSTEM}\n${user}`, system: PLAN_EDIT_SYSTEM, user, constraint: planEditConstraint(rooms) };
}

// ---- the reply -------------------------------------------------------------

const cleanName = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[<>{}"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return s ? s.replace(/^./, (c) => c.toUpperCase()) : undefined;
};

/** A model's text → an edit naming a real room, or why it was refused. */
export function parsePlanEdit(text: string, rooms: readonly RoomBox[]): { ok: true; edit: PlanEdit } | { ok: false; error: string } {
  const json = extractJson(text);
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, error: 'the reply was not an edit' };
  const r = json as Record<string, unknown>;
  const a = String(r.a ?? r.action ?? '').toLowerCase() as PlanEditAction;
  if (!(PLAN_EDIT_ACTIONS as readonly string[]).includes(a)) return { ok: false, error: 'no known action' };
  if (a === 'none') return { ok: false, error: 'the model said it could not make that edit' };
  const room = findRoom(rooms, typeof (r.r ?? r.room) === 'string' ? String(r.r ?? r.room) : undefined);
  if (!room) return { ok: false, error: 'no room from the plan was named' };
  const sideRaw = String(r.s ?? r.side ?? '').toLowerCase()[0] as Side | undefined;
  const s = sideRaw && (SIDES as readonly string[]).includes(sideRaw) ? sideRaw : undefined;
  const mNum = typeof r.m === 'number' ? r.m : typeof r.m === 'string' ? Number(r.m) : NaN;
  const m = Number.isFinite(mNum) ? mNum : undefined;
  const n = cleanName(r.n ?? r.name);
  if ((a === 'add' || a === 'rename') && !n) return { ok: false, error: 'no name for the room' };
  return { ok: true, edit: { a, r: room.name, ...(n ? { n } : {}), ...(s ? { s } : {}), ...(m !== undefined ? { m } : {}) } };
}

// ---- the edit, on a copy ---------------------------------------------------

export interface AppliedPlanEdit { doc: PlanDoc; summary: string }
export type PlanEditResult = { ok: true; value: AppliedPlanEdit } | { ok: false; error: string };

const MIN_ROOM = 1500;
const MAX_ROOM = 12_000;
const clampMm = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
type Rect = { x: number; y: number; w: number; h: number };

/** The room's wall that lies along side `s` of its box (the longest one). */
function sideWall(doc: PlanDoc, box: RoomBox, s: Side): Wall | null {
  const room = doc.rooms.find((r) => r.id === box.id);
  if (!room) return null;
  const on = (w: Wall): boolean => {
    if (s === 'n') return near(w.a.y, box.y + box.h) && near(w.b.y, box.y + box.h);
    if (s === 's') return near(w.a.y, box.y) && near(w.b.y, box.y);
    if (s === 'e') return near(w.a.x, box.x + box.w) && near(w.b.x, box.x + box.w);
    return near(w.a.x, box.x) && near(w.b.x, box.x);
  };
  const cands = roomWalls(room, doc).filter(on);
  cands.sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y));
  return cands[0] ?? null;
}

function beside(box: Rect, s: Side, depth: number): Rect {
  if (s === 'e') return { x: box.x + box.w, y: box.y, w: depth, h: box.h };
  if (s === 'w') return { x: box.x - depth, y: box.y, w: depth, h: box.h };
  if (s === 'n') return { x: box.x, y: box.y + box.h, w: box.w, h: depth };
  return { x: box.x, y: box.y - depth, w: box.w, h: depth };
}
const facing: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
const SIDE_INDEX: Record<Side, number> = { s: 0, e: 1, n: 2, w: 3 }; // add_room builds walls S, E, N, W

const sameBoxes = (a: readonly RoomBox[], b: readonly RoomBox[], skip: string | null): boolean => {
  const key = (r: RoomBox) => `${r.name}|${Math.round(r.x)}|${Math.round(r.y)}|${Math.round(r.w)}|${Math.round(r.h)}`;
  const A = a.filter((r) => r.id !== skip).map(key).sort();
  const B = new Set(b.map(key));
  return A.every((k) => B.has(k));
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

/** Apply one edit to a COPY of the drawing. Other rooms never change shape. */
export function applyPlanEdit(doc: PlanDoc, edit: PlanEdit): PlanEditResult {
  const rooms = planRooms(doc);
  const box = findRoom(rooms, edit.r);
  if (!box) return { ok: false, error: 'that room is not on the plan' };
  const others = rooms.filter((r) => r.id !== box.id);
  const engine = new PlanEngine();
  const start = structuredClone(doc);
  const run = (base: PlanDoc, ops: Record<string, unknown>[]): string | null => {
    engine.restore(base);
    for (const raw of ops) {
      const r = applyRaw(engine, raw);
      if (r) return r;
    }
    return null;
  };
  const free = (r: Rect, skip: RoomBox | null = null): boolean => !rooms.some((o) => o !== skip && overlaps(r, o));
  let summary: string;
  let targetId: string | null = box.id;

  switch (edit.a) {
    case 'add': {
      const name = edit.n!;
      if (findRoom(rooms, name)) return { ok: false, error: `there is already a ${name}` };
      const depth = clampMm((edit.m && edit.m > 0 ? edit.m : 3) * 1000, MIN_ROOM, 8000);
      const order: Side[] = edit.s ? [edit.s, ...(['e', 'w', 'n', 's'] as Side[]).filter((s) => s !== edit.s)] : ['e', 'w', 'n', 's'];
      const side = order.find((s) => free(beside(box, s, depth)));
      if (!side) return { ok: false, error: `there is no free side next to ${box.name}` };
      const rect = beside(box, side, depth);
      const err = run(start, [{ op: 'add_room', nums: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, name }]);
      if (err) return { ok: false, error: err };
      // A door into it, on the wall it shares with the room she named.
      const mid = engine.getState();
      const added = mid.rooms[mid.rooms.length - 1];
      const shared = added?.wallIds[SIDE_INDEX[facing[side]]];
      if (shared) applyRaw(engine, { op: 'add_door', target: shared, nums: { width: 800 } });
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
        if (rect.w < MIN_ROOM || rect.h < MIN_ROOM || rect.w > MAX_ROOM || rect.h > MAX_ROOM) return { ok: false, error: 'the room would be too small or too big' };
      } else {
        const dx = s === 'e' ? by : s === 'w' ? -by : 0;
        const dy = s === 'n' ? by : s === 's' ? -by : 0;
        rect = { ...rect, x: rect.x + dx, y: rect.y + dy };
      }
      if (!free(rect, box)) return { ok: false, error: `${box.name} would run into another room` };
      const err = rebuildRoom(engine, start, box, rect, edit.a === 'move');
      if (err) return { ok: false, error: err };
      summary = edit.a === 'move'
        ? `Move ${box.name} ${m1(Math.abs(by))} m ${SIDE_WORD[s]}`
        : `Make ${box.name} ${m1(Math.abs(by))} m ${by > 0 ? 'bigger' : 'smaller'} on the ${SIDE_WORD[s]} side`;
      break;
    }
    case 'door': case 'window': {
      const s = edit.s ?? pickOuterSide(start, box, others);
      const wall = sideWall(start, box, s);
      if (!wall) return { ok: false, error: `${box.name} has no ${SIDE_WORD[s]} wall` };
      const err = run(start, [{ op: edit.a === 'door' ? 'add_door' : 'add_window', target: wall.id, nums: { width: edit.a === 'door' ? 800 : 1000 } }]);
      if (err) return { ok: false, error: err };
      summary = `Add a ${edit.a} to ${box.name} (${SIDE_WORD[s]} wall)`;
      break;
    }
    case 'stairs': {
      const along = box.w >= box.h;
      const run1 = Math.min(3000, (along ? box.w : box.h) - 400);
      const wide = Math.min(1000, (along ? box.h : box.w) - 400);
      if (run1 < 900 || wide < 600) return { ok: false, error: `${box.name} is too small for stairs` };
      const err = run(start, [{ op: 'add_fixture', kind: 'stairs', nums: { x: box.x + box.w / 2, y: box.y + box.h / 2, w: run1, d: wide, rotation: along ? 0 : 90, steps: stairStepCount(run1) } }]);
      if (err) return { ok: false, error: err };
      summary = `Add stairs in ${box.name}`;
      break;
    }
    default:
      return { ok: false, error: 'no edit' };
  }
  const after = engine.getState();
  const out: PlanDoc = { ...structuredClone(after), selectedId: null, selectedIds: [] };
  // Nobody else's room may change shape or name.
  if (!sameBoxes(planRooms(doc), planRooms(out), targetId)) return { ok: false, error: 'the edit would change another room' };
  return { ok: true, value: { doc: out, summary } };
}

/** An outside wall of the room (no other room on that side), else south. */
function pickOuterSide(doc: PlanDoc, box: RoomBox, others: readonly RoomBox[]): Side {
  for (const s of ['n', 'e', 'w', 's'] as Side[]) if (!others.some((o) => overlaps(beside(box, s, 10), o)) && sideWall(doc, box, s)) return s;
  return 's';
}

function applyRaw(engine: PlanEngine, raw: Record<string, unknown>): string | null {
  // Same untrusted-input gate as every other plan op.
  const v = validatePlanOp(raw);
  if (!v.ok) return v.error;
  const r = engine.apply(v.op);
  return r.ok ? null : r.error ?? 'the plan refused that edit';
}

/** Resize / move: the room is taken out (its own walls only) and drawn again
 *  at `rect`; its doors and windows go back on the same sides at the same
 *  place, and a moved room takes what stands in it along. */
function rebuildRoom(engine: PlanEngine, doc: PlanDoc, box: RoomBox, rect: Rect, moving: boolean): string | null {
  const dx = moving ? rect.x - box.x : 0;
  const dy = moving ? rect.y - box.y : 0;
  const room = doc.rooms.find((r) => r.id === box.id)!;
  const cut = withoutRoom(doc, box.id);
  const removed = new Set(cut.removedWalls.map((w) => w.id));
  // Openings on the walls that go: where they were, and on which side.
  const carry: Array<{ o: Opening; side: Side; from: { x: number; y: number }; to: { x: number; y: number } }> = [];
  for (const s of SIDES) {
    const wall = sideWall(doc, box, s);
    if (!wall || !removed.has(wall.id)) continue;
    for (const o of doc.openings.filter((x) => x.wallId === wall.id)) {
      const p = pointAlong(wall, o.offset), q = pointAlong(wall, o.offset + o.width);
      carry.push({ o, side: s, from: { x: p.x + dx, y: p.y + dy }, to: { x: q.x + dx, y: q.y + dy } });
    }
  }
  if (moving) {
    // A moved room may not leave a shared wall behind (its neighbour keeps it).
    if (room.wallIds.some((id) => !removed.has(id))) return `${box.name} shares a wall with another room, so it can't move on its own`;
    cut.doc.fixtures = cut.doc.fixtures.map((f) => (inside(f, box) ? { ...f, x: f.x + dx, y: f.y + dy } : f));
  }
  engine.restore(cut.doc);
  const e1 = applyRaw(engine, { op: 'add_room', nums: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, name: box.name });
  if (e1) return e1;
  const st = engine.getState();
  const added = st.rooms[st.rooms.length - 1];
  for (const c of carry) {
    const wid = added.wallIds[SIDE_INDEX[c.side]];
    const wall = st.walls.find((w) => w.id === wid);
    if (!wall) continue;
    const d = wallDir(wall);
    const t1 = (c.from.x - wall.a.x) * d.x + (c.from.y - wall.a.y) * d.y;
    const t2 = (c.to.x - wall.a.x) * d.x + (c.to.y - wall.a.y) * d.y;
    const op = c.o.kind === 'door' ? 'add_door' : c.o.kind === 'window' ? 'add_window' : 'add_opening';
    applyRaw(engine, { op, target: wid, nums: { offset: Math.max(0, Math.min(t1, t2)), width: c.o.width }, ...(c.o.swing ? { swing: c.o.swing } : {}) });
  }
  return null;
}

// ---- SIM: a rules guess, labelled SIM -------------------------------------

/** What the scripted (SIM) "model" replies: a plain-rules reading of her
 *  words. Only ever used in ?sim=1 runs, where every label says SIM. */
export function simPlanEdit(text: string, rooms: readonly RoomBox[]): string {
  const t = text.toLowerCase().replace(/[.!?]+$/, '').trim();
  const roomIn = (s: string): RoomBox | null => {
    const want = normName(s);
    return rooms.find((r) => want.includes(normName(r.name))) ?? rooms.find((r) => normName(r.name).split(' ')[0] === want.split(' ').pop()) ?? null;
  };
  const sideIn = (s: string): Side | undefined => {
    if (/\b(east|right)\b/.test(s)) return 'e';
    if (/\b(west|left)\b/.test(s)) return 'w';
    if (/\b(north|above|top|up)\b/.test(s)) return 'n';
    if (/\b(south|below|bottom|down)\b/.test(s)) return 's';
    return undefined;
  };
  const metres = /(\d+(?:\.\d+)?)\s*(m|metres?|meters?)\b/.exec(t);
  const m = metres ? Number(metres[1]) : undefined;
  const out = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
  let mm: RegExpExecArray | null;
  if ((mm = /\b(?:rename|call)\s+(?:the\s+)?(.+?)\s+(?:to\s+|as\s+)?(?:the\s+|a\s+)?([a-z][a-z ]*)$/.exec(t)) && /\brename\b|\bcall\b/.test(t)) {
    const r = roomIn(mm[1]); if (r) return out({ a: 'rename', r: r.name, n: cap(mm[2].trim()) });
  }
  if (/\b(door|doorway)\b/.test(t) && /\b(add|put|insert|place)\b/.test(t)) { const r = roomIn(t); if (r) return out({ a: 'door', r: r.name, s: sideIn(t) }); }
  if (/\bwindows?\b/.test(t) && /\b(add|put|insert|place)\b/.test(t)) { const r = roomIn(t); if (r) return out({ a: 'window', r: r.name, s: sideIn(t) }); }
  if (/\b(stairs?|staircase)\b/.test(t)) { const r = roomIn(t); if (r) return out({ a: 'stairs', r: r.name }); }
  if ((mm = /\b(?:add|put|insert|place|build)\s+(?:a|an|another|one)?\s*(?:new\s+)?([a-z][a-z ]*?)\s+(?:next\s+to|beside|by|near|east\s+of|west\s+of|north\s+of|south\s+of|to\s+the\s+(?:left|right)\s+of|above|below)\s+(.+)$/.exec(t))) {
    const r = roomIn(mm[2]); if (r) return out({ a: 'add', r: r.name, n: cap(mm[1].replace(/\s+room$/, ' room').trim()), s: sideIn(t), m });
  }
  if (/\b(remove|delete|take\s+out|get\s+rid\s+of)\b/.test(t)) { const r = roomIn(t); if (r) return out({ a: 'remove', r: r.name }); }
  if (/\b(move|shift|slide)\b/.test(t)) { const r = roomIn(t); if (r) return out({ a: 'move', r: r.name, s: sideIn(t) ?? 'e', m: m ?? 1 }); }
  if (/\b(widen|enlarge|extend|stretch|bigger|larger|wider|longer)\b/.test(t)) { const r = roomIn(t); if (r) return out({ a: 'resize', r: r.name, s: sideIn(t), m: m ?? 1 }); }
  if (/\b(shrink|narrow|smaller|narrower)\b/.test(t)) { const r = roomIn(t); if (r) return out({ a: 'resize', r: r.name, s: sideIn(t), m: -(m ?? 1) }); }
  return out({ a: 'none' });
}
const cap = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Of|And|To)\b/g, (w) => w.toLowerCase());

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
  /** False when the cloud can't be reached (offline): Nano only, no handoff. */
  canHandoff?: () => boolean;
  /** What really goes to the cloud (names redacted on this device). */
  cloudPrompt?: (prompt: string) => string;
  nanoTimeoutMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
export type PlanEditOutcome =
  | { ok: true; value: AppliedPlanEdit; edit: PlanEdit; si: SentInfo; handedOff: boolean; nanoSi?: SentInfo }
  | { ok: false; why: string; si: SentInfo | null; offline: boolean };

const NANO_ROUTE = 'Nano · on device — nothing left this device';
const GEMINI_SENT = 'your words and the plan’s room names and sizes. No device data, no addresses.';

function receipt(eng: SurfaceEngine, prompt: string, line?: string): SentInfo {
  const cloud = eng.id === 'gemini';
  const base = line ?? eng.routeLine ?? (cloud ? 'Gemini · cloud — sent your words and the room list to edit the plan' : NANO_ROUTE);
  return { engine: eng.id, prompt, sent: cloud ? GEMINI_SENT : null, routeLine: eng.sim && !base.startsWith('SIM') ? `SIM · ${base}` : base, sim: eng.sim };
}

/** One plan-edit turn: Nano on this device first (one short constrained
 *  prompt, one repair), Gemini only when Nano can't and the cloud is
 *  reachable. Returns the edited copy of the drawing, or why not. */
export async function runPlanEditTurn(text: string, doc: PlanDoc, engine: SurfaceEngine, ui: PlanEditTurnUi = {}, opts: PlanEditTurnOptions = {}): Promise<PlanEditOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rooms = planRooms(doc);
  if (!rooms.length) return { ok: false, why: 'the plan has no rooms yet', si: null, offline: false };
  const req = buildPlanEditRequest(text, rooms);
  const tryReply = (reply: string): { ok: true; edit: PlanEdit; value: AppliedPlanEdit } | { ok: false; error: string } => {
    const p = parsePlanEdit(reply, rooms);
    if (!p.ok) return p;
    const a = applyPlanEdit(doc, p.edit);
    return a.ok ? { ok: true, edit: p.edit, value: a.value } : a;
  };

  const runCloud = async (eng: SurfaceEngine, si: SentInfo): Promise<PlanEditOutcome> => {
    const prompt = opts.cloudPrompt ? opts.cloudPrompt(si.prompt) : si.prompt;
    try {
      const so: StreamOptions = { shape: 'json', onCloudSend: () => ui.onCloudSend?.(si), onCloudRetract: () => ui.onCloudRetract?.(si) };
      const reply = eng.sim
        ? await eng.stream(prompt, (f) => ui.onText?.(f), { shape: 'json' })
        : await withTimeoutRetry(() => eng.stream(prompt, (f) => ui.onText?.(f), so), { timeoutMs: opts.timeoutMs ?? GEMINI_TIMEOUT_MS, retries: 1, sleep, shouldRetry: (e) => !(e instanceof CloudCallError) || e.kind === 'timeout' || e.kind === 'busy' });
      const got = tryReply(reply);
      if (got.ok) return { ok: true, value: got.value, edit: got.edit, si, handedOff: false };
      ui.onNote?.(eng.id, `refused: ${got.error}`);
      return { ok: false, why: got.error, si, offline: false };
    } catch (e) {
      const why = eng.id === 'gemini' ? geminiFailLine(e) : `Nano didn’t answer: ${e instanceof Error ? e.message : String(e)}`;
      ui.onNote?.(eng.id, why);
      return { ok: false, why, si, offline: false };
    }
  };

  const liveNano = engine.id === 'nano' && !engine.sim;
  if (!liveNano) {
    // Scripted (SIM), or a "Nano" step that is really Gemini (no Nano here).
    const si = receipt(engine, req.prompt);
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
    if (!got.ok && !/could not make that edit/.test(got.error)) {
      ui.onNote?.('nano', `Nano’s edit was refused (${got.error}); asking once more.`);
      const user = `${req.user}\nYour last reply was refused: ${got.error}. Reply again with the JSON object only.`;
      reply = await timed(engine.stream(`${req.system}\n${user}`, (f) => ui.onText?.(f), { ...so, user }));
      got = tryReply(reply);
    }
    over = true;
    if (got.ok) return { ok: true, value: got.value, edit: got.edit, si, handedOff: false };
    why = got.error;
  } catch (e) {
    over = true;
    why = e instanceof Error ? e.message : String(e);
  }
  ctl?.abort();
  ui.onNote?.('nano', `couldn’t make the edit: ${why}`);
  const cloud = engine.handoff;
  if (!cloud) return { ok: false, why, si, offline: false };
  if (opts.canHandoff && !opts.canHandoff()) return { ok: false, why, si, offline: true };
  const handed = receipt(cloud, req.prompt, `Gemini · cloud — Nano couldn’t make the edit (${why}), so Gemini made it`);
  handed.handoffWhy = why;
  ui.onHandoff?.(handed, why);
  const out = await runCloud(cloud, handed);
  return out.ok ? { ...out, handedOff: true, nanoSi: si } : out;
}
