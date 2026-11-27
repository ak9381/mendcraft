// Demo kit: a seeded project, a warm-up hook, and a slot for a backup video.

export const SHARMA_HOUSE = 'Sharma House';
export const BACKUP_VIDEO_KEY = 'mendcraft:demo-backup-video';
export const WARMUP_PROMPT = 'draw a room';

/** Site boundary and levels, no rooms — ready for the on-stage first wall. */
export function sharmaHouseOps(): Record<string, unknown>[] {
  const t = 200;
  const w = 20_000;
  const h = 15_000;
  return [
    { op: 'add_wall', a: { x: 0, y: 0 }, b: { x: w, y: 0 }, thickness: t },
    { op: 'add_wall', a: { x: w, y: 0 }, b: { x: w, y: h }, thickness: t },
    { op: 'add_wall', a: { x: w, y: h }, b: { x: 0, y: h }, thickness: t },
    { op: 'add_wall', a: { x: 0, y: h }, b: { x: 0, y: 0 }, thickness: t },
    { op: 'add_text', x: w / 2, y: -900, text: 'Sharma House · site', size: 400 },
    { op: 'add_text', x: 600, y: 600, text: 'Level 0', size: 250 },
    { op: 'add_text', x: 600, y: h - 600, text: 'Level 1 · 3.0 m', size: 250 },
  ];
}

export function isSharmaHousePrompt(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  return t === 'sample house' || t === 'sharma house' || t === 'load the sample house' || t === 'load sharma house';
}

export function backupVideoUrl(store: { getItem(k: string): string | null }): string | null {
  const v = store.getItem(BACKUP_VIDEO_KEY)?.trim() ?? '';
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const BACKUP_VIDEO_SLOT_LABEL = 'Backup video, cued to each demo beat';
export const WARMUP_HINT = 'Warm Quick with one throwaway request before going on stage.';
