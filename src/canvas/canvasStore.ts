// Loading the saved layout without ever destroying it.
//
// The layout (localStorage `mc.canvas.v1`: camera, focus, frames, language)
// says where her boards sit; what they show lives in the artifact store. Two
// ways the layout was lost: a stored layout this build could not read was
// treated as "nothing stored", so the first save wrote over it; and ?fresh=1
// deleted it outright (and stayed in the address bar, so any later reload of
// that tab deleted it again). Here:
//  - an unreadable layout is copied, as it was, to its own key before
//    anything else can write — and that copy is never overwritten (a second,
//    different one gets a key of its own, at most MAX_UNREADABLE). If the
//    copy can't be made, the canvas must not save the layout this session
//    (`safe: false`);
//  - a layout that loads only after a repair is copied aside first (the
//    first copy is kept for good; later ones rotate);
//  - ?fresh=1 starts blank only after the saved layout is copied aside (the
//    first copy is kept for good; later ones rotate).
import { coerceLayoutReport, LAYOUT_KEY, type CanvasLayout } from './canvasPersistence';
import { isDevicesPlan } from './connectedDevices';
import type { SurfacePlan } from './surfacePlan';

export const CANVAS_STORAGE_KEY = LAYOUT_KEY;
/** The devices-board frame id, kept beside the layout. */
export const DEVICES_BOARD_KEY = 'mendcraft.devicesBoard';
export const UNREADABLE_KEY = `${LAYOUT_KEY}.unreadable`;
export const BEFORE_FRESH_KEY = `${LAYOUT_KEY}.beforeFresh`;
export const BEFORE_REPAIR_KEY = `${LAYOUT_KEY}.beforeRepair`;
/** Unreadable layouts kept at most (the first under UNREADABLE_KEY). */
export const MAX_UNREADABLE = 3;
export const UNREADABLE_LINE = 'Couldn’t open your saved boards — they’re kept safe.';
export const UNSAVED_LINE = 'Couldn’t open your saved boards, and changes in this session won’t be saved.';

type Store = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem' | 'key'>> & { length?: number };

export interface LoadedLayout {
  /** The saved layout, or null when there was none or it couldn't be read. */
  layout: CanvasLayout | null;
  /** A saved layout was there but this build couldn't read it. */
  unreadable: boolean;
  /** False only when an unreadable layout could NOT be copied aside: then
   *  the canvas must never write the layout key this session. */
  safe: boolean;
  /** What was repaired to load it. */
  repaired?: string[];
}

const read = (s: Store, k: string): string | null => { try { return s.getItem(k); } catch { return null; } };
const write = (s: Store, k: string, v: string): boolean => {
  try { s.setItem(k, v); return s.getItem(k) === v; } catch { return false; }
};
const empty = (raw: string | null): raw is null => raw === null || raw === '' || raw === 'null';

/** Copy `raw` aside under a key nothing else writes. Never overwrites an
 *  earlier copy; the same text already copied counts as done. At most
 *  MAX_UNREADABLE copies: past that it says false (and nothing is added). */
export function keepUnreadable(storage: Store, raw: string, now: () => number = Date.now): boolean {
  const first = read(storage, UNREADABLE_KEY);
  if (first === raw) return true;
  if (first === null) return write(storage, UNREADABLE_KEY, raw);
  const extra: string[] = [];
  try {
    for (let i = 0; i < (storage.length ?? 0); i++) { const k = storage.key?.(i); if (k && k.startsWith(`${UNREADABLE_KEY}.`)) extra.push(k); }
  } catch { /* can't list: count what we can see */ }
  if (extra.some((k) => read(storage, k) === raw)) return true;
  if (1 + extra.length >= MAX_UNREADABLE) return false;
  for (let i = 0; i < 20; i++) {
    const k = `${UNREADABLE_KEY}.${now()}${i ? `-${i}` : ''}`;
    if (read(storage, k) === null) return write(storage, k, raw);
  }
  return false;
}

/** Three slots for a copy: the first is kept for good; slots 2–3 hold the
 *  latest two others (newest in slot 2). The same text already there counts
 *  as kept. False when the copy could not be written. */
