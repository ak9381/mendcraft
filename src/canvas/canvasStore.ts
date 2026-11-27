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
import { coerceLayoutReport, LAYOUT_KEY, splitCanvasDoc, type CanvasLayout } from './canvasPersistence';
import type { CanvasDoc } from './frames';
import { frameIdOfArtifactId, type Artifact, type ArtifactBy } from '../artifacts/artifact';

export const CANVAS_STORAGE_KEY = LAYOUT_KEY;
/** The old fixed devices board's frame marker: no longer written (the
 *  devices board is generated now); ?fresh still clears an old one. */
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

/** Said once when the artifact store could not be read: nothing this session
 *  is written to it (or to the layout), so an unread board is never overwritten. */
export const STORE_SAVE_OFF_LINE = 'Changes in this session won’t be saved. Reload to try again.';

/** Said once when saving her boards fails (the browser refused the write). */
export const SAVE_FAIL_LINE = 'Couldn’t save your boards — the browser refused to store them. Your next change tries again.';
/** A save's result → the line to say, once: on the first failure, then not
 *  again until a save has worked. */
export function createSaveFailNotice(): { after(ok: boolean): string | null } {
  let said = false;
  return {
    after(ok) {
      if (ok) { said = false; return null; }
      if (said) return null;
      said = true;
      return SAVE_FAIL_LINE;
    },
  };
}

/** One part of a save that did not happen: a put (and what was stored
 *  before it), a remove (the artifact still stored), or the layout. */
export type SaveFailure = { put: Artifact; prev: Artifact | undefined } | { removed: Artifact } | { layout: true };

/** The session's artifact list after a failed part of a save: a failed put
 *  is known as what was stored before it (so the next save puts it again),
 *  unless a newer save of it has happened since; a failed remove is known as
 *  still stored (so the next save removes it again). */
export function revertFailedSave(artifacts: Artifact[], f: SaveFailure): Artifact[] {
  if ('put' in f) {
    const i = artifacts.findIndex((a) => a.id === f.put.id);
    if (i < 0 || artifacts[i] !== f.put) return artifacts;
    const out = [...artifacts];
    if (f.prev) out[i] = f.prev; else out.splice(i, 1);
    return out;
  }
  if ('removed' in f) return artifacts.some((a) => a.id === f.removed.id) ? artifacts : [...artifacts, f.removed];
  return artifacts;
}

/** Artifacts written one at a time (a connector, next steps): a write the
 *  store refuses is handed back (onFail) and queued, and the next change
 *  (retry, or another keep) writes it again — like a board save. Nothing is
 *  written while `blocked()` (an unread store, an import reloading). */
export interface OneWriter {
  keep(a: Artifact): void;
  retry(): void;
  /** Ids still waiting to be written again. */
  pending(): string[];
}
export function createOneWriter(o: {
  get(): Artifact[];
  set(list: Artifact[]): void;
  put(a: Artifact): Promise<void>;
  blocked(): boolean;
  onOk(): void;
  onFail(f: SaveFailure): void;
}): OneWriter {
  const queued = new Map<string, Artifact>();
  const latest = new Map<string, Artifact>();
  function write(a: Artifact): void {
    const prev = o.get().find((x) => x.id === a.id);
    o.set([...o.get().filter((x) => x.id !== a.id), a]);
    latest.set(a.id, a);
    if (o.blocked()) { queued.set(a.id, a); return; }
    void o.put(a).then(o.onOk, (e) => {
      console.warn(`[mendcraft] couldn't keep ${a.id}: ${e instanceof Error ? e.message : String(e)}`);
      o.onFail({ put: a, prev });
      // Tried again on the next change, unless a newer version came since.
      if (latest.get(a.id) === a) queued.set(a.id, a);
    });
  }
  function retry(): void {
    const list = [...queued.values()];
    queued.clear();
    for (const a of list) write(a);
  }
  return {
    keep(a) { queued.delete(a.id); write(a); retry(); },
    retry,
    pending: () => [...queued.keys()],
  };
}

export interface SaveTargets {
  layoutStorage: Pick<Storage, 'setItem'> | null;
  store: { put(a: Artifact): Promise<void>; remove(id: string): Promise<void> };
  /** The saved layout couldn't be read or copied aside: never write it. */
  layoutBlocked: boolean;
  /** The store couldn't be read: what it holds is unknown, so nothing is
   *  written to it (and the layout, which points at it, is left as it was). */
  storeBlocked: boolean;
  /** A part of this save failed (called later for the store's writes). */
  onFail?: (f: SaveFailure) => void;
  /** A store write of this save worked. */
  onOk?: () => void;
}

