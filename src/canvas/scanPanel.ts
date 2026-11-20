// REGISTRATION SCAN PANEL. The warm-paper card the Register button opens: a
// big progress ring that fills while the current scan holds (face → left palm
// → right palm), one clear instruction line, a ✓-ticked step list, and a
// Cancel button. A real <dialog>-style overlay (role=dialog, aria-modal) so
// the hand pointer scopes pinches to it while it's open; closing it leaves
// the canvas exactly as it was. Plain DOM like the repo's other panels.

import type { ScanState, ScanStep } from './scanRegistration';

export interface ScanPanel {
  open(): void;
  close(): void;
  setState(state: Pick<ScanState, 'step' | 'progress' | 'prompt'>): void;
  isOpen(): boolean;
  destroy(): void;
}

export interface ScanPanelOptions {
  onCancel?: () => void;
}

const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;

const STEP_LABELS: ReadonlyArray<{ step: ScanStep; label: string }> = [
  { step: 'face', label: 'Face' },
  { step: 'left', label: 'Left hand' },
  { step: 'right', label: 'Right hand' },
];

const ORDER: ScanStep[] = ['face', 'left', 'right', 'done'];

export function mountScanPanel(root: HTMLElement, opts: ScanPanelOptions = {}): ScanPanel {
  const doc = root.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'mc-scan';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'mc-scan-title');
  el.hidden = true;
  el.innerHTML = `
    <div class="mc-scan-card">
      <h2 id="mc-scan-title">Register you</h2>
      <svg class="mc-scan-ring" viewBox="0 0 110 110" aria-hidden="true">
        <circle class="mc-scan-ring-track" cx="55" cy="55" r="${RING_R}" />
        <circle class="mc-scan-ring-fill" cx="55" cy="55" r="${RING_R}"
          stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${RING_C.toFixed(1)}" />
        <text class="mc-scan-ring-label" x="55" y="60" text-anchor="middle"></text>
      </svg>
      <p class="mc-scan-prompt" aria-live="polite"></p>
      <ol class="mc-scan-steps">
        ${STEP_LABELS.map((s) => `<li data-step="${s.step}"><span class="mc-scan-tick" aria-hidden="true"></span>${s.label}</li>`).join('')}
      </ol>
      <button type="button" class="mc-btn mc-scan-cancel">Cancel</button>
    </div>`;
  root.append(el);

  const fill = el.querySelector<SVGCircleElement>('.mc-scan-ring-fill')!;
  const ringLabel = el.querySelector<SVGTextElement>('.mc-scan-ring-label')!;
  const prompt = el.querySelector<HTMLElement>('.mc-scan-prompt')!;
  const cancel = el.querySelector<HTMLButtonElement>('.mc-scan-cancel')!;
  cancel.addEventListener('click', () => opts.onCancel?.());

  function setState(state: Pick<ScanState, 'step' | 'progress' | 'prompt'>): void {
    const idx = ORDER.indexOf(state.step);
    const label = STEP_LABELS.find((s) => s.step === state.step)?.label ?? '✓';
    ringLabel.textContent = state.step === 'done' ? '✓' : label;
    prompt.textContent = state.prompt;
    fill.setAttribute('stroke-dashoffset', String(RING_C * (1 - Math.max(0, Math.min(1, state.progress)))));
    el.querySelectorAll<HTMLElement>('.mc-scan-steps li').forEach((li) => {
      const liIdx = ORDER.indexOf(li.dataset.step as ScanStep);
      li.classList.toggle('is-done', liIdx < idx || state.step === 'done');
      li.classList.toggle('is-active', li.dataset.step === state.step);
    });
    el.classList.toggle('is-done', state.step === 'done');
  }

  return {
    open() {
      el.hidden = false;
      setState({ step: 'face', progress: 0, prompt: 'Look at the camera and hold still.' });
      cancel.focus({ preventScroll: true });
    },
    close() { el.hidden = true; },
    setState,
    isOpen: () => !el.hidden,
    destroy() { el.remove(); },
  };
}
