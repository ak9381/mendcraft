// Limits a device intent must respect, shared by the store (last line of
// defence) and the try-to-break turn. Out-of-range values are refused with a
// plain reason — never clamped into something the person did not ask for.
export const LAMP_RANGE_REFUSAL = 'Lamps go from 10 to 100 %. Nothing changed.';
export const VOLUME_RANGE_REFUSAL = 'Volume goes from 0 to 100 %. Nothing changed.';

/** Lamp brightness: off (0) or 10..100. */
export const lampLevelOk = (n: number): boolean => Number.isFinite(n) && (n === 0 || (n >= 10 && n <= 100));
/** Volume: 0..100. */
export const volumeLevelOk = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100;

/** The refusal reason for an intent's levels, or null when they are fine. */
export function levelRefusal(i: { brightness?: number; volume?: number }): string | null {
  if (i.brightness !== undefined && !lampLevelOk(i.brightness)) return LAMP_RANGE_REFUSAL;
  if (i.volume !== undefined && !volumeLevelOk(i.volume)) return VOLUME_RANGE_REFUSAL;
  return null;
}
