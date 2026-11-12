// Hand-adaptive settings panel: shows the interaction profile Nano (or the rules
// fallback) picked for this person's hands, its one-line reason, and the live
// metrics behind it — plus a select to OVERRIDE the choice (Auto / Precise /
// Standard / Assist) and a "Re-adapt now" button. Profile maths + persistence
// are pure (input/handProfile); this module is just the DOM + wiring. All numbers
// are on-device — the panel states so explicitly.

import {
  ALL_PROFILES, loadProfileOverride, saveProfileOverride,
  type OverrideChoice, type ProfileAdaptation, type ProfileSource,
} from '../input/handProfile';
import type { HandMetrics } from '../input/handMetrics';

const PROFILE_LABELS: Record<string, string> = {
  precise: 'Precise', standard: 'Standard', assist: 'Assist',
};
const SOURCE_LABELS: Record<ProfileSource, string> = {
  nano: 'on-device AI', rules: 'rules', override: 'you',
};

export interface HandProfilePanel {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  getOverride(): OverrideChoice;
  /** Reflect the profile currently in force (after an adapt or an override). */
  setAdaptation(a: ProfileAdaptation): void;
  /** Reflect the latest live metrics (numbers only). */
  setMetrics(m: HandMetrics | null): void;
  dispose(): void;
}

export interface HandProfilePanelOptions {
  /** User changed the override select. */
  onOverride(choice: OverrideChoice): void;
  /** User asked to re-run the on-device adaptation. */
  onReadapt(): void;
}

export function createHandProfilePanel(opts: HandProfilePanelOptions): HandProfilePanel {
  let override = loadProfileOverride();

  const root = document.createElement('section');
  root.className = 'mc-hands-panel';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', 'Hand-adaptive input settings');

  const header = document.createElement('div');
  header.className = 'mc-panel-head';
  const title = document.createElement('h2');
  title.textContent = 'Adapt to my hands';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mc-panel-x';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close hand settings');
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);

  // Current profile + reason.
  const current = document.createElement('p');
  current.className = 'mc-hands-current';
  current.setAttribute('role', 'status');
  current.setAttribute('aria-live', 'polite');
  current.textContent = 'Not adapted yet — pinch a few times to calibrate.';

  // Override select.
  const overrideRow = document.createElement('div');
  overrideRow.className = 'mc-hands-row';
  const overrideLabel = document.createElement('label');
  overrideLabel.htmlFor = 'mc-hands-override';
  overrideLabel.textContent = 'Profile';
  const select = document.createElement('select');
  select.id = 'mc-hands-override';
  for (const opt of ['auto', ...ALL_PROFILES] as OverrideChoice[]) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt === 'auto' ? 'Auto (adapt for me)' : PROFILE_LABELS[opt];
    select.appendChild(o);
  }
  select.value = override;
  select.addEventListener('change', () => {
    override = select.value as OverrideChoice;
    saveProfileOverride(override);
    opts.onOverride(override);
  });
  overrideRow.append(overrideLabel, select);

  // Live metrics (numbers only).
  const metricsEl = document.createElement('dl');
  metricsEl.className = 'mc-hands-metrics';

  // Footer: re-adapt + privacy note.
  const footer = document.createElement('div');
  footer.className = 'mc-panel-foot';
  const readaptBtn = document.createElement('button');
  readaptBtn.type = 'button';
  readaptBtn.className = 'mc-btn-reset';
  readaptBtn.textContent = 'Re-adapt now';
  readaptBtn.addEventListener('click', () => opts.onReadapt());
  footer.append(readaptBtn);

  const note = document.createElement('p');
  note.className = 'mc-panel-note';
  note.textContent = 'These numbers are measured from your hand landmarks and stay on this device — nothing is uploaded. Override sticks on this device.';

  root.append(header, current, overrideRow, metricsEl, note, footer);

  function setAdaptation(a: ProfileAdaptation): void {
    current.textContent = `Profile: ${PROFILE_LABELS[a.profile.name]} (by ${SOURCE_LABELS[a.source]}). ${a.reason}`;
  }

  function row(dl: HTMLElement, k: string, v: string): void {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }

  function setMetrics(m: HandMetrics | null): void {
    metricsEl.textContent = '';
    if (!m || m.pinches === 0) {
      const p = document.createElement('p');
      p.className = 'mc-hands-hint';
      p.textContent = 'No pinches measured yet.';
      metricsEl.appendChild(p);
      return;
    }
    row(metricsEl, 'Pinch effort', `${Math.round(m.pinchEffort * 100)}%`);
    row(metricsEl, 'Tremor', m.tremor.toFixed(4));
    row(metricsEl, 'Pinch time', `${Math.round(m.pinchMs)} ms`);
    row(metricsEl, 'Fatigue', `${Math.round(m.fatigue * 100)}%`);
    row(metricsEl, 'Pinches', String(m.pinches));
  }

  function open(): void { root.hidden = false; closeBtn.focus(); }
  function close(): void { root.hidden = true; }

  return {
    element: root,
    open,
    close,
    toggle() { root.hidden ? open() : close(); },
    isOpen: () => !root.hidden,
    getOverride: () => override,
    setAdaptation,
    setMetrics,
    dispose() { root.remove(); },
  };
}
