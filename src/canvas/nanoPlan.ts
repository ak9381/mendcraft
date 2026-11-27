// The on-device (Nano) board turn: ONE short prompt, ONE tiny structured
// reply. On a laptop Nano writes about 20 characters a second, so the time a
// turn takes is the length of its reply. Nano therefore only DECIDES — which
// devices go on the board and what to call it — and everything else (tile types, labels, the plan's board id, the Connect
// button) is derived here from the device list. A full draft is ~60
// characters instead of ~600.
//
// Nano never designs controls: expandNanoPlan leaves `controls` unset, so
// each device tile it makes shows the standard controls (controlSpec.ts),
// footnoted as such.
//
//   room:        {"t":"Study","d":["lamp-a","speaker-a"]}
//
// Nano never draws a floor plan: a plan is geometry, which Gemini writes and
// code checks (planGenerate.ts). A floor-plan ask here is refused.
import { extractJson } from '../ai/cloudJson';
import { coerceSurfacePlan, MAX_TILES, type Coerced, type SurfacePlan, type TileSpec } from './surfacePlan';
import type { DeviceHint, PartialPlan, SurfaceRequest } from './aiTurn';

export const NANO_CONNECT_LABEL = 'Connect a device';
/** Why a Nano floor-plan reply is refused. */
export const NANO_NO_PLAN = 'Nano does not draw floor plans; Gemini does';
/** The most devices one Nano draft puts on a board. */
export const NANO_MAX_DEVICES = 4;
const TITLE_MAX = 24;

/** Fixed instructions, one per kind of ask, kept in the session's
 *  initialPrompts. Short on purpose: every character is read before the
 *  first one is written. */
export const NANO_ROOM_SYSTEM = [
  'You choose what goes on one board of a smart home canvas.',
  'Reply with JSON only: {"t": title, "d": [device ids]}',
  '"t" is a title of at most 4 words. "d" lists the ids of the devices she asked for, taken only from the list, each once.',
  `At most ${NANO_MAX_DEVICES} ids. Nothing else: no labels, no status, no other keys.`,
].join('\n');
/** Kept for callers that only need "the Nano system prompt" (the room one). */
export const NANO_SYSTEM_PROMPT = NANO_ROOM_SYSTEM;

const PLAN_ASK = /\bfloor\s*plan\b|\bbedrooms?\b|\bstudio\b|\bblueprint\b|\b(draw|sketch|start|make)\b.*\b(plan|layout|flat|apartment|house)\b/i;
/** Is this a floor-plan ask (the caller's `want` wins; else her words)?
 *  Nano refuses these: floor plans are Gemini's (planGenerate.ts). */
export function nanoWantsPlan(req: SurfaceRequest): boolean {
  if (req.want) return req.want === 'plan';
  return PLAN_ASK.test(req.utterance);
}

/** JSON-schema keywords Chrome's Prompt API does not accept in a
 *  `responseConstraint` — one of them makes the whole prompt fail with
 *  NotSupportedError. `uniqueItems` was measured live; the others are the
 *  same class (validation the constrained decoder cannot express). */
export const UNSUPPORTED_CONSTRAINT_KEYWORDS = ['uniqueItems', 'pattern', 'format', '$ref'] as const;

/** Every unsupported keyword used in `schema` (as a keyword, not as the name
 *  of a property), with its path — empty when the schema is safe to send. */
export function unsupportedConstraintKeywords(schema: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema)) return schema.flatMap((v, i) => unsupportedConstraintKeywords(v, `${path}[${i}]`));
  const found: string[] = [];
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if ((UNSUPPORTED_CONSTRAINT_KEYWORDS as readonly string[]).includes(key)) found.push(`${path}.${key}`);
    // The keys of a `properties` map are field names, not keywords.
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) found.push(...unsupportedConstraintKeywords(sub, `${path}.properties.${name}`));
    } else found.push(...unsupportedConstraintKeywords(value, `${path}.${key}`));
  }
  return found;
}

/** The JSON schema Chrome's Prompt API enforces (`responseConstraint`). */
export function nanoPlanConstraint(devices: DeviceHint[]): Record<string, unknown> {
  const ids = devices.map((d) => d.id);
  const title = { type: 'string', maxLength: TITLE_MAX };
  if (!ids.length) return { type: 'object', additionalProperties: false, required: ['t'], properties: { t: title } };
  return {
    type: 'object', additionalProperties: false, required: ['t', 'd'],
    properties: {
      t: title,
      // No `uniqueItems`: Chrome's Prompt API rejects the whole request with
      // NotSupportedError when a constraint carries it (measured live). A
      // repeated id is dropped locally instead (expandNanoPlan).
      d: { type: 'array', minItems: 1, maxItems: Math.min(NANO_MAX_DEVICES, ids.length), items: { type: 'string', enum: ids } },
    },
  };
}

export interface NanoPlanRequest {
  /** The whole prompt (instructions + this turn) — what the terminal shows. */
  prompt: string;
  /** The fixed part, for a session that already holds it. */
  system: string;
  /** This turn only. */
  user: string;
  constraint: Record<string, unknown>;
  /** A floor-plan ask: Nano does not draw plans, and its reply is refused. */
  plan: boolean;
}

