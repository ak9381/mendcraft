// INTERACTION PROFILES for hand-adaptive input (pure, DOM-free, network-free).
//
// A profile is the set of pointer knobs the app tunes to a person's hands: snap
// radius, pointer smoothing, click mode (pinch vs dwell), target size, and how
// chatty the voice prompts are. On-device Nano picks one from the hand metrics
// (ai/hybrid.adaptHandProfile); this module owns the presets, the JSON schema it
// must answer in, a deterministic rules fallback, validation of its (untrusted)
// answer, the human-readable "Adapted for your hands…" summary, and the manual
// override persisted on this device. The raw metrics NEVER leave the device.

import type { HandMetrics } from './handMetrics';

export type ProfileName = 'precise' | 'standard' | 'assist';
export type ClickMode = 'pinch' | 'dwell';
export type VoiceVerbosity = 'terse' | 'standard' | 'coached';

export interface InteractionProfile {
  name: ProfileName;
  /** Multiplier on the mode's base snap radius (bigger = forgiving). */
  snapRadiusScale: number;
  /** Pointer EMA factor 0..1 (0 = raw, higher = smoother but laggier). */
  smoothing: number;
  /** How a click is issued: a pinch, or hovering (dwell) for dwellMs. */
  clickMode: ClickMode;
  dwellMs: number;
  /** Multiplier on hit-target / cursor size. */
  targetScale: number;
  voiceVerbosity: VoiceVerbosity;
  /** Pinch on/off thresholds tuned to how fully this person can close. */
  pinchOn: number;
  pinchOff: number;
}

export const ALL_PROFILES: readonly ProfileName[] = ['precise', 'standard', 'assist'];

/** The three presets. `standard` is the neutral baseline; the summary diffs it. */
export const PROFILES: Record<ProfileName, InteractionProfile> = {
  precise: {
    name: 'precise', snapRadiusScale: 0.7, smoothing: 0.15, clickMode: 'pinch',
    dwellMs: 600, targetScale: 0.9, voiceVerbosity: 'terse', pinchOn: 0.30, pinchOff: 0.42,
  },
  standard: {
    name: 'standard', snapRadiusScale: 1.0, smoothing: 0.35, clickMode: 'pinch',
    dwellMs: 700, targetScale: 1.0, voiceVerbosity: 'standard', pinchOn: 0.35, pinchOff: 0.48,
  },
  assist: {
    name: 'assist', snapRadiusScale: 1.6, smoothing: 0.6, clickMode: 'dwell',
    dwellMs: 900, targetScale: 1.3, voiceVerbosity: 'coached', pinchOn: 0.42, pinchOff: 0.55,
  },
};

export function isProfileName(v: unknown): v is ProfileName {
  return v === 'precise' || v === 'standard' || v === 'assist';
}

// --- deterministic fallback (used when Nano is unavailable / answers badly) ---

/** Tremor jerk thresholds in screen fraction (steady ≈ 0.002, shaky ≈ 0.012). */
const TREMOR_LO = 0.004;
const TREMOR_HI = 0.012;
const PINCH_MS_LO = 250;

/** Pick a profile from metrics with simple, explainable thresholds. */
export function fallbackProfile(m: HandMetrics): ProfileName {
  if (m.tremor >= TREMOR_HI || m.pinchEffort >= 0.75 || m.fatigue >= 0.5) return 'assist';
  if (
    m.tremor <= TREMOR_LO && m.pinchEffort <= 0.35 && m.fatigue <= 0.2 && m.pinchMs <= PINCH_MS_LO
  ) return 'precise';
  return 'standard';
}

/** One-line rationale for a rules-picked profile (shown when Nano is absent). */
export function fallbackReason(m: HandMetrics): string {
  const name = fallbackProfile(m);
  if (name === 'assist') {
    if (m.fatigue >= 0.5) return 'Pinches are slowing — bigger targets and an easier pinch as you work.';
    if (m.tremor >= TREMOR_HI) return 'Steadying a shaky pointer with bigger targets and extra smoothing.';
    return 'Pinches take effort — larger targets and an easier pinch.';
  }
  if (name === 'precise') return 'Steady, quick pinches — a crisper pointer for finer control.';
  return 'Balanced pinch and steadiness — standard sensitivity.';
}

/** Default rationale when Nano names a profile but gives no reason text. */
export function defaultReason(name: ProfileName): string {
  switch (name) {
    case 'precise': return 'Fine control: a crisper pointer, smaller targets, and a firmer pinch.';
    case 'assist': return 'Easier aiming: bigger targets, extra smoothing, and an easier pinch.';
    default: return 'Balanced sensitivity for your hands.';
  }
}

// --- Nano schema + prompt (small, numbers-only) --------------------------------

/** Plain JSON Schema the on-device model answers in (→ Firebase Schema in hybrid). */
export const PROFILE_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    profile: { type: 'string' },
    reason: { type: 'string' },
    snapRadiusScale: { type: 'number' },
    smoothing: { type: 'number' },
    clickMode: { type: 'string' },
    dwellMs: { type: 'number' },
    targetScale: { type: 'number' },
    voiceVerbosity: { type: 'string' },
  },
  required: ['profile'],
};

