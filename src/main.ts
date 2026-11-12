import './style.css';
import { Engine, type SceneState } from './core/scene';
import { validateOp } from './core/ops';
import { buildTemplate, isTemplateName } from './core/templates';
import { buildScene } from './core/geometry';
import { meshesToSTL, downloadSTL } from './core/stl';
import { createViewport, type ViewportHandle } from './ui/viewport';
import { createHandTracker, type HandEvent, type HandTracker } from './input/hands';
import { createHandOverlay } from './ui/handOverlay';
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
import { TEMPLATE_HINT } from './core/ruleParser';

const ONBOARD_KEY = 'mendcraft.onboarded';
const DRAG_MM_RANGE = 300;

const engine = new Engine();

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="topbar">
    <span class="brand">Mendcraft</span>
    <span id="source-badge" class="badge badge-rules" title="Who answered the last command">RULES</span>
    <span id="ai-status" class="ai-status" aria-live="polite">Checking AI…</span>
    ${SIM_ACTIVE ? '<span class="badge badge-sim">SIM</span>' : ''}
    <button id="btn-camera" type="button" aria-pressed="false">Enable camera</button>
    <button id="btn-mic" type="button" aria-pressed="false">Enable mic</button>
    <button id="btn-ai" type="button" disabled>Checking on-device AI…</button>
    <div id="progress-wrap" hidden>
      <div id="progress-bar"><div id="progress-fill"></div></div>
      <span id="progress-label">0%</span>
    </div>
    <div class="spacer"></div>
    <button id="btn-undo" type="button">Undo</button>
    <button id="btn-redo" type="button">Redo</button>
    <button id="btn-export" type="button">Export STL</button>
    ${SIM_ACTIVE ? '<button id="btn-demo" type="button">Play demo</button>' : ''}
  </div>
  <div id="layout">
    <div id="viewport" role="application" aria-label="3D build viewport. Click a part to select it.">
      <div id="empty-hint" class="empty-hint">
        <p>${TEMPLATE_HINT}</p>
        <div class="hint-buttons">
          <button type="button" data-cmd="cup grip">Cup grip</button>
          <button type="button" data-cmd="phone stand">Phone stand</button>
          <button type="button" data-cmd="hook">Hook</button>
          <button type="button" data-cmd="utensil holder">Utensil holder</button>
        </div>
      </div>
    </div>
    <div id="panel">
      <div id="fail-states"></div>
      <section>
        <h2>Parts</h2>
        <ul id="parts-list"></ul>
      </section>
      <section>
        <h2>Command</h2>
        <form id="command-box">
          <input id="command-input" type="text" placeholder="Try: cup grip" aria-label="Type a build command" />
          <button id="btn-say" type="submit">Send</button>
        </form>
        <p id="last-command" style="font-size:0.85em;color:var(--text-dim);margin:0.5em 0 0.25em;"></p>
        <pre id="op-json"></pre>
      </section>
      <section>
        <h2>Verifier</h2>
        <p id="verifier-result" style="font-size:0.9em;margin:0;">No command run yet.</p>
      </section>
      <section>
        <h2>Printability</h2>
        <ul id="warnings"></ul>
      </section>
    </div>
  </div>
  <div id="sr-live" aria-live="polite"></div>
  <div id="onboarding">
    <div class="card">
      <div id="onboard-body"></div>
      <div class="steps">
        <span class="dot active"></span><span class="dot"></span><span class="dot"></span>
      </div>
      <p style="margin-top:1.2em;">
        <button id="btn-onboard-next" type="button">Next</button>
      </p>
    </div>
  </div>
