// Shared accessibility-checker config + issue shape. ALL thresholds live here
// (one configurable place), each with the standard it comes from — the app has
// a global audience, so both ADA 2010 (US) and ISO 21542 (international) are
// cited for the geometry rules and WCAG 2.2 for the UI rules. The checks
// themselves are deterministic CODE (plan/accessibility.ts and
// ui/design/accessibility.ts); the cloud model only explains issues and may
// propose alternative fixes, which are re-validated like any other AI output.

/** Severity: 'fail' breaks the cited minimum; 'warn' passes the minimum but
 *  misses the recommended value (or is advisory, e.g. stairs need a ramp). */
export type A11ySeverity = 'fail' | 'warn';

/** One deterministic accessibility finding. `fix` is an op ENVELOPE in the
 *  active mode's vocabulary (re-validated by the controller before applying);
 *  absent when no safe automatic fix exists — the cloud may propose one. */
export interface A11yIssue {
  /** Stable id, e.g. "door-o2" — keyed on the offending object. */
  id: string;
  /** Rule key, e.g. "door-clear-width". */
  rule: string;
  severity: A11ySeverity;
  /** Deterministic measured-vs-required message (no AI needed to be useful). */
  message: string;
  /** Source standard(s) by name, e.g. "ADA 2010 §404.2.3; ISO 21542 §6.1.2". */
  citation: string;
  /** Object ids to highlight on the canvas. */
  targetIds: string[];
  /** Proposed fix as a raw op envelope (validated on apply), if computable. */
  fix?: Record<string, unknown>;
  /** Short human label for the fix button, e.g. "Widen to 850 mm". */
  fixLabel?: string;
  /** Who proposed the fix — the checks themselves are ALWAYS rules; this only
   *  labels the suggestion ("Checked by rules · fix suggested by cloud"). */
  fixSource?: 'rules' | 'on-device' | 'cloud';
}

/** Verdict of re-running the deterministic checks after a proposed fix. */
export type FixRecheck =
  | { ok: true }
  | { ok: false; reason: 'not-fixed' | 'new-issue'; detail: string };

/**
 * FIXED RULES DECIDE: after any proposed fix (code-computed or AI-suggested)
 * is applied, the deterministic checker runs again; the fix stands only if
 * every targeted issue is gone AND no new issue appeared. Pure — the caller
 * applies the op, re-checks, and undoes on a rejection.
 */
export function recheckFix(
  before: readonly A11yIssue[],
  after: readonly A11yIssue[],
  fixedIds: readonly string[],
): FixRecheck {
  const afterIds = new Set(after.map((i) => i.id));
  const still = fixedIds.filter((id) => afterIds.has(id));
  if (still.length > 0) {
    return { ok: false, reason: 'not-fixed', detail: `still flagged: ${still.join(', ')}` };
  }
  const beforeIds = new Set(before.map((i) => i.id));
  const fresh = after.filter((i) => !beforeIds.has(i.id));
  if (fresh.length > 0) {
    return { ok: false, reason: 'new-issue', detail: fresh.map((i) => i.message).join('; ') };
  }
  return { ok: true };
}

/** Plan-mode (architectural) thresholds, all mm. min = hard fail below it;
 *  recommended = warn below it. */
export const PLAN_A11Y = {
  /** Clear door opening width. ADA 2010 §404.2.3: 815 mm (32 in); ISO 21542
   *  recommends 850 mm. */
  doorClear: { min: 815, recommended: 850 },
  /** Wheelchair turning circle diameter. ISO 21542 §: 1500 mm; ADA 2010
   *  §304.3.1 uses 1525 mm (60 in) — we check the configured diameter. */
  turningCircleDiameter: 1500,
  /** Grid step used when searching for a clear turning-circle spot. */
  turningGridStep: 100,
  /** Clear corridor width. ADA 2010 §403.5.1: 915 mm; ISO 21542 recommends
   *  1000–1200 mm. Task range 900–1000. */
  corridor: { min: 900, recommended: 1000 },
  /** Max ramp slope as rise/run. ADA 2010 §405.2 and ISO 21542: 1:12. */
  rampMaxSlope: 1 / 12,
  /** Assumed rise a ramp fixture must overcome (one step/threshold), mm. */
  rampAssumedRise: 150,
  /** Max unbevelled threshold/level change. ADA 2010 §404.2.5: 13 mm (1/2 in). */
  thresholdMax: 13,
} as const;

