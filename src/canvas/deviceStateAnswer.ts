// "is the lamp on?": answered from the device store, never guessed by chat
// (the chat model cannot see the devices). Pure: the live refs in, one line out.
import type { DeviceRef } from './deviceCommands';

const norm = (text: string): string => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** "is the lamp on", "are the lights off?", "is the desk lamp still on",
 *  "is the music playing", "is my speaker on" — the thing asked about and the state. */
const ASK = /^(?:(?:hey|ok|okay|so|and|mendcraft)\s+)*(?:is|are)\s+(?:the\s+|my\s+|all\s+the\s+|both\s+(?:the\s+)?)?(.+?)\s+(?:still\s+|currently\s+|already\s+)?(on|off|playing|paused|working|answering)(?:\s+(?:now|right now|still))?$/;

const LAMP_WORDS = /^(?:lamps?|lights?|bulbs?)$/;
const MUSIC_WORDS = /^(?:music|song|speakers?|player)$/;

function lower(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

function stateOf(d: DeviceRef): string {
  const name = `the ${lower(d.label)}`;
  if (d.unreachable) return `${name} isn't answering`;
  if (d.kind === 'music') return `${name} is ${d.playing ? 'playing' : 'not playing'}`;
  return `${name} is ${d.on ? 'on' : 'off'}`;
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
  return hits.every((d) => d.unreachable) ? `I don't know — ${out[0].toLowerCase()}${out.slice(1)}` : out;
}
