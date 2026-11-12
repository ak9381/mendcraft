import './style.css';
import { Engine, type SceneState } from './core/scene';
import { buildTemplate, isTemplateName } from './core/templates';
import { buildScene } from './core/geometry';
import { meshesToSTL, downloadSTL } from './core/stl';
import type { ViewportHandle } from './ui/viewport';
import { getActiveMode, listModes, setActiveMode } from './core/modes';
import type { HandEvent } from './input/hands';
import { createPresenceTracker, type PresenceTracker, type PresenceFrame } from './input/presence';
import { createHandOverlay } from './ui/handOverlay';
import { createFaceOverlay } from './ui/faceOverlay';
import { createVoiceController, type VoiceController } from './input/voice';
import { SIM_ACTIVE, DEMO_SCRIPT, mountSimCursor, playDemo } from './sim';
import {
  initDeviceModel,
  checkDeviceAvailability,
  compileCommand,
  verifyOp,
  generateTemplate,
  isDesignRequest,
  prepareHybrid,
  getHybridStatus,
  type DeviceModelStatus,
} from './ai/hybrid';

const ONBOARD_KEY = 'mendcraft.onboarded';
const MODE_KEY = 'mendcraft.mode';
const DRAG_MM_RANGE = 300;

const engine = new Engine();

// Restore a previously chosen (ready) mode before reading the active one.
try {
  const storedMode = localStorage.getItem(MODE_KEY);
  if (storedMode) setActiveMode(storedMode);
} catch {
  // Storage blocked — fall back to the default mode.
}
const mode = getActiveMode();

const hintButtonsHtml = mode.hints
  .map((h) => `<button type="button" data-cmd="${h.command}">${h.label}</button>`)
  .join('');

const modeSwitchHtml = listModes()
  .map((m) => {
    const active = m.id === mode.id;
    const soon = m.status === 'coming-soon';
    const title = soon ? `${m.label} — coming soon` : m.description;
    return `<button type="button" class="mode-btn${active ? ' active' : ''}" data-mode="${m.id}" aria-pressed="${active}" ${soon ? 'disabled' : ''} title="${title}">${m.label}${soon ? ' · soon' : ''}</button>`;
  })
  .join('');

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header id="topbar">
    <span class="brand">Mendcraft</span>
    <div id="mode-switch" role="group" aria-label="Design mode">${modeSwitchHtml}</div>
    <button id="btn-help" type="button" class="ghost" aria-label="Help and guided tour">Help / tour</button>
    ${SIM_ACTIVE ? '<span class="badge badge-sim" title="Judge/simulation mode — no camera or mic needed">SIM</span>' : ''}
    <button id="btn-camera" type="button" aria-pressed="false">Enable camera</button>
    <button id="btn-register" type="button" hidden>Register me</button>
    <button id="btn-reregister" type="button" hidden>Re-register</button>
    <button id="btn-mic" type="button" aria-pressed="false">Enable mic</button>
    <button id="btn-ai" type="button" disabled>Checking on-device AI…</button>
    <div id="progress-wrap" hidden>
      <div id="progress-bar" role="progressbar" aria-label="On-device AI download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="progress-fill"></div></div>
      <span id="progress-label">0%</span>
    </div>
    <div class="spacer"></div>
    <button id="btn-undo" type="button">Undo</button>
    <button id="btn-redo" type="button">Redo</button>
    <button id="btn-export" type="button">Export STL</button>
    ${SIM_ACTIVE ? '<button id="btn-demo" type="button">Play demo</button>' : ''}
  </header>
  <div id="statusbar" role="group" aria-label="System status">
    <span class="status-chip">
      <span class="status-k">AI</span>
      <span id="source-badge" class="badge badge-rules" tabindex="0" role="img">RULES</span>
    </span>
    <span class="status-chip"><span class="status-k">On-device model</span><span id="model-state" class="status-v">checking…</span></span>
    <span class="status-chip"><span class="status-k">Facing</span><span id="facing-state" class="status-v">—</span></span>
    <span class="status-chip"><span class="status-k">Operator</span><span id="operator-state" class="status-v">—</span></span>
    <span class="status-chip"><span class="status-k">Tracking</span><span id="tracking-state" class="status-v">camera off</span></span>
  </div>
  <div id="layout">
    <div id="viewport" role="application" aria-label="3D build viewport. Click a part to select it.">
      <div id="resume-hint" class="resume-hint" role="status" hidden>Look at the screen to resume</div>
      <p id="privacy-line" class="privacy-line" hidden>Face and hand data stay on this device. Nothing is uploaded.</p>
      <div id="empty-hint" class="empty-hint">
        <p>${mode.hint}</p>
        <div class="hint-buttons">${hintButtonsHtml}</div>
      </div>
    </div>
    <aside id="panel" aria-label="Build details">
      <div id="fail-states" role="alert"></div>
      <section>
        <h2>Parts</h2>
        <ul id="parts-list"></ul>
      </section>
      <section>
        <h2>Command</h2>
        <form id="command-box">
          <input id="command-input" type="text" placeholder="${mode.inputPlaceholder}" aria-label="Type a build command" autocomplete="off" />
          <button id="btn-say" type="submit">Send</button>
        </form>
        <p id="last-command" class="last-command"></p>
        <pre id="op-json" aria-label="Last operation (JSON)"></pre>
      </section>
      <section>
        <h2>Verifier</h2>
        <p id="verifier-result" class="verifier-result">No command run yet.</p>
      </section>
      <section>
        <h2>Printability</h2>
        <ul id="warnings"></ul>
      </section>
    </aside>
  </div>
  <div id="sr-live" class="sr-only" aria-live="polite"></div>
  <div id="status-live" class="sr-only" aria-live="polite"></div>
  <div id="onboarding" hidden></div>
