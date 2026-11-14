// Recipe voice matching — all pure. Three layers:
//   1. parseRecipeMeta: fixed teach/save/run phrases (English AND Kannada —
//      resolved locally, no model, so teaching works offline in both).
//   2. matchRecipe: the deterministic rules fallback — exact name/alias match,
//      then fuzzy (token overlap / small edit distance).
//   3. buildRecipePickPrompt / parseRecipePick: the hybrid Nano pick — a
//      structured "enum of recipe ids" output, parsed strictly (an id the
//      model invents is rejected).

export interface RecipeRef {
  id: string;
  name: string;
  aliases: string[];
}

/** Lowercase, strip punctuation, squeeze spaces. Keeps letters AND combining
 *  marks (\p{M}) — Kannada vowel signs and virama are marks, not letters. */
export function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Meta-commands. Kept to FIXED phrases so the badge can honestly say "Rules".

export type RecipeMeta =
  | { kind: 'start' }
  | { kind: 'cancel' }
  | { kind: 'save'; name: string }
  | { kind: 'run'; name: string };

const EN_START = /^(start|begin)\s+(teaching|recording)( (a|the) recipe)?$/i;
const EN_CANCEL = /^(stop|cancel)\s+(teaching|recording)$/i;
const EN_SAVE = /^save\s+(this|that|it)?\s*as\s+(.{1,60})$/i;
const EN_RUN = /^(do|run|play|replay)\s+(the\s+recipe\s+)?(.{1,60})$/i;

// Kannada fixed phrases: "ಕಲಿಸು"/"ಹೇಳಿಕೊಡು" (teach me → start), "ನಿಲ್ಲಿಸು"
// (stop), "<ಹೆಸರು> ಅಂತ ಉಳಿಸು" (save as <name>), "<ಹೆಸರು> ಮಾಡು" (do <name>).
const KN_START = /^(ಕಲಿಸು|ಹೇಳಿಕೊಡು|ಕಲಿಸಲು ಶುರು)$/u;
const KN_CANCEL = /^(ಕಲಿಸುವುದು\s+)?(ನಿಲ್ಲಿಸು|ರದ್ದು ಮಾಡು)$/u;
const KN_SAVE = /^(.{1,60}?)\s+(ಅಂತ|ಎಂದು)\s+(ಉಳಿಸು|ಸೇವ್ ಮಾಡು)$/u;
const KN_RUN = /^(.{1,60}?)\s+ಮಾಡು$/u;

/** Recognize a recipe meta-command in English or Kannada, else null.
 *  NOTE: 'run' is a CANDIDATE — the caller only treats it as a recipe run when
 *  the name matches a saved recipe; otherwise the utterance routes normally. */
export function parseRecipeMeta(utterance: string): RecipeMeta | null {
  const t = utterance.trim();
  if (!t) return null;
  if (EN_START.test(t) || KN_START.test(t)) return { kind: 'start' };
  if (EN_CANCEL.test(t) || KN_CANCEL.test(t)) return { kind: 'cancel' };
  const enSave = EN_SAVE.exec(t);
  if (enSave) return { kind: 'save', name: enSave[2].trim() };
  const knSave = KN_SAVE.exec(t);
  if (knSave) return { kind: 'save', name: knSave[1].trim() };
  const enRun = EN_RUN.exec(t);
  if (enRun) return { kind: 'run', name: enRun[3].trim() };
  const knRun = KN_RUN.exec(t);
  if (knRun) return { kind: 'run', name: knRun[1].trim() };
  return null;
}

// ---------------------------------------------------------------------------
// Rules fallback matcher.

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

export interface RecipeMatch {
  id: string;
  how: 'exact' | 'fuzzy';
  score: number;
}

/**
 * Deterministic matcher: the spoken name against each recipe's name + aliases.
 * Exact = the normalized phrase equals (or contains) the name. Fuzzy = ≥60%
 * token overlap, or edit distance ≤ 2 for near-miss transcriptions.
 */
export function matchRecipe(spoken: string, recipes: readonly RecipeRef[]): RecipeMatch | null {
  const phrase = normalizePhrase(spoken);
  if (!phrase) return null;
  let best: RecipeMatch | null = null;
  for (const r of recipes) {
    for (const label of [r.name, ...r.aliases]) {
      const want = normalizePhrase(label);
      if (!want || want.length < 2) continue;
      if (phrase === want || phrase.includes(want)) {
        return { id: r.id, how: 'exact', score: 1 };
      }
      const overlap = tokenOverlap(phrase, want);
      const dist = levenshtein(phrase, want);
      const fuzzyHit = overlap >= 0.6 || (want.length >= 4 && dist <= 2);
      const score = Math.max(overlap, want.length >= 4 && dist <= 2 ? 1 - dist / want.length : 0);
      if (fuzzyHit && (!best || score > best.score)) {
        best = { id: r.id, how: 'fuzzy', score };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Hybrid Nano pick (structured output; strict parse).

export const RECIPE_PICK_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    recipeId: { type: 'string' },
    confidence: { type: 'number' },
  },
};

export function buildRecipePickPrompt(
  utterance: string,
  recipes: readonly RecipeRef[],
  languageName?: string,
): string {
  const list = recipes
    .map((r) => `- id "${r.id}": ${r.name}${r.aliases.length ? ` (also: ${r.aliases.join(', ')})` : ''}`)
    .join('\n');
  const langNote = languageName && languageName !== 'English'
    ? ` The request may be in ${languageName}; match it by meaning.`
    : '';
  return `You map one spoken request to a saved recipe.${langNote} Reply with JSON only: {"recipeId":"<one of the ids below, or none>","confidence":0..1}.
If no recipe clearly matches, reply {"recipeId":"none","confidence":0}.
Saved recipes:
${list}
Request: ${JSON.stringify(utterance)}`;
}

export interface RecipePick {
  id: string | null;
  confidence: number;
}

/** Strict parse of the model's pick: only a KNOWN id survives; "none", an
 *  invented id, or junk all become { id: null }. */
export function parseRecipePick(raw: unknown, validIds: readonly string[]): RecipePick {
  if (typeof raw !== 'object' || raw === null) return { id: null, confidence: 0 };
  const obj = raw as Record<string, unknown>;
  const conf = typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
    ? Math.min(1, Math.max(0, obj.confidence))
    : 0;
  const id = typeof obj.recipeId === 'string' && validIds.includes(obj.recipeId) ? obj.recipeId : null;
  return { id, confidence: id ? conf : 0 };
}
