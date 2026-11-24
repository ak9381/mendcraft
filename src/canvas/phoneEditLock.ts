// Look-to-edit lock for the phone canvas. A board can arrive over Relay
// immediately, but touch editing stays locked until the existing look-to-sync
// facing signal is true. Looking away for LOOK_AWAY_LOCK_MS re-locks.
// Pure: no DOM, no camera, no Relay — those are injected by the host.

export const LOOK_AWAY_LOCK_MS = 3000;
export const LOOK_TO_EDIT_HINT = 'Look at me to edit';

export interface PhoneEditLockInput {
  /** Whether touch editing is currently unlocked. */
  unlocked: boolean;
  /** Existing look-to-sync / FaceLandmarker "facing this device" bit. */
  facing: boolean;
  now: number;
  /** When facing last went false while unlocked, or null. */
  awaySince: number | null;
  /** Override the re-lock delay in tests. */
  awayMs?: number;
}

export interface PhoneEditLockResult {
  unlocked: boolean;
  awaySince: number | null;
  /** Shown only while locked. */
  hint: string | null;
}

export function nextPhoneEditLock(input: PhoneEditLockInput): PhoneEditLockResult {
  if (input.facing) {
    return { unlocked: true, awaySince: null, hint: null };
  }
  if (!input.unlocked) {
    return { unlocked: false, awaySince: null, hint: LOOK_TO_EDIT_HINT };
  }
  const since = input.awaySince ?? input.now;
  const wait = input.awayMs ?? LOOK_AWAY_LOCK_MS;
  if (input.now - since >= wait) {
    return { unlocked: false, awaySince: null, hint: LOOK_TO_EDIT_HINT };
  }
  return { unlocked: true, awaySince: since, hint: null };
}