`;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewportEl = el<HTMLDivElement>('viewport');
const emptyHint = el<HTMLDivElement>('empty-hint');
const sourceBadge = el<HTMLSpanElement>('source-badge');
const modelStateEl = el<HTMLSpanElement>('model-state');
const facingStateEl = el<HTMLSpanElement>('facing-state');
const operatorStateEl = el<HTMLSpanElement>('operator-state');
const trackingStateEl = el<HTMLSpanElement>('tracking-state');
const partsList = el<HTMLUListElement>('parts-list');
const opJsonEl = el<HTMLPreElement>('op-json');
const lastCommandEl = el<HTMLParagraphElement>('last-command');
const verifierEl = el<HTMLParagraphElement>('verifier-result');
const warningsEl = el<HTMLUListElement>('warnings');
const failStatesEl = el<HTMLDivElement>('fail-states');
const srLive = el<HTMLDivElement>('sr-live');
const statusLive = el<HTMLDivElement>('status-live');
const btnHelp = el<HTMLButtonElement>('btn-help');
const btnCamera = el<HTMLButtonElement>('btn-camera');
const btnRegister = el<HTMLButtonElement>('btn-register');
const btnReregister = el<HTMLButtonElement>('btn-reregister');
const resumeHint = el<HTMLDivElement>('resume-hint');
const privacyLine = el<HTMLParagraphElement>('privacy-line');
const btnMic = el<HTMLButtonElement>('btn-mic');
const btnAi = el<HTMLButtonElement>('btn-ai');
const btnUndo = el<HTMLButtonElement>('btn-undo');
const btnRedo = el<HTMLButtonElement>('btn-redo');
const btnExport = el<HTMLButtonElement>('btn-export');
const progressWrap = el<HTMLDivElement>('progress-wrap');
const progressBar = el<HTMLDivElement>('progress-bar');
const progressFill = el<HTMLDivElement>('progress-fill');
const progressLabel = el<HTMLSpanElement>('progress-label');
const commandForm = el<HTMLFormElement>('command-box');
const commandInput = el<HTMLInputElement>('command-input');

function say(message: string): void {
  srLive.textContent = message;
  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(message);
    utter.rate = 1.1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }
}

/** Curated, de-duplicated screen-reader status (no TTS, polite — not spammy). */
let lastStatusAnnounced = '';
function announceStatus(message: string): void {
  if (message === lastStatusAnnounced) return;
  lastStatusAnnounced = message;
  statusLive.textContent = message;
}

function fail(id: string, message: string): void {
  if (document.getElementById(id)) return;
  const div = document.createElement('div');
  div.id = id;
  div.className = 'fail-banner';
  div.textContent = message;
  failStatesEl.appendChild(div);
}
function clearFail(id: string): void {
  document.getElementById(id)?.remove();
}

const SOURCE_TOOLTIP: Record<'on-device' | 'cloud' | 'rules', string> = {
  'on-device': 'Answered by Gemini Nano running on your device. Nothing left the browser.',
  cloud: 'Answered by the cloud model (Firebase AI Logic, App Check required).',
  rules: 'Answered by the built-in deterministic parser — fully offline, no AI.',
};

function setBadge(source: 'on-device' | 'cloud' | 'rules'): void {
  sourceBadge.className = `badge badge-${source}`;
  const label = source.toUpperCase().replace('-', ' ');
  sourceBadge.textContent = label;
  sourceBadge.title = SOURCE_TOOLTIP[source];
  sourceBadge.setAttribute('aria-label', `AI source: ${label}. ${SOURCE_TOOLTIP[source]}`);
}
setBadge('rules');

// ---- rendering ----

function renderAll(): void {
  const state = engine.getState();
  viewport.render(state);
  renderParts(state);
  renderWarnings();
  emptyHint.hidden = state.parts.length > 0;
}

function renderParts(state: SceneState): void {
  partsList.innerHTML = '';
  for (const part of state.parts) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const selected = part.id === state.selectedId;
    btn.textContent = part.name + (selected ? ' (selected)' : '');
    btn.setAttribute('aria-pressed', String(selected));
    if (selected) btn.classList.add('active');
    btn.addEventListener('click', () => {
      engine.apply({ op: 'select', target: part.id });
      renderAll();
    });
    li.appendChild(btn);
    partsList.appendChild(li);
  }
}

function renderWarnings(): void {
  const warnings = engine.printability();
  warningsEl.innerHTML = '';
  for (const w of warnings) {
    const li = document.createElement('li');
    li.textContent = w.message;
    warningsEl.appendChild(li);
  }
}

// ---- viewport + selection ----

const viewport: ViewportHandle = await mode.createRenderer(viewportEl, (partId) => {
  if (!partId) return;
  engine.apply({ op: 'select', target: partId });
  renderAll();
});

// ---- command pipeline (shared by voice, text, and sim) ----

function applyTemplateResult(result: { template: string; params: Record<string, number> }): boolean {
  opJsonEl.textContent = JSON.stringify(result, null, 2);
  if (!isTemplateName(result.template)) {
    verifierEl.textContent = `Unknown template "${result.template}".`;
    return false;
  }
  // A template starts its design fresh: replace the plate's parts in one
  // undoable step (undo brings the previous design back).
  const applied = engine.applyTemplate(buildTemplate(result.template, result.params));
  if (!applied.ok) {
    verifierEl.textContent = `Template step failed: ${applied.error}`;
    say(`Could not finish: ${applied.error}`);
    renderAll();
    return false;
  }
  verifierEl.textContent = `Applied template "${result.template}".`;
  say(`Built ${result.template}.`);
  renderAll();
  announceWarnings();
  return true;
}

async function runUtterance(utterance: string): Promise<void> {
  lastCommandEl.textContent = `"${utterance}"`;
  let ok = false;
  try {
    ok = await runUtteranceInner(utterance);
  } finally {
    renderAiStatus();
  }
  if (ok) onboarding.notifyCommand();
}

async function runUtteranceInner(utterance: string): Promise<boolean> {
  const before = engine.summary();
  const state = engine.getState();

  // Longer design requests go to the cloud-only template model, with the
  // rule parser as fallback inside generateTemplate.
  if (isDesignRequest(utterance)) {
    const tmpl = await generateTemplate(utterance);
    setBadge(tmpl.source);
    if ('clarify' in tmpl) {
      opJsonEl.textContent = '';
      verifierEl.textContent = tmpl.clarify;
      say(tmpl.clarify);
      return false;
    }
    return applyTemplateResult(tmpl);
  }

  const { result, source } = await compileCommand(utterance, before, state.selectedId);
  setBadge(source);

  if ('clarify' in result) {
    opJsonEl.textContent = '';
    verifierEl.textContent = result.clarify;
    say(result.clarify);
    return false;
  }

  if ('template' in result) {
    return applyTemplateResult(result);
  }

  // Single op: validate (AI output is never trusted), apply, then verify intent.
  const validated = mode.validateOp(result);
  opJsonEl.textContent = JSON.stringify(result, null, 2);
  if (!validated.ok) {
    verifierEl.textContent = `Rejected: ${validated.error}`;
    say(`I couldn't do that: ${validated.error}`);
    return false;
  }

  const applied = engine.apply(validated.op);
  if (!applied.ok) {
    verifierEl.textContent = `Failed: ${applied.error}`;
    say(`Couldn't do that: ${applied.error}`);
    return false;
  }

  renderAll();
  const after = engine.summary();
  const verdict = await verifyOp(validated.op, before, after, applied.warnings.map((w) => w.message));
  if (verdict.matchesIntent) {
    verifierEl.textContent = `Matches intent (${verdict.source}).`;
  } else {
    verifierEl.textContent = `Possible mismatch: ${verdict.issue ?? 'unverified'} (${verdict.source}).`;
    say(verdict.issue ?? 'That may not match what you asked for.');
  }
  announceWarnings();
  return true;
}

