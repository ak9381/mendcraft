// English device speech → device intents, parsed against the live device list.
// Pure: it knows only ids, labels, kinds and the current on/brightness/volume so
// it can turn a relative "dim", "warmer" or "louder" into an absolute value.
// Returns null when nothing device-like is recognised (canvas and CAD parsers
// get their turn).
import type { DeviceIntent } from './deviceActions';
import { lampStep } from './deviceGuard';
import { LAMP_COLOURS, VOLUME_PRESETS, colourFromSpeech, sceneFromSpeech, tempStep } from './lampPresets';
import { WIZ_SCENES } from '../devices/wiz';
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

// ── Command shape ────────────────────────────────────────────────────────────
// A device route acts at once, with no review, so only a COMMAND may reach it.
// A line that merely talks about a device (a question, a negation, a report or
// claim, a tile on a board) or about something else that shares a word with a
// device ("cool", "make the text lighter", "lower your voice") is refused here
// and falls through to chat.

/** Polite openers stripped before the shape check ("please", "hey", "can you"). */
const POLITE = /^(?:(?:please|pls|hey|hi|ok|okay|alright|now|just|so|and|then|also|mendcraft|can you|could you|would you|will you|kindly)\s+)+/;
const REQUEST = /^(?:(?:please|pls|hey|ok|okay|now|just|so)\s+)*(?:can|could|would|will) you\b/;
/** Words a device order may start with. No bare "warm" / "cool": "cool",
 *  "ok cool" and "warm welcome" are talk. "warmer", "make it warm" still act. */
const VERBS = new Set([
  'turn', 'switch', 'put', 'set', 'make', 'dim', 'brighten', 'darken', 'lower', 'raise', 'increase', 'decrease', 'reduce',
  'boost', 'cut', 'play', 'resume', 'pause', 'stop', 'next', 'skip', 'previous', 'go', 'change', 'bring', 'mute', 'unmute',
  'louder', 'softer', 'quieter', 'brighter', 'dimmer', 'darker', 'lighter', 'warmer', 'cooler', 'lights', 'light', 'volume',
]);
/** Device words a short phrase may start with ("lamp on", "volume up"). */
const SHORT_HEADS = new Set(['lamp', 'lamps', 'light', 'lights', 'music', 'song', 'track', 'speaker', 'speakers', 'volume', 'everything', 'all', 'room']);
const DETERMINERS = new Set(['the', 'my', 'our', 'both', 'every']);
/** Question, negation, claim, time and change-of-mind words: not an order. */
const REFUSE = new RegExp('\\b(?:' + [
  'is', 'are', 'am', 'was', 'were', 'isnt', 'arent', 'wasnt', 'werent', 'did', 'didnt', 'does', 'doesnt', 'do', 'dont',
  'not', 'never', 'cant', 'cannot', 'wont', 'shouldnt', 'wouldnt', 'couldnt', 'should', 'has', 'have', 'had', 'been', 'being',
  'without', 'how', 'why', 'what', 'whats', 'which', 'who', 'whos', 'when', 'where', 'wheres', 'whether', 'if',
  'tell', 'told', 'say', 'said', 'already', 'think', 'remind', 'remember', 'later', 'tomorrow', 'tonight',
  'turned', 'switched', 'dimmed', 'brightened', 'played', 'paused', 'stopped', 'went', 'got', 'made', 'changed',
  // A change of mind or a choice ("turn off the lamp no wait", "on or off");
  // Kannada / Hindi "don't" in Latin letters ("lights off beda", "mat karo").
  'wait', 'actually', 'or', 'either', 'no', 'beda', 'bedi', 'maadbeda', 'mat', 'nahi', 'nahin',
  'tile', 'tiles', 'board', 'boards', 'card', 'cards', 'widget', 'widgets', 'button', 'buttons', 'control', 'controls',
  'slider', 'sliders', 'toggle', 'dashboard', 'dashboards', 'canvas', 'note', 'notes', 'icon', 'icons', 'chart', 'panel',
  'panels', 'page', 'screen', 'story', 'picture', 'photo', 'image', 'drawing', 'sketch', 'diagram', 'label',
].join('|') + ')\\b');

/** Every word a device order is made of. A line with any other word ("make
 *  the TEXT lighter", "lower your VOICE", "lamp on FIRE", "play a GAME", "turn
 *  on the lamp in an HOUR") is about something else and never acts. A device's
 *  own label words are added per call; numbers are a level. */