`;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewportEl = el<HTMLDivElement>('viewport');
const emptyHint = el<HTMLDivElement>('empty-hint');
const aiStatusEl = el<HTMLSpanElement>('ai-status');
const sourceBadge = el<HTMLSpanElement>('source-badge');
const partsList = el<HTMLUListElement>('parts-list');
const opJsonEl = el<HTMLPreElement>('op-json');
const lastCommandEl = el<HTMLParagraphElement>('last-command');
const verifierEl = el<HTMLParagraphElement>('verifier-result');
const warningsEl = el<HTMLUListElement>('warnings');
const failStatesEl = el<HTMLDivElement>('fail-states');
const srLive = el<HTMLDivElement>('sr-live');
const btnCamera = el<HTMLButtonElement>('btn-camera');
const btnMic = el<HTMLButtonElement>('btn-mic');
const btnAi = el<HTMLButtonElement>('btn-ai');
const btnUndo = el<HTMLButtonElement>('btn-undo');
const btnRedo = el<HTMLButtonElement>('btn-redo');
const btnExport = el<HTMLButtonElement>('btn-export');
const progressWrap = el<HTMLDivElement>('progress-wrap');
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

function setBadge(source: 'on-device' | 'cloud' | 'rules'): void {
  sourceBadge.className = `badge badge-${source}`;
  sourceBadge.textContent = source.toUpperCase().replace('-', ' ');
}

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
    btn.textContent = part.name + (part.id === state.selectedId ? ' (selected)' : '');
    if (part.id === state.selectedId) btn.classList.add('active');
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

const viewport: ViewportHandle = createViewport(viewportEl, (partId) => {
  if (!partId) return;
  engine.apply({ op: 'select', target: partId });
  renderAll();
});

// ---- command pipeline (shared by voice, text, and sim) ----

function applyTemplateResult(result: { template: string; params: Record<string, number> }): void {
  opJsonEl.textContent = JSON.stringify(result, null, 2);
  if (!isTemplateName(result.template)) {
    verifierEl.textContent = `Unknown template "${result.template}".`;
    return;
  }
  // A template starts its design fresh: replace the plate's parts in one
  // undoable step (undo brings the previous design back).
  const applied = engine.applyTemplate(buildTemplate(result.template, result.params));
  if (!applied.ok) {
    verifierEl.textContent = `Template step failed: ${applied.error}`;
    say(`Could not finish: ${applied.error}`);
    renderAll();
    return;
  }
  verifierEl.textContent = `Applied template "${result.template}".`;
  say(`Built ${result.template}.`);
  renderAll();
  announceWarnings();
}

async function runUtterance(utterance: string): Promise<void> {
  lastCommandEl.textContent = `"${utterance}"`;
  try {
    await runUtteranceInner(utterance);
  } finally {
    renderAiStatus();
  }
}

async function runUtteranceInner(utterance: string): Promise<void> {
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
      return;
    }
    applyTemplateResult(tmpl);
    return;
  }

  const { result, source } = await compileCommand(utterance, before, state.selectedId);
  setBadge(source);

  if ('clarify' in result) {
    opJsonEl.textContent = '';
    verifierEl.textContent = result.clarify;
    say(result.clarify);
    return;
  }

  if ('template' in result) {
    applyTemplateResult(result);
    return;
  }

  // Single op: validate (AI output is never trusted), apply, then verify intent.
  const validated = validateOp(result);
  opJsonEl.textContent = JSON.stringify(result, null, 2);
  if (!validated.ok) {
    verifierEl.textContent = `Rejected: ${validated.error}`;
    say(`I couldn't do that: ${validated.error}`);
    return;
  }

  const applied = engine.apply(validated.op);
  if (!applied.ok) {
    verifierEl.textContent = `Failed: ${applied.error}`;
    say(`Couldn't do that: ${applied.error}`);
    return;
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
  voice.setAlwaysOn(nowOn);
  say(nowOn ? 'Listening.' : 'Mic off.');
});

// ---- hand tracking ----

const handOverlay = createHandOverlay(viewportEl);
const handCursor = document.createElement('div');
handCursor.className = 'hand-cursor';
handCursor.hidden = true;
viewportEl.appendChild(handCursor);