function announceWarnings(): void {
  const warnings = engine.printability();
  if (warnings.length > 0) say(warnings[0].message);
}

commandForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = commandInput.value.trim();
  if (!text) return;
  commandInput.value = '';
  void runUtterance(text);
});

// ---- undo/redo/export ----

btnUndo.addEventListener('click', () => {
  engine.apply({ op: 'undo' });
  renderAll();
});
btnRedo.addEventListener('click', () => {
  engine.apply({ op: 'redo' });
  renderAll();
});
btnExport.addEventListener('click', () => {
  const meshes = buildScene(engine.getState());
  if (meshes.length === 0) {
    say('Nothing to export yet.');
    return;
  }
  downloadSTL(meshesToSTL(meshes), 'mendcraft.stl');
  say('Exported STL.');
});

// ---- voice ----

const voice: VoiceController = createVoiceController((utterance) => void runUtterance(utterance));

if (!voice.supported) {
  btnMic.disabled = true;
  fail('fail-mic', 'Voice recognition is not supported in this browser — use the text command box instead.');
}

btnMic.addEventListener('click', () => {
  const nowOn = btnMic.getAttribute('aria-pressed') !== 'true';
  btnMic.setAttribute('aria-pressed', String(nowOn));
  btnMic.classList.toggle('active', nowOn);
  btnMic.textContent = nowOn ? 'Mic on' : 'Enable mic';
  voice.setAlwaysOn(nowOn);
  say(nowOn ? 'Listening.' : 'Mic off.');
});

