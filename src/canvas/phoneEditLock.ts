// Look-to-edit lock for the phone canvas. Touch works by default. Look-to-edit
// is opt-in (persisted flag); only when it is on AND a face has been seen and
// then gone for LOOK_AWAY_LOCK_MS does the board lock. An unknown, denied or
// absent face signal (facing === null) never locks.
// Pure: no DOM, no camera, no Relay — those are injected by the host.

export const LOOK_AWAY_LOCK_MS = 3000;
export const LOOK_TO_EDIT_HINT = 'Look at me to edit';
export const LOOK_TO_EDIT_KEY = 'mc.lookToEdit';

/** Persisted opt-in. Off unless explicitly '1'. */
export function readLookToEdit(storage?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return s?.getItem(LOOK_TO_EDIT_KEY) === '1';
  } catch { return false; }
}

export interface PhoneEditLockInput {
  /** Whether touch editing is currently unlocked. */
  unlocked: boolean;
  /** User opted in to look-to-edit. Off => never locks. */
  enabled: boolean;
  /** true = face present, false = known absent, null = unknown/denied/no signal. */
  facing: boolean | null;
  /** A face has been seen since the signal started. */
  faceSeen: boolean;
  now: number;
  /** When facing last went false while unlocked, or null. */
  awaySince: number | null;
  /** Override the re-lock delay in tests. */
  awayMs?: number;
}

export interface PhoneEditLockResult {
  unlocked: boolean;
  faceSeen: boolean;
  awaySince: number | null;
  /** Shown only while locked. */
  hint: string | null;
}

export function nextPhoneEditLock(input: PhoneEditLockInput): PhoneEditLockResult {
  const open = (faceSeen: boolean): PhoneEditLockResult => ({ unlocked: true, faceSeen, awaySince: null, hint: null });
  if (!input.enabled) return open(false);
  if (input.facing === true) return open(true);
  // Unknown signal (denied, no camera, backgrounded): never lock, start over.
  if (input.facing === null) return open(false);
  // facing === false: known absent. Only matters once a face has been seen.
  if (!input.faceSeen) return open(false);
  if (!input.unlocked) {
    return { unlocked: false, faceSeen: true, awaySince: null, hint: LOOK_TO_EDIT_HINT };
  }
  const since = input.awaySince ?? input.now;
  const wait = input.awayMs ?? LOOK_AWAY_LOCK_MS;
  if (input.now - since >= wait) {
    return { unlocked: false, faceSeen: true, awaySince: null, hint: LOOK_TO_EDIT_HINT };
  }
  return { unlocked: true, faceSeen: true, awaySince: since, hint: null };
}
