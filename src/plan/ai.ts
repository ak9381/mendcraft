// PLAN-mode AI: the on-device intent prompt + compact responseConstraint, the
// cloud "generate a whole plan" prompt + {ops:[...]} constraint, the verifier
// prompt/constraint, and the coercion functions that turn untrusted model JSON
// (or rules output) into validated plan ops. Nothing here talks to Firebase;
// hybrid.ts converts these plain JSON-Schema constraints into the Firebase
// `Schema` objects at runtime and re-validates everything via validatePlanOp.

import type { Clarify } from '../core/ruleParser';
import { validatePlanOp, type PlanOp } from './ops';
import { PlanEngine } from './engine';
import { parsePlanCommand } from './ruleParser';
import { wallLength, type PlanDoc, type Room, type Swing } from './doc';

/** Max ops a single cloud "generate" may expand to (hard cap, enforced in code). */
export const MAX_GENERATE_OPS = 40;
/** Caps on a single generated plan (keep the op expansion bounded + sane). */
export const MAX_GENERATE_ROOMS = 8;
export const MAX_GENERATE_OPENINGS = 16;

const NUM = { type: 'number' } as const;

/** Compact on-device constraint for one plan edit op. Kept small — it counts
 *  toward the Nano context window. */
export const PLAN_OP_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    op: { type: 'string' },
    target: { type: 'string' },
    nums: {
      type: 'object',
      properties: {
        x: NUM, y: NUM, w: NUM, h: NUM,
        x1: NUM, y1: NUM, x2: NUM, y2: NUM,
        dx: NUM, dy: NUM, length: NUM, offset: NUM,
        width: NUM, thickness: NUM, delta: NUM, dist: NUM,
      },
    },
    unit: { type: 'string' },
    name: { type: 'string' },
    swing: { type: 'string' },
    clarify: { type: 'string' },
  },
};

/**
 * Cloud constraint for a whole generated plan: a DOCUMENT, not raw ops. The
 * model only places rectangular rooms (+ doors/windows by room+side); CODE owns
 * wall creation, shared-wall reuse, and all ids — so the model can never emit an
 * op that references an id it could not know (the "no wall for target r1" bug).
 */
export const PLAN_GENERATE_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  // `rooms` is REQUIRED: the model returned only {windows:[...]} without it, so
  // force it (a plan with no rooms is not a plan). Room fields are required too.
  required: ['rooms'],
  properties: {
    unit: { type: 'string' },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        required: ['x', 'y', 'w', 'h'],
        properties: { name: { type: 'string' }, x: NUM, y: NUM, w: NUM, h: NUM },
      },
    },
    doors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['room', 'side'],
        properties: {
          room: { type: 'string' }, side: { type: 'string' },
          offset: NUM, width: NUM, swing: { type: 'string' },
        },
      },
    },
    windows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['room', 'side'],
        properties: { room: { type: 'string' }, side: { type: 'string' }, offset: NUM, width: NUM },
      },
    },
    clarify: { type: 'string' },
  },
};

/** Verifier constraint — its own schema, NOT the edit-op schema. */
export const PLAN_VERIFY_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    matchesIntent: { type: 'boolean' },
    issue: { type: 'string' },
  },
};

export const PLAN_INTENT_PROMPT = `You convert one short spoken command for a 2D architectural floor-plan editor into ONE JSON op. Lengths use the "unit" field (mm|cm|m). Use target "selected" unless the user names an id like "w2". Reply with JSON only, no prose.
Ops (exact shapes):
{"op":"add_room","nums":{"x","y","w","h"},"unit","name"?}
{"op":"add_wall","nums":{"x1","y1","x2","y2","thickness"?},"unit"}
{"op":"add_door","target","nums":{"width"?,"offset"?},"swing":"left|right"?}
{"op":"add_window","target","nums":{"width"?}}
{"op":"add_dim","target"}
{"op":"set_length","target","nums":{"length"},"unit"}  (keeps the start point, snaps to ortho)
{"op":"move","target","nums":{"dx","dy"},"unit"}
{"op":"offset","target","nums":{"dist"},"unit"}        (perpendicular to the wall)
{"op":"set_thickness","target","nums":{"thickness"} or {"delta"},"unit"}
{"op":"rename","target","name"} {"op":"delete","target"} {"op":"select","target"}
{"op":"undo"} {"op":"redo"}
ALWAYS include every number the command states inside "nums" — never drop it.
Examples:
"make this wall 4 meters" -> {"op":"set_length","target":"selected","nums":{"length":4},"unit":"m"}
"move it 500 left" -> {"op":"move","target":"selected","nums":{"dx":-500},"unit":"mm"}
"add a door" -> {"op":"add_door","target":"selected"}
"thicker by 50" -> {"op":"set_thickness","target":"selected","nums":{"delta":50},"unit":"mm"}
If unclear, reply {"clarify":"<short question>"}.`;

