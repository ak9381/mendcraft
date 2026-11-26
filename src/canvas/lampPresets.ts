// One-press presets for the lamp and speaker tiles (and the voice grammar).
// A hand user aims the palm highlight at a chip and presses it with a held
// thumbs-up, so every value here is a whole action: no dragging, no slider.
// Pure data + lookups; the WiZ scene ids come from src/devices/wiz.ts.
import type { DeviceIntent } from './deviceActions';
import { TEMP_MAX, TEMP_MIN, WIZ_SCENES } from '../devices/wiz';

/** One − / + press on the lamp tile's brightness. */
export const LAMP_TILE_STEP = 10;
/** One − / + press on the speaker tile's volume. */
export const VOLUME_TILE_STEP = 10;
/** One warmer / cooler press (and the spoken "warmer" / "cooler"), in Kelvin. */
export const TEMP_STEP = 500;
/** Where a lamp with no known white starts from. */
export const TEMP_DEFAULT = 4000;

export interface ColourPreset {
  key: string;
  label: string;
  /** What the swatch shows. */
  swatch: string;
  /** A real colour (RGB mode) … */
  rgb?: { r: number; g: number; b: number };
  /** … or a white (colour-temperature mode), in Kelvin. */
  temp?: number;
}

/** The colour row: two whites, then six colours. */
export const LAMP_COLOURS: readonly ColourPreset[] = [
  { key: 'warm-white', label: 'Warm white', swatch: '#FFD9A0', temp: 2700 },
  { key: 'daylight', label: 'Daylight', swatch: '#EAF1FF', temp: 5000 },
  { key: 'red', label: 'Red', swatch: '#E5372B', rgb: { r: 255, g: 0, b: 0 } },
  { key: 'orange', label: 'Orange', swatch: '#F28A1E', rgb: { r: 255, g: 120, b: 0 } },
  { key: 'yellow', label: 'Yellow', swatch: '#F2CF1E', rgb: { r: 255, g: 200, b: 0 } },
  { key: 'green', label: 'Green', swatch: '#2FA84F', rgb: { r: 0, g: 255, b: 0 } },
  { key: 'blue', label: 'Blue', swatch: '#2F6FE0', rgb: { r: 0, g: 0, b: 255 } },
  { key: 'purple', label: 'Purple', swatch: '#8E44D6', rgb: { r: 160, g: 0, b: 255 } },
];

export interface ScenePreset { key: string; label: string; sceneId: number }
/** The scenes row (WiZ sceneId values). */
export const LAMP_SCENES: readonly ScenePreset[] = [
  { key: 'relax', label: 'Relax', sceneId: 16 },
  { key: 'focus', label: 'Focus', sceneId: 15 },
  { key: 'cozy', label: 'Cozy', sceneId: 6 },
  { key: 'night-light', label: 'Night light', sceneId: 14 },
  { key: 'sunset', label: 'Sunset', sceneId: 3 },
  { key: 'party', label: 'Party', sceneId: 4 },
];


/** A form "slider" field as discrete controls: a round step (about a tenth of
 *  the range) for − / +, and five evenly spaced preset chips, min to max. */
export function rangeStep(min: number, max: number): number {
  const raw = Math.abs(max - min) / 10;
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  return (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * pow;
}
export function rangePresets(min: number, max: number): number[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  const out = [0, 0.25, 0.5, 0.75, 1].map((f) => round(min + (max - min) * f));
  return out.filter((v, i) => out.indexOf(v) === i);
}
/** One − / + press on a range: stays inside [min, max], no float dust. */
export function rangeNudge(value: number, dir: 1 | -1, min: number, max: number): number {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return Math.round(Math.max(lo, Math.min(hi, value + dir * rangeStep(min, max))) * 100) / 100;
}

export const rgbHex =(c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;

/** Where one warmer (−1) / cooler (+1) step lands: always inside 2200–6500 K. */
export const tempStep = (cur: number | undefined, dir: 1 | -1): number =>
  Math.max(TEMP_MIN, Math.min(TEMP_MAX, Math.round((cur && cur > 0 ? cur : TEMP_DEFAULT) + dir * TEMP_STEP)));

/** The intent a colour swatch sends (a white swatch sets the temperature). */
export function colourIntent(deviceId: string, key: string): DeviceIntent | null {
  const c = LAMP_COLOURS.find((x) => x.key === key);
  if (!c) return null;
  return c.rgb ? { deviceId, on: true, rgb: { ...c.rgb } } : { deviceId, on: true, temp: c.temp };
}
export function sceneIntent(deviceId: string, key: string): DeviceIntent | null {
  const s = LAMP_SCENES.find((x) => x.key === key);
  return s ? { deviceId, on: true, sceneId: s.sceneId } : null;
}
/** Which colour swatch matches a lamp's current state ('' = none). */
export function activeColourKey(s: { color?: string; temp?: number; sceneId?: number }): string {
  if (s.sceneId) return '';
  if (s.color) return LAMP_COLOURS.find((c) => c.rgb && rgbHex(c.rgb) === s.color!.toLowerCase())?.key ?? '';
  if (s.temp) return LAMP_COLOURS.find((c) => c.temp === s.temp)?.key ?? '';
  return '';
}

/** A scene's name for the tile's state line. */
export const sceneName = (id: number | undefined): string => (id ? WIZ_SCENES[id] ?? '' : '');

/** "On · 70% · Sunset" / "On · 40% · Blue" / "On · 4000 K" / "Off". */
export function lampStateLine(s: { on: boolean; brightness: number; color?: string; temp?: number; sceneId?: number }): string {
  if (!s.on) return 'Off';
  const parts = ['On', `${s.brightness}%`];
  const scene = sceneName(s.sceneId);
  if (scene) parts.push(scene);
  else if (s.color) parts.push(LAMP_COLOURS.find((c) => c.rgb && rgbHex(c.rgb) === s.color!.toLowerCase())?.label ?? 'Colour');
  else if (s.temp) parts.push(`${s.temp} K`);
  return parts.join(' · ');
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Spoken scene name → WiZ scene id: every scene the bulb knows, longest name first. */
export function sceneFromSpeech(text: string): { sceneId: number; label: string } | null {
  const t = ` ${normName(text)} `;
  const all = Object.entries(WIZ_SCENES)
    .map(([id, label]) => ({ sceneId: Number(id), label, n: normName(label) }))
    .concat([{ sceneId: 6, label: 'Cozy', n: 'cosy' }, { sceneId: 15, label: 'Focus', n: 'reading' }, { sceneId: 15, label: 'Focus', n: 'study' }])
    // "warm white" / "daylight" are whites on the colour row, not scenes, when spoken.
    .filter((s) => s.sceneId !== 11 && s.sceneId !== 12 && s.sceneId !== 13)
    .sort((a, b) => b.n.length - a.n.length);
  const hit = all.find((s) => t.includes(` ${s.n} `));
  return hit ? { sceneId: hit.sceneId, label: hit.label } : null;
}
/** Spoken colour → a colour preset ("violet" is purple). */
export function colourFromSpeech(text: string): ColourPreset | null {
  const t = ` ${normName(text)} `;
  if (t.includes(' warm white ')) return LAMP_COLOURS[0];
  if (t.includes(' daylight ')) return LAMP_COLOURS[1];
  if (t.includes(' violet ')) return LAMP_COLOURS.find((c) => c.key === 'purple')!;
  return LAMP_COLOURS.find((c) => c.rgb && t.includes(` ${c.key} `)) ?? null;
}
