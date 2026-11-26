// English device speech → device intents, parsed against the live device list.
// Pure: it knows only ids, labels, kinds and the current on/brightness/volume so
// it can turn a relative "dim", "warmer" or "louder" into an absolute value.
// Returns null when nothing device-like is recognised (canvas and CAD parsers
// get their turn).
import type { DeviceIntent } from './deviceActions';
import { lampStep } from './deviceGuard';
import { VOLUME_PRESETS, colourFromSpeech, sceneFromSpeech, tempStep } from './lampPresets';
import type { StatusKey } from './languagePack';

export type DeviceKind = 'lamp' | 'music' | 'switch';
export interface DeviceRef {
  id: string;
  label: string;
  kind?: DeviceKind;
  on?: boolean;
  brightness?: number;
  playing?: boolean;
  volume?: number;
  /** Lamp white in Kelvin, when known (so "warmer" / "cooler" step from it). */
  temp?: number;
}
export interface DeviceCommandResult { intents: DeviceIntent[]; say: string; statusKey?: StatusKey }

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
const curVol = (d: DeviceRef) => (typeof d.volume === 'number' ? d.volume : 50);
const labelList = (ds: readonly DeviceRef[], all: boolean) => (all ? 'everything' : ds.map((d) => d.label).join(' and '));

export function parseDeviceCommands(text: string, devices: readonly DeviceRef[], opts?: { pointed?: DeviceRef | null }): DeviceCommandResult | null {
  const t = norm(text);
  if (!t || !devices.length) return null;

  // Music is a separate vocabulary (play / pause / next / louder / softer) and
  // targets the music devices; lamp verbs never touch a speaker.
  const musics = devices.filter((d) => d.kind === 'music');
  const lamps = devices.filter((d) => d.kind !== 'music');
  if (musics.length) {
    // "the music" / "volume" / "song" lets "turn it down" and "stop" target the
    // speaker; bare "turn down" without a music word stays a lamp command.
    const musicNamed = /\b(music|song|songs|speaker|speakers|volume|track)\b/.test(t);
    const play = /\b(play|resume)\b/.test(t);
    const pause = /\bpause\b/.test(t) || (musicNamed && /\bstop\b/.test(t));
    const next = /\bnext\b/.test(t);
    const previous = /\bprevious\b/.test(t) || /\b(last|go back a?) (song|track)\b/.test(t) || (musicNamed && /\bgo back\b/.test(t));
    // "volume to quiet / medium / loud": the tile's own preset chips, by voice.
    const preset = musicNamed ? VOLUME_PRESETS.find((v) => new RegExp(`\\b${v.key}\\b`).test(t)) : undefined;
    if (preset) return { intents: musics.map((d) => ({ deviceId: d.id, volume: preset.volume })), say: `Volume ${preset.label.toLowerCase()}.` };
    if (previous) return { intents: musics.map((d) => ({ deviceId: d.id, previous: true })), say: 'Previous song.' };
    const louder = /\blouder\b/.test(t) || (musicNamed && /\b(up|higher|increase)\b/.test(t));
    const softer = /\b(softer|quieter)\b/.test(t) || (musicNamed && /\b(down|lower|decrease)\b/.test(t));
    if (play || pause || next || louder || softer) {
      if (next) return { intents: musics.map((d) => ({ deviceId: d.id, next: true })), say: 'Next song.', statusKey: 'nextSong' };
      if (louder || softer) {
        const delta = louder ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP;
        return { intents: musics.map((d) => ({ deviceId: d.id, volume: clamp(curVol(d) + delta) })), say: louder ? 'Louder.' : 'Softer.', statusKey: louder ? 'louder' : 'softer' };
      }
      const playing = play; // play wins over pause if both somehow present
      return { intents: musics.map((d) => ({ deviceId: d.id, playing })), say: playing ? 'Playing.' : 'Paused.', statusKey: playing ? 'playing' : 'paused' };
    }
  }

  const matched = matchDevices(t, lamps);
  const hasAllWord = /\b(lights?|lamps?|everything|all|room)\b/.test(t);

  // Percent is read from the raw text — norm() strips the "%" sign.
  const percent = /(\d{1,3})\s*(?:percent|%)/.exec(text.toLowerCase());
  const warmer = /\bwarm(er)?\b/.test(t);
  const cooler = /\bcool(er)?\b/.test(t);
  const dimmer = /\b(dim|dimmer|darker|lower)\b/.test(t)
    || /\bturn(?:ing)? down\b/.test(t)
    || /\b(decrease|reduce|cut)(?: the)? brightness\b/.test(t);
  const brighter = /\b(bright|brighter|brighten|lighter)\b/.test(t)
    || /\bturn(?:ing)? up\b/.test(t)
    || /\b(increase|raise|boost)(?: the)? brightness\b/.test(t);
  const offWord = /\b(off|out)\b/.test(t);
  const onWord = !offWord && /\bon\b/.test(t);

  // Targets: named devices win; otherwise a relative/warmth/percent command with
  // an "all" word (or none at all) applies to every lamp. A bare on/off needs a
  // named device or an all-word, else it is not a device command.
  const relative = warmer || cooler || dimmer || brighter;
  const look = !!sceneFromSpeech(t) || !!colourFromSpeech(t);
  let targets: DeviceRef[];
  let all = false;
  const deictic = /\b(this|that|it)\b/.test(t);
  if (matched.length) {
    targets = matched;
  } else if (deictic && opts?.pointed) {
    // Voice + point: "turn that off" / "dim this" uses the focused tile.
    targets = [opts.pointed];
  } else if ((percent || relative || hasAllWord) && lamps.length) {
    targets = lamps.slice();
    all = true;
  } else if (look && lamps.length && /\b(scene|mode)\b/.test(t)) {
    // "sunset scene" names no lamp: it is still about the lights.
    targets = lamps.slice();
    all = true;
  } else {
    return null;
  }
  // A colour / scene word only counts next to a lamp: a named one, the pointed
  // one, a lights word, or the word "scene" itself.
  const lampContext = look && (matched.length > 0 || hasAllWord || (deictic && !!opts?.pointed) || /\b(scene|mode)\b/.test(t));

  // "make the lamp blue" / "set the lamp to sunset": a colour or a scene, never
  // with an off or a percent in the same breath (those mean something else).
  if (!percent && !offWord && lampContext) {
    const scene = sceneFromSpeech(t);
    const colour = scene ? null : colourFromSpeech(t);
    if (scene) {
      return { intents: targets.map((d) => ({ deviceId: d.id, on: true, sceneId: scene.sceneId })), say: `${labelList(targets, all)} set to ${scene.label}.` };
    }
    if (colour) {
      const intents = targets.map((d) => (colour.rgb ? { deviceId: d.id, on: true, rgb: { ...colour.rgb } } : { deviceId: d.id, on: true, temp: colour.temp }));
      return { intents, say: `${labelList(targets, all)} set to ${colour.label.toLowerCase()}.` };
    }
  }

  if (percent) {
    const v = clamp(Number(percent[1]));
    const intents = targets.map((d) => ({ deviceId: d.id, on: v > 0, brightness: v }));
    return { intents, say: `${labelList(targets, all)} to ${v}%.` };
  }

  // Warmer / cooler change the WHITE (colour temperature), not the brightness.
  if (warmer || cooler) {
    const intents = targets.map((d) => ({ deviceId: d.id, on: true, temp: tempStep(d.temp, warmer ? -1 : 1) }));
    return { intents, say: `${warmer ? 'Warmer' : 'Cooler'} white on ${labelList(targets, all)}.` };
  }

  if (dimmer || brighter) {
    const delta = brighter ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP;
    const intents = targets.map((d) => {
      const brightness = lampStep(curBright(d) + delta);
      return brighter ? { deviceId: d.id, on: true, brightness } : { deviceId: d.id, brightness };
    });
    const verb = brighter ? 'Brightened' : 'Dimmed';
    return { intents, say: `${verb} ${labelList(targets, all)}.`, statusKey: brighter ? 'brighter' : 'dimmer' };
  }

  if (onWord || offWord) {
    const on = onWord;
    const intents = targets.map((d) => ({ deviceId: d.id, on }));
    const say = all ? (on ? 'Lights on.' : 'Lights off.') : `Turned ${on ? 'on' : 'off'} ${labelList(targets, all)}.`;
    return { intents, say, statusKey: on ? 'lightsOn' : 'lightsOff' };
  }

  return null;
}

