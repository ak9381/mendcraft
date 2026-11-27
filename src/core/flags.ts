// Feature flags gate legacy pages the canvas story no longer uses by default
// (old studio, /phone, /remote, /control, /judges' old tour). Read from
// `?flags=a,b` and persisted to localStorage under `mc.flags` so a flag set
// once survives a redirect that drops the query string (e.g. Spotify OAuth).

const STORAGE_KEY = 'mc.flags';

export type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface FlagWindow {
  location?: { search: string };
  localStorage?: FlagStorage;
}

function parseList(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (name) out.add(name);
  }
  return out;
}

/** Reads active flags (URL ∪ storage) and persists any URL flags to storage. */
export function loadFlags(win: FlagWindow = typeof window !== 'undefined' ? window : {}): Set<string> {
  const urlFlags = parseList(new URLSearchParams(win.location?.search ?? '').get('flags'));
  const storage = win.localStorage;
  const storedFlags = storage ? parseList(storage.getItem(STORAGE_KEY)) : new Set<string>();
  const merged = new Set([...storedFlags, ...urlFlags]);
  if (storage && urlFlags.size > 0) storage.setItem(STORAGE_KEY, [...merged].join(','));
  return merged;
}

export function hasFlag(name: string, flags: Set<string>): boolean {
  return flags.has(name);
}
