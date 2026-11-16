// Best-effort Firestore sync for the site checklist + change log ("site book").
// Same capability-id model as the recipe book: a 24-char random id per browser
// (see firestore.rules, sitebooks/{bookId}). Only metadata syncs — never the
// full document snapshots used for revert. Fails soft: offline or no Firebase
// just leaves the local copy in charge.

import { getFirebaseApp, isFirebaseConfigured } from '../firebase/app';
import { recipeBookId } from '../recipes/sync';
import { mergeEntries, sanitizeEntry, type ChangeLog, type ChangeEntry } from './changeLog';
import { mergeItems, sanitizeItem, type SiteChecklist, type ChecklistItem } from './siteChecklist';

const SITEBOOK_KEY = 'mendcraft.sitebook';
const TIMEOUT_MS = 5000;

/** Stable per-browser site-book id (shares the recipe-book id generator). */
export function siteBookId(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void }): string {
  // recipeBookId stores under its own key; mirror it under ours via a shim.
  const shim = {
    getItem: (k: string) => (k === 'mendcraft.recipebook' ? storage.getItem(SITEBOOK_KEY) : null),
    setItem: (k: string, v: string) => { if (k === 'mendcraft.recipebook') storage.setItem(SITEBOOK_KEY, v); },
  };
  return recipeBookId(shim);
}

export function mergeSiteBook(
  local: { changes: ChangeEntry[]; checklist: ChecklistItem[] },
  remoteRaw: unknown,
): { changes: ChangeEntry[]; checklist: ChecklistItem[] } {
  const r = (remoteRaw && typeof remoteRaw === 'object' ? remoteRaw : {}) as { changes?: unknown; checklist?: unknown };
  const rc = Array.isArray(r.changes) ? r.changes.map(sanitizeEntry).filter((e): e is ChangeEntry => !!e) : [];
  const ri = Array.isArray(r.checklist) ? r.checklist.map(sanitizeItem).filter((x): x is ChecklistItem => !!x) : [];
  return { changes: mergeEntries(local.changes, rc), checklist: mergeItems(local.checklist, ri) };
}

export type SiteSyncResult = { ok: true; changes: number; items: number } | { ok: false; reason: string };

export async function syncSiteBook(log: ChangeLog, list: SiteChecklist, bookId: string): Promise<SiteSyncResult> {
  if (!isFirebaseConfigured()) return { ok: false, reason: 'Firebase is not configured (local only).' };
  try {
    const app = await getFirebaseApp();
    const fs = await import('firebase/firestore');
    const db = fs.getFirestore(app);
    const ref = fs.doc(db, 'sitebooks', bookId);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('site sync timed out')), TIMEOUT_MS));
    const snap = await Promise.race([fs.getDoc(ref), timeout]);
    const merged = mergeSiteBook({ changes: log.entries(), checklist: list.items() }, snap.exists() ? snap.data() : null);
    await Promise.race([
      fs.setDoc(ref, JSON.parse(JSON.stringify({ changes: merged.changes, checklist: merged.checklist, updatedAt: Date.now() }))),
      timeout,
    ]);
    log.replaceEntries(merged.changes);
    list.replaceItems(merged.checklist);
    return { ok: true, changes: merged.changes.length, items: merged.checklist.length };
  } catch (err) {
    console.warn('[mendcraft] site sync:', err);
    return { ok: false, reason: 'Site checklist cloud sync unavailable (local copy still works).' };
  }
}
