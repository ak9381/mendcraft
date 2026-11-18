// English device speech → lamp intents, parsed against the live device list.
// Pure: it knows only ids, labels and the current on/brightness so it can turn a
// relative "dim" or "warmer" into an absolute brightness. Returns null when
// nothing device-like is recognised (canvas and CAD parsers get their turn).
import type { LampIntent } from './deviceActions';

export interface DeviceRef { id: string; label: string; on?: boolean; brightness?: number }
export interface DeviceCommandResult { intents: LampIntent[]; say: string }

export const BRIGHTNESS_STEP = 20;

const COMMON = new Set(['lamp', 'lamps', 'light', 'lights', 'the', 'a']);
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function norm(text: string): string {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Devices whose label is named in the text, best (full-label) match first. */
function matchDevices(t: string, devices: readonly DeviceRef[]): DeviceRef[] {
  const toks = new Set(t.split(' '));
  const scored = devices
    .map((d) => {
      const label = norm(d.label);
      if (label && t.includes(label)) return { d, score: 2 };
      const distinctive = label.split(' ').filter((w) => !COMMON.has(w));
      return { d, score: distinctive.some((w) => toks.has(w)) ? 1 : 0 };
    })
    .filter((s) => s.score > 0);
  if (!scored.length) return [];
  const top = Math.max(...scored.map((s) => s.score));
  return scored.filter((s) => s.score === top).map((s) => s.d);
}

const curBright = (d: DeviceRef) => (typeof d.brightness === 'number' ? d.brightness : 50);
const labelList = (ds: readonly DeviceRef[], all: boolean) => (all ? 'everything' : ds.map((d) => d.label).join(' and '));

export function parseDeviceCommands(text: string, devices: readonly DeviceRef[]): DeviceCommandResult | null {
  const t = norm(text);
  if (!t || !devices.length) return null;

  const matched = matchDevices(t, devices);
  const hasAllWord = /\b(lights?|lamps?|everything|all|room)\b/.test(t);

  // Percent is read from the raw text — norm() strips the "%" sign.
  const percent = /(\d{1,3})\s*(?:percent|%)/.exec(text.toLowerCase());
  const warmer = /\bwarm(er)?\b/.test(t);
  const cooler = /\bcool(er)?\b/.test(t);
  const dimmer = /\b(dim|dimmer|darker|lower)\b/.test(t);
  const brighter = /\b(bright|brighter|brighten|lighter)\b/.test(t);
  const offWord = /\b(off|out)\b/.test(t);
  const onWord = !offWord && /\bon\b/.test(t);

  // Targets: named devices win; otherwise a relative/warmth/percent command with
  // an "all" word (or none at all) applies to every lamp. A bare on/off needs a
  // named device or an all-word, else it is not a device command.
  const relative = warmer || cooler || dimmer || brighter;
  let targets: DeviceRef[];
  let all = false;
  if (matched.length) {
    targets = matched;
  } else if (percent || relative || hasAllWord) {
    targets = devices.slice();
    all = true;
  } else {
    return null;
  }

  if (percent) {
    const v = clamp(Number(percent[1]));
    const intents = targets.map((d) => ({ deviceId: d.id, on: v > 0, brightness: v }));
    return { intents, say: `${labelList(targets, all)} to ${v}%.` };
  }

  if (warmer || cooler) {
    const delta = warmer ? -BRIGHTNESS_STEP : BRIGHTNESS_STEP;
    const verb = warmer ? 'dimmed' : 'brightened';
    const intents = targets.map((d) => {
      const brightness = clamp(curBright(d) + delta);
      return cooler ? { deviceId: d.id, on: true, brightness } : { deviceId: d.id, brightness };
    });
    const word = warmer ? 'Warmer' : 'Cooler';
    return { intents, say: `${word} — ${verb} ${labelList(targets, all)} by ${BRIGHTNESS_STEP}%.` };
  }

  if (dimmer || brighter) {
    const delta = brighter ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP;
    const intents = targets.map((d) => {
      const brightness = clamp(curBright(d) + delta);
      return brighter ? { deviceId: d.id, on: true, brightness } : { deviceId: d.id, brightness };
    });
    const verb = brighter ? 'Brightened' : 'Dimmed';
    return { intents, say: `${verb} ${labelList(targets, all)}.` };
  }

  if (onWord || offWord) {
    const on = onWord;
    const intents = targets.map((d) => ({ deviceId: d.id, on }));
    const say = all ? (on ? 'Lights on.' : 'Lights off.') : `Turned ${on ? 'on' : 'off'} ${labelList(targets, all)}.`;
    return { intents, say };
  }

  return null;
}