// ---- hand tracking ----

const handOverlay = createHandOverlay(viewportEl);
const faceOverlay = createFaceOverlay(viewportEl);
const handCursor = document.createElement('div');
handCursor.className = 'hand-cursor';
handCursor.hidden = true;
viewportEl.appendChild(handCursor);

function placeCursor(x: number, y: number): void {
  // With the real camera on, the full skeleton overlay replaces the dot.
  if (tracker) {
    handCursor.hidden = true;
    return;
  }
  const rect = viewportEl.getBoundingClientRect();
  handCursor.hidden = false;
  handCursor.style.left = `${x * rect.width}px`;
  handCursor.style.top = `${y * rect.height}px`;
}

function toClient(x: number, y: number): { clientX: number; clientY: number } {
  const rect = viewportEl.getBoundingClientRect();
  return { clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height };
}

function handleHandEvent(e: HandEvent): void {
  switch (e.type) {
    case 'tracking':
      placeCursor(e.x, e.y);
      break;
    case 'pinch-start':
      placeCursor(e.x, e.y);
      handCursor.classList.add('pinching');
      break;
    case 'pinch-tap': {
      placeCursor(e.x, e.y);
      onboarding.notifyPinch();
      const { clientX, clientY } = toClient(e.x, e.y);
      const partId = viewport.pick(clientX, clientY);
      if (partId) {
        engine.apply({ op: 'select', target: partId });
        renderAll();
      }
      break;
    }
    case 'pinch-move': {
      placeCursor(e.x, e.y);
      const state = engine.getState();
      if (state.selectedId) {
        const applied = engine.apply({
          op: 'move',
          target: 'selected',
          dx: e.dx * DRAG_MM_RANGE,
          dy: -e.dy * DRAG_MM_RANGE,
          dz: 0,
        });
        if (applied.ok) renderAll();
      }
      break;
    }
    case 'pinch-end':
      handCursor.classList.remove('pinching');
      break;
    case 'lost':
      handCursor.hidden = true;
      break;
  }
}

