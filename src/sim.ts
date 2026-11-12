// Judge path (/?sim=1): works without a camera or mic. A virtual hand cursor
// driven by the mouse (mousedown = pinch) reuses the exact same HandEvent
// shape hands.ts emits, and a scripted demo drives the same command pipeline
// voice/text use. All sim output is labelled SIM in the UI.

import type { HandEvent } from './input/hands';

export const SIM_ACTIVE = new URLSearchParams(window.location.search).get('sim') === '1';

export interface SimStep {
  label: string;
  utterance?: string;
  action?: () => void | Promise<void>;
  delayMs?: number;
  /** Final beat: open the "what left this device" ledger so the judge can see
   *  the cloud calls (abstract ops + text) against the private on-device count.
   *  The shell handles the reveal in onStep; playDemo just skips the export. */
  revealLedger?: boolean;
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
  { label: 'Thicken it by 50 mm', utterance: 'thicker by 50' },
  { label: 'Add a door to it', utterance: 'add a door' },
  { label: 'Check accessibility', utterance: 'check accessibility' },
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

export async function playDemo(
  steps: SimStep[],
  runUtterance: (text: string) => Promise<void>,
  onStep: (step: SimStep, index: number) => void,
  onExport: () => void,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onStep(step, i);
    if (step.utterance) await runUtterance(step.utterance);
    else if (step.action) await step.action();
    else if (step.revealLedger) { /* onStep opens the ledger; no export here */ }
    else onExport();
    await new Promise((resolve) => setTimeout(resolve, step.delayMs ?? 1400));
  }
}