const ORDER_WORDS = new Set<string>([
  ...VERBS, ...SHORT_HEADS, ...DETERMINERS, ...COMMON,
  'on', 'off', 'out', 'up', 'down', 'to', 'at', 'and', 'then', 'it', 'this', 'that', 'them', 'these', 'those', 'one',
  'a', 'an', 'bit', 'little', 'more', 'lot', 'much', 'slightly', 'way', 'please', 'pls', 'now', 'again', 'back',
  'percent', 'per', 'cent', 'brightness', 'bright', 'white', 'level', 'warm', 'cool', 'dim', 'brighten',
  'songs', 'tracks', 'sound', 'quiet', 'medium', 'loud', 'some', 'for', 'me', 'us',
  'full', 'max', 'maximum', 'half', 'higher', 'high', 'low', 'scene', 'mode', 'colour', 'color',
  'hey', 'hi', 'ok', 'okay', 'alright', 'so', 'just', 'also', 'kindly', 'mendcraft', 'can', 'could', 'would', 'will', 'you',
  'thanks', 'thank', 'playing', 'last', 'here', 'in', 'everything',
  ...LAMP_COLOURS.flatMap((c) => norm(c.label).split(' ')), 'violet', 'pink', 'amber',
  ...Object.values(WIZ_SCENES).flatMap((l) => norm(l).split(' ')), 'cosy', 'cozy', 'reading', 'study',
]);

function strayWords(t: string, devices: readonly DeviceRef[]): string[] {
  const label = new Set(devices.flatMap((d) => norm(d.label).split(' ')));
  return t.split(' ').filter((w) => w && !ORDER_WORDS.has(w) && !label.has(w) && !/^\d+$/.test(w));
}

/** A short phrase ends at its state: "lamp on", "desk lamp 40 percent",
 *  "volume up" — never "lamp on my desk", "room on the left". */
const STATE_END = /(?:\b(?:on|off|out|up|down|brighter|dimmer|darker|lighter|warmer|cooler|louder|softer|quieter|percent|cent|quiet|medium|loud|full|max|half)|\d)$/;

