// "is the lamp on?": answered from the device store, never guessed by chat
// (the chat model cannot see the devices). Pure: the live refs in, one line out.
import type { DeviceRef } from './deviceCommands';

const norm = (text: string): string => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** "is the lamp on", "are the lights off?", "is the desk lamp still on",
 *  "is the music playing", "is my speaker on" — the thing asked about and the state. */
const ASK = /^(?:(?:hey|ok|okay|so|and|mendcraft)\s+)*(?:is|are)\s+(?:the\s+|my\s+|all\s+the\s+|both\s+(?:the\s+)?)?(.+?)\s+(?:still\s+|currently\s+|already\s+)?(on|off|playing|paused|working|answering)(?:\s+(?:now|right now|still))?$/;

const LAMP_WORDS = /^(?:lamps?|lights?|bulbs?)$/;
const MUSIC_WORDS = /^(?:music|song|speakers?|player)$/;

/** Ordinary words lose their capital mid-sentence ("the desk lamp"); a
 *  name keeps its own casing ("the WiZ lamp", "the Marshall"). */
const PLAIN_FIRST = /^(?:desk|bedroom|bed|bedside|living|kitchen|ceiling|floor|reading|table|study|hall|hallway|office|dining|porch|garden|night|side|corner|wall|lamp|lamps|light|lights|bulb|speaker|music|main|big|small|left|right|front|back|my|the)$/i;
function lower(label: string): string {
  const first = label.split(/\s+/)[0] ?? '';
  return /^[A-Z][a-z]*$/.test(first) && PLAIN_FIRST.test(first) ? label[0].toLowerCase() + label.slice(1) : label;
}

type Said = 'looking' | 'unreachable' | 'unknown' | 'known';
function kindOfAnswer(d: DeviceRef): Said {
  if (d.looking) return 'looking';
  if (d.unreachable) return 'unreachable';
  if (d.unknown || (d.kind === 'music' ? typeof d.playing !== 'boolean' : typeof d.on !== 'boolean')) return 'unknown';
  return 'known';
}
function stateOf(d: DeviceRef): string {
  const name = `the ${lower(d.label)}`;
  switch (kindOfAnswer(d)) {
    case 'looking': return `I'm still looking for ${name}`;
    case 'unreachable': return `${name} isn't answering`;
    case 'unknown': return d.kind === 'music' ? `I don't know whether ${name} is playing` : `I don't know whether ${name} is on`;
    default: return d.kind === 'music' ? `${name} is ${d.playing ? 'playing' : 'not playing'}` : `${name} is ${d.on ? 'on' : 'off'}`;
  }
}

/** The answer to a device state question, or null when the line is not one
 *  (or names no connected device: chat answers it). */
export function deviceStateAnswer(text: string, devices: readonly DeviceRef[]): string | null {
  if (!devices.length) return null;
  const m = ASK.exec(norm(text));
  if (!m) return null;
  const subject = m[1];
  const words = subject.split(' ');
  let hits = devices.filter((d) => {
    const label = norm(d.label);
    return label && (subject === label || subject.includes(label));
  });
  if (!hits.length) {
    const distinctive = (d: DeviceRef) => norm(d.label).split(' ').filter((w) => !LAMP_WORDS.test(w) && !MUSIC_WORDS.test(w) && w !== 'the');
    hits = devices.filter((d) => distinctive(d).some((w) => words.includes(w)));
  }
  if (!hits.length && words.length <= 2) {
    const last = words[words.length - 1];
    if (LAMP_WORDS.test(last) || last === 'everything') hits = devices.filter((d) => d.kind !== 'music');
    else if (MUSIC_WORDS.test(last)) hits = devices.filter((d) => d.kind === 'music');
  }
  if (!hits.length) return null;
  const all = hits.map(stateOf);
  const line = all.length === 1 ? all[0] : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
  const out = line[0].toUpperCase() + line.slice(1) + '.';
  return hits.every((d) => kindOfAnswer(d) === 'unreachable') ? `I don't know — ${out[0].toLowerCase()}${out.slice(1)}` : out;
}
