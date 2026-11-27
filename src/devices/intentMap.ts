// INTENT MAP: how the canvas's device intents become a generated connector's
// named actions. The canvas speaks in DeviceIntents ({on}, {brightness}, …);
// a connector speaks in actions ("power-on", "brightness" with a "level"
// param). Gemini writes the map next to the connector, as DATA; this file
// checks it against that connector and turns an intent into action calls.
// Nothing here is evaluated, and a value is never clamped: an argument
// outside the range the connector declares is refused.
import type { Connector, ConnectorAction } from './connector';
import type { DeviceIntent } from '../canvas/deviceActions';

export const INTENT_KEYS = ['on', 'off', 'brightness', 'temp', 'rgb', 'sceneId'] as const;
export type IntentKey = (typeof INTENT_KEYS)[number];
/** The intent field a connector param is filled from. */
export type IntentField = 'brightness' | 'temp' | 'r' | 'g' | 'b' | 'sceneId';
export interface IntentEntry { action: string; params?: Record<string, IntentField> }
export type IntentMap = Partial<Record<IntentKey, IntentEntry>>;

/** Which fields each intent key may fill (a power action takes none). */
const FIELDS_FOR: Record<IntentKey, readonly IntentField[]> = {
  on: [], off: [], brightness: ['brightness'], temp: ['temp'], rgb: ['r', 'g', 'b'], sceneId: ['sceneId'],
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Why one map entry is not usable with this connector, or null when it is. */
function entryProblem(key: IntentKey, raw: unknown, c: Connector): string | null {
  if (!isObj(raw) || typeof raw.action !== 'string') return 'names no action';
  const action = c.actions.find((a) => a.id === raw.action);
  if (!action) return `names "${String(raw.action).slice(0, 32)}", which the connector does not have`;
  if (raw.params !== undefined && !isObj(raw.params)) return 'has params that are not a list of names';
  const params = (raw.params ?? {}) as Record<string, unknown>;
  for (const [name, field] of Object.entries(params)) {
    if (!action.params.some((p) => p.name === name)) return `fills "${name.slice(0, 24)}", which "${action.id}" does not declare`;
    if (!FIELDS_FOR[key].includes(field as IntentField)) return `fills "${name.slice(0, 24)}" from something a ${key} request does not carry`;
    const spec = action.params.find((p) => p.name === name)!;
    if (spec.type !== 'number') return `fills "${name.slice(0, 24)}", which is not a number`;
  }
  // Every param the action declares must be filled from the request: a param
  // left to its default would send a value nobody asked for.
  for (const p of action.params) if (!(p.name in params)) return `leaves "${p.name}" of "${action.id}" unfilled`;
  // rgb needs all three channels, each once.
  if (key === 'rgb') {
    const got = Object.values(params).sort().join(',');
    if (got !== 'b,g,r') return 'does not fill r, g and b once each';
  }
  return null;
}

/** Keep only the entries that name an action this connector has, with params
 *  that action declares (all of them, each from a field the intent carries).
 *  Every dropped entry is said in `dropped`. */
export function coerceIntentMapNotes(raw: unknown, c: Connector): { map: IntentMap; dropped: string[] } {
  const map: IntentMap = {};
  const dropped: string[] = [];
  if (!isObj(raw)) return { map, dropped: raw === undefined ? [] : ['the intent map is not an object'] };
  for (const [k, v] of Object.entries(raw)) {
    if (!INTENT_KEYS.includes(k as IntentKey)) { dropped.push(`"${k.slice(0, 24)}" is not something the canvas asks a lamp`); continue; }
    const key = k as IntentKey;
    const why = entryProblem(key, v, c);
    if (why) { dropped.push(`${key} ${why}`); continue; }
    const e = v as { action: string; params?: Record<string, IntentField> };
    map[key] = { action: e.action, ...(e.params && Object.keys(e.params).length ? { params: { ...e.params } } : {}) };
  }
  return { map, dropped };
}

export function coerceIntentMap(raw: unknown, c: Connector): IntentMap {
  return coerceIntentMapNotes(raw, c).map;
}

export type ActionCall = { action: string; args: Record<string, number | boolean | string> };

/** The action calls one intent becomes, in order, or null when the map can't
 *  do all of it (a speaker field, or a key with no entry). Off is off: off,
 *  or brightness 0, is the off action alone. Never partial. */
export function actionsForIntent(i: DeviceIntent, m: IntentMap): ActionCall[] | null {
  if (i.playing !== undefined || i.volume !== undefined || i.next !== undefined || i.previous !== undefined || i.query !== undefined) return null;
  const call = (key: IntentKey, values: Partial<Record<IntentField, number>>): ActionCall | null => {
    const e = m[key];
    if (!e) return null;
    const args: Record<string, number> = {};
    for (const [name, field] of Object.entries(e.params ?? {})) {
      const v = values[field];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      args[name] = v;
    }
    return { action: e.action, args };
  };
  if (i.on === false || i.brightness === 0) { const off = call('off', {}); return off ? [off] : null; }
  const out: ActionCall[] = [];
  const steps: Array<[IntentKey, boolean, Partial<Record<IntentField, number>>]> = [
    ['on', i.on === true, {}],
    ['brightness', i.brightness !== undefined, { brightness: i.brightness }],
    ['temp', i.temp !== undefined, { temp: i.temp }],
    ['rgb', i.rgb !== undefined, { r: i.rgb?.r, g: i.rgb?.g, b: i.rgb?.b }],
    ['sceneId', i.sceneId !== undefined, { sceneId: i.sceneId }],
  ];
  for (const [key, asked, values] of steps) {
    if (!asked) continue;
    const c = call(key, values);
    if (!c) return null;
    out.push(c);
  }
  return out.length ? out : null;
}

/** Refuse, never clamp: an argument outside what the action declares (or a
 *  missing one) is a reason, not a value to move into range. */
export function argsRefusal(action: ConnectorAction, args: Record<string, unknown>): string | null {
  for (const p of action.params) {
    const v = args[p.name];
    if (p.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return `"${action.label}" needs a whole number for ${p.name}.`;
      if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) return `"${action.label}" takes ${p.name} from ${p.min} to ${p.max}.`;
    } else if (p.type === 'boolean') {
      if (typeof v !== 'boolean') return `"${action.label}" needs ${p.name} as on or off.`;
    } else if (typeof v !== 'string' || !p.values?.includes(v)) return `"${action.label}" doesn't know that ${p.name}.`;
  }
  return null;
}
