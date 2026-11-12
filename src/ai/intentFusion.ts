// ON-DEVICE INTENT FUSION: resolve a messy/partial voice transcript PLUS the
// pointer/hand context (element under the cursor, current selection, nearby
// elements with ids, cursor position in plan/ui coordinates) into ONE typed op
// with a confidence score. Built for Gemini Nano via the Prompt API's
// responseConstraint (PREFER_ON_DEVICE — wired in hybrid.fuseIntent()).
//
// This module is PURE: it builds the prompt/context payload and parses/
// validates the untrusted model result. No network, no Firebase, no DOM — so
// the unit tests never need a model. The mode's own coerce() re-validates
// every op, exactly like the plain intent path: AI output is never trusted.

/** Cursor position in the active mode's coordinates (plan mm / ui px). */
export interface FusionCursor {
  x: number;
  y: number;
}

/** One element near the cursor, so the model can resolve "the other window". */
export interface NearbyElement {
  id: string;
  /** Mode vocabulary: 'wall' | 'door' | 'window' | 'button' | 'text' | ... */
  kind: string;
  label?: string;
  /** Distance from the cursor in the mode's unit (mm for plan, px for ui). */
  dist?: number;
}

/** Everything the pointer/hand layer knows at the moment the user spoke. */
export interface FusionContext {
  /** Which editor the coordinates belong to. */
  space: 'plan' | 'ui' | 'part';
  /** Unit of cursor coordinates and distances. */
  unit: 'mm' | 'px';
  cursor: FusionCursor | null;
  /** Element id directly under the cursor ("this one"), if any. */
  hoverId: string | null;
  selectedIds: readonly string[];
  nearby: readonly NearbyElement[];
}

/** A mode's coercion of untrusted AI JSON (EditorMode.coerce). */
export type CoerceFn = (raw: unknown, utterance?: string) => object | null;

export interface FusionParse {
  /** Mode-validated result: an op envelope, template, or {clarify}. */
  result: object;
  /** 0..1 — the model's own certainty (rules path: 1 for ops, 0 for clarify). */
  confidence: number;
}

/** Context payload caps — the whole prompt must fit Nano's small window. */
export const MAX_NEARBY = 6;
export const MAX_SELECTED = 8;
export const MAX_LABEL = 24;

/** Confidence when the model emitted a valid op but no confidence number. */
export const DEFAULT_OP_CONFIDENCE = 0.5;

// ---------------------------------------------------------------------------
// Transcript cleanup. Speech recognition hands us disfluent text ("uh move
// move it um left a bit"); strip pure fillers and immediate word repeats so
// both the model prompt and the rule-parser fallback see a cleaner command.
// Deliberately conservative: never reorders or rewrites meaningful words.

const FILLER_WORDS = new Set([
  'uh', 'uhh', 'um', 'umm', 'erm', 'er', 'ehm', 'hmm', 'hm', 'mmm', 'ah', 'eh',
]);
const FILLER_PHRASES = [/\byou know\b/gi, /\bi mean\b/gi];

export function normalizeTranscript(raw: string): string {
  let t = raw;
  for (const re of FILLER_PHRASES) t = t.replace(re, ' ');
  const out: string[] = [];
  let prevWord = '';
  for (const tok of t.split(/\s+/)) {
    const word = tok.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    if (!word) continue; // punctuation-only token
    if (FILLER_WORDS.has(word)) continue;
    if (word === prevWord) continue; // stutter: "move move it"
    out.push(tok);
    prevWord = word;
  }
  return out.join(' ').trim();
}

// ---------------------------------------------------------------------------
// Context payload + prompt.

/** Compact JSON the model sees: nearest-first nearby (capped), rounded
 *  coordinates, truncated labels. Empty fields are omitted to save tokens. */