/** One save of the canvas document: the layout, then the changed artifacts
 *  (without waiting). Returns the artifacts as the session now knows them. */
export function saveCanvasDoc(doc: CanvasDoc, artifacts: Artifact[], by: (id: string) => ArtifactBy, now: number, keep: ReadonlySet<string>, t: SaveTargets): Artifact[] {
  if (t.storeBlocked) return artifacts;
  const out = splitCanvasDoc(doc, artifacts, by, now, keep);
  // A full localStorage (quota) must not stop the artifacts being kept.
  try { if (!t.layoutBlocked) t.layoutStorage?.setItem(LAYOUT_KEY, JSON.stringify(out.layout)); } catch (e) {
    console.warn(`[mendcraft] couldn't keep the layout: ${e instanceof Error ? e.message : String(e)}`);
    t.onFail?.({ layout: true });
  }
  const gone = new Set(out.remove);
  const put = new Map(out.put.map((a) => [a.id, a]));
  const before = new Map(artifacts.map((a) => [a.id, a]));
  // A write that fails is handed back (onFail), so the session does not count
  // it as stored and the next save tries it again.
  for (const a of out.put) {
    void t.store.put(a).then(() => t.onOk?.(), (e) => {
      console.warn(`[mendcraft] couldn't keep ${a.id}: ${e instanceof Error ? e.message : String(e)}`);
      t.onFail?.({ put: a, prev: before.get(a.id) });
    });
  }
  for (const id of out.remove) {
    const was = before.get(id);
    void t.store.remove(id).then(() => t.onOk?.(), () => { if (was) t.onFail?.({ removed: was }); });
  }
  return [...artifacts.filter((a) => !gone.has(a.id) && !put.has(a.id)), ...put.values()];
}

/** Frame ids new boards must never take: every stored board or drawing the
 *  canvas does not show — and, when the store could not be read, every
 *  frame of the layout (its boards may be stored under those ids). */
export function reservedIds(o: { keepIds: Iterable<string>; loaded: readonly Artifact[]; readFailed: boolean; layout: CanvasLayout | null }): string[] {
  const keep = new Set(o.keepIds);
  const ids = new Set<string>();
  for (const id of keep) { const f = frameIdOfArtifactId(id); if (f) ids.add(f); }
  for (const a of o.loaded) if (keep.has(a.id) && a.kind === 'plan') { const f = (a.data as { frameId?: unknown }).frameId; if (typeof f === 'string') ids.add(f); }
  if (o.readFailed) for (const f of o.layout?.frames ?? []) ids.add(f.id);
  return [...ids];
}

/** Where a test build's ?fresh keeps the stored artifacts it clears. */
export const BEFORE_FRESH_ARTIFACTS_KEY = `${LAYOUT_KEY}.beforeFresh.artifacts`;
/** A store bigger than this (JSON characters, ~1 MB) is not copied into
 *  localStorage: it would crowd out the layout itself. */
export const BEFORE_FRESH_MAX_CHARS = 1_000_000;
/** Test build ?fresh: copy every stored artifact aside — ONE copy, the
 *  newest (older rotation slots are removed) — then clear the store. A store
 *  over BEFORE_FRESH_MAX_CHARS is not copied (the last copy stays) and `log`
 *  says so. A failed read or copy clears nothing (false). An empty store
 *  needs no copy. */
export async function clearStoreForFresh(
  store: { list(): Promise<unknown[]>; clear(): Promise<void> },
  storage: Store | null,
  log: (line: string) => void = (l) => console.warn(l),
): Promise<boolean> {
  let rows: unknown[];
  try { rows = await store.list(); } catch { return false; }
  if (rows.length) {
    const raw = JSON.stringify(rows);
    if (raw.length > BEFORE_FRESH_MAX_CHARS) {
      log(`[mendcraft] ?fresh: the stored artifacts (${(raw.length / 1e6).toFixed(1)} MB) are too big to copy aside; the last copy under ${BEFORE_FRESH_ARTIFACTS_KEY} stays.`);
    } else {
      if (!storage || !write(storage, BEFORE_FRESH_ARTIFACTS_KEY, raw)) return false;
      for (const old of slotsOf(BEFORE_FRESH_ARTIFACTS_KEY).slice(1)) { try { storage.removeItem?.(old); } catch { /* kept */ } }
    }
  }
  try { await store.clear(); return true; } catch { return false; }
}