export function buildNanoPlanRequest(req: SurfaceRequest): NanoPlanRequest {
  const plan = nanoWantsPlan(req);
  const system = NANO_ROOM_SYSTEM;
  const user = [
    `Devices:\n${req.devices.map((d) => `${d.id} = ${d.label} (${d.kind})`).join('\n') || 'none yet'}`,
    `She said: "${req.utterance}"`,
  ].join('\n');
  return { prompt: `${system}\n${user}`, system, user, constraint: nanoPlanConstraint(req.devices), plan };
}

/** The follow-up when the first reply was refused: short, and says why. */
export function buildNanoRepairPrompt(first: NanoPlanRequest, why: string): string {
  return `${first.system}\n${buildNanoRepairUser(first, why)}`;
}
/** The repair turn alone, for a session that already holds the instructions. */
export function buildNanoRepairUser(first: NanoPlanRequest, why: string): string {
  return `${first.user}\nYour last reply was refused: ${why.slice(0, 120)}. Reply again with the JSON object only.`;
}

function tileTypeFor(kind: string): 'lamp' | 'music' | 'switch' {
  const k = kind.toLowerCase();
  if (k === 'music' || k === 'speaker') return 'music';
  if (k === 'switch' || k === 'plug' || k === 'fan' || k === 'tv' || k === 'ac') return 'switch';
  return 'lamp';
}
/** A device's tile is the device's own: type from its kind, label from its
 *  name. The docked stand (kind 'gimbal') is the gimbal tile, which has no deviceId. */
const deviceTile = (d: DeviceHint): TileSpec => (d.kind === 'gimbal'
  ? { type: 'gimbal', label: d.label }
  : { type: tileTypeFor(d.kind), deviceId: d.id, label: d.label });

function cleanTitle(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const words = raw.replace(/[<>]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
  return words ? words.slice(0, 40) : fallback;
}

/** Nano's decision → the raw plan (still validated by coerceSurfacePlan).
 *  Ids that are not in the room are dropped with a note; tiles, labels and
 *  the plan's board id come from here, never from the model. */
export function expandNanoPlan(raw: unknown, req: SurfaceRequest): { raw: unknown; notes: string[]; error?: string } {
  const notes: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { raw, notes, error: 'The reply was not a board plan.' };
  const r = raw as Record<string, unknown>;
  if (nanoWantsPlan(req)) return { raw, notes, error: NANO_NO_PLAN };
  const title = cleanTitle(r.t, req.frameTitle || 'This room');
  if (!req.devices.length) return { raw: { kind: 'room', title, tiles: [{ type: 'connect', label: NANO_CONNECT_LABEL }] }, notes };
  if (!Array.isArray(r.d)) return { raw, notes, error: 'no device list in the reply' };
  const byId = new Map(req.devices.map((d) => [d.id, d]));
  const tiles: TileSpec[] = [];
  const seen = new Set<string>();
  for (const id of r.d) {
    const dev = typeof id === 'string' ? byId.get(id) : undefined;
    if (!dev) { notes.push('Dropped a device that is not in this room.'); continue; }
    if (seen.has(dev.id) || tiles.length >= MAX_TILES) continue;
    seen.add(dev.id);
    tiles.push(deviceTile(dev));
  }
  if (!tiles.length) return { raw, notes, error: 'no device from this room was chosen' };
  return { raw: { kind: 'room', title, tiles }, notes };
}

/** Nano's final text → a validated plan, or the reason it was refused. */
export function parseNanoPlan(text: string, req: SurfaceRequest): Coerced<SurfacePlan> {
  const json = extractJson(text);
  if (json == null) return { ok: false, error: 'The reply was not a board plan.' };
  const { raw, notes, error } = expandNanoPlan(json, req);
  if (error) return { ok: false, error };
  const plan = coerceSurfacePlan(raw);
  if (!plan.ok) return plan;
  const all = [...notes, ...(plan.notes ?? [])];
  return all.length ? { ok: true, value: plan.value, notes: all } : { ok: true, value: plan.value };
}

/** The ghost preview while Nano is still writing: a tile for every device id
 *  that has fully arrived, so
 *  she sees the board form id by id instead of waiting for the closing brace. */
export function partialNanoPlan(text: string, req: SurfaceRequest): PartialPlan {
  const out: PartialPlan = { tiles: [], rejected: 0 };
  if (nanoWantsPlan(req)) { out.kind = 'plan'; out.title = 'Floor plan'; return out; }
  out.kind = 'room';
  const t = /"t"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (t) out.title = cleanTitle(t[1], req.frameTitle || 'This room');
  const at = text.search(/"d"\s*:\s*\[/);
  if (at < 0) return out;
  const list = text.slice(text.indexOf('[', at) + 1).split(']')[0];
  const byId = new Map(req.devices.map((d) => [d.id, d]));
  const seen = new Set<string>();
  for (const m of list.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const dev = byId.get(m[1]);
    if (!dev) { out.rejected++; continue; }
    if (seen.has(dev.id) || out.tiles.length >= MAX_TILES) continue;
    seen.add(dev.id);
    out.tiles.push(deviceTile(dev));
  }
  return out;
}
