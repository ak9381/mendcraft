// "Try to break it": a request that breaks a real limit is refused by real
// validation — never clamped to something the person didn't ask for. Two
// limits are demonstrable: lamps only go 10–100 %, and a control needs a
// device that is actually connected. The model proposes (scripted and labelled
// SIM in ?sim=1), the validator here decides, the responsible engine's
// terminal fails (engine bar + AI monitor mirror it), and nothing is applied.
// Pure of the DOM: the panel and the board are passed in.
import type { SurfaceEngine } from './aiTurn';
import { LAMP_RANGE_REFUSAL } from './deviceGuard';
import { parseDeviceCommands, type DeviceRef } from './deviceCommands';
import type { LogVerb } from './modelPanels';

export { LAMP_RANGE_REFUSAL };

export type Attempt =
  | { kind: 'brightness'; deviceId: string; label: string; level: number }
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

/** An explicit "<n> %" brightness request, or an "add a control for <appliance>" ask. */
export function detectAttempt(text: string, devices: readonly DeviceRef[]): Attempt | null {
  const pct = /(\d{1,5})\s*(?:percent|%)/.exec(text.toLowerCase());
  if (pct) {
    // The ordinary parser only names the targets; its own clamped number is never used.
    const hit = parseDeviceCommands(text, devices)?.intents.find((i) => i.brightness !== undefined);
    if (hit) {
      const d = devices.find((x) => x.id === hit.deviceId);
      return { kind: 'brightness', deviceId: hit.deviceId, label: d?.label ?? hit.deviceId, level: Number(pct[1]) };
    }
    return null;
  }
  const m = /\b(?:add|make|create|build|put|give me|set up)\b[^.?!]*?\b(?:control|button|switch|toggle|slider|tile|widget)s?\s+(?:for|to|of)\s+(?:the\s+|my\s+|a\s+)?([a-z][a-z ]*?)\s*[.?!]*$/i.exec(text.trim());
  if (!m) return null;
  const thing = m[1].toLowerCase().trim();
  const words = thing.split(' ');
  if (!words.some((w) => APPLIANCES.has(w))) return null;
  return { kind: 'control', thing };
}

/** The one validator: used before a turn starts and again on what the model replied. */
export function validateAttempt(a: Attempt, devices: readonly DeviceRef[]): Verdict {
  if (a.kind === 'brightness') {
    const ok = Number.isInteger(a.level) && (a.level === 0 || (a.level >= 10 && a.level <= 100));
    return ok ? { ok: true } : { ok: false, reason: LAMP_RANGE_REFUSAL };
  }
  const words = a.thing.split(' ');
  const connected = devices.some((d) => norm(d.label).split(' ').filter((w) => !COMMON.has(w)).some((w) => words.includes(w)));
  return connected ? { ok: true } : { ok: false, reason: `There's no ${a.thing} connected. Nothing changed.` };
}

/** What the model's reply looks like for this ask (the ?sim=1 script is exactly this shape). */
export function scriptedReply(a: Attempt): string {
  return JSON.stringify(a.kind === 'brightness' ? { deviceId: a.deviceId, brightness: a.level } : { add: 'control', for: a.thing });
}

export function breakPrompt(text: string): string {
  return 'Turn this request into one device intent. Reply JSON only: '
    + '{"deviceId":string,"brightness":number} or {"add":"control","for":string}.\n'
    + `Request: "${text}"`;
}

function parseReply(raw: string, devices: readonly DeviceRef[]): Attempt | null {
  let o: unknown;
  try { o = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return null; }
  const r = o as { deviceId?: unknown; brightness?: unknown; add?: unknown; for?: unknown } | null;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.deviceId === 'string' && typeof r.brightness === 'number') {
    return { kind: 'brightness', deviceId: r.deviceId, label: devices.find((d) => d.id === r.deviceId)?.label ?? r.deviceId, level: r.brightness };
  }
  if (r.add === 'control' && typeof r.for === 'string') return { kind: 'control', thing: r.for.toLowerCase().trim() };
  return null;
}

const describe = (a: Attempt) => (a.kind === 'brightness' ? `${a.label} to ${a.level}%` : `a control for the ${a.thing}`);

export interface BreakDeps {
  engine: SurfaceEngine;
  devices: readonly DeviceRef[];
  /** The responsible engine's terminal (fail() blinks it red and flips the bar + feed). */
  panel: { log(verb: LogVerb, detail: string): void; fail(detail: string): void };
  say(text: string): void;
}

/** Ask the engine, then validate. The literal request is checked as well as
 *  the model's reply, so a model that quietly clamps still cannot get a
 *  changed value through. Returns refused:false only if everything passes —
 *  the caller applies the (valid) request itself. */
export async function runBreakTurn(text: string, attempt: Attempt, deps: BreakDeps): Promise<{ refused: boolean; reason?: string }> {
  const { engine, panel, devices } = deps;
  const tag = engine.sim ? 'SIM · ' : '';
  let proposed: Attempt = attempt;
  try {
    const reply = await engine.stream(breakPrompt(text), () => {});
    proposed = parseReply(reply, devices) ?? attempt;
    panel.log('note', `${tag}proposed ${describe(proposed)}. Checking it before anything changes.`);
  } catch {
    panel.log('note', `${tag}the model didn’t answer; checking your request directly.`);
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
