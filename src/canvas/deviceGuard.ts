// Limits a device intent must respect, shared by the store (last line of
// defence) and the try-to-break turn. Out-of-range values are refused with a
// plain reason — never clamped into something the person did not ask for.
export const LAMP_RANGE_REFUSAL = 'Lamps go from 10 to 100 %. Nothing changed.';

/** Brightness / volume must be a real number in 0..100. */
export const levelInRange = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100;
