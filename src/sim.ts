// Judge path (/?sim=1): works without a camera or mic. A virtual hand cursor
// driven by the mouse (mousedown = pinch) reuses the exact same HandEvent
// shape hands.ts emits, and a scripted demo drives the same command pipeline
// voice/text use. All sim output is labelled SIM in the UI.

import type { HandEvent } from './input/hands';
// The /control dashboard's fake-adapter driver lives with the pure snapshot
// module (no DOM/window) so tests can import it without a browser; re-exported
// here so the Play-demo surface stays in src/sim.ts.
export { playControlDemo } from './relay/controlSnapshot';

export const SIM_ACTIVE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('sim') === '1';

/** A declarative "feature beat" the shell performs (via playDemo's onFeature):
 *  on-device hand-adapt pick, offline/online toggle, or accepting an a11y fix.
 *  Keeps the demo script data-only; main.ts owns each implementation. */
export type SimFeature =
  | 'adapt' | 'offline' | 'online' | 'accept-a11y'
  // Relay pairing beats: a simulated phone joins over the in-page fake
  // transport (no Firestore), drives the editor, then leaves.
  | 'relay-pair' | 'relay-undo' | 'relay-cmd' | 'relay-gone';

export interface SimStep {
  label: string;
  utterance?: string;
  action?: () => void | Promise<void>;
  delayMs?: number;
  /** Final beat: open the "what left this device" ledger so the judge can see
   *  the cloud calls (abstract ops + text) against the private on-device count.
   *  The shell handles the reveal in onStep; playDemo just skips the export. */
  revealLedger?: boolean;
  /** A declarative feature beat handled by onFeature before any utterance. */
  feature?: SimFeature;
  /** Switch the spoken/written language (e.g. 'kn') before the utterance — drives
   *  the live caption bar and the honest "Cloud · Kannada" badge path. */
  lang?: string;
}

/**
 * Frozen demo for the plan hero: "two-bedroom plan" (rules fallback, no AI) →
 * the shared wall w3 comes pre-selected + dimensioned → "make it 4 meters" →
 * the wall and its dimension jump → export DXF. The shared wall id (w3) is
 * deterministic because applyGenerated resets the id counter (see plan/templates).
 */
export const PLAN_DEMO: SimStep[] = [
  { label: 'Two-bedroom plan', utterance: 'two bedroom plan' },
  { label: 'Make the shared wall 4 meters', utterance: 'make this wall 4 meters' },
  { label: 'Intent fusion: thicken it', utterance: 'thicker by 50' },
  { label: 'Add a door to it', utterance: 'add a door' },
  { label: 'Teach a personal phrase (on-device)', utterance: 'teach beef it up means thicker by 20' },
  { label: 'Use the phrase I just taught', utterance: 'beef it up' },
  { label: 'Adapt to my hand (numbers only, on-device)', feature: 'adapt' },
  { label: 'Go offline', feature: 'offline' },
  { label: 'Queue a studio plan while offline', utterance: 'studio apartment', delayMs: 1700 },
  { label: 'Back online — drain the cloud queue', feature: 'online', delayMs: 1900 },
  { label: 'Say it in Kannada (live caption)', lang: 'kn', utterance: 'ಈ ಗೋಡೆಯನ್ನು ದಪ್ಪ ಮಾಡು', delayMs: 1700 },
  { label: 'Back to English', lang: 'en' },
  { label: 'Check accessibility', utterance: 'check accessibility' },
  { label: 'Accept the accessibility fix', feature: 'accept-a11y' },
  { label: 'Pair a phone (QR + short code)', feature: 'relay-pair', delayMs: 1900 },
  { label: 'Phone remote: undo', feature: 'relay-undo', delayMs: 1700 },
  { label: 'Phone remote: type a command', feature: 'relay-cmd', delayMs: 1900 },
  { label: 'Phone leaves the room', feature: 'relay-gone' },
  { label: 'Export the DXF', action: undefined },
  { label: 'See what left this device', revealLedger: true },
];

/** Frozen demo for the 3D part mode (reachable via ?mode=part&sim=1). */
export const PART_DEMO: SimStep[] = [
  { label: 'Build a cup grip', utterance: 'cup grip' },
  { label: 'Select the sleeve', utterance: 'select sleeve' },
  { label: 'Make it narrower (triggers a thin-wall warning)', utterance: 'make it narrower by 7' },
  { label: 'Fix the wall', utterance: 'make it wider by 7' },
  { label: 'Export the STL', action: undefined },
  { label: 'See what left this device', revealLedger: true },
];

/**
 * Frozen demo for the UI-design mode (reachable via ?mode=ui&sim=1): a login
 * screen (rules fallback, no AI) → select the sign-in button → recolour it green,
 * make it taller, enlarge the heading (all visible edits) → export the HTML.
 * All deterministic, no network.
 */
export const UI_DEMO: SimStep[] = [
  { label: 'Login screen', utterance: 'login screen' },
  { label: 'Select the button', utterance: 'select the button' },
  { label: 'Make the button green', utterance: 'make the button green' },
  { label: 'Make it 56 pixels tall', utterance: 'make it 56 pixels tall' },
  { label: 'Bigger heading', utterance: 'bigger heading' },
  { label: 'Check accessibility', utterance: 'check accessibility' },
  { label: 'Accept the accessibility fix', feature: 'accept-a11y' },
  { label: 'Export the HTML', action: undefined },
  { label: 'See what left this device', revealLedger: true },
];

/** Back-compat alias (defaults to the plan hero demo). */
export const DEMO_SCRIPT = PLAN_DEMO;