export const PLAN_CITATIONS = {
  doorClear: 'ADA 2010 §404.2.3; ISO 21542 §6.1.2',
  turningCircle: 'ISO 21542 (1500 mm circle); ADA 2010 §304.3.1',
  corridor: 'ADA 2010 §403.5.1; ISO 21542 §8.1',
  ramp: 'ADA 2010 §405.2; ISO 21542 §8.2',
  threshold: 'ADA 2010 §404.2.5; ISO 21542 §6.1.4',
} as const;

/** UI-mode thresholds. */
export const UI_A11Y = {
  /** WCAG 2.2 SC 1.4.3: 4.5:1 normal text, 3:1 large text. */
  contrast: { normal: 4.5, large: 3 },
  /** Large text: ≥ 24 px, or ≥ 18.5 px bold (WCAG definition, px ≈ 1.333·pt). */
  largeTextPx: 24,
  largeBoldPx: 18.5,
  /** Min touch-target side. WCAG 2.1 SC 2.5.5 (AAA) / platform HIGs: 44 px. */
  minTargetPx: 44,
} as const;

export const UI_CITATIONS = {
  contrast: 'WCAG 2.2 SC 1.4.3 (Contrast, Minimum)',
  targetSize: 'WCAG 2.1 SC 2.5.5 (Target Size, AAA); ISO 9241-410',
  label: 'WCAG 2.2 SC 3.3.2 (Labels or Instructions); SC 1.3.1',
} as const;

/** Does this utterance ask for an accessibility check / retrofit? Checked
 *  BEFORE design-request routing ("make this house wheelchair friendly" would
 *  otherwise match the plan-generate path on "house"). */
export function isAccessibilityRequest(utterance: string): boolean {
  return /\b(accessib\w*|wheelchair|wheel\s*chair|barrier[- ]?free|ada|wcag)\b/i.test(utterance);
}

// ─── Cloud explanation plumbing (schema + coercion, both pure) ─────────────

/** Cloud response constraint for the a11y explainer: one entry per issue id,
 *  plus an optional `fix` in the active mode's op vocabulary (the mode's
 *  opConstraint is spliced in so there is ONE op-schema source of truth). */
export function buildA11yConstraint(opConstraint: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'explanation'],
          properties: {
            id: { type: 'string' },
            explanation: { type: 'string' },
            fix: opConstraint,
          },
        },
      },
    },
  };
}

/** A cloud explanation for one issue; `fix` (if any) is already mode-validated. */
export interface A11yExplanation {
  id: string;
  explanation: string;
  fix?: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Coerce an untrusted a11y-explain response. Only entries matching a KNOWN
 * issue id survive; a proposed fix survives only if the active mode's coerce
 * turns it into a validated op (clarify / template responses are dropped).
 */
export function coerceA11yExplanations(
  raw: unknown,
  knownIds: readonly string[],
  coerceOp: (raw: unknown) => object | null,
): A11yExplanation[] {
  if (!isObj(raw) || !Array.isArray(raw.items)) return [];
  const out: A11yExplanation[] = [];
  for (const item of raw.items) {
    if (!isObj(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
    if (!id || !explanation || !knownIds.includes(id)) continue;
    const entry: A11yExplanation = { id, explanation };
    if (isObj(item.fix)) {
      const coerced = coerceOp(item.fix);
      if (coerced && isObj(coerced) && typeof coerced.op === 'string') {
        entry.fix = coerced as Record<string, unknown>;
      }
    }
    out.push(entry);
  }
  return out;
}