let tracker: PresenceTracker | null = null;

function syncOperatorButtons(): void {
  const on = tracker !== null;
  const registered = tracker?.isRegistered ?? false;
  btnRegister.hidden = !on || registered;
  btnReregister.hidden = !on || !registered;
  privacyLine.hidden = !on;
}

// ---- presence status (facing / operator / tracking quality) ----

let fpsStamps: number[] = [];
function noteFps(now: number): number {
  fpsStamps.push(now);
  const cutoff = now - 1000;
  while (fpsStamps.length && fpsStamps[0] < cutoff) fpsStamps.shift();
  return fpsStamps.length;
}

function onPresenceFrame(f: PresenceFrame): void {
  handOverlay.draw(f.hands);
  faceOverlay.draw(f.faces, f.rejectedHands);

  const fps = noteFps(performance.now());
  const handCount = f.hands.length;
  if (f.paused) {
    trackingStateEl.textContent = 'paused · look at screen';
  } else {
    const quality = handCount > 0 && fps >= 12 ? 'good' : handCount > 0 ? 'poor' : 'searching';
    const plural = handCount === 1 ? 'hand' : 'hands';
    trackingStateEl.textContent = `${handCount} ${plural} · ${fps} fps · ${quality}`;
  }

  facingStateEl.textContent = f.registered
    ? f.facing ? 'facing screen' : 'looking away'
    : f.facing ? 'facing screen' : 'no face';
  operatorStateEl.textContent = f.registered ? 'locked to you' : 'anyone can drive';
}

function resetPresenceStatus(): void {
  fpsStamps = [];
  facingStateEl.textContent = '—';
  operatorStateEl.textContent = '—';
  trackingStateEl.textContent = 'camera off';
}

function setCameraBusy(busy: boolean): void {
  btnCamera.setAttribute('aria-busy', String(busy));
  if (busy) {
    btnCamera.textContent = 'Starting camera…';
    btnCamera.disabled = true;
    trackingStateEl.textContent = 'starting camera…';
  } else {
    btnCamera.disabled = false;
  }
}

async function enableCamera(): Promise<boolean> {
  if (tracker) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    fail('fail-camera-unsupported', 'This browser cannot access a camera — pinch gestures are unavailable. Voice and text still work.');
    return false;
  }
  setCameraBusy(true);
  try {
    const t = createPresenceTracker(handleHandEvent, onPresenceFrame);
    t.onPauseChange((paused) => {
      resumeHint.hidden = !paused;
      if (paused) {
        handCursor.classList.remove('pinching');
        say('Look at the screen to resume.');
      } else {
        say('Resumed.');
      }
    });
    await t.start();
    tracker = t;
    setCameraBusy(false);
    btnCamera.setAttribute('aria-pressed', 'true');
    btnCamera.classList.add('active');
    btnCamera.textContent = 'Camera on';
    clearFail('fail-camera');
    syncOperatorButtons();
    announceStatus('Camera on.');
    say('Camera on. Pinch to select or drag a part. Press "Register me" to lock onto your face.');
    return true;
  } catch {
    tracker = null;
    setCameraBusy(false);
    btnCamera.setAttribute('aria-pressed', 'false');
    btnCamera.classList.remove('active');
    btnCamera.textContent = 'Enable camera';
    fail('fail-camera', 'Could not access the camera — pinch gestures are unavailable. Voice and text still work.');
    syncOperatorButtons();
    resetPresenceStatus();
    return false;
  }
}

function disableCamera(): void {
  tracker?.stop();
  tracker = null;
  handOverlay.clear();
  faceOverlay.clear();
  resumeHint.hidden = true;
  btnCamera.setAttribute('aria-pressed', 'false');
  btnCamera.classList.remove('active');
  btnCamera.textContent = 'Enable camera';
  handCursor.hidden = true;
  syncOperatorButtons();
  resetPresenceStatus();
  say('Camera off.');
}

