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
}

export const DEMO_SCRIPT: SimStep[] = [
  { label: 'Build a cup grip', utterance: 'cup grip' },
  { label: 'Select the sleeve', utterance: 'select sleeve' },
  { label: 'Make it narrower (triggers a thin-wall warning)', utterance: 'make it narrower by 7' },
  { label: 'Fix the wall', utterance: 'make it wider by 7' },
  { label: 'Export the STL', action: undefined },
];

/** Mounts a visible on-screen cursor over `container`; mouse drag emulates a pinch. */
export function mountSimCursor(container: HTMLElement, onEvent: (e: HandEvent) => void): () => void {
  const cursor = document.createElement('div');
  cursor.className = 'sim-cursor';
  cursor.textContent = 'SIM';
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
    else onExport();
    await new Promise((resolve) => setTimeout(resolve, step.delayMs ?? 1400));
  }
}
