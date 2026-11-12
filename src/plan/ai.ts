// PLAN-mode AI: the on-device intent prompt + compact responseConstraint, the
// cloud "generate a whole plan" prompt + {ops:[...]} constraint, the verifier
// prompt/constraint, and the coercion functions that turn untrusted model JSON
// (or rules output) into validated plan ops. Nothing here talks to Firebase;
// hybrid.ts converts these plain JSON-Schema constraints into the Firebase
// `Schema` objects at runtime and re-validates everything via validatePlanOp.

import type { Clarify } from '../core/ruleParser';
import { validatePlanOp, type PlanOp } from './ops';

/** Max ops a single cloud "generate" may expand to (hard cap, enforced in code). */
export const MAX_GENERATE_OPS = 40;

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

/** Cloud constraint for a whole generated plan: a capped list of op envelopes. */
export const PLAN_GENERATE_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string' },
          target: { type: 'string' },
          nums: {
            type: 'object',
            properties: {
              x: NUM, y: NUM, w: NUM, h: NUM, length: NUM,
              width: NUM, offset: NUM, dx: NUM, dy: NUM, thickness: NUM,
            },
          },
          unit: { type: 'string' },
          name: { type: 'string' },
          swing: { type: 'string' },
        },
      },
    },
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
If unclear, reply {"clarify":"<short question>"}.`;

export const PLAN_GENERATE_PROMPT = `You design a whole 2D floor plan. Reply with ONE JSON object {"ops":[...]} only, using at most ${MAX_GENERATE_OPS} ops drawn from: add_room{nums:{x,y,w,h}}, add_door{target}, add_window{target}, add_dim{target}, set_length, move. Lengths use the "unit" field (default "m"). Place rooms on a grid so shared walls meet exactly. Do not emit free geometry — rooms and their walls only. Walls created by a room are addressable as w1, w2, ... in later ops.`;

export const PLAN_VERIFY_PROMPT = `You check whether a floor-plan edit did what the op intended. Reply JSON only: {"matchesIntent":true|false,"issue":null or "<short issue>"}.`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Coerce untrusted JSON into a validated single plan op, a clarify, or null. */
export function coercePlan(raw: unknown): PlanOp | Clarify | null {
  if (!isObj(raw)) return null;
  if (typeof raw.clarify === 'string' && raw.clarify.trim()) return { clarify: raw.clarify.trim() };
  const v = validatePlanOp(raw);
  return v.ok ? v.op : null;
}

/** Coerce an untrusted {ops:[...]} into validated plan ops (capped), or clarify/null. */
export function coercePlanGenerate(raw: unknown): { ops: PlanOp[] } | Clarify | null {
  if (!isObj(raw)) return null;
  if (typeof raw.clarify === 'string' && raw.clarify.trim()) return { clarify: raw.clarify.trim() };
  const list = Array.isArray(raw.ops) ? raw.ops : null;
  if (!list) return null;
  const ops: PlanOp[] = [];
  for (const item of list.slice(0, MAX_GENERATE_OPS)) {
    const v = validatePlanOp(item);
    if (v.ok) ops.push(v.op);
  }
  return ops.length ? { ops } : null;
}