const slotsOf = (key: string) => [key, `${key}.2`, `${key}.3`] as const;
export function keepRotating(storage: Store, key: string, raw: string): boolean {
  const slots = slotsOf(key);
  const there = slots.map((k) => read(storage, k));
  if (there.includes(raw)) return true;
  if (there[0] === null) return write(storage, slots[0], raw);
  if (there[1] !== null && !write(storage, slots[2], there[1])) return false;
  return write(storage, slots[1], raw);
}
/** The ?fresh copies (first kept for good; later ones rotate). */
export const FRESH_SLOTS = slotsOf(BEFORE_FRESH_KEY);
/** The copies made before a repaired layout is saved over. */
export const REPAIR_SLOTS = slotsOf(BEFORE_REPAIR_KEY);

export function loadLayout(storage: Store | null, key: string = CANVAS_STORAGE_KEY, log: (line: string) => void = (l) => console.warn(l)): LoadedLayout {
  const raw = storage ? read(storage, key) : null;
  if (!storage || empty(raw)) return { layout: null, unreadable: false, safe: true };
  let report: ReturnType<typeof coerceLayoutReport> = { layout: null, repaired: [] };
  try { report = coerceLayoutReport(JSON.parse(raw)); } catch { /* not JSON */ }
  if (!report.layout) return { layout: null, unreadable: true, safe: keepUnreadable(storage, raw) };
  if (!report.repaired.length) return { layout: report.layout, unreadable: false, safe: true };
  // Loaded after a repair: the raw text goes aside before any save.
  const kept = keepRotating(storage, BEFORE_REPAIR_KEY, raw);
  log(`[mendcraft] saved boards repaired on load: ${report.repaired.join(', ')} ${kept
    ? `(the saved text is kept under ${BEFORE_REPAIR_KEY})`
    : '(the saved text could not be copied aside)'}`);
  return { layout: report.layout, unreadable: false, safe: true, repaired: report.repaired };
}

/** The one line said when the saved layout couldn't be opened (null: none). */
export function loadLine(loaded: LoadedLayout): string | null {
  if (!loaded.unreadable) return null;
  return loaded.safe ? UNREADABLE_LINE : UNSAVED_LINE;
}

/** The devices-board frame from the key kept beside the layout — trusted
 *  only when that frame really holds the devices list (a stale key, or one
 *  whose id a new board later took, must never turn her board into it). */
export function resolveDevicesBoard(surfaces: Record<string, SurfacePlan> | null | undefined, legacy: string | null): string | null {
  return legacy && surfaces && isDevicesPlan(surfaces[legacy]) ? legacy : null;
}

/** ?fresh=1: copy the saved layout aside, then clear it (and the
 *  devices-board marker that belonged to it). A layout with no boards isn't
 *  worth a copy. Returns false (and clears nothing) when the copy failed. */
export function startFresh(storage: Store, key: string = CANVAS_STORAGE_KEY, extraKeys: readonly string[] = []): boolean {
  const raw = read(storage, key);
  if (!empty(raw)) {
    let layout: CanvasLayout | null = null;
    try { layout = coerceLayoutReport(JSON.parse(raw)).layout; } catch { layout = null; }
    if (!layout) { if (!keepUnreadable(storage, raw)) return false; }
    else if (layout.frames.length && !keepRotating(storage, BEFORE_FRESH_KEY, raw)) return false;
  }
  for (const k of [key, ...extraKeys]) { try { storage.removeItem?.(k); } catch { /* nothing to clear */ } }
  return true;
}

/** The address without ?fresh, so reloading this tab later never wipes
 *  what she built in it. null when there is nothing to strip. */
export function withoutFresh(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has('fresh')) return null;
  u.searchParams.delete('fresh');
  return `${u.pathname}${u.search}${u.hash}`;
}

/** The ?fresh boot step: is this open really fresh (the saved layout was
 *  copied aside and cleared), and the address to show instead. A failed
 *  copy means NOT fresh — nothing is reset. */
export function openFresh(storage: Store | null, href: string): { fresh: boolean; url: string | null } {
  const url = withoutFresh(href);
  if (url === null) return { fresh: false, url: null };
  if (!storage) return { fresh: true, url };
  return { fresh: startFresh(storage, CANVAS_STORAGE_KEY, [DEVICES_BOARD_KEY]), url };
}
