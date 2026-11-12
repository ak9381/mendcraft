// Pure URL normalisation for the reference panel's address bar. DOM-free and
// unit-tested. Turns loose user input ("example.com", "  foo.org/x ") into a
// loadable https URL, and recognises search queries vs bare hosts.

/** True when the string looks like a single host/URL rather than a search query. */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return true;
  // host.tld or host.tld/path, optional port — at least one dot, no spaces.
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s);
}

/**
 * Normalise address-bar input to a URL string, or null if it's empty/invalid.
 * Bare hosts get https://; non-URL text becomes a DuckDuckGo search (a real,
 * frameable results page), so the panel always has something to load.
 */
export function normalizeUrl(input: string): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;

  if (looksLikeUrl(s)) {
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    try {
      return new URL(withScheme).toString();
    } catch {
      return null;
    }
  }

  // Treat anything else as a web search.
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
}

/** Short host label for the panel title (or the raw string if not a URL). */
export function hostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
