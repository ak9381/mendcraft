// 20-phrase device-voice eval — scores the same path the canvas uses in sim
// (Kannada pack phrases first, then parseDeviceCommands). Pure, no DOM.
import { parseDeviceCommands, type DeviceRef } from '../canvas/deviceCommands';
import { routePackPhrase, type IntentKey, type LanguagePack } from '../canvas/languagePack';
import type { DeviceIntent } from '../canvas/deviceActions';

/** Fixed room used by the 20-phrase eval and its tests. */
export const EVAL_DEVICES: DeviceRef[] = [
  { id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp', on: true, brightness: 40 },
  { id: 'wiz-ceiling', label: 'Ceiling light', kind: 'lamp', on: true, brightness: 70 },
  { id: 'speaker-1', label: 'Speaker', kind: 'music', playing: true, volume: 40 },
];

const DEVICE_INTENTS: ReadonlySet<IntentKey> = new Set(['lampOn', 'lampOff', 'brighter', 'dimmer']);

export interface DeviceVoiceCase {
  text: string;
  expect: string;
  gloss?: string;
  tags?: string[];
}

export interface DeviceVoiceCaseResult {
  text: string;
  expect: string;
  got: string;
  pass: boolean;
}

export interface DeviceVoiceScore {
  total: number;
  correct: number;
  accuracy: number;
  results: DeviceVoiceCaseResult[];
}

/** Serialize a parse result the way the eval compares (stable, exact). */
export function labelIntents(intents: readonly DeviceIntent[]): string {
  return intents
    .map((i) => {
      const bits: string[] = [i.deviceId];
      if (i.on === true) bits.push('on');
      if (i.on === false) bits.push('off');
      if (typeof i.brightness === 'number') bits.push(`b${i.brightness}`);
      if (typeof i.temp === 'number') bits.push(`t${i.temp}`);
      if (i.rgb) bits.push(`c${i.rgb.r},${i.rgb.g},${i.rgb.b}`);
      if (typeof i.sceneId === 'number') bits.push(`s${i.sceneId}`);
      if (i.previous) bits.push('prev');
      if (i.playing === true) bits.push('play');
      if (i.playing === false) bits.push('pause');
      if (i.next) bits.push('next');
      if (typeof i.volume === 'number') bits.push(`v${i.volume}`);
      return bits.join(':');
    })
    .join('|');
}

/** The canvas run() path for device speech: pack phrases, then the English parser. */
export function resolveDeviceVoice(
  text: string,
  devices: readonly DeviceRef[] = EVAL_DEVICES,
  pack: LanguagePack | null = null,
): string {
  if (pack) {
    const intent = routePackPhrase(text, pack);
    if (intent && DEVICE_INTENTS.has(intent)) return `intent:${intent}`;
  }
  const parsed = parseDeviceCommands(text, devices);
  return parsed ? labelIntents(parsed.intents) : 'none';
}

export function scoreDeviceVoice(
  cases: readonly DeviceVoiceCase[],
  devices: readonly DeviceRef[] = EVAL_DEVICES,
  pack: LanguagePack | null = null,
): DeviceVoiceScore {
  const results = cases.map((c) => {
    const got = resolveDeviceVoice(c.text, devices, pack);
    return { text: c.text, expect: c.expect, got, pass: got === c.expect };
  });
  const correct = results.filter((r) => r.pass).length;
  return {
    total: results.length,
    correct,
    accuracy: results.length ? correct / results.length : 0,
    results,
  };
}