export const PLAN_GENERATE_PROMPT = `You design a whole 2D floor plan as ONE JSON DOCUMENT (NOT ops). Reply JSON only, no prose:
{"unit":"mm","rooms":[{"name":"Bedroom 1","x":0,"y":0,"w":4000,"h":3000},{"name":"Bedroom 2","x":4000,"y":0,"w":4000,"h":3000}],"doors":[{"room":"Bedroom 1","side":"s","offset":1000,"width":900}],"windows":[{"room":"Bedroom 2","side":"n","width":1200}]}
Rules: "rooms" is REQUIRED and must be non-empty — every plan has at least one room. Each room is an axis-aligned rectangle; (x,y) is its bottom-left corner; w,h are width/height. Place rooms on a grid so neighbours share an EXACT edge (e.g. one room x=0 w=4000 and its neighbour x=4000). "side" is n|s|e|w (north/south/east/west) of that room's wall. Default "unit" is "mm" (a 4 m room is 4000). At most ${MAX_GENERATE_ROOMS} rooms. CODE builds every wall, reuses shared walls, assigns all ids, dimensions and selects a wall — you ONLY place rooms, doors and windows. Never emit ops or ids. A "two-bedroom plan" is two side-by-side bedrooms. If the request is unclear, reply {"clarify":"<short question>"}.`;

export const PLAN_VERIFY_PROMPT = `You check whether a floor-plan edit did what the op intended. Reply JSON only: {"matchesIntent":true|false,"issue":null or "<short issue>"}.`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Repair a model op that named a valid operation but under-filled it — chiefly
 * the observed "set_length / target selected / unit m" with the length DROPPED.
 * We overlay the model's fields onto the deterministic parse of the SAME
 * utterance, but ONLY when the rule parser independently agrees on the op name,
 * so we fill missing numbers without ever inventing a different operation.
 */
function repairPlanOp(raw: Record<string, unknown>, utterance: string): Record<string, unknown> | null {
  if (typeof raw.op !== 'string') return null;
  const ruled = parsePlanCommand(utterance);
  if (!isObj(ruled) || ruled.op !== raw.op) return null;
  return { ...ruled, ...raw }; // model fields win; rules fill the gaps (nums, unit)
}

/** Coerce untrusted JSON into a validated single plan op, a clarify, or null.
 *  Rejections are logged (console.warn) so a dropped edit is never silent — this
 *  is the trail that explains an unexpected RULES-badge fallback. When the model
 *  under-fills a valid op, `utterance` enables a conservative numeric repair. */
export function coercePlan(raw: unknown, utterance?: string): PlanOp | Clarify | null {
  if (!isObj(raw)) return null;
  if (typeof raw.clarify === 'string' && raw.clarify.trim()) return { clarify: raw.clarify.trim() };
  let v = validatePlanOp(raw);
  if (!v.ok && utterance) {
    const repaired = repairPlanOp(raw, utterance);
    if (repaired) v = validatePlanOp(repaired);
  }
  if (!v.ok) {
    if (typeof raw.op === 'string')
      console.warn(`[mendcraft] plan op "${raw.op}" rejected: ${v.error}`, raw);
    return null;
  }
  return v.op;
}

// ── Whole-plan document → ops expansion ───────────────────────────────────
// The cloud "generate" model returns a DOCUMENT {rooms,doors,windows}. CODE
// expands it into deterministic ops here: it builds the add_room ops, SIMULATES
// them on a throwaway PlanEngine to learn each room's real wall ids (the engine
// resets its id counter per generated plan, so these match what the controller's
// engine will assign), then resolves every door/window's room+side to a concrete
// wall id. Finally it dimensions and pre-selects a sensible wall so the next
// edit ("make this wall 4 meters" → target "selected") lands without pointing.

/** room.wallIds are built in corner order S,E,N,W (see engine add_room). */
const SIDE_INDEX: Record<'n' | 's' | 'e' | 'w', number> = { s: 0, e: 1, n: 2, w: 3 };
const SIDE_ALIASES: Record<string, 'n' | 's' | 'e' | 'w'> = {
  n: 'n', north: 'n', top: 'n', up: 'n',
  s: 's', south: 's', bottom: 's', down: 's',
  e: 'e', east: 'e', right: 'e',
  w: 'w', west: 'w', left: 'w',
};

interface OpeningSpec {
  kind: 'add_door' | 'add_window';
  room: string;
  side: 'n' | 's' | 'e' | 'w';
  width?: number;
  offset?: number;
  swing?: Swing;
}