/** True when the line has the shape of a device order (see above). */
export function looksLikeDeviceCommand(text: string, devices: readonly DeviceRef[] = []): boolean {
  const raw = text.trim().toLowerCase();
  const t = norm(text);
  if (!t) return false;
  const request = REQUEST.test(t);
  // A "?" makes it a question, except a polite request ("can you turn the lamp on?").
  if (raw.includes('?') && !request) return false;
  // "the lamp's on", "it's off": a claim, not an order.
  if (/\b\w+['’]s\s+(?:on|off|out)\b/.test(raw)) return false;
  if (REFUSE.test(t)) return false;
  if (/\bright$/.test(t)) return false; // "…, right"
  if (/\bstop \w+ing\b/.test(t)) return false; // "stop turning the lamp off"
  if (strayWords(t, devices).length) return false;
  // "turn on the lamp at 9": a time, not a level.
  if (/\bat \d+\b/.test(t) && !/\d\s*(?:percent|per cent|%)/.test(raw)) return false;
  const words = t.replace(POLITE, '').replace(/(?:\s+(?:please|pls|now|thanks|thank you))+$/, '').split(' ').filter(Boolean);
  if (!words.length) return false;
  if (VERBS.has(words[0])) return true;
  if (request) return false;
  // A short device phrase: its first content word is a device word or a word of
  // a device's label, and it ends at its state.
  if (words.length > 6) return false;
  const labelWords = new Set(devices.flatMap((d) => norm(d.label).split(' ')).filter((w) => w && !COMMON.has(w)));
  const phrase = words.join(' ');
  // "party scene", "sunset mode": a scene by name, still about the lights.
  if (words.length <= 3 && /\b(?:scene|mode)$/.test(phrase) && !!sceneFromSpeech(phrase)) return true;
  const head = words.find((w) => !DETERMINERS.has(w));
  if (!head || !(SHORT_HEADS.has(head) || labelWords.has(head))) return false;
  // "the lamps on" is "the lamp's on" heard without its apostrophe: a report.
  if (/^(?:the|my|our) \w+s (?:on|off|out)$/.test(phrase)) return false;
  return STATE_END.test(phrase) || (words.length <= 4 && !!(colourFromSpeech(phrase) || sceneFromSpeech(phrase)));
}

/** "turn the desk lamp on and the bedroom lamp off": clauses, each with its own
 *  state. Null when the line is one clause (an "and" between two lamps). */
function clauses(t: string): string[] | null {
  const parts = t.split(/\s+(?:and|then)\s+(?:then\s+)?/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const stated = (p: string) => /\b(?:on|off|out|up|down|brighter|dimmer|darker|lighter|warmer|cooler|louder|softer|quieter|percent|play|pause|stop|resume|next|skip|previous|dim|brighten)\b/.test(p);
  return parts.every(stated) ? parts : null;
}

/** The level said as a percent ("40 percent", "40%", "-20 percent", "1000
 *  percent", "12.5%"), read whole from the raw text; null when none. */
function percentOf(text: string): number | null {
  const m = /(?<![\d.])(-?\d+(?:\.\d+)?)\s*(?:percent|per cent|%)/.exec(text.toLowerCase());
  return m ? Number(m[1]) : null;
}

const MUSIC_WORD = /\b(music|song|songs|speaker|speakers|volume|track)\b/;

export function parseDeviceCommands(text: string, devices: readonly DeviceRef[], opts?: { pointed?: DeviceRef | null }): DeviceCommandResult | null {
  const t = norm(text);
  if (!t || !devices.length) return null;
  if (!looksLikeDeviceCommand(text, devices)) return null;
  // Two clauses, two states: each is done to its own device, or nothing is.
  const parts = clauses(t);
  if (parts) {
    const lead = /^(?:please |hey |ok |okay |can you |could you |would you |now )*(turn|switch|set|make|put)\b/.exec(t)?.[1];
    const results: DeviceCommandResult[] = [];
    for (const [i, part] of parts.entries()) {
      // "turn the desk lamp on and the bedroom lamp off": the verb carries over.
      const said = i > 0 && lead && !/^(?:turn|switch|set|make|put|dim|brighten|play|pause|stop|resume|next|skip)\b/.test(part) ? `${lead} ${part}` : part;
      const r = parseOne(said, said, devices, opts);
      if (!r) return null;
      results.push(r);
    }
    const ids = results.flatMap((r) => r.intents.map((x) => x.deviceId));
    // The same device twice ("turn the lamp on then off"): refused, not guessed.
    if (new Set(ids).size !== ids.length) return null;
    return { intents: results.flatMap((r) => r.intents), say: results.map((r) => r.say).join(' ') };
  }
  return parseOne(text, t, devices, opts);
}

function parseOne(text: string, t: string, devices: readonly DeviceRef[], opts?: { pointed?: DeviceRef | null }): DeviceCommandResult | null {

  // Music is a separate vocabulary (play / pause / next / louder / softer) and
  // targets the music devices; lamp verbs never touch a speaker.
  const musics = devices.filter((d) => d.kind === 'music');
  const lamps = devices.filter((d) => d.kind !== 'music');
  if (musics.length) {
    // "the music" / "volume" / "song" lets "turn it down" and "stop" target the
    // speaker; bare "turn down" without a music word stays a lamp command.
    const musicNamed = MUSIC_WORD.test(t);
    // "set the volume to 40 percent", "speaker 30 percent": a volume, never a
    // lamp's brightness. As asked, never clamped (the store refuses).
    const volPercent = musicNamed ? percentOf(text) : null;
    if (volPercent !== null) return { intents: musics.map((d) => ({ deviceId: d.id, volume: volPercent })), say: `Volume ${volPercent}%.` };
    // A music verb counts only when it IS the command ("next", "play",
    // "pause please") or the sentence is about music ("next song", "play the
    // music"). Inside any other sentence it is just a word: "a study NEXT to
    // bedroom 2" or "add a PLAY area" must never touch the speaker.
    const leads = (verbs: string) => new RegExp(`^(?:please |hey |ok |okay |can you |could you |now )*(?:${verbs})\\b`).test(t);
    const play = leads('play|resume') || (musicNamed && /\b(play|resume)\b/.test(t));
    const pause = leads('pause') || (musicNamed && /\b(pause|stop)\b/.test(t));
    const next = leads('next|skip') || (musicNamed && /\b(next|skip)\b/.test(t));
    const previous = leads('previous') || /\b(last|go back a?) (song|track)\b/.test(t) || (musicNamed && /\b(previous|go back)\b/.test(t));
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
  // A music word with no lamp named is about the speaker, never the lamps
  // (with no speaker connected, "volume 40 percent" does nothing here).
  if (!matched.length && MUSIC_WORD.test(t)) return null;
  const hasAllWord = /\b(lights?|lamps?|everything|all|room)\b/.test(t);

  // Percent is read from the raw text — norm() strips the "%" sign.
  const percentValue = percentOf(text);
  const percent = percentValue !== null;
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
    // As asked, never clamped: the store refuses anything outside 10–100 %.
    const v = percentValue!;
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
