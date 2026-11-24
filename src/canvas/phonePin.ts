// "Pin on this device" — PURE over an injected Storage. Pinning captures the
// current board (or dashboard) so the phone keeps showing/working it even when
// the hub goes away or the network drops. The WiZ LAN / existing connector path
// keeps working against the pinned board because it is local. Re-validated
// through coerceSurfacePlan before anything is rendered.

import {
  loadPhonePin,
  savePhonePin,
  clearPhonePin,
  type PhonePin,
  type StorageLike,
} from '../relay/pairingStore';
import { coerceSurfacePlan, type SurfacePlan } from './surfacePlan';

export type { StorageLike } from '../relay/pairingStore';

export interface PinState {
  pinned: boolean;
  /** The pinned board, re-validated; null when unpinned or invalid. */
  board: SurfacePlan | null;
  at?: number;
}

/** Pin the given board locally. `now` is injectable so tests stay deterministic
 *  (and node has no stable clock contract here). */
export function pinBoard(
  storage: StorageLike | null | undefined,
  board: SurfacePlan,
  now = 0,
): PinState {
  const pin: PhonePin = { pinned: true, board, at: now };
  savePhonePin(storage, pin);
  return { pinned: true, board, at: now };
}

/** Remove the pin and the stored board. */
export function unpin(storage: StorageLike | null | undefined): PinState {
  clearPhonePin(storage);
  return { pinned: false, board: null };
}

/** Load the pin, re-validating the stored board through coerceSurfacePlan. A
 *  pin whose board no longer validates is reported as pinned-but-empty rather
 *  than rendering untrusted data. */
export function loadPin(storage: StorageLike | null | undefined): PinState {
  const raw: PhonePin = loadPhonePin(storage);
  if (!raw.pinned) return { pinned: false, board: null };
  if (raw.board === undefined) return { pinned: true, board: null, at: raw.at };
  const coerced = coerceSurfacePlan(raw.board);
  return { pinned: true, board: coerced.ok ? coerced.value : null, at: raw.at };
}

/** Toggle pin: pins `board` when currently unpinned, unpins otherwise. */
export function togglePin(
  storage: StorageLike | null | undefined,
  board: SurfacePlan,
  now = 0,
): PinState {
  return loadPhonePin(storage).pinned ? unpin(storage) : pinBoard(storage, board, now);
}
