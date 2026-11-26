// Loading the saved canvas without ever destroying it.
//
// Two ways her boards were lost: a stored doc this build could not read was
// treated as "nothing stored", so the first save of the default board wrote
// over it; and ?fresh=1 deleted the saved doc outright (and stayed in the
// address bar, so any later reload of that tab deleted it again). Here:
//  - an unreadable doc is copied, as it was, to its own key before anything
//    else can write — and that copy is never overwritten (a second, different
//    unreadable doc gets a key of its own). If the copy can't be made, the
//    canvas must not save over the original at all (`safe: false`);
//  - ?fresh=1 starts blank only after the saved doc is copied aside.
import { parseCanvasDoc, type CanvasDoc } from './frames';

export const CANVAS_STORAGE_KEY = 'mc.canvas.v1';
/** Where older builds kept the devices-board frame id, beside the doc. Read
 *  once to migrate (only when that frame really holds the devices list). */
export const LEGACY_DEVICES_BOARD_KEY = 'mendcraft.devicesBoard';
export const UNREADABLE_KEY = 'mc.canvas.v1.unreadable';
export const BEFORE_FRESH_KEY = 'mc.canvas.v1.beforeFresh';
export const UNREADABLE_LINE = 'Couldn’t open your saved boards — they’re kept safe.';

type Store = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

export interface LoadedCanvas {
  /** The saved doc, or null when there was none or it couldn't be read. */
  doc: CanvasDoc | null;
  /** A saved doc was there but this build couldn't read it. */
  unreadable: boolean;
  /** False only when an unreadable doc could NOT be copied aside: then the
   *  canvas must never write the main key this session. */
  safe: boolean;
}

const read = (s: Store, k: string): string | null => { try { return s.getItem(k); } catch { return null; } };
const write = (s: Store, k: string, v: string): boolean => {
  try { s.setItem(k, v); return s.getItem(k) === v; } catch { return false; }
};

/** Copy `raw` aside under a key nothing else writes. Never overwrites an
 *  earlier copy; the same text already copied counts as done. */
export function keepUnreadable(storage: Store, raw: string, now: () => number = Date.now): boolean {
  const first = read(storage, UNREADABLE_KEY);
  if (first === raw) return true;
  if (first === null) return write(storage, UNREADABLE_KEY, raw);
  for (let i = 0; i < 20; i++) {
    const k = `${UNREADABLE_KEY}.${now()}${i ? `-${i}` : ''}`;
    const there = read(storage, k);
    if (there === raw) return true;
    if (there === null) return write(storage, k, raw);
  }
  return false;
}

export function loadCanvasDoc(storage: Store, key: string): LoadedCanvas {
  const raw = read(storage, key);
  if (raw === null || raw === '' || raw === 'null') return { doc: null, unreadable: false, safe: true };
  let doc: CanvasDoc | null = null;
  try { doc = parseCanvasDoc(JSON.parse(raw)); } catch { doc = null; }
  if (doc) return { doc, unreadable: false, safe: true };
  return { doc: null, unreadable: true, safe: keepUnreadable(storage, raw) };
}

/** ?fresh=1: copy the saved doc aside, then clear it (and the devices-board
 *  marker that belonged to it). A doc with no boards isn't worth a copy and
 *  never replaces one that has boards. Returns false (and clears nothing)
 *  when the copy failed. */
export function startFresh(storage: Store, key: string, extraKeys: readonly string[] = []): boolean {
  const raw = read(storage, key);
  if (raw !== null && raw !== '' && raw !== 'null') {
    let doc: CanvasDoc | null = null;
    try { doc = parseCanvasDoc(JSON.parse(raw)); } catch { doc = null; }
    if (!doc) { if (!keepUnreadable(storage, raw)) return false; }
    else if (doc.frames.length && !write(storage, BEFORE_FRESH_KEY, raw)) return false;
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