function placeCursor(x: number, y: number): void {
  // With the real camera on, the full skeleton overlay replaces the dot.
  if (handTracker) {
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

let handTracker: HandTracker | null = null;

btnCamera.addEventListener('click', async () => {
  const turningOn = btnCamera.getAttribute('aria-pressed') !== 'true';
  if (!turningOn) {
    handTracker?.stop();
    handTracker = null;
    handOverlay.clear();
    btnCamera.setAttribute('aria-pressed', 'false');
    btnCamera.classList.remove('active');
    handCursor.hidden = true;
    say('Camera off.');
    return;
  }
  try {
    handTracker = createHandTracker(handleHandEvent, (hands) => handOverlay.draw(hands));
    await handTracker.start();
    btnCamera.setAttribute('aria-pressed', 'true');
    btnCamera.classList.add('active');
    clearFail('fail-camera');
    say('Camera on. Pinch to select or drag a part.');
  } catch {
    fail('fail-camera', 'Could not access the camera — pinch gestures are unavailable. Voice and text still work.');
    handTracker = null;
  }
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

function renderAiStatus(): void {
  const st = getHybridStatus();
  const cloud = st.appCheck === 'ready' ? 'Cloud AI on' : st.appCheck === 'failed' ? 'Cloud AI off' : 'Rules only';
  const dev: Record<DeviceModelStatus, string> = {
    idle: 'on-device: checking', unsupported: 'on-device: not supported',
    unavailable: 'on-device: unavailable', downloadable: 'on-device: not downloaded',
    downloading: 'on-device: downloading', ready: 'on-device: ready', failed: 'on-device: failed',
  };
  aiStatusEl.textContent = `${cloud} · ${dev[st.deviceModel]}`;
  aiStatusEl.title = st.lastError ?? '';
}

btnAi.addEventListener('click', async () => {
  btnAi.disabled = true;
  btnAi.textContent = 'Downloading on-device AI…';
  progressWrap.hidden = false;
  progressFill.style.width = '0%';
  progressLabel.textContent = 'starting…';
  clearFail('fail-ai');
  let sawProgress = false;
  const ok = await initDeviceModel((p) => {
    sawProgress = true;
    const pct = Math.round(p * 100);
    progressFill.style.width = `${pct}%`;
    progressLabel.textContent = `${pct}%`;
  });
  progressWrap.hidden = true;
  const status = getHybridStatus();
  renderDeviceButton(status.deviceModel);
  renderAiStatus();
  if (ok) {
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

// ---- onboarding ----

const ONBOARD_STEPS = [
  { title: 'Your privacy', body: 'Camera frames are processed on this device for pinch detection and are never uploaded.' },
  { title: 'Calibrate your pinch', body: 'Turn on the camera, then touch your thumb and index finger together to select and drag parts.' },
  { title: 'Try a command', body: 'Say or type "cup grip" to build your first part.' },
];

function showOnboarding(): void {
  const overlay = el<HTMLDivElement>('onboarding');
  const body = el<HTMLDivElement>('onboard-body');
  const nextBtn = el<HTMLButtonElement>('btn-onboard-next');
  const dots = overlay.querySelectorAll<HTMLSpanElement>('.dot');
  let step = 0;

  function render(): void {
    body.innerHTML = `<h2>${ONBOARD_STEPS[step].title}</h2><p>${ONBOARD_STEPS[step].body}</p>`;
    dots.forEach((d, i) => d.classList.toggle('active', i === step));
    nextBtn.textContent = step === ONBOARD_STEPS.length - 1 ? 'Start building' : 'Next';
  }

  nextBtn.addEventListener('click', () => {
    step += 1;
    if (step >= ONBOARD_STEPS.length) {
      overlay.remove();
      localStorage.setItem(ONBOARD_KEY, '1');
      return;
    }
    render();
  });

  render();
}

if (localStorage.getItem(ONBOARD_KEY)) {
  el<HTMLDivElement>('onboarding').remove();
} else {
  showOnboarding();
}

if (!navigator.mediaDevices?.getUserMedia) {
  btnCamera.disabled = true;
  fail('fail-camera-unsupported', 'This browser cannot access a camera — pinch gestures are unavailable.');
}

renderAll();
