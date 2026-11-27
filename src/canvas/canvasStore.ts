// Loading the saved canvas without ever destroying it.
//
// Two ways her boards were lost: a stored doc this build could not read was
// treated as "nothing stored", so the first save of the default board wrote
// over it; and ?fresh=1 deleted the saved doc outright (and stayed in the
// address bar, so any later reload of that tab deleted it again). Here:
//  - an unreadable doc is copied, as it was, to its own key before anything
//    else can write — and that copy is never overwritten (a second, different
//    unreadable doc gets a key of its own, at most MAX_UNREADABLE). If the
//    copy can't be made, the canvas must not save over the original at all
//    (`safe: false`);
//  - a doc that loads only after a repair is copied aside first (the first
//    copy is never overwritten; later ones rotate, at most 3);
//  - ?fresh=1 starts blank only after the saved doc is copied aside (the
//    first copy is never overwritten; later ones rotate).
import { parseCanvasDocReport, type CanvasDoc } from './frames';
import { isDevicesPlan } from './connectedDevices';

export const CANVAS_STORAGE_KEY = 'mc.canvas.v1';
/** Where older builds kept the devices-board frame id, beside the doc. Read
 *  once to migrate (only when that frame really holds the devices list). */
export const LEGACY_DEVICES_BOARD_KEY = 'mendcraft.devicesBoard';
export const UNREADABLE_KEY = 'mc.canvas.v1.unreadable';
export const BEFORE_FRESH_KEY = 'mc.canvas.v1.beforeFresh';
export const BEFORE_REPAIR_KEY = 'mc.canvas.v1.beforeRepair';
/** Unreadable docs kept at most (the first under UNREADABLE_KEY). */
export const MAX_UNREADABLE = 3;
export const UNREADABLE_LINE = 'Couldn’t open your saved boards — they’re kept safe.';
export const UNSAVED_LINE = 'Couldn’t open your saved boards, and changes in this session won’t be saved.';

type Store = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem' | 'key'>> & { length?: number };

export interface LoadedCanvas {
  /** The saved doc, or null when there was none or it couldn't be read. */
  doc: CanvasDoc | null;
  /** A saved doc was there but this build couldn't read it. */
  unreadable: boolean;
  /** False only when an unreadable doc could NOT be copied aside: then the
   *  canvas must never write the main key this session. */
  safe: boolean;
  /** What was repaired to load it (the raw text was copied aside first). */
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

export function loadCanvasDoc(storage: Store, key: string, log: (line: string) => void = (l) => console.warn(l)): LoadedCanvas {
  const raw = read(storage, key);
  if (empty(raw)) return { doc: null, unreadable: false, safe: true };
  let report: ReturnType<typeof parseCanvasDocReport> = { doc: null, repaired: [] };
  try { report = parseCanvasDocReport(JSON.parse(raw)); } catch { /* not JSON */ }
  if (!report.doc) return { doc: null, unreadable: true, safe: keepUnreadable(storage, raw) };
  if (!report.repaired.length) return { doc: report.doc, unreadable: false, safe: true };
  // Loaded after a repair: the raw text goes aside, before any save.
  const kept = keepBeforeRepair(storage, raw);
  log(`[mendcraft] saved boards repaired on load: ${report.repaired.join(', ')} (${kept ? `the saved text is kept under ${kept}` : 'the saved text could not be kept aside'})`);
  return { doc: report.doc, unreadable: false, safe: true, repaired: report.repaired };
}

/** The beforeRepair copies, like the ?fresh ones: the first is kept for
 *  good; slots 2–3 hold the latest two other repaired docs (newest in 2). */
export const REPAIR_SLOTS = [BEFORE_REPAIR_KEY, `${BEFORE_REPAIR_KEY}.2`, `${BEFORE_REPAIR_KEY}.3`] as const;

/** Copy a repaired doc's raw text aside. The key that holds it, or null
 *  when it could not be kept (never claims a slot holding other text). */
function keepBeforeRepair(storage: Store, raw: string): string | null {
  const i = keepInSlots(storage, REPAIR_SLOTS, raw);
  return i === null ? null : REPAIR_SLOTS[i];
}

/** First slot never overwritten; slots 2–3 rotate (newest in slot 2). The
 *  index of the slot that holds `raw` afterwards, or null on a failed write. */
function keepInSlots(storage: Store, slots: readonly string[], raw: string): number | null {
  const there = slots.map((k) => read(storage, k));
  const at = there.indexOf(raw);
  if (at >= 0) return at;
  if (there[0] === null) return write(storage, slots[0], raw) ? 0 : null;
  if (there[1] !== null && !write(storage, slots[2], there[1])) return null;
  return write(storage, slots[1], raw) ? 1 : null;
}

/** The one line said when the saved doc couldn't be opened (null: none). */
export function loadLine(loaded: LoadedCanvas): string | null {
  if (!loaded.unreadable) return null;
  return loaded.safe ? UNREADABLE_LINE : UNSAVED_LINE;
}

/** The devices-board frame: the id in the doc, else (older builds) the key
 *  kept beside it — trusted only when that frame really holds the devices list. */
export function resolveDevicesBoard(doc: CanvasDoc | null, legacy: string | null): string | null {
  if (!doc) return null;
  if (doc.devicesBoard) return doc.devicesBoard;
  return legacy && isDevicesPlan(doc.surfaces[legacy]) ? legacy : null;
}

/** The ?fresh copies: the first is kept for good; later ones rotate here. */
export const FRESH_SLOTS = [BEFORE_FRESH_KEY, `${BEFORE_FRESH_KEY}.2`, `${BEFORE_FRESH_KEY}.3`] as const;

/** Copy a doc aside before ?fresh. The first slot is never overwritten;
 *  slots 2–3 hold the latest two others (newest in slot 2). */
function keepBeforeFresh(storage: Store, raw: string): boolean {
  return keepInSlots(storage, FRESH_SLOTS, raw) !== null;
}

/** ?fresh=1: copy the saved doc aside, then clear it (and the devices-board
 *  marker that belonged to it). A doc with no boards isn't worth a copy.
 *  Returns false (and clears nothing) when the copy failed. */
export function startFresh(storage: Store, key: string, extraKeys: readonly string[] = []): boolean {
  const raw = read(storage, key);
  if (!empty(raw)) {
    let doc: CanvasDoc | null = null;
    try { doc = parseCanvasDocReport(JSON.parse(raw)).doc; } catch { doc = null; }
    if (!doc) { if (!keepUnreadable(storage, raw)) return false; }
    else if (doc.frames.length && !keepBeforeFresh(storage, raw)) return false;
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

/** The ?fresh boot step: is this open really fresh (the saved doc was copied
 *  aside and cleared), and the address to show instead. A failed copy means
 *  NOT fresh — nothing beside the doc (what she took off boards) is reset. */
export function openFresh(storage: Store | null, href: string): { fresh: boolean; url: string | null } {
  const url = withoutFresh(href);
  if (url === null) return { fresh: false, url: null };
  if (!storage) return { fresh: true, url };
  return { fresh: startFresh(storage, CANVAS_STORAGE_KEY, [LEGACY_DEVICES_BOARD_KEY]), url };
}
