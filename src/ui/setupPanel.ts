// First-run setup wizard (DOM). All logic is pure in setup/calibration.ts,
// setup/setupState.ts, input/gestureTemplates.ts and input/faceCues.ts; this
// file owns the dialog, the step screens and feeding camera frames into them.
// Every number it computes stays in this browser (localStorage).

import { INDEX_TIP, type Pt } from '../input/handLogic';
import type { Pt3 } from '../input/faceLogic';
import { pinchRatio } from '../input/handMetrics';
import { computeCalibration, type Calibration } from '../setup/calibration';
import { CALIBRATION_TARGETS, TARGET_HOLD_MS, targetHit } from '../setup/targets';
import {
  SETUP_STEPS, CAMERA_STEPS, STEP_TITLES, nextStep, prevStep, stepProgress, loadSetup, saveSetup,
  setBinding, addTemplate, removeTemplate, type SetupData, type SetupStep,
} from '../setup/setupState';
import { createTemplateRecorder, steadiestFrame } from '../input/gestureTemplates';
import { faceRatios, type FaceRatios } from '../input/faceCues';
import { ensureCameraReady } from '../input/cameraShare';

export interface SetupTarget { id: string; label: string }
export interface SetupGesture { id: string; label: string }

export interface SetupPanelOptions {
  /** Buttons/commands a gesture or phrase can be bound to. */
  targets(): SetupTarget[];
  /** Built-in gestures she can bind (custom templates are added on top). */
  gestures(): SetupGesture[];
  cameraOn(): boolean;
  enableCamera(): Promise<boolean>;
  onChange(data: SetupData): void;
  say(text: string): void;
  /** Live check for the Connect Chrome step. */
  extensionConnected?: () => boolean;
}

export interface SetupPanel {
  readonly element: HTMLElement;
  open(step?: SetupStep): void;
  close(): void;
  isOpen(): boolean;
  data(): SetupData;
  /** Operator's primary hand (21 mirrored points) for this frame, or null. */
  feedHand(points: readonly Pt[] | null, now: number): void;
  /** Operator's face mesh for this frame, or null. */
  feedFace(landmarks: readonly Pt3[] | null): void;
}