function registerOperator(): boolean {
  if (!tracker) return false;
  if (tracker.register()) {
    syncOperatorButtons();
    announceStatus('Registered. Tracking your hands only.');
    say('Registered. Tracking your hands only.');
    return true;
  }
  say('No face detected yet. Face the camera and try again.');
  return false;
}

btnCamera.addEventListener('click', () => {
  if (btnCamera.getAttribute('aria-pressed') === 'true' || tracker) {
    disableCamera();
  } else {
    void enableCamera();
  }
});

btnRegister.addEventListener('click', () => {
  registerOperator();
});

btnReregister.addEventListener('click', () => {
  if (!tracker) return;
  tracker.reregister();
  resumeHint.hidden = true;
  syncOperatorButtons();
  announceStatus('Registration reset. Anyone can control again.');
  say('Registration reset. Any face can control again.');
});

// ---- on-device AI ----
// A Firebase key is not "on-device ready". The user must click to call
// initializeDeviceModel; we then show downloading, ready, or failed.

const DEVICE_LABELS: Record<DeviceModelStatus, string> = {
  idle: 'Checking on-device AI…',
  unsupported: 'On-device AI: not in this browser',
  unavailable: 'On-device AI: unavailable here',
  downloadable: 'Download on-device AI',
  downloading: 'Resume on-device AI download',
  ready: 'On-device AI ready',
  failed: 'Retry on-device AI',
};

function renderDeviceButton(status: DeviceModelStatus): void {
  btnAi.textContent = DEVICE_LABELS[status];
  btnAi.disabled = status === 'idle' || status === 'unsupported' || status === 'unavailable' || status === 'ready';
  btnAi.dataset.status = status;
  if (status === 'unsupported' || status === 'unavailable') {
    btnAi.title = 'Chrome reports Gemini Nano cannot run on this device. Commands use the cloud model instead.';
  } else {
    btnAi.title = '';
  }
}

const DEVICE_STATE_TEXT: Record<DeviceModelStatus, string> = {
  idle: 'checking…',
  unsupported: 'not supported',
  unavailable: 'unavailable',
  downloadable: 'not downloaded',
  downloading: 'downloading…',
  ready: 'ready',
  failed: 'failed',
};

function renderAiStatus(): void {
  const st = getHybridStatus();
  const cloud = st.appCheck === 'ready' ? 'Cloud AI on' : st.appCheck === 'failed' ? 'Cloud AI off' : 'Rules only';
  modelStateEl.textContent = `${DEVICE_STATE_TEXT[st.deviceModel]} · ${cloud}`;
  modelStateEl.title = st.lastError ?? '';
}

btnAi.addEventListener('click', async () => {
  btnAi.disabled = true;
  btnAi.textContent = 'Downloading on-device AI…';
  progressWrap.hidden = false;
  progressFill.style.width = '0%';
  progressBar.setAttribute('aria-valuenow', '0');
  progressLabel.textContent = 'starting…';
  clearFail('fail-ai');
  let sawProgress = false;
  const ok = await initDeviceModel((p) => {
    sawProgress = true;
    const pct = Math.round(p * 100);
    progressFill.style.width = `${pct}%`;
    progressBar.setAttribute('aria-valuenow', String(pct));
    progressLabel.textContent = `${pct}%`;
  });
  progressWrap.hidden = true;
  const status = getHybridStatus();
  renderDeviceButton(status.deviceModel);
  renderAiStatus();
  if (ok) {
    announceStatus('On-device AI ready.');
    say(sawProgress ? 'On-device AI downloaded and ready.' : 'On-device AI is ready.');
  } else {
    const why =
      status.deviceModel === 'unavailable' || status.deviceModel === 'unsupported'
        ? 'Chrome says on-device AI is not available on this device. Using the cloud model instead.'
        : `On-device AI did not start${status.lastError ? ` (${status.lastError})` : ''}. Using the cloud model instead.`;
    fail('fail-ai', why);
    say('On-device AI is not available. Using the cloud.');
  }
});

for (const btn of emptyHint.querySelectorAll<HTMLButtonElement>('button[data-cmd]')) {
  btn.addEventListener('click', () => void runUtterance(btn.dataset.cmd!));
}