export function serializeFusionContext(ctx: FusionContext): string {
  const nearby = [...ctx.nearby]
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity))
    .slice(0, MAX_NEARBY)
    .map((n) => {
      const o: Record<string, unknown> = { id: n.id, kind: n.kind };
      if (n.label) o.label = n.label.slice(0, MAX_LABEL);
      if (typeof n.dist === 'number' && Number.isFinite(n.dist)) o.dist = Math.round(n.dist);
      return o;
    });
  const payload: Record<string, unknown> = { space: ctx.space, unit: ctx.unit };
  if (ctx.cursor) payload.cursor = { x: Math.round(ctx.cursor.x), y: Math.round(ctx.cursor.y) };
  if (ctx.hoverId) payload.under_cursor = ctx.hoverId;
  if (ctx.selectedIds.length) payload.selected = ctx.selectedIds.slice(0, MAX_SELECTED);
  if (nearby.length) payload.nearby = nearby;
  return JSON.stringify(payload);
}

/** Deixis + disfluency addendum appended to the mode's own intent prompt. */
export const FUSION_GUIDE = `The transcript is messy speech: ignore fillers ("uh", "um"), stutters, and abandoned fragments; if the speaker corrects themself, use the FINAL version. Context (JSON) is what the user's hand/cursor points at right now:
- "this" / "that" / "that one" / "it" => the under_cursor id if present, else the selected id, else target "selected".
- "here" / "right here" / "there" => place at the cursor position (use its x,y for the op's coordinates).
- "the other <kind>" / "same as the <kind>" => the nearest nearby element of that kind that is not under_cursor or selected; target it by id or copy its property.
- "a bit" / "slightly" => a small sensible amount in the given unit.
Only use ids that appear in Context — never invent ids. Also output "confidence": a number 0..1 for how sure you are this op matches the intent (vague or ambiguous => low). If you cannot resolve the intent at all, reply {"clarify":"<short question>","confidence":0}.`;

/** Full fusion prompt: the active mode's intent prompt (op vocabulary) + the
 *  deixis guide + the pointer context + the cleaned transcript. */
export function buildFusionPrompt(intentPrompt: string, utterance: string, ctx: FusionContext): string {
  // JSON.stringify escapes quotes in the transcript so speech can never close
  // the Transcript field early and masquerade as extra instructions.
  return `${intentPrompt}\n${FUSION_GUIDE}\nContext: ${serializeFusionContext(ctx)}\nTranscript: ${JSON.stringify(normalizeTranscript(utterance))}`;
}

/** The mode's op responseConstraint + a "confidence" number. Non-mutating —
 *  the plain intent model keeps using the original constraint untouched. */
export function buildFusionConstraint(opConstraint: Record<string, unknown>): Record<string, unknown> {
  const props = (opConstraint.properties as Record<string, unknown> | undefined) ?? {};
  return { ...opConstraint, properties: { ...props, confidence: { type: 'number' } } };
}

// ---------------------------------------------------------------------------
// Result parsing / validation.

/** Is a coerced result a clarification rather than an applicable op? */
export function isClarify(result: object): boolean {
  return typeof (result as Record<string, unknown>).clarify === 'string';
}

/** Deterministic-path confidence: rules either match exactly or ask. */
export function ruleConfidence(result: object): number {
  return isClarify(result) ? 0 : 1;
}

/** Clamp an untrusted confidence into [0,1]. Only an integer percent ("85",
 *  85) is rescaled; a mere overshoot like 1.5 clamps to 1, not 0.015. */
function coerceConfidence(v: unknown, fallback: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  const scaled = Number.isInteger(n) && n >= 2 && n <= 100 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
}

/**
 * Parse an untrusted fusion response: split off `confidence`, then hand the
 * remainder to the mode's coerce() (which validates ops exactly like the plain
 * intent path). Returns null when nothing valid came out (→ caller falls back).
 */
export function parseFusionResult(raw: unknown, coerce: CoerceFn, utterance: string): FusionParse | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { confidence, ...rest } = raw as Record<string, unknown>;
  const result = coerce(rest, utterance);
  if (!result) return null;
  return {
    result,
    confidence: coerceConfidence(confidence, isClarify(result) ? 0 : DEFAULT_OP_CONFIDENCE),
  };
}

/**
 * Short-circuit seam for the upcoming command router: the deterministic rule
 * parse of the cleaned transcript when it yields a concrete (non-clarify)
 * result, else null (→ the router then calls fuseIntent with pointer context).
 */
export function exactRuleParse(parse: (utterance: string) => object, utterance: string): object | null {
  const result = parse(normalizeTranscript(utterance));
  return isClarify(result) ? null : result;
}
