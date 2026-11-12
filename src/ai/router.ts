// VISIBLE HYBRID ROUTER — the pure decision layer in front of the hybrid AI.
//
//   1. exact rules first (deterministic parser, zero AI) — unless the utterance
//      points at the canvas ("here", "that one"), which only fusion can resolve;
//   2. otherwise on-device intent fusion (Nano, PREFER_ON_DEVICE);
//   3. escalate to the cloud when confidence is low, the job is big (whole-design
//      generation), or no on-device model can run.
//
// This module is PURE: it decides and labels; it never calls a model, Firebase,
// or the DOM. Execution stays in hybrid.ts / main.ts, and the badge always shows
// the ACTUAL source of the answer (finalReason reconciles plan vs. reality), so
// the honest-badge guarantee survives any fallback.

import { exactRuleParse } from './intentFusion';
import type { Source } from './hybrid';

export type RoutePath = 'rules' | 'on-device' | 'cloud';

export type RouteReason =
  | 'exact'          // rules: the deterministic parser matched the command exactly
  | 'private'        // on-device: answered locally, nothing left the browser
  | 'big-job'        // cloud: whole-design generation/checking, too big for Nano
  | 'low-confidence' // cloud: the on-device answer was unsure, re-asked the cloud
  | 'no-device'      // cloud: no usable on-device model here
  | 'offline'        // rules: no AI available at all (Firebase missing / blocked)
  | 'fallback';      // rules: an AI path failed, the deterministic floor answered

/** What the router knows about the world when it decides. */
export interface RouterEnv {
  /** Gemini Nano is downloaded and ready in this browser. */
  deviceReady: boolean;
  /** Firebase AI Logic is configured and App Check passed. */
  cloudReady: boolean;
}

export interface RouteDecision {
  path: RoutePath;
  reason: RouteReason;
  /** The parsed result when the exact-rule path short-circuited. */
  ruleResult?: object;
}

/** On-device fusion confidence below this re-asks the cloud (when available). */
export const LOW_CONFIDENCE = 0.6;

/**
 * Pointing language the rule parser cannot resolve (it has no cursor/hand
 * context) — these must reach intent fusion even if the words around them
 * happen to rule-parse (the plan parser greedily matches e.g. "window").
 * Bare "it" is NOT deictic here: rules already resolve "it" to the selection.
 */
const POINTING_RE = /\b(right here|over there|here|there|this one|that one|the other)\b/i;

export function isPointing(utterance: string): boolean {
  return POINTING_RE.test(utterance);
}

/**
 * Decide the route BEFORE any model call.
 * `parse` is the active mode's deterministic rule parser.
 * `isBigJob` is the mode's "generate a whole design" classifier.
 */
export function planRoute(
  utterance: string,
  parse: (utterance: string) => object,
  isBigJob: boolean,
  env: RouterEnv,
): RouteDecision {
  if (isBigJob) {
    return env.cloudReady ? { path: 'cloud', reason: 'big-job' } : { path: 'rules', reason: 'offline' };
  }
  const modelAvailable = env.deviceReady || env.cloudReady;
  // Exact rules first — except for pointing commands, which only fusion can
  // ground in the cursor context (when any model is there to do it).
  if (!(modelAvailable && isPointing(utterance))) {
    const exact = exactRuleParse(parse, utterance);
    if (exact) return { path: 'rules', reason: 'exact', ruleResult: exact };
  }
  if (env.deviceReady) return { path: 'on-device', reason: 'private' };
  if (env.cloudReady) return { path: 'cloud', reason: 'no-device' };
  return { path: 'rules', reason: 'offline' };
}

/** After an on-device answer: is it unsure enough to re-ask the cloud? */
export function shouldEscalate(source: Source, confidence: number, env: RouterEnv): boolean {
  return source === 'on-device' && env.cloudReady && confidence < LOW_CONFIDENCE;
}

/** A model outcome the escalation chooser compares (subset of FusionOutcome). */
export interface Outcome {
  result: object;
  confidence: number;
  source: Source;
}

/**
 * Pick between the unsure on-device answer and its cloud re-ask. The cloud
 * answer wins when it is a concrete op or is simply more confident; otherwise
 * keep the original (a failed escalation must never make the answer worse).
 */
export function pickEscalated<T extends Outcome>(original: T, escalated: T | null): { outcome: T; escalated: boolean } {
  if (!escalated || escalated.source === 'rules') return { outcome: original, escalated: false };
  const origClarify = 'clarify' in original.result;
  const escClarify = 'clarify' in escalated.result;
  if (!escClarify && (origClarify || escalated.confidence >= original.confidence)) {
    return { outcome: escalated, escalated: true };
  }
  return { outcome: original, escalated: false };
}

/**
 * Reconcile the planned route with what ACTUALLY answered, so the badge never
 * claims a path that didn't run. Rules answering an AI-planned route = fallback;
 * the SDK silently running an "on-device" plan in the cloud = no-device.
 */
export function finalReason(planned: RouteDecision, actual: Source, escalated: boolean): RouteReason {
  if (actual === 'rules') return planned.path === 'rules' ? planned.reason : 'fallback';
  if (actual === 'on-device') return 'private';
  if (escalated) return 'low-confidence';
  return planned.path === 'cloud' ? planned.reason : 'no-device';
}

export const SOURCE_TEXT: Record<Source, string> = {
  'on-device': 'On-device',
  cloud: 'Cloud',
  rules: 'Rules',
};

export const REASON_TEXT: Record<RouteReason, string> = {
  exact: 'exact command',
  private: 'private',
  'big-job': 'big job',
  'low-confidence': 'low confidence',
  'no-device': 'no on-device AI',
  offline: 'offline',
  fallback: 'fallback',
};

/** Badge text: "Cloud · big job", "On-device · private", "Rules · exact command". */
export function badgeLabel(source: Source, reason: RouteReason): string {
  return `${SOURCE_TEXT[source]} · ${REASON_TEXT[reason]}`;
}

// ---------------------------------------------------------------------------
// Dev-panel log entries.

export interface RouteLogEntry {
  utterance: string;
  planned: RoutePath;
  source: Source;
  reason: RouteReason;
  /** Fusion confidence (absent on exact-rule and big-job routes). */
  confidence?: number;
  escalated: boolean;
  ms: number;
}

/** One compact dev-panel line, e.g.
 *  `"door here" → On-device · private (0.82, 41 ms)` or
 *  `"plan a studio" planned cloud → Rules · fallback (12 ms)`. */
export function formatLogEntry(e: RouteLogEntry): string {
  const quoted = `"${e.utterance.length > 48 ? `${e.utterance.slice(0, 47)}…` : e.utterance}"`;
  const mismatch = e.planned !== e.source && !e.escalated ? ` planned ${e.planned} →` : ' →';
  const conf = typeof e.confidence === 'number' ? `${e.confidence.toFixed(2)}, ` : '';
  const esc = e.escalated ? ', escalated' : '';
  return `${quoted}${mismatch} ${badgeLabel(e.source, e.reason)} (${conf}${Math.round(e.ms)} ms${esc})`;
}