const STILL_MS = 2500;
const PINCHES_NEEDED = 5;
const TRY_MS = 1200;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(label: string, cls = '', onClick?: () => void): HTMLButtonElement {
  const b = h('button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function createSetupPanel(opts: SetupPanelOptions): SetupPanel {
  let data = loadSetup();
  let step: SetupStep = data.completed ? 'welcome' : data.step;

  const root = h('section', 'mc-setup');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', 'mc-setup-title');

  const head = h('div', 'mc-setup-head');
  const kicker = h('p', 'mc-setup-kicker');
  const title = h('h2', 'mc-setup-title');
  title.id = 'mc-setup-title';
  const titleKn = h('p', 'mc-setup-kn');
  titleKn.lang = 'kn';
  const closeBtn = btn('✕', 'mc-panel-x', () => close());
  closeBtn.setAttribute('aria-label', 'Close setup');
  head.append(kicker, title, titleKn, closeBtn);

  const dots = h('ol', 'mc-setup-dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < SETUP_STEPS.length - 1; i++) dots.append(h('li'));

  const body = h('div', 'mc-setup-body');
  const live = h('p', 'mc-setup-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const nav = h('div', 'mc-setup-nav');
  const backBtn = btn('Back', 'ghost', () => go(prevStep(step)));
  const skipBtn = btn('Skip', 'ghost', () => go(nextStep(step)));
  const nextBtn = btn('Next', 'mc-setup-primary', () => onNext());
  nav.append(backBtn, skipBtn, nextBtn);
  root.append(head, dots, body, live, nav);

  // ---- per-step capture state ----
  let reachFrames: Pt[][] = [];
  let targetIndex = 0;
  let targetHoldStart = 0;
  let targetHits: Pt[] = [];
  let pinchFrames: Pt[][] = [];
  let pinchCount = 0;
  let wasPinched = false;
  let stillFrames: Pt[][] = [];
  let stillStart = 0;
  let faceSamples: FaceRatios[] = [];
  let capturingFace = false;
  let recorder: ReturnType<typeof createTemplateRecorder> | null = null;
  let recordTarget = '';
  let tryFrames: Pt[][] = [];
  let tryUntil = 0;
  let progressEl: HTMLDivElement | null = null;

  function persist(): void {
    saveSetup(data);
    opts.onChange(data);
  }

  function setProgress(f: number): void {
    if (progressEl) progressEl.style.setProperty('--p', String(Math.max(0, Math.min(1, f))));
  }

  function progressBar(): HTMLDivElement {
    const wrap = h('div', 'mc-setup-progress');
    wrap.setAttribute('role', 'progressbar');
    wrap.setAttribute('aria-label', 'Progress');
    progressEl = wrap;
    setProgress(0);
    return wrap;
  }

  function cameraNote(): HTMLElement | null {
    if (opts.cameraOn()) return null;
    const p = h('div', 'mc-setup-camera');
    p.append(h('p', '', 'This step uses the camera. Video stays on this device.'));
    p.append(btn('Turn on camera', 'mc-setup-primary', async () => {
      if (await opts.enableCamera()) render();
    }));
    return p;
  }

  function resetCapture(): void {
    // Sample arrays survive step changes (calibration needs all three); each is
    // cleared only when its own step starts again.
    pinchCount = 0; wasPinched = false;
    stillStart = 0; faceSamples = []; capturingFace = false;
    if (step === 'reach') { reachFrames = []; targetIndex = 0; targetHoldStart = 0; targetHits = []; }
    if (step === 'pinch') pinchFrames = [];
    if (step === 'still') stillFrames = [];
    recorder = null; tryFrames = []; tryUntil = 0; progressEl = null;
  }

  function finishCalibration(): void {
    const cal: Calibration = computeCalibration({ reach: reachFrames, pinch: pinchFrames, still: stillFrames });
    data = { ...data, calibration: cal };
    persist();
  }

  function onNext(): void {
    if (step === 'still' && reachFrames.length + pinchFrames.length + stillFrames.length > 0) finishCalibration();
    if (step === 'done') {
      data = { ...data, completed: true, step: 'done' };
      persist();
      opts.say('Setup saved. You can change it any time from Set up.');
      close();
      return;
    }
    go(nextStep(step));
  }

  function go(s: SetupStep): void {
    step = s;
    if (!data.completed) { data = { ...data, step: s }; saveSetup(data); }
    resetCapture();
    render();
    const t = STEP_TITLES[s];
    opts.say(t.en);
  }

  // ---- step renderers ----
  function renderWelcome(): void {
    body.append(
      h('p', 'mc-setup-lead', 'Two minutes, once. Mendcraft learns how far your hand reaches from five spots, how firmly you can pinch, and how steady it is. Then you can give any button your own gesture or spoken phrase. Dwell, voice and pinch all click — a pinch is optional if it hurts.'),
      h('p', 'mc-setup-note', 'Everything stays on this device. No video or hand data is uploaded.'),
    );
    const list = h('ul', 'mc-setup-list');
    for (const s of ['Reach', 'Pinch', 'Hold still', 'Your gestures', 'Buttons and voice', 'Face cues (optional)', 'Connect Chrome']) list.append(h('li', '', s));
    body.append(list);
  }

  function renderCapture(text: string, kn: string): void {
    body.append(h('p', 'mc-setup-lead', text));
    const k = h('p', 'mc-setup-kn-line', kn);
    k.lang = 'kn';
    body.append(k);
    const cam = cameraNote();
    if (cam) body.append(cam);
    else body.append(progressBar());
  }

  function renderReach(): void {
    body.append(h('p', 'mc-setup-lead', 'Hold your pointing finger on each of the five spots, one at a time. This steadies the cursor and cuts false clicks.'));
    const k = h('p', 'mc-setup-kn-line', 'ಪ್ರತಿ ಚುಕ್ಕೆಯ ಮೇಲೆ ಬೆರಳು ಹಿಡಿದು ನಿಲ್ಲಿಸಿ.');
    k.lang = 'kn';
    body.append(k);
    const cam = cameraNote();
    if (cam) {
      body.append(cam);
      return;
    }
    const board = h('div', 'mc-setup-board');
    board.setAttribute('aria-label', 'Five calibration spots');
    for (let i = 0; i < CALIBRATION_TARGETS.length; i++) {
      const t = CALIBRATION_TARGETS[i];
      const spot = h('div', 'mc-setup-spot', t.label);
      spot.style.left = `${t.nx * 100}%`;
      spot.style.top = `${t.ny * 100}%`;
      if (i < targetIndex) spot.classList.add('is-done');
      if (i === targetIndex) spot.classList.add('is-current');
      board.append(spot);
    }
    body.append(board);
    body.append(progressBar());
    live.textContent = `${targetIndex} of ${CALIBRATION_TARGETS.length}`;
  }

  function renderGestures(): void {
    body.append(h('p', 'mc-setup-lead', 'Record your own version of a gesture, or a new one, in three tries. Pick what it should do, then press Record and hold the pose.'));
    const row = h('div', 'mc-setup-row');
    const sel = h('select', 'mc-setup-select');
    sel.setAttribute('aria-label', 'What the gesture does');
    for (const t of opts.targets()) {
      const o = h('option', '', t.label);
      o.value = t.id;
      sel.append(o);
    }
    if (recordTarget) sel.value = recordTarget;
    sel.addEventListener('change', () => { recordTarget = sel.value; });
    recordTarget = sel.value;
    const rec = btn(recorder ? `Record try ${recorder.tries() + 1} of 3` : 'Record (3 tries)', 'mc-setup-primary', () => startTry());
    rec.dataset.role = 'record';
    row.append(sel, rec);
    body.append(row);
    if (!opts.cameraOn()) { const cam = cameraNote(); if (cam) body.append(cam); }
    else body.append(progressBar());

    if (data.templates.length) {
      body.append(h('h3', 'mc-setup-h3', 'Your recorded gestures'));
      const ul = h('ul', 'mc-setup-templates');
      for (const t of data.templates) {
        const li = h('li');
        const bound = data.bindings.find((b) => b.gesture === `custom:${t.id}`);
        const tgt = opts.targets().find((x) => x.id === bound?.target);
        li.append(h('span', '', `${t.label}${tgt ? ` → ${tgt.label}` : ''}`));
        li.append(btn('Delete', 'ghost', () => { data = removeTemplate(data, t.id); persist(); render(); }));
        ul.append(li);
      }
      body.append(ul);
    }
  }

  async function startTry(): Promise<void> {
    const wasOn = opts.cameraOn();
    const ready = await ensureCameraReady(opts);
    if (!ready.ok) { live.textContent = ready.message; return; }
    if (!wasOn) render();
    if (!recorder) {
      const label = opts.targets().find((t) => t.id === recordTarget)?.label ?? recordTarget;
      const id = `${recordTarget}`.replace(/^btn-/, '').replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'gesture';
      recorder = createTemplateRecorder(id, label);
    }
    tryFrames = [];
    tryUntil = performance.now() + TRY_MS;
    live.textContent = 'Hold the pose…';
  }

  function endTry(): void {
    const pose = steadiestFrame(tryFrames);
    tryUntil = 0;
    if (!recorder) return;
    const res = recorder.addTry(pose ?? []);
    if (res.status === 'need-more') live.textContent = `Got try ${res.tries}. ${3 - res.tries} to go.`;
    else if (res.status === 'retry') live.textContent = res.reason;
    else {
      data = addTemplate(data, res.template);
      data = setBinding(data, { target: recordTarget, gesture: `custom:${res.template.id}`, phrase: data.bindings.find((b) => b.target === recordTarget)?.phrase });
      persist();
      live.textContent = `Saved. This gesture now does: ${res.template.label}.`;
      opts.say('Gesture saved.');
      recorder = null;
    }
    const keep = live.textContent;
    render();
    live.textContent = keep;
  }

  function renderShortcuts(): void {
    body.append(h('p', 'mc-setup-lead', 'Any button can have a gesture and a spoken phrase, in Kannada or English. Leave a box empty to keep the default.'));
    const gestures = [...opts.gestures(), ...data.templates.map((t) => ({ id: `custom:${t.id}`, label: `My: ${t.label}` }))];
    const table = h('div', 'mc-setup-shortcuts');
    for (const t of opts.targets()) {
      const b = data.bindings.find((x) => x.target === t.id);
      const row = h('div', 'mc-setup-srow');
      const name = h('span', 'mc-setup-sname', t.label);
      const sel = h('select', 'mc-setup-select');
      sel.setAttribute('aria-label', `Gesture for ${t.label}`);
      const none = h('option', '', 'Default');
      none.value = '';
      sel.append(none);
      for (const g of gestures) { const o = h('option', '', g.label); o.value = g.id; sel.append(o); }
      sel.value = b?.gesture ?? '';
      const phrase = h('input', 'mc-setup-phrase');
      phrase.type = 'text';
      phrase.placeholder = 'Say…';
      phrase.value = b?.phrase ?? '';
      phrase.setAttribute('aria-label', `Voice phrase for ${t.label}`);
      const save = () => {
        data = setBinding(data, { target: t.id, gesture: sel.value || undefined, phrase: phrase.value || undefined });
        persist();
        render();
      };
      sel.addEventListener('change', save);
      phrase.addEventListener('change', save);
      row.append(name, sel, phrase);
      table.append(row);
    }
    body.append(table);
  }

  function renderFace(): void {
    body.append(h('p', 'mc-setup-lead', 'On days your hands are sore, a smile or raised eyebrows held for a moment can confirm what is waiting (like "Send?"). They never start anything on their own.'));
    const toggle = h('label', 'mc-setup-toggle');
    const cb = h('input');
    cb.type = 'checkbox';
    cb.checked = data.faceCues;
    cb.addEventListener('change', () => { data = { ...data, faceCues: cb.checked }; persist(); render(); });
    toggle.append(cb, document.createTextNode(' Use face cues to confirm'));
    body.append(toggle);
    if (data.faceCues) {
      const cam = cameraNote();
      if (cam) body.append(cam);
      else {
        body.append(h('p', 'mc-setup-note', data.faceBaseline ? 'Neutral face saved.' : 'Look at the screen with a relaxed face, then press Capture.'));
        body.append(btn('Capture relaxed face', 'mc-setup-primary', () => { faceSamples = []; capturingFace = true; live.textContent = 'Hold a relaxed face…'; }));
      }
    }
  }

  function renderChrome(): void {
    const connected = Boolean(opts.extensionConnected?.());
    body.append(h('p', 'mc-setup-lead', 'To copy from any Chrome tab and paste with your voice or a pinch, load the Mendcraft extension once. It stays on this computer, never reads password or payment fields, and never submits a form.'));
    const ol = h('ol', 'mc-setup-list');
    for (const s of [
      'Open chrome://extensions in Chrome.',
      'Turn on Developer mode (top right).',
      'Click Load unpacked and pick the extension folder (the one with manifest.json).',
      'Come back here. This step will say “Chrome extension connected” when it is ready.',
    ]) ol.append(h('li', '', s));
    body.append(ol);
    const note = h('p', connected ? 'mc-setup-note mc-setup-chrome-on' : 'mc-setup-note', connected
      ? 'Chrome extension connected.'
      : 'You can skip this and do it later. The studio status bar also shows when the extension is connected.');
    body.append(note);
  }

  function renderDone(): void {
    const c = data.calibration;
    const ul = h('ul', 'mc-setup-list');
    ul.append(h('li', '', c ? `Reach: ${Math.round((c.reach.x1 - c.reach.x0) * 100)}% × ${Math.round((c.reach.y1 - c.reach.y0) * 100)}% of the camera view now covers the whole screen` : 'Reach: not measured (default)'));
    ul.append(h('li', '', c ? `Pinch: registers at ${c.pinchOn.toFixed(2)} (default is a soft close)` : 'Pinch: default (soft close)'));
    ul.append(h('li', '', c ? `Steadiness: smoothing ${Math.round(c.smoothing * 100)}%, dwell ${c.dwellMs} ms` : 'Steadiness: default'));
    ul.append(h('li', '', `${data.templates.length} recorded gesture${data.templates.length === 1 ? '' : 's'}, ${data.bindings.length} custom shortcut${data.bindings.length === 1 ? '' : 's'}`));
    ul.append(h('li', '', `Face cues: ${data.faceCues ? 'on' : 'off'}`));
    body.append(h('p', 'mc-setup-lead', 'Saved on this device. Buttons with a gesture show a small badge, and every button also works with a pinch (or hover and wait).'), ul);
    const hints = h('label', 'mc-setup-toggle');
    const cb = h('input');
    cb.type = 'checkbox';
    cb.checked = data.showHints;
    cb.addEventListener('change', () => { data = { ...data, showHints: cb.checked }; persist(); });
    hints.append(cb, document.createTextNode(' Show gesture hints on buttons'));
    const dw = h('label', 'mc-setup-toggle');
    const dcb = h('input');
    dcb.type = 'checkbox';
    dcb.checked = data.dwellClick;
    dcb.addEventListener('change', () => { data = { ...data, dwellClick: dcb.checked }; persist(); });
    dw.append(dcb, document.createTextNode(` Hover and wait to click (dwell${c ? `, ${c.dwellMs} ms` : ''})`));
    body.append(hints, dw);
  }

  function render(): void {
    body.replaceChildren();
    live.textContent = '';
    progressEl = null;
    const t = STEP_TITLES[step];
    const { index, total } = stepProgress(step);
    kicker.textContent = step === 'done' ? 'Setup' : `Setup · step ${index + 1} of ${total}`;
    title.textContent = t.en;
    titleKn.textContent = t.kn;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i <= index));
    backBtn.hidden = step === 'welcome';
    skipBtn.hidden = step === 'welcome' || step === 'done';
    nextBtn.textContent = step === 'welcome' ? 'Start' : step === 'done' ? 'Finish' : 'Next';
    switch (step) {
      case 'welcome': renderWelcome(); break;
      case 'reach': renderReach(); break;
      case 'pinch': renderCapture(`Pinch ${PINCHES_NEEDED} times, only as firmly as is comfortable today.`, 'ಇಂದು ಆರಾಮವಿರುವಷ್ಟು ಮಾತ್ರ ಚಿವುಟಿ.'); break;
      case 'still': renderCapture('Point at the screen and hold still for a moment.', 'ಪರದೆಯ ಕಡೆ ಬೆರಳು ತೋರಿಸಿ, ಸ್ವಲ್ಪ ಹೊತ್ತು ಹಾಗೇ ಇಡಿ.'); break;
      case 'gestures': renderGestures(); break;
      case 'shortcuts': renderShortcuts(); break;
      case 'face': renderFace(); break;
      case 'chrome': renderChrome(); break;
      case 'done': renderDone(); break;
    }
  }

  function feedHand(points: readonly Pt[] | null, now: number): void {
    if (root.hidden || !points || points.length < 21) return;
    const p = points as Pt[];
    if (step === 'reach' && progressEl) {
      const tip = p[INDEX_TIP];
      const current = CALIBRATION_TARGETS[targetIndex];
      if (current && tip && targetHit(tip, current)) {
        if (!targetHoldStart) targetHoldStart = now;
        const f = (now - targetHoldStart) / TARGET_HOLD_MS;
        setProgress(f);
        live.textContent = `${current.label} · ${targetIndex + 1} of ${CALIBRATION_TARGETS.length}`;
        if (f >= 1) {
          targetHits.push({ x: tip.x, y: tip.y });
          reachFrames.push(p);
          targetIndex++;
          targetHoldStart = 0;
          setProgress(0);
          if (targetIndex >= CALIBRATION_TARGETS.length) {
            live.textContent = 'Reach saved.';
            go('pinch');
          } else {
            render();
          }
        }
      } else {
        targetHoldStart = 0;
        setProgress(0);
        if (current) live.textContent = `Point at ${current.label} · ${targetIndex + 1} of ${CALIBRATION_TARGETS.length}`;
      }
    } else if (step === 'pinch' && progressEl) {
      pinchFrames.push(p);
      const r = pinchRatio(p);
      const closed = r < 0.45;
      if (closed && !wasPinched) pinchCount++;
      wasPinched = closed ? true : r > 0.55 ? false : wasPinched;
      setProgress(pinchCount / PINCHES_NEEDED);
      live.textContent = `${pinchCount} of ${PINCHES_NEEDED}`;
      if (pinchCount >= PINCHES_NEEDED && !closed) go('still');
    } else if (step === 'still' && progressEl) {
      if (!stillStart) stillStart = now;
      stillFrames.push(p);
      const f = (now - stillStart) / STILL_MS;
      setProgress(f);
      if (f >= 1) { finishCalibration(); go('gestures'); live.textContent = 'Calibration saved on this device.'; }
    } else if (step === 'gestures' && tryUntil) {
      tryFrames.push(p);
      setProgress(1 - (tryUntil - now) / TRY_MS);
      if (now >= tryUntil) endTry();
    }
  }

  function feedFace(lm: readonly Pt3[] | null): void {
    if (root.hidden || step !== 'face' || !capturingFace || !lm) return;
    const r = faceRatios(lm);
    if (r) faceSamples.push(r);
    if (faceSamples.length >= 15) {
      const n = faceSamples.length;
      data = { ...data, faceBaseline: { smile: faceSamples.reduce((s, x) => s + x.smile, 0) / n, brow: faceSamples.reduce((s, x) => s + x.brow, 0) / n } };
      capturingFace = false;
      persist();
      render();
      live.textContent = 'Relaxed face saved. Smile or raise your eyebrows to confirm.';
    }
  }

  function open(s?: SetupStep): void {
    root.hidden = false;
    step = s ?? (data.completed ? 'welcome' : data.step);
    resetCapture();
    render();
    nextBtn.focus();
  }
  function close(): void { root.hidden = true; resetCapture(); }

  void CAMERA_STEPS;
  return {
    element: root, open, close, isOpen: () => !root.hidden, data: () => data, feedHand, feedFace,
  };
}