/** Build the (tiny) on-device prompt. Numbers only — no landmarks, no video. */
export function buildAdaptPrompt(m: HandMetrics): string {
  const metrics = {
    pinchEffort: round(m.pinchEffort, 2),
    tremor: round(m.tremor, 4),
    pinchMs: Math.round(m.pinchMs),
    fatigue: round(m.fatigue, 2),
    pinches: m.pinches,
  };
  return [
    'You tune a hands-free design tool to how a person pinches. Choose ONE interaction',
    'profile from these metrics (all on a 0..1 scale unless noted):',
    '- pinchEffort: strain to complete a pinch (1 = fingers barely close).',
    '- tremor: pointer shakiness (screen fraction; higher = shakier).',
    '- pinchMs: average time to complete a pinch, milliseconds.',
    '- fatigue: how much pinches are slowing/hardening over the session.',
    'Profiles:',
    '- "precise": steady, quick hands — tight snapping, small targets, pinch to click.',
    '- "standard": balanced default.',
    '- "assist": shaky/effortful/tiring hands — big forgiving targets, dwell to click, strong smoothing.',
    'Prefer "assist" when tremor, effort, or fatigue are high; "precise" only when all are low.',
    'Reply JSON only: {"profile":"precise|standard|assist","reason":"<=1 short sentence"}.',
    `Metrics: ${JSON.stringify(metrics)}`,
  ].join('\n');
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// --- validation of the untrusted answer ---------------------------------------

export type ProfileSource = 'nano' | 'rules' | 'override';

export interface ProfileAdaptation {
  profile: InteractionProfile;
  reason: string;
  source: ProfileSource;
}

const RANGES: Record<string, [number, number]> = {
  snapRadiusScale: [0.4, 2.5],
  smoothing: [0, 0.9],
  dwellMs: [300, 1500],
  targetScale: [0.7, 2],
};

function clampField(raw: unknown, key: keyof typeof RANGES, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  const [lo, hi] = RANGES[key];
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Turn the model's (untrusted) JSON into a validated profile. An unusable answer
 * — wrong shape, unknown profile name — falls back to the deterministic rules
 * pick, so the feature always produces a sensible profile. Optional numeric
 * tweaks the model returns are clamped onto the named preset; never trusted raw.
 */
export function coerceProfileAdaptation(raw: unknown, metrics: HandMetrics): ProfileAdaptation {
  const rules = (): ProfileAdaptation => ({
    profile: PROFILES[fallbackProfile(metrics)],
    reason: fallbackReason(metrics),
    source: 'rules',
  });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return rules();
  const o = raw as Record<string, unknown>;
  if (!isProfileName(o.profile)) return rules();

  const base = PROFILES[o.profile];
  const profile: InteractionProfile = {
    ...base,
    snapRadiusScale: clampField(o.snapRadiusScale, 'snapRadiusScale', base.snapRadiusScale),
    smoothing: clampField(o.smoothing, 'smoothing', base.smoothing),
    clickMode: o.clickMode === 'pinch' || o.clickMode === 'dwell' ? o.clickMode : base.clickMode,
    dwellMs: clampField(o.dwellMs, 'dwellMs', base.dwellMs),
    targetScale: clampField(o.targetScale, 'targetScale', base.targetScale),
    voiceVerbosity:
      o.voiceVerbosity === 'terse' || o.voiceVerbosity === 'standard' || o.voiceVerbosity === 'coached'
        ? o.voiceVerbosity : base.voiceVerbosity,
  };
  const reason =
    typeof o.reason === 'string' && o.reason.trim()
      ? o.reason.trim().slice(0, 120)
      : defaultReason(o.profile);
  return { profile, reason, source: 'nano' };
}

// --- human-readable summary (the toast) ---------------------------------------

/**
 * Short "Adapted for your hands: …" clause list, diffed against `standard`.
 * Describes only the knobs that are actually applied to the pointer today
 * (target size, pointer smoothing, pinch sensitivity, voice) — not the
 * reserved snap/dwell parameters — so the toast never over-claims.
 */
export function summarizeAdaptation(p: InteractionProfile): string {
  const base = PROFILES.standard;
  const parts: string[] = [];
  if (p.targetScale > base.targetScale) parts.push('larger targets');
  else if (p.targetScale < base.targetScale) parts.push('smaller targets');
  if (p.smoothing > base.smoothing) parts.push('extra smoothing');
  else if (p.smoothing < base.smoothing) parts.push('a crisper pointer');
  if (p.pinchOn > base.pinchOn) parts.push('an easier pinch');
  else if (p.pinchOn < base.pinchOn) parts.push('a firmer pinch');
  if (p.voiceVerbosity === 'coached') parts.push('more voice guidance');
  else if (p.voiceVerbosity === 'terse') parts.push('quieter voice');
  if (!parts.length) parts.push('standard sensitivity');
  return `Adapted for your hands: ${parts.join(', ')}.`;
}

// --- manual override (persisted on this device only) --------------------------

export type OverrideChoice = ProfileName | 'auto';
const OVERRIDE_KEY = 'mendcraft.handProfile';

export function loadProfileOverride(): OverrideChoice {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    return isProfileName(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveProfileOverride(choice: OverrideChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, choice);
  } catch {
    /* storage blocked — override simply won't persist */
  }
}

/**
 * The profile actually in force: a manual override wins over the adaptation;
 * otherwise the adaptation (Nano or rules) stands.
 */
export function resolveActiveProfile(
  adaptation: ProfileAdaptation,
  override: OverrideChoice,
): ProfileAdaptation {
  if (override !== 'auto') {
    return { profile: PROFILES[override], reason: 'Manual override', source: 'override' };
  }
  return adaptation;
}
