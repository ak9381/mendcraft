// The on-device (Nano) board turn: ONE short prompt, ONE structured reply.
// Nano is a small model on a laptop GPU — the full nested tile grammar made
// it ramble for minutes. Here it gets a flat, six-tile grammar, the device
// ids it may use as a JSON-schema enum (so it cannot invent a device), and a
// reply the code then normalises against the real device list.
import { extractJson } from '../ai/cloudJson';
import { coerceSurfacePlan, MAX_TILES, PLAN_TEMPLATES, type Coerced, type PlanTemplate, type SurfacePlan } from './surfacePlan';
import type { DeviceHint, SurfaceRequest } from './aiTurn';

export const NANO_TILE_TYPES = ['lamp', 'music', 'switch', 'connect', 'plan'] as const;
export const NANO_CONNECT_LABEL = 'Connect a device';

/** Fixed instructions: kept apart so a warm session can hold them once. */
export const NANO_SYSTEM_PROMPT = [
  'You fill one board on a smart home canvas. Reply with one JSON object and nothing else:',
  `{"kind":"room"|"plan","title":string,"tiles":[{"type":"lamp"|"music"|"switch"|"connect"|"plan","deviceId":string,"label":string,"template":${PLAN_TEMPLATES.map((t) => `"${t}"`).join('|')}}]}`,
  'Rules:',
  '- One tile per device she asks for. Use only device ids from the list. Never invent a device, a count or a status.',
  '- "connect" is the button that adds a device. If there is no device to show, reply with one connect tile.',
  '- A floor plan is kind "plan" with one "plan" tile and a template (studio, oneRoom or twoBedroom).',
  `- At most ${MAX_TILES} tiles. Labels are two or three plain words.`,
].join('\n');

function deviceLines(devices: DeviceHint[]): string {
  return devices.map((d) => `- ${d.id}: ${d.label} (${d.kind})`).join('\n') || '- none found yet';
}

function currentLine(current: SurfacePlan | null | undefined): string {
  if (!current) return '';
  const flat = current.tiles
    .map((t) => ('deviceId' in t ? `${t.type} ${t.deviceId}` : t.type))
    .slice(0, MAX_TILES)
    .join(', ');
  return flat ? `\nOn the board now: ${flat}` : '';
}

/** The JSON schema Chrome's Prompt API enforces (`responseConstraint`). */
export function nanoPlanConstraint(devices: DeviceHint[]): Record<string, unknown> {
  const ids = devices.map((d) => d.id);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'title', 'tiles'],
    properties: {
      kind: { type: 'string', enum: ['room', 'plan'] },
      title: { type: 'string', maxLength: 40 },
      tiles: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_TILES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: { type: 'string', enum: [...NANO_TILE_TYPES] },
            ...(ids.length ? { deviceId: { type: 'string', enum: ids } } : {}),
            label: { type: 'string', maxLength: 30 },
            template: { type: 'string', enum: [...PLAN_TEMPLATES] },
          },
        },
      },
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
}

export function buildNanoPlanRequest(req: SurfaceRequest): NanoPlanRequest {
  const user = [
    `Board: ${req.frameTitle}`,
    `Devices in the room:\n${deviceLines(req.devices)}${currentLine(req.current)}`,
    `She said: "${req.utterance}"`,
  ].join('\n');
  return { prompt: `${NANO_SYSTEM_PROMPT}\n${user}`, system: NANO_SYSTEM_PROMPT, user, constraint: nanoPlanConstraint(req.devices) };
}

/** The follow-up when the first reply was refused: short, and says why. */
export function buildNanoRepairPrompt(first: NanoPlanRequest, why: string): string {
  return `${first.system}\n${buildNanoRepairUser(first, why)}`;
}
/** The repair turn alone, for a session that already holds the instructions. */
export function buildNanoRepairUser(first: NanoPlanRequest, why: string): string {
  return `${first.user}\nYour last reply was refused: ${why.slice(0, 160)}. Reply again with the JSON object only.`;
}

function tileTypeFor(kind: string): 'lamp' | 'music' | 'switch' {
  const k = kind.toLowerCase();
  if (k === 'music' || k === 'speaker') return 'music';
  if (k === 'switch' || k === 'plug' || k === 'fan' || k === 'tv' || k === 'ac') return 'switch';
  return 'lamp';
}

const wantsTwoBedrooms = (s: string): boolean => /\b(two|2)[\s-]*(bed|bedroom)/i.test(s);
const wantsStudio = (s: string): boolean => /\bstudio\b/i.test(s);

/** Make Nano's flat reply a real plan: device tiles are checked against the
 *  devices that exist (type and fallback label come from the device, not the
 *  model), plan tiles get their board id, and a made-up device is dropped
 *  with a note rather than shown. */
export function normalizeNanoPlan(raw: unknown, req: SurfaceRequest): { raw: unknown; notes: string[] } {
  const notes: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { raw, notes };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.tiles)) return { raw, notes };
  const byId = new Map(req.devices.map((d) => [d.id, d]));
  const hasPlanTile = r.tiles.some((t) => t && typeof t === 'object' && (t as { type?: unknown }).type === 'plan');
  const kind: SurfacePlan['kind'] = r.kind === 'plan' || (r.kind !== 'room' && hasPlanTile) ? 'plan' : 'room';
  const planBoardId = kind === 'plan' && req.frameId ? `${req.frameId}-cad` : 'room-plan';
  const tiles: unknown[] = [];
  const seen = new Set<string>();
  for (const t of r.tiles) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    if (o.type === 'connect') {
      if (seen.has('connect')) continue;
      seen.add('connect');
      tiles.push({ type: 'connect', label: NANO_CONNECT_LABEL });
    } else if (o.type === 'plan') {
      if (seen.has('plan')) continue;
      seen.add('plan');
      const asked: PlanTemplate | null = wantsTwoBedrooms(req.utterance) ? 'twoBedroom' : wantsStudio(req.utterance) ? 'studio' : null;
      const given = PLAN_TEMPLATES.includes(o.template as PlanTemplate) ? (o.template as PlanTemplate) : null;
      tiles.push({ type: 'plan', boardId: planBoardId, template: asked ?? given ?? 'oneRoom' });
    } else if (o.type === 'lamp' || o.type === 'music' || o.type === 'switch') {
      const dev = typeof o.deviceId === 'string' ? byId.get(o.deviceId) : undefined;
      if (!dev) { notes.push('Dropped a device that is not in this room.'); continue; }
      if (seen.has(dev.id)) continue;
      seen.add(dev.id);
      const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : dev.label;
      tiles.push({ type: tileTypeFor(dev.kind), deviceId: dev.id, label });
    }
  }
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : (kind === 'plan' ? 'Floor plan' : req.frameTitle || 'This room');
  return { raw: { kind, title, tiles }, notes };
}

/** Nano's final text → a validated plan, or the reason it was refused. */
export function parseNanoPlan(text: string, req: SurfaceRequest): Coerced<SurfacePlan> {
  const json = extractJson(text);
  if (json == null) return { ok: false, error: 'The reply was not a board plan.' };
  const { raw, notes } = normalizeNanoPlan(json, req);
  const plan = coerceSurfacePlan(raw);
  if (!plan.ok) return plan;
  if (plan.value.kind === 'plan' && !plan.value.tiles.some((t) => t.type === 'plan')) {
    return { ok: false, error: 'a floor plan needs a plan tile' };
  }
  const all = [...notes, ...(plan.notes ?? [])];
  return all.length ? { ok: true, value: plan.value, notes: all } : { ok: true, value: plan.value };
}