// Mode switch: 'ready' modes reload the shell under the chosen mode; coming-soon
// buttons are disabled. Only 'part' is ready today, so this mostly surfaces the
// roadmap, but the switch is wired for when 'plan'/'ui' land.
for (const btn of document.querySelectorAll<HTMLButtonElement>('#mode-switch [data-mode]')) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.mode!;
    if (id === mode.id) return;
    if (setActiveMode(id)) {
      try {
        localStorage.setItem(MODE_KEY, id);
      } catch {
        // Storage blocked — the mode just won't persist across reloads.
      }
      location.reload();
    }
  });
}

void prepareHybrid().then(async (status) => {
  if (status.appCheck === 'failed' || status.message) {
    fail('fail-appcheck', `${status.message ?? 'App Check is required. Using rules only.'}${status.lastError ? ` (${status.lastError})` : ''}`);
    setBadge('rules');
  }
  renderDeviceButton(await checkDeviceAvailability());
  renderAiStatus();
});

// ---- sim mode ----

if (SIM_ACTIVE) {
  mountSimCursor(viewportEl, handleHandEvent);
  const btnDemo = document.getElementById('btn-demo') as HTMLButtonElement | null;
  btnDemo?.addEventListener('click', () => {
    btnDemo.disabled = true;
    void playDemo(
      DEMO_SCRIPT,
      runUtterance,
      (step) => {
        lastCommandEl.textContent = `SIM: ${step.label}`;
      },
      () => btnExport.click(),
    ).finally(() => {
      btnDemo.disabled = false;
    });
  });
}

// ---- onboarding: a real guided flow, skippable at every step ----

interface OnboardStep {
  id: 'privacy' | 'camera' | 'register' | 'pinch' | 'command';
  title: string;
}

const ONBOARD_STEPS: OnboardStep[] = [
  { id: 'privacy', title: 'Your privacy' },
  { id: 'camera', title: 'Turn on the camera' },
  { id: 'register', title: 'Register yourself' },
  { id: 'pinch', title: 'Try a pinch' },
  { id: 'command', title: 'Say or type a command' },
];

const onboarding = createOnboarding();
btnHelp.addEventListener('click', () => onboarding.open(0));

