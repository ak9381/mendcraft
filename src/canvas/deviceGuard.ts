// Limits a device intent must respect, shared by the store (last line of
// defence) and the try-to-break turn. Out-of-range values are refused with a
// plain reason — never clamped into something the person did not ask for.
import { isWizScene } from '../devices/wiz';

export const LAMP_RANGE_REFUSAL = 'Lamps go from 10 to 100 %. Nothing changed.';
export const VOLUME_RANGE_REFUSAL = 'Volume goes from 0 to 100 %. Nothing changed.';

/** Lamp brightness: off (0) or 10..100. */
export const lampLevelOk = (n: number): boolean => Number.isFinite(n) && (n === 0 || (n >= 10 && n <= 100));
/** Volume: 0..100. */
export const volumeLevelOk = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100;

export const TEMP_RANGE_REFUSAL = 'White goes from 2200 to 6500 K. Nothing changed.';
export const COLOUR_RANGE_REFUSAL = 'Each colour value goes from 0 to 255. Nothing changed.';
export const SCENE_REFUSAL = 'That is not a scene this lamp knows. Nothing changed.';

/** White colour temperature: 2200..6500 K. */
export const tempOk = (n: number): boolean => Number.isFinite(n) && n >= 2200 && n <= 6500;
/** One RGB channel: a whole number 0..255. */
export const byteOk = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255;
export const rgbOk = (c: { r: number; g: number; b: number } | null | undefined): boolean => !!c && byteOk(c.r) && byteOk(c.g) && byteOk(c.b);

/** The refusal reason for an intent's levels, or null when they are fine. */
export function levelRefusal(i: { brightness?: number; volume?: number; temp?: number; rgb?: { r: number; g: number; b: number }; sceneId?: number }): string | null {
  if (i.brightness !== undefined && !lampLevelOk(i.brightness)) return LAMP_RANGE_REFUSAL;
  if (i.volume !== undefined && !volumeLevelOk(i.volume)) return VOLUME_RANGE_REFUSAL;
  if (i.temp !== undefined && !tempOk(i.temp)) return TEMP_RANGE_REFUSAL;
  if (i.rgb !== undefined && !rgbOk(i.rgb)) return COLOUR_RANGE_REFUSAL;
  if (i.sceneId !== undefined && !isWizScene(i.sceneId)) return SCENE_REFUSAL;
  return null;
}

/** Where a relative brighter/dimmer step lands: 10..100 (a dimmer at the floor
 *  stays at 10; off is only ever an explicit "off"). */
export const lampStep = (n: number): number => Math.max(10, Math.min(100, Math.round(n)));

// ---- the fixed tables a generated control is checked against (never generated) ----

/** The device classes a board tile can bind to. */
export type DeviceClass = 'lamp' | 'music' | 'switch' | 'gimbal';
export const DEVICE_CLASSES: readonly DeviceClass[] = ['lamp', 'music', 'switch', 'gimbal'];
/** The only intent keys a control on a tile of each class may carry. */
export const CLASS_INTENTS: Record<DeviceClass, readonly string[]> = {
  lamp: ['on', 'brightness', 'temp', 'rgb', 'sceneId'],
  music: ['playing', 'volume', 'next', 'previous'],
  switch: ['on'],
  gimbal: ['gimbalMode', 'gimbalCue'],
};
/** A slider's range comes from here; a model never writes min or max. */
export const RANGES = { brightness: [10, 100], volume: [0, 100], temp: [2200, 6500] } as const;
