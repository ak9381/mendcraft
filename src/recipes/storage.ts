// Local-first recipe book. Recipes live in localStorage (works fully offline);
// Firestore sync (sync.ts) merges the same RecipeBook shape both ways. Deletes
// are tombstones so they survive a merge with a stale remote copy.

import { validateRecipe, type Recipe } from './model';

export interface RecipeBook {
  recipes: Record<string, Recipe>;
  /** id → deletion time: a tombstone beats any copy not updated after it. */
  deleted: Record<string, number>;
}

export function emptyBook(): RecipeBook {
  return { recipes: {}, deleted: {} };
}

/** Parse an untrusted book (storage/Firestore): invalid recipes are dropped,
 *  tombstones coerced to finite numbers. Never throws. */
export function sanitizeBook(raw: unknown): RecipeBook {
  const book = emptyBook();
  if (typeof raw !== 'object' || raw === null) return book;
  const obj = raw as { recipes?: unknown; deleted?: unknown };
  if (typeof obj.recipes === 'object' && obj.recipes !== null) {
    for (const value of Object.values(obj.recipes as Record<string, unknown>)) {
      const v = validateRecipe(value);
      if (v.ok) book.recipes[v.recipe.id] = v.recipe;
    }
  }
  if (typeof obj.deleted === 'object' && obj.deleted !== null) {
    for (const [id, at] of Object.entries(obj.deleted as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) book.deleted[id] = at;
    }
  }
  return book;
}

/**
 * Pure two-way merge: per recipe id the newer `updatedAt` wins; a tombstone
 * removes any copy not updated AFTER the deletion (re-teaching later revives
 * the name under a new save). Tombstone times merge by max.
 */
export function mergeBooks(a: RecipeBook, b: RecipeBook): RecipeBook {
  const out = emptyBook();
  for (const [id, at] of [...Object.entries(a.deleted), ...Object.entries(b.deleted)]) {
    out.deleted[id] = Math.max(out.deleted[id] ?? 0, at);
  }
  for (const r of [...Object.values(a.recipes), ...Object.values(b.recipes)]) {
    const current = out.recipes[r.id];
    if (current && current.updatedAt >= r.updatedAt) continue;
    out.recipes[r.id] = r;
  }
  for (const [id, deletedAt] of Object.entries(out.deleted)) {
    const r = out.recipes[id];
    if (r && r.updatedAt <= deletedAt) delete out.recipes[id];
  }
  return out;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECIPES_KEY = 'mendcraft.recipes';

export interface RecipeStore {
  list(): Recipe[];
  get(id: string): Recipe | undefined;
  /** Validates; returns an error string instead of saving anything invalid. */
  upsert(recipe: Recipe): string | null;
  rename(id: string, name: string, now: number): boolean;
  setAliases(id: string, aliases: string[], now: number): boolean;
  /** Tombstone delete (propagates through sync). */
  remove(id: string, now: number): boolean;
  book(): RecipeBook;
  /** Replace the whole book after a sync merge. */
  replaceBook(book: RecipeBook): void;
  subscribe(fn: () => void): void;
}

export function createRecipeStore(storage?: StorageLike | null, key = RECIPES_KEY): RecipeStore {
  let book = emptyBook();
  const listeners: (() => void)[] = [];

  try {
    const raw = storage?.getItem(key);
    if (raw) book = sanitizeBook(JSON.parse(raw));
  } catch {
    // Broken/blocked storage — start empty; saving below is best-effort too.
  }

  function persist(): void {
    try {
      storage?.setItem(key, JSON.stringify(book));
    } catch {
      // Storage full/blocked — the in-memory book still works this session.
    }
    for (const fn of listeners) fn();
  }

  return {
    list: () => Object.values(book.recipes).sort((a, b) => a.name.localeCompare(b.name)),
    get: (id) => book.recipes[id],
    upsert(recipe) {
      const v = validateRecipe(recipe);
      if (!v.ok) return v.error;
      book.recipes[v.recipe.id] = v.recipe;
      delete book.deleted[v.recipe.id];
      persist();
      return null;
    },
    rename(id, name, now) {
      const r = book.recipes[id];
      const trimmed = name.trim();
      if (!r || !trimmed) return false;
      book.recipes[id] = { ...r, name: trimmed.slice(0, 60), updatedAt: now };
      persist();
      return true;
    },
    setAliases(id, aliases, now) {
      const r = book.recipes[id];
      if (!r) return false;
      const clean = aliases.map((a) => a.trim()).filter(Boolean).slice(0, 12).map((a) => a.slice(0, 60));
      book.recipes[id] = { ...r, aliases: clean, updatedAt: now };
      persist();
      return true;
    },
    remove(id, now) {
      if (!book.recipes[id]) return false;
      delete book.recipes[id];
      book.deleted[id] = now;
      persist();
      return true;
    },
    book: () => ({ recipes: { ...book.recipes }, deleted: { ...book.deleted } }),
    replaceBook(next) {
      book = sanitizeBook(next);
      persist();
    },
    subscribe(fn) {
      listeners.push(fn);
    },
  };
}