function createOnboarding() {
  const overlay = el<HTMLDivElement>('onboarding');
  let index = 0;
  let open = false;
  let restoreFocus: HTMLElement | null = null;

  function markDone(): void {
    try {
      localStorage.setItem(ONBOARD_KEY, '1');
    } catch {
      // Private mode / storage blocked — tour just won't be remembered.
    }
  }

  function close(): void {
    open = false;
    overlay.hidden = true;
    overlay.innerHTML = '';
    markDone();
    restoreFocus?.focus();
  }

  function next(): void {
    if (index >= ONBOARD_STEPS.length - 1) {
      close();
      return;
    }
    index += 1;
    render();
  }

  function back(): void {
    if (index > 0) {
      index -= 1;
      render();
    }
  }

  function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (variant) b.className = variant;
    b.addEventListener('click', onClick);
    return b;
  }

  function render(): void {
    const step = ONBOARD_STEPS[index];
    overlay.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'onboard-title');

    const heading = document.createElement('h2');
    heading.id = 'onboard-title';
    heading.tabIndex = -1;
    heading.textContent = `${step.title} (${index + 1} of ${ONBOARD_STEPS.length})`;
    card.appendChild(heading);

    const body = document.createElement('p');
    const note = document.createElement('p');
    note.className = 'onboard-note';
    note.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'onboard-actions';

    const cameraOn = tracker !== null;
    const noCamera = !navigator.mediaDevices?.getUserMedia;

    switch (step.id) {
      case 'privacy':
        body.textContent =
          'Camera frames are processed on this device to detect your face and pinch gestures. ' +
          'They are never uploaded or stored. You can skip the camera entirely and use voice or the keyboard.';
        actions.append(button('Next', next, 'primary'));
        break;

      case 'camera':
        if (noCamera) {
          body.textContent = 'No camera is available in this browser. That is fine — you can drive everything with voice or the keyboard.';
          actions.append(button('Continue without camera', next, 'primary'));
        } else if (cameraOn) {
          body.textContent = 'Camera is on. ✓';
          actions.append(button('Next', next, 'primary'));
        } else {
          body.textContent = 'Turn on the camera to control parts by pinching. We will ask the browser for permission.';
          const enable = button('Enable camera', async () => {
            enable.disabled = true;
            note.textContent = 'Starting camera…';
            const ok = await enableCamera();
            if (ok) {
              next();
            } else {
              enable.disabled = false;
              note.textContent = noCamera || !navigator.mediaDevices?.getUserMedia
                ? 'No camera found.'
                : 'Camera was blocked or unavailable. You can skip and use voice or keyboard.';
            }
          }, 'primary');
          actions.append(enable);
          actions.append(button('Skip — use voice / keyboard', next, 'ghost'));
        }
        break;

      case 'register':
        if (!cameraOn) {
          body.textContent = 'Registration locks tracking to your face so other people nearby cannot move your parts. It needs the camera, which is off — you can set it up later from “Register me”.';
          actions.append(button('Skip', next, 'primary'));
        } else {
          body.textContent = 'Face the camera and press “Register me”. We will lock onto your face so only your hands control the build.';
          const reg = button('Register me', () => {
            if (registerOperator()) {
              next();
            } else {
              note.textContent = 'No face detected yet. Face the camera and try again.';
            }
          }, 'primary');
          actions.append(reg);
          actions.append(button('Skip', next, 'ghost'));
        }
        break;

      case 'pinch':
        if (!cameraOn) {
          body.textContent = 'Pinching uses the camera, which is off. You can select and move parts with voice or the keyboard instead.';
          actions.append(button('Skip', next, 'primary'));
        } else {
          body.textContent = 'Touch your thumb and index finger together to pinch. Pinch now to select a part — this step advances as soon as a pinch is detected.';
          note.textContent = 'Waiting for a pinch…';
          actions.append(button('Skip', next, 'ghost'));
        }
        break;

      case 'command': {
        body.textContent = `Say or type a command to build something. Try “${mode.exampleCommand}”. This step finishes when a command succeeds.`;
        const quick = document.createElement('div');
        quick.className = 'onboard-quick';
        for (const h of mode.hints.slice(0, 3)) {
          quick.append(button(h.label, () => void runUtterance(h.command)));
        }
        card.appendChild(body);
        card.appendChild(quick);
        card.appendChild(note);
        note.textContent = 'Waiting for a command…';
        actions.append(button('Finish', close, 'primary'));
        wireFooter(card, actions);
        mountCard(card);
        return;
      }
    }

    card.appendChild(body);
    card.appendChild(note);
    wireFooter(card, actions);
    mountCard(card);
  }

  function wireFooter(card: HTMLDivElement, actions: HTMLDivElement): void {
    if (index > 0) actions.append(button('Back', back, 'ghost'));
    actions.append(button('Skip tour', close, 'ghost skip-tour'));
    card.appendChild(actions);

    const dots = document.createElement('div');
    dots.className = 'steps';
    dots.setAttribute('aria-hidden', 'true');
    ONBOARD_STEPS.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'dot' + (i === index ? ' active' : '');
      dots.appendChild(dot);
    });
    card.appendChild(dots);
  }

  function mountCard(card: HTMLDivElement): void {
    overlay.appendChild(card);
    (card.querySelector('#onboard-title') as HTMLElement | null)?.focus();
  }

  // Focus trap + Escape to close (WCAG 2.1.2 / 2.4.3).
  overlay.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = overlay.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return {
    open(from = 0): void {
      index = from;
      open = true;
      restoreFocus = (document.activeElement as HTMLElement) ?? btnHelp;
      overlay.hidden = false;
      render();
    },
    notifyPinch(): void {
      if (open && ONBOARD_STEPS[index].id === 'pinch') next();
    },
    notifyCommand(): void {
      if (open && ONBOARD_STEPS[index].id === 'command') close();
    },
  };
}

let onboardedAlready = false;
try {
  onboardedAlready = localStorage.getItem(ONBOARD_KEY) === '1';
} catch {
  onboardedAlready = false;
}
// Skip auto-onboarding on the judge path so the demo UI is never obscured;
// it stays reachable from the Help / tour button.
if (!onboardedAlready && !SIM_ACTIVE) onboarding.open(0);

if (!navigator.mediaDevices?.getUserMedia) {
  btnCamera.disabled = true;
  fail('fail-camera-unsupported', 'This browser cannot access a camera — pinch gestures are unavailable.');
}

renderAll();
