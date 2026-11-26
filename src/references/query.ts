// Turn a (possibly fuzzy or non-English) request into a short image-search
// query. The local path is deterministic; Gemini (Nano first, cloud otherwise)
// is used only when the request looks messy. Pure parsing, no network.

const MAX_QUERY = 80;

/** Pull a {"query":"..."} (or a bare line) out of a model reply. */
export function parseRefinedQuery(text: string): string | null {
  if (!text) return null;
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const raw = JSON.parse(stripped.slice(start, end + 1)) as { query?: unknown };
      if (typeof raw.query === 'string') return cleanQuery(raw.query);
    } catch {
      // fall through to the first line
    }
  }
  const line = stripped.split('\n')[0]?.replace(/^query\s*[:=]\s*/i, '').replace(/^["']|["']$/g, '');
  return line ? cleanQuery(line) : null;
}

export function cleanQuery(q: string): string | null {
  const t = q.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '');
  if (!t || t.length < 2) return null;
  return t.slice(0, MAX_QUERY);
}

export const REFINE_PROMPT =
  'You turn a person\'s request into a short image-search query (3 to 8 English words) for reference pictures. ' +
  'Reply with JSON only: {"query":"..."}. No commentary.';

export function refinePrompt(request: string): string {
  return `${REFINE_PROMPT}\nRequest: ${request.trim().slice(0, 240)}`;
}
