// "Try to break it": a request that breaks a real limit is refused by real
// validation — never clamped to something the person didn't ask for. Two
// limits are demonstrable: lamps only go 10–100 %, and a control needs a
// device that is actually connected. The model proposes (a recorded reply,
// labelled, in ?sim=1 test runs), the validator here decides, the responsible engine's
// terminal fails (engine bar + AI monitor mirror it), and nothing is applied.
// Pure of the DOM: the panel and the board are passed in.
import type { SurfaceEngine } from './aiTurn';
import { LAMP_RANGE_REFUSAL, VOLUME_RANGE_REFUSAL, levelRefusal } from './deviceGuard';
import { parseDeviceCommands, type DeviceRef } from './deviceCommands';
import type { LogVerb } from './modelPanels';

export { LAMP_RANGE_REFUSAL, VOLUME_RANGE_REFUSAL };

export type Attempt =
  | { kind: 'brightness'; deviceId: string; label: string; level: number }
  | { kind: 'volume'; deviceId: string; label: string; level: number }
  | { kind: 'control'; thing: string };

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Things a person might ask for a control for; one that isn't connected is refused. */
const APPLIANCES = new Set([
  'oven', 'stove', 'cooker', 'hob', 'fridge', 'refrigerator', 'freezer', 'kettle', 'toaster', 'microwave', 'dishwasher',
  'washer', 'washing', 'dryer', 'heater', 'geyser', 'fan', 'ac', 'aircon', 'thermostat', 'tv', 'television', 'door',
  'lock', 'garage', 'blinds', 'curtains', 'curtain', 'vacuum', 'coffee', 'pump', 'sprinkler', 'doorbell', 'camera',
]);
const COMMON = new Set(['lamp', 'lamps', 'light', 'lights', 'the', 'a', 'my']);
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const VOLUME_WORDS = /\b(volume|speaker|music|song|loud)\b/;

/** One clause ("desk lamp to 500%", "speaker volume to 150%") as an attempt. A
 *  bare "to 500" next to a lamp/volume word is read as a percent. */
function levelAttempt(clause: string, devices: readonly DeviceRef[]): Attempt | null {
  const low = clause.toLowerCase();
  let m = /(\d{1,5})\s*(?:percent|%)/.exec(low);
  let text = clause;
  if (!m && /\b(?:lamps?|lights?|brightness|volume|speaker)\b/.test(low)) {
    const bare = /\bto\s+(\d{1,5})\b(?!\s*(?::|am\b|pm\b))/.exec(low);
    if (bare) { m = bare; text = low.replace(bare[0], `${bare[0]}%`); }
  }
  if (!m) return null;
  const level = Number(m[1]);
  if (VOLUME_WORDS.test(low)) {
    const d = devices.find((x) => x.kind === 'music');
    return d ? { kind: 'volume', deviceId: d.id, label: d.label, level } : null;
  }
  // The ordinary parser only names the targets; its own clamped number is never used.
  const hit = parseDeviceCommands(text, devices)?.intents.find((i) => i.brightness !== undefined);
  if (!hit) return null;
  return { kind: 'brightness', deviceId: hit.deviceId, label: devices.find((x) => x.id === hit.deviceId)?.label ?? hit.deviceId, level };
}

/** An explicit level request, or an "add a control for <appliance>" ask. With
 *  several clauses ("desk lamp 50% and speaker 500%") the first one that
 *  breaks a limit wins, else the first one found. */
export function detectAttempt(text: string, devices: readonly DeviceRef[]): Attempt | null {
  const found = text.split(/\s+and\s+|,|;/i).map((c) => levelAttempt(c, devices)).filter((a): a is Attempt => !!a);
  if (found.length) return found.find((a) => !validateAttempt(a, devices).ok) ?? found[0];
  const m = /\b(?:add|make|create|build|put|give me|set up)\b[^.?!]*?\b(?:control|button|switch|toggle|slider|tile|widget)s?\s+(?:for|to|of)\s+(?:the\s+|my\s+|a\s+)?([a-z][a-z ]*?)\s*[.?!]*$/i.exec(text.trim());
  if (!m) return null;
  const thing = m[1].toLowerCase().trim();
  if (!thing.split(' ').some((w) => APPLIANCES.has(w))) return null;
  return { kind: 'control', thing };
}

/** The one validator: used before a turn starts and again on what the model replied. */
export function validateAttempt(a: Attempt, devices: readonly DeviceRef[]): Verdict {
  if (a.kind === 'brightness' || a.kind === 'volume') {
    const reason = levelRefusal(a.kind === 'brightness' ? { brightness: a.level } : { volume: a.level });
    return reason ? { ok: false, reason } : { ok: true };
  }
  const words = a.thing.split(' ');
  const connected = devices.some((d) => norm(d.label).split(' ').filter((w) => !COMMON.has(w)).some((w) => words.includes(w)));
  return connected ? { ok: true } : { ok: false, reason: `There's no ${a.thing} connected. Nothing changed.` };
}