/** The demo script for the active mode id. */
export function demoFor(modeId: string): SimStep[] {
  if (modeId === 'part') return PART_DEMO;
  if (modeId === 'ui') return UI_DEMO;
  return PLAN_DEMO;
}

/** Mounts a visible on-screen cursor over `container`; mouse drag emulates a pinch. */
export function mountSimCursor(container: HTMLElement, onEvent: (e: HandEvent) => void): () => void {
  const cursor = document.createElement('div');
  cursor.className = 'sim-cursor';
  cursor.textContent = 'SIM';
  // Hidden until the first real pointer input — otherwise it sits parked at the
  // viewport's top-left corner before the mouse has ever moved.
  cursor.style.visibility = 'hidden';
  container.appendChild(cursor);

  let pinching = false;
  let lastX = 0;
  let lastY = 0;
  let moved = false;

  function norm(e: MouseEvent): { x: number; y: number } {
    const rect = container.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function place(x: number, y: number): void {
    const rect = container.getBoundingClientRect();
    cursor.style.visibility = 'visible'; // reveal on first real pointer input
    cursor.style.left = `${x * rect.width}px`;
    cursor.style.top = `${y * rect.height}px`;
  }

  function onMove(e: MouseEvent): void {
    const { x, y } = norm(e);
    place(x, y);
    if (!pinching) {
      onEvent({ type: 'tracking', x, y });
      return;
    }
    const dx = x - lastX;
    const dy = y - lastY;
    if (Math.hypot(dx, dy) > 0.001) moved = true;
    lastX = x;
    lastY = y;
    onEvent({ type: 'pinch-move', x, y, dx, dy });
  }

  function onDown(e: MouseEvent): void {
    const { x, y } = norm(e);
    place(x, y); // reveal + position even if no move preceded the press
    pinching = true;
    moved = false;
    lastX = x;
    lastY = y;
    cursor.classList.add('pinching');
    onEvent({ type: 'pinch-start', x, y });
  }

  function onUp(e: MouseEvent): void {
    if (!pinching) return;
    const { x, y } = norm(e);
    pinching = false;
    cursor.classList.remove('pinching');
    if (!moved) onEvent({ type: 'pinch-tap', x, y });
    onEvent({ type: 'pinch-end' });
  }

  container.addEventListener('mousemove', onMove);
  container.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);

  return () => {
    container.removeEventListener('mousemove', onMove);
    container.removeEventListener('mousedown', onDown);
    window.removeEventListener('mouseup', onUp);
    cursor.remove();
  };
}

/**
 * Playback controller for the sim walk: Pause/Resume, Next (cut the current
 * step's wait short and advance) and Skip (abort the rest of the walk). It is a
 * pure, testable state machine — playDemo consults it between and during steps.
 * `onChange` lets the shell re-render its Pause/Next/Skip buttons.
 */
export interface SimPlayback {
  isPaused(): boolean;
  isAborted(): boolean;
  pause(): void;
  resume(): void;
  /** Toggle pause; returns the new paused state. */
  toggle(): boolean;
  /** Request advancing to the next step now (consumed once by the wait loop). */
  requestNext(): void;
  /** Abort the remainder of the walk. */
  skip(): void;
  /** Reset to a fresh run (not paused, not aborted, no pending next). */
  reset(): void;
  /** True once if a Next was requested; clears the request. */
  consumeNext(): boolean;
}

export function createSimPlayback(onChange?: () => void): SimPlayback {
  let paused = false;
  let aborted = false;
  let nextPending = false;
  const changed = () => onChange?.();
  return {
    isPaused: () => paused,
    isAborted: () => aborted,
    pause() { if (!paused) { paused = true; changed(); } },
    resume() { if (paused) { paused = false; changed(); } },
    toggle() { paused = !paused; changed(); return paused; },
    requestNext() { nextPending = true; changed(); },
    skip() { if (!aborted) { aborted = true; paused = false; changed(); } },
    reset() { paused = false; aborted = false; nextPending = false; changed(); },
    consumeNext() { if (!nextPending) return false; nextPending = false; return true; },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait up to `ms`, but honour the playback controls: abort/Next cut it short,
 *  Pause holds here without counting toward the elapsed time. */
async function waitWithControls(ms: number, playback?: SimPlayback): Promise<void> {
  if (!playback) { await sleep(ms); return; }
  const tick = 60;
  let waited = 0;
  while (waited < ms) {
    if (playback.isAborted()) return;
    if (playback.consumeNext()) return; // Next: skip the remaining wait
    if (playback.isPaused()) { await sleep(tick); continue; } // hold, don't advance
    await sleep(tick);
    waited += tick;
  }
}

export async function playDemo(
  steps: SimStep[],
  runUtterance: (text: string) => Promise<void>,
  onStep: (step: SimStep, index: number) => void,
  onExport: () => void,
  onFeature?: (step: SimStep, index: number) => void | Promise<void>,
  playback?: SimPlayback,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    if (playback?.isAborted()) return;
    const step = steps[i];
    onStep(step, i);
    // A declarative feature / language beat runs first (it may set the language
    // the following utterance is spoken in).
    if ((step.feature || step.lang) && onFeature) await onFeature(step, i);
    if (step.utterance) await runUtterance(step.utterance);
    else if (step.action) await step.action();
    else if (step.revealLedger) { /* onStep opens the ledger; no export here */ }
    else if (step.feature || step.lang) { /* handled by onFeature; no export */ }
    else onExport();
    await waitWithControls(step.delayMs ?? 1400, playback);
  }
}
