// User-facing one-liners for failure + rollback. Shared so the terminals,
// spoken status, and tests agree on the exact wording.

export const QUOTA_SAVE_LINE =
  "Couldn't save on this device (storage is full) — the board is still here until you leave.";

export const OFFLINE_MID_LINE =
  'Went offline mid-request — the last board is unchanged.';

export const INCOMPLETE_KN_LINE =
  'Kannada pack was incomplete — still in English.';

export const CAMERA_LOST_REGISTER =
  "Camera was lost — you aren't re-registered.";

export const CAMERA_LOST_TEACH =
  'Camera was lost — nothing was saved. Try again.';

export const PHONE_DROP_LINE =
  'Phone disconnected — this canvas is unchanged.';

export const PHONE_DROP_UNDONE =
  'Phone disconnected — last command was undone.';

export const MORPH_UNVERIFIED_LINE =
  "Couldn't apply that — the tile is unchanged.";

export function phoneDropLine(undone: boolean): string {
  return undone ? PHONE_DROP_UNDONE : PHONE_DROP_LINE;
}

export function saveSpokenLine(ok: boolean, title: string | null, savedAt: string): string {
  return ok
    ? (title ? `Saved ${title} at ${savedAt}.` : `Saved the canvas at ${savedAt}.`)
    : QUOTA_SAVE_LINE;
}

export function tryWriteStorage(
  storage: { setItem(k: string, v: string): void },
  key: string,
  value: string,
): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