/** The attempt, if the request breaks a limit: the one guard both routes use. */
export function impossibleAttempt(text: string, devices: readonly DeviceRef[]): Attempt | null {
  const a = detectAttempt(text, devices);
  return a && !validateAttempt(a, devices).ok ? a : null;
}

export function breakPrompt(text: string): string {
  return 'Turn this request into one device intent. Reply JSON only: '
    + '{"deviceId":string,"brightness":number} or {"deviceId":string,"volume":number} or {"add":"control","for":string}.\n'
    + `Request: "${text}"`;
}

function parseReply(raw: string, devices: readonly DeviceRef[]): Attempt | null {
  let o: unknown;
  try { o = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return null; }
  const r = o as { deviceId?: unknown; brightness?: unknown; volume?: unknown; add?: unknown; for?: unknown } | null;
  if (!r || typeof r !== 'object') return null;
  const label = (id: string) => devices.find((d) => d.id === id)?.label ?? id;
  if (typeof r.deviceId === 'string' && typeof r.brightness === 'number') return { kind: 'brightness', deviceId: r.deviceId, label: label(r.deviceId), level: r.brightness };
  if (typeof r.deviceId === 'string' && typeof r.volume === 'number') return { kind: 'volume', deviceId: r.deviceId, label: label(r.deviceId), level: r.volume };
  if (r.add === 'control' && typeof r.for === 'string') return { kind: 'control', thing: r.for.toLowerCase().trim() };
  return null;
}

const describe = (a: Attempt) => (a.kind === 'control' ? `a control for the ${a.thing}` : `${a.label} ${a.kind === 'volume' ? 'volume ' : ''}to ${a.level}%`);

/** The route line when no on-device model checks the request: the validator
 *  is deterministic, so it runs alone and no model is claimed. */
export const BREAK_RULES_ROUTE = 'Rules · on this device — checked by fixed limits, no model. Nothing sent.';

/** The model a try-to-break turn may consult: only a real on-device Nano (or
 *  a ?sim=1 replay engine). No engine at all: the rules decide alone. A "Nano" step that would really be drafted by Gemini in
 *  the cloud is never called — her words would leave the device for a check
 *  the rules already decide — so it returns null and the rules decide alone. */
export function breakEngine(engine: SurfaceEngine | undefined, sim: boolean): SurfaceEngine | null {
  if (!engine) return null;
  if (sim) return engine.sim ? engine : null;
  return engine.id === 'nano' && !engine.sim ? engine : null;
}

export interface BreakDeps {
  /** null: no on-device model — the deterministic validator decides alone. */
  engine: SurfaceEngine | null;
  devices: readonly DeviceRef[];
  /** The responsible engine's terminal (fail() blinks it red and flips the bar + feed). */
  panel: { log(verb: LogVerb, detail: string): void; fail(detail: string): void };
  say(text: string): void;
  /** Test hook: how long the model gets (default BREAK_MODEL_MS). */
  modelMs?: number;
}

/** Ask the engine, then validate. The literal request is checked as well as
 *  the model's reply, so a model that quietly clamps still cannot get a
 *  changed value through. Returns refused:false only if everything passes —
 *  the caller applies the (valid) request itself. */
/** How long the model gets to propose something before the guard decides alone. */
export const BREAK_MODEL_MS = 8000;
const BREAK_LATE = 'break-model-late';

export async function runBreakTurn(text: string, attempt: Attempt, deps: BreakDeps): Promise<{ refused: boolean; reason?: string }> {
  const { engine, panel, devices } = deps;
  let proposed: Attempt = attempt;
  if (!engine) {
    panel.log('note', BREAK_RULES_ROUTE);
  } else try {
    const tag = engine.sim ? 'SIM · ' : '';
    // The guard refuses on its own: the model only gets a short window to try,
    // so a slow on-device model never keeps her waiting for the refusal.
    let late: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      engine.stream(breakPrompt(text), () => {}),
      new Promise<never>((_, rej) => { late = setTimeout(() => rej(new Error(BREAK_LATE)), deps.modelMs ?? BREAK_MODEL_MS); }),
    ]).finally(() => clearTimeout(late));
    const parsed = parseReply(reply, devices);
    if (parsed) {
      proposed = parsed;
      panel.log('note', `${tag}proposed ${describe(parsed)}. Checking it before anything changes.`);
    } else {
      panel.log('note', `${tag}The model’s reply wasn’t usable; checking your request directly.`);
    }
  } catch (err) {
    const late = err instanceof Error && err.message === BREAK_LATE;
    panel.log('note', `${engine.sim ? 'SIM · ' : ''}the model didn’t answer${late ? ' in time' : ''}; checking your request directly.`);
  }
  for (const a of [attempt, proposed]) {
    const v = validateAttempt(a, devices);
    if (!v.ok) {
      panel.fail(v.reason);
      deps.say(v.reason);
      return { refused: true, reason: v.reason };
    }
  }
  return { refused: false };
}
