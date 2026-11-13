// Assistive-service policy — pure, no DOM, no Android. This is the single
// source of truth for what the Android AccessibilityService is allowed to do;
// the Java side (android/.../assist/) mirrors these rules and the comments
// there point back here. Unit-tested in tests/assistPolicy.test.ts.
//
// Hard rules:
//  - ALLOWLIST ONLY: Instagram, Pinterest, WhatsApp (+ WhatsApp Business).
//  - Instagram/Pinterest get scroll gestures, nothing else.
//  - WhatsApp gets a reply DRAFT placed in the compose field; the single
//    send click happens only after an explicit user confirm (pinch or a big
//    on-screen button) issued AFTER the draft is visible. Never on a timer,
//    never because the compose field filled, never automatically.

/** Packages the service may act in. Everything else is invisible to it. */
export const ASSIST_ALLOWLIST = [
  'com.instagram.android',
  'com.pinterest',
  'com.whatsapp',
  'com.whatsapp.w4b',
] as const;

export type AssistCapability = 'scroll' | 'draft-reply';

export function isAllowedPackage(pkg: string): boolean {
  return (ASSIST_ALLOWLIST as readonly string[]).includes(pkg);
}

/** Per-app capabilities: feeds scroll; WhatsApp drafts (and scrolls chats). */
export function capabilitiesFor(pkg: string): AssistCapability[] {
  switch (pkg) {
    case 'com.instagram.android':
    case 'com.pinterest':
      return ['scroll'];
    case 'com.whatsapp':
    case 'com.whatsapp.w4b':
      return ['scroll', 'draft-reply'];
    default:
      return [];
  }
}

export function canScroll(pkg: string): boolean {
  return capabilitiesFor(pkg).includes('scroll');
}

export function canDraftReply(pkg: string): boolean {
  return capabilitiesFor(pkg).includes('draft-reply');
}

// ---------------------------------------------------------------------------
// Auto-scroll: OFF by default, pausable instantly, clamped to a slow cadence.

export interface AutoScrollState {
  enabled: boolean;
  paused: boolean;
  intervalMs: number;
}

/** Slowest the user can ask for; fastest we will ever auto-scroll. */
export const AUTO_SCROLL_MIN_INTERVAL_MS = 1500;
export const AUTO_SCROLL_DEFAULT_INTERVAL_MS = 3000;

export function initialAutoScroll(): AutoScrollState {
  return { enabled: false, paused: false, intervalMs: AUTO_SCROLL_DEFAULT_INTERVAL_MS };
}

export function setAutoScrollEnabled(s: AutoScrollState, enabled: boolean): AutoScrollState {
  // Re-enabling always starts un-paused so "it kept going" can't surprise.
  return { ...s, enabled, paused: false };
}

export function pauseAutoScroll(s: AutoScrollState): AutoScrollState {
  return { ...s, paused: true };
}

export function setAutoScrollInterval(s: AutoScrollState, intervalMs: number): AutoScrollState {
  return { ...s, intervalMs: Math.max(AUTO_SCROLL_MIN_INTERVAL_MS, Math.round(intervalMs)) };
}

/** One timer tick: may the service perform a scroll gesture right now? */
export function autoScrollTickAllowed(s: AutoScrollState, foregroundPkg: string): boolean {
  return s.enabled && !s.paused && canScroll(foregroundPkg);
}

/** A single user-initiated scroll (big ▲/▼ button or pinch-flick). */
export function manualScrollAllowed(foregroundPkg: string): boolean {
  return canScroll(foregroundPkg);
}

// ---------------------------------------------------------------------------
// WhatsApp reply: draft → (visible) → explicit confirm → ONE send click.
//
//   idle ──stage──▶ staged ──placed──▶ placed ──confirm──▶ sent
//     ▲                │                  │
//     └───── cancel ───┴────── cancel ────┘
//
// 'timer' and 'compose-filled' events exist so tests can prove they NEVER
// advance the machine toward sending.

export type DraftPhase = 'idle' | 'staged' | 'placed' | 'sent';

export interface DraftState {
  phase: DraftPhase;
  /** The reply text the user already confirmed in Mendcraft. */
  text: string;
  pkg: string | null;
}

export type DraftEvent =
  | { type: 'stage'; text: string; pkg: string }
  | { type: 'placed' } // service verified the text is visible in the compose field
  | { type: 'confirm'; source: 'pinch' | 'button' } // explicit user act, nothing else
  | { type: 'cancel' }
  | { type: 'timer' } // any elapsed time — must be a no-op
  | { type: 'compose-filled' }; // observing text in compose — must be a no-op

export interface DraftStep {
  state: DraftState;
  /** True exactly when the service should perform its single send click. */
  performSend: boolean;
}

export function initialDraft(): DraftState {
  return { phase: 'idle', text: '', pkg: null };
}

export function reduceDraft(state: DraftState, event: DraftEvent): DraftStep {
  const stay: DraftStep = { state, performSend: false };
  switch (event.type) {
    case 'stage':
      // Only WhatsApp may receive drafts, and staging always restarts clean.
      if (!canDraftReply(event.pkg) || event.text.trim() === '') return stay;
      return { state: { phase: 'staged', text: event.text, pkg: event.pkg }, performSend: false };
    case 'placed':
      if (state.phase !== 'staged') return stay;
      return { state: { ...state, phase: 'placed' }, performSend: false };
    case 'confirm':
      // The ONLY transition that sends — and only from 'placed', meaning the
      // draft is already visible to the user. Confirming twice is a no-op.
      if (state.phase !== 'placed') return stay;
      return { state: { ...state, phase: 'sent' }, performSend: true };
    case 'cancel':
      return { state: initialDraft(), performSend: false };
    case 'timer':
    case 'compose-filled':
      // Deliberately inert: time passing or a filled compose field never sends.
      return stay;
  }
}