function numOf(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Resolve a room reference (name, id like "r1", or 1-based index) to a sim room. */
function findDocRoom(doc: PlanDoc, ref: string): Room | undefined {
  const want = ref.trim().toLowerCase();
  const byName = doc.rooms.find((r) => r.name.toLowerCase() === want);
  if (byName) return byName;
  const byId = doc.rooms.find((r) => r.id.toLowerCase() === want);
  if (byId) return byId;
  const m = want.match(/(\d+)/);
  if (m) {
    const i = Number(m[1]) - 1;
    if (i >= 0 && i < doc.rooms.length) return doc.rooms[i];
  }
  return doc.rooms.length === 1 ? doc.rooms[0] : undefined;
}

/** A wall worth pre-selecting: a shared interior wall if any, else the longest
 *  wall of the first room, else the first wall. */
function pickSelectableWall(doc: PlanDoc): string | undefined {
  if (!doc.walls.length) return undefined;
  const count = new Map<string, number>();
  for (const r of doc.rooms) for (const id of r.wallIds) count.set(id, (count.get(id) ?? 0) + 1);
  const shared = [...count.entries()].find(([, n]) => n >= 2);
  if (shared) return shared[0];
  const first = doc.rooms[0];
  if (first) {
    let best: string | undefined;
    let bestLen = -1;
    for (const id of first.wallIds) {
      const w = doc.walls.find((x) => x.id === id);
      if (w && wallLength(w) > bestLen) {
        bestLen = wallLength(w);
        best = id;
      }
    }
    if (best) return best;
  }
  return doc.walls[0].id;
}

function collectOpenings(raw: unknown, kind: 'add_door' | 'add_window'): OpeningSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: OpeningSpec[] = [];
  for (const o of raw) {
    if (!isObj(o)) continue;
    const roomRef =
      typeof o.room === 'string' ? o.room : typeof o.room === 'number' ? String(o.room) : undefined;
    const side = typeof o.side === 'string' ? SIDE_ALIASES[o.side.trim().toLowerCase()] : undefined;
    if (!roomRef || !side) continue;
    const swing: Swing | undefined = o.swing === 'right' ? 'right' : o.swing === 'left' ? 'left' : undefined;
    out.push({ kind, room: roomRef, side, width: numOf(o.width), offset: numOf(o.offset), swing });
  }
  return out;
}

/** Expand a whole-plan document into validated, deterministic ops (or []). */
export function expandPlanDocument(raw: Record<string, unknown>): PlanOp[] {
  const unit = typeof raw.unit === 'string' ? raw.unit : 'mm';
  const roomsRaw = Array.isArray(raw.rooms) ? raw.rooms.slice(0, MAX_GENERATE_ROOMS) : [];
  const roomOps: PlanOp[] = [];
  for (const r of roomsRaw) {
    if (!isObj(r)) continue;
    const env: Record<string, unknown> = { op: 'add_room', nums: { x: r.x, y: r.y, w: r.w, h: r.h }, unit };
    if (typeof r.name === 'string' && r.name.trim()) env.name = r.name.trim();
    const v = validatePlanOp(env);
    if (v.ok) roomOps.push(v.op);
  }
  if (!roomOps.length) return [];

  // Simulate the rooms to learn their concrete wall ids (deterministic).
  const sim = new PlanEngine();
  for (const op of roomOps) sim.apply(op);
  const simDoc = sim.getState();

  const ops: PlanOp[] = [...roomOps];
  const openings = [
    ...collectOpenings(raw.doors, 'add_door'),
    ...collectOpenings(raw.windows, 'add_window'),
  ].slice(0, MAX_GENERATE_OPENINGS);

  for (const spec of openings) {
    const room = findDocRoom(simDoc, spec.room);
    const wallId = room?.wallIds[SIDE_INDEX[spec.side]];
    if (!wallId) continue;
    const env: Record<string, unknown> = { op: spec.kind, target: wallId };
    const nums: Record<string, number> = {};
    if (spec.width !== undefined) nums.width = spec.width;
    if (spec.offset !== undefined) nums.offset = spec.offset;
    if (Object.keys(nums).length) {
      env.nums = nums;
      env.unit = unit;
    }
    if (spec.swing) env.swing = spec.swing;
    const v = validatePlanOp(env);
    if (v.ok) ops.push(v.op);
  }

  const pick = pickSelectableWall(simDoc);
  if (pick) {
    ops.push({ op: 'add_dim', target: pick });
    ops.push({ op: 'select', target: pick });
  }
  return ops.slice(0, MAX_GENERATE_OPS);
}

/**
 * Coerce an untrusted whole-plan response into validated ops (capped), a clarify,
 * or null. Preferred shape is the DOCUMENT {rooms,doors,windows}; a legacy raw
 * {ops:[...]} is still tolerated (re-validated) for robustness.
 */
export function coercePlanGenerate(raw: unknown): { ops: PlanOp[] } | Clarify | null {
  if (!isObj(raw)) return null;
  if (typeof raw.clarify === 'string' && raw.clarify.trim()) return { clarify: raw.clarify.trim() };
  if (Array.isArray(raw.rooms)) {
    const ops = expandPlanDocument(raw);
    return ops.length ? { ops } : null;
  }
  const list = Array.isArray(raw.ops) ? raw.ops : null;
  if (!list) return null;
  const ops: PlanOp[] = [];
  for (const item of list.slice(0, MAX_GENERATE_OPS)) {
    const v = validatePlanOp(item);
    if (v.ok) ops.push(v.op);
  }
  return ops.length ? { ops } : null;
}