/** Map the magnet-focused element (button / tile / chip) to a device, so
 *  Talk "that" / "this" / "it" can resolve without a spoken name. */
export function resolvePointedDevice(el: Element | null | undefined, devices: readonly DeviceRef[]): DeviceRef | null {
  if (!el || !devices.length) return null;
  let node: Element | null = el;
  const ids = new Map(devices.map((d) => [d.id, d]));
  while (node) {
    for (const attr of ['data-device', 'data-device-id', 'data-deviceid']) {
      const v = node.getAttribute?.(attr);
      if (v && ids.has(v)) return ids.get(v)!;
      if (v) {
        const stripped = v.replace(/^(lamp|music|switch)-/, '');
        if (ids.has(stripped)) return ids.get(stripped)!;
      }
    }
    const label = (node.getAttribute?.('aria-label') || '').trim().toLowerCase();
    if (label) {
      const hit = devices.filter((d) => d.label && label.includes(d.label.toLowerCase()));
      if (hit.length === 1) return hit[0];
    }
    node = node.parentElement;
  }
  const blob = ((el as HTMLElement).innerText || el.textContent || el.getAttribute?.('aria-label') || '').toLowerCase();
  if (!blob.trim()) return null;
  const hit = devices.filter((d) => d.label && blob.includes(d.label.toLowerCase()));
  return hit.length === 1 ? hit[0] : null;
}
