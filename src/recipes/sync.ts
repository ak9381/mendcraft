// Best-effort Firestore sync for the recipe book. Same capability-URL model as
// the relay rooms: the book id is a 24-char high-entropy token generated once
// per browser — knowing it IS the capability (see firestore.rules,
// recipebooks/{bookId}). Everything fails soft: no Firebase, no Firestore
// database, or offline just leaves the local book in charge.

import { getFirebaseApp, isFirebaseConfigured } from '../firebase/app';
import { mergeBooks, sanitizeBook, type RecipeStore } from './storage';

export const BOOK_ID_KEY = 'mendcraft.recipebook';
const SYNC_TIMEOUT_MS = 5000;

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // gitleaks:allow (alphabet, not a secret)

/** The stable per-browser book id (created on first use). */
export function recipeBookId(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void }): string {
  try {
    const existing = storage.getItem(BOOK_ID_KEY);
    if (existing && /^[A-Z2-9]{24}$/.test(existing)) return existing;
  } catch { /* storage blocked — fall through to a session-only id */ }
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = '';
  for (const b of bytes) id += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  try { storage.setItem(BOOK_ID_KEY, id); } catch { /* session-only id */ }
  return id;
}

export type SyncResult = { ok: true; count: number } | { ok: false; reason: string };

/**
 * One two-way sync: read the remote book, merge with local (tombstones and
 * newest-wins), write the merge back, and adopt it locally. Never throws.
 */
export async function syncRecipeBook(store: RecipeStore, bookId: string): Promise<SyncResult> {
  if (!isFirebaseConfigured()) return { ok: false, reason: 'Firebase is not configured (local-only).' };
  try {
    const app = await getFirebaseApp();
    const fs = await import('firebase/firestore');
    const db = fs.getFirestore(app);
    const ref = fs.doc(db, 'recipebooks', bookId);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('recipe sync timed out')), SYNC_TIMEOUT_MS));
    const snap = await Promise.race([fs.getDoc(ref), timeout]);
    const remote = sanitizeBook(snap.exists() ? snap.data() : null);
    const merged = mergeBooks(store.book(), remote);
    await Promise.race([
      fs.setDoc(ref, JSON.parse(JSON.stringify(merged))),
      timeout,
    ]);
    store.replaceBook(merged);
    return { ok: true, count: Object.keys(merged.recipes).length };
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const reason = code === 'permission-denied'
      ? 'Firestore rules for recipe books are not deployed yet.'
      : 'Recipe cloud sync unavailable (local book still works).';
    console.warn('[mendcraft] recipe sync:', err);
    return { ok: false, reason };
  }
}
