import './style.css';
import { getActiveMode, listModes, setActiveMode } from './core/modes';
import type { ModeController, ViewportHandle } from './core/controller';
import type { HandEvent } from './input/hands';
import { createPresenceTracker, type PresenceTracker, type PresenceFrame } from './input/presence';
import { createHandOverlay } from './ui/handOverlay';
import { createFaceOverlay } from './ui/faceOverlay';
import { createVoiceController, type VoiceController } from './input/voice';
import { createGestureRecognizer } from './input/gestures';
import type { GestureAction } from './input/gestureMap';
import { createGesturesPanel } from './ui/gesturesPanel';
import { createOnScreenKeyboard } from './ui/onscreenKeyboard';
import { createReferencePanel } from './ui/referencePanel';
import { SIM_ACTIVE, demoFor, mountSimCursor, playDemo } from './sim';
import {
  initDeviceModel,
  checkDeviceAvailability,
  explainAccessibility,
  fuseIntent,
  verifyOp,
  prepareHybrid,
  getHybridStatus,
  routerEnv,
  adaptHandProfile,
  type DeviceModelStatus,
  type FusionContext,
  type Source,
} from './ai/hybrid';
import { createHandMetricsSampler, type HandMetrics } from './input/handMetrics';
import {
  PROFILES, resolveActiveProfile, summarizeAdaptation,
  type InteractionProfile, type ProfileAdaptation,
} from './input/handProfile';
import { createHandProfilePanel } from './ui/handProfilePanel';
import { isAccessibilityRequest, type A11yIssue } from './core/a11y';
import { createA11yPanel } from './ui/a11yPanel';
import {
  REASON_TEXT,
  badgeLabel,
  finalReason,
  pickEscalated,
  planRoute,
  shouldEscalate,
  type RouteReason,
} from './ai/router';
import { createRouterPanel } from './ui/routerPanel';
import { recordInference } from './firebase/telemetry';

const ONBOARD_KEY = 'mendcraft.onboarded';
const MODE_KEY = 'mendcraft.mode';

// Restore a chosen (ready) mode: ?mode= wins, then localStorage, else default.
try {
  const queryMode = new URLSearchParams(window.location.search).get('mode');
  const storedMode = queryMode ?? localStorage.getItem(MODE_KEY);
  if (storedMode) setActiveMode(storedMode);
} catch {
  // Storage blocked — fall back to the default mode ('plan').
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
    <button id="btn-gestures" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog">Gestures</button>
    <button id="btn-hands" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="Adapt pointer sensitivity to your hands (on-device)">My hands</button>
    <button id="btn-keyboard" type="button" class="ghost" aria-pressed="false">Keyboard</button>
    <button id="btn-reference" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog">Reference</button>
    <button id="btn-routing" type="button" class="ghost" aria-pressed="false" title="Show how each command was routed (rules / on-device / cloud)">Routing</button>
    <button id="btn-a11y" type="button" class="ghost" title="Check accessibility (door widths, turning circles, contrast…) — also via the command 'check accessibility'">Access check</button>
    <button id="btn-ai" type="button" disabled>Checking on-device AI…</button>
    <div id="progress-wrap" hidden>
      <div id="progress-bar" role="progressbar" aria-label="On-device AI download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="progress-fill"></div></div>
      <span id="progress-label">0%</span>
    </div>
    <div class="spacer"></div>
    <button id="btn-undo" type="button">Undo</button>
    <button id="btn-redo" type="button">Redo</button>
    <button id="btn-3d" type="button" aria-pressed="false" hidden>3D view</button>
    <button id="btn-export" type="button">${mode.exportLabel}</button>
    ${mode.id === 'ui' ? '<button id="btn-copy-html" type="button">Copy HTML</button>' : ''}
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
    <div id="viewport" tabindex="0" role="application" aria-label="Design viewport. Click an object to select it; arrow keys pan, +/- zoom.">
      <div id="resume-hint" class="resume-hint" role="status" hidden>Look at the screen to resume</div>
      <p id="privacy-line" class="privacy-line" hidden>Face and hand data stay on this device. Nothing is uploaded.</p>
      <div id="empty-hint" class="empty-hint">
        <p>${mode.hint}</p>
        <div class="hint-buttons">${hintButtonsHtml}</div>
      </div>
    </div>
    <aside id="panel" aria-label="Design details">
      <div id="fail-states" role="alert"></div>
      <section>
        <h2>Objects</h2>
        <ul id="parts-list"></ul>
      </section>
      <section>
        <h2>Command</h2>
        <form id="command-box">
          <input id="command-input" type="text" placeholder="${mode.inputPlaceholder}" aria-label="Type a design command" autocomplete="off" />
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
        <h2>Hints</h2>
        <ul id="warnings"></ul>
      </section>
    </aside>
  </div>
  <div id="sr-live" class="sr-only" aria-live="polite"></div>
  <div id="status-live" class="sr-only" aria-live="polite"></div>
  <div id="mc-toast" class="mc-toast" role="status" aria-live="polite" hidden></div>
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
const btn3d = el<HTMLButtonElement>('btn-3d');
const btnExport = el<HTMLButtonElement>('btn-export');
const progressWrap = el<HTMLDivElement>('progress-wrap');
const progressBar = el<HTMLDivElement>('progress-bar');
const progressFill = el<HTMLDivElement>('progress-fill');
const progressLabel = el<HTMLSpanElement>('progress-label');
const commandForm = el<HTMLFormElement>('command-box');
const commandInput = el<HTMLInputElement>('command-input');

// The interaction profile currently in force (hand-adaptive input). Declared
// here so say() can honour its voiceVerbosity; retuned by applyActiveProfile().
let activeProfile: InteractionProfile = PROFILES.standard;

function say(message: string): void {
  srLive.textContent = message; // screen-reader text always updates
  // The active hand profile's voiceVerbosity tunes spoken output: 'terse' keeps
  // the screen-reader text but skips text-to-speech (less chatter for confident
  // users); 'standard'/'coached' speak normally.
  if (activeProfile.voiceVerbosity === 'terse') return;
  if ('speechSynthesis' in window) {
    const utter = new SpeechSynthesisUtterance(message);
    utter.rate = 1.1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }
}

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

function setBadge(source: Source, reason?: RouteReason): void {
  sourceBadge.className = `badge badge-${source}`;
  const label = reason ? badgeLabel(source, reason) : source.toUpperCase().replace('-', ' ');
  sourceBadge.textContent = label;
  const why = reason ? ` Route: ${REASON_TEXT[reason]}.` : '';
  sourceBadge.title = `${SOURCE_TOOLTIP[source]}${why}`;
  sourceBadge.setAttribute('aria-label', `AI source: ${label}. ${SOURCE_TOOLTIP[source]}${why}`);
}
setBadge('rules');

// ---- controller + renderer (mode-provided) ----

if (mode.id === 'ui') viewportEl.classList.add('ui-mode');
const controller: ModeController = await mode.createController();
const viewport: ViewportHandle = await mode.createRenderer(viewportEl, controller, (id) => {
  if (!id) return;
  controller.selectId(id);
  renderAll();
});

let hadContent = false;
function renderAll(): void {
  viewport.render();
  renderParts();
  renderWarnings();
  const count = controller.listItems().length;
  emptyHint.hidden = count > 0;
  // Zoom-to-fit the first time content appears (e.g. "room 4 by 3" on a blank
  // canvas) so the drawing is centred in the viewport, not under the panel.
  if (!hadContent && count > 0) {
    hadContent = true;
    viewport.fit?.();
  } else if (count === 0) {
    hadContent = false;
  }
}

function renderParts(): void {
  const items = controller.listItems();
  partsList.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.label + (item.selected ? ' (selected)' : '');
    btn.setAttribute('aria-pressed', String(item.selected));
    if (item.selected) btn.classList.add('active');
    btn.addEventListener('click', () => {
      controller.selectId(item.id);
      renderAll();
    });
    li.appendChild(btn);
    partsList.appendChild(li);
  }
}

function renderWarnings(): void {
  warningsEl.innerHTML = '';
  for (const w of controller.warnings()) {
    const li = document.createElement('li');
    li.textContent = w;
    warningsEl.appendChild(li);
  }
}

// ---- input extras: custom gestures, on-screen keyboard, reference panel ----

const btnGestures = el<HTMLButtonElement>('btn-gestures');
const btnKeyboard = el<HTMLButtonElement>('btn-keyboard');
const btnReference = el<HTMLButtonElement>('btn-reference');
const btnRouting = el<HTMLButtonElement>('btn-routing');

// On-screen keyboard lives at the bottom of the page (fixed), so elementFromPoint
// hit-testing works for the hand pointer; the float panels sit over the canvas.
const keyboard = createOnScreenKeyboard();
document.body.appendChild(keyboard.element);
const referencePanel = createReferencePanel();
viewportEl.appendChild(referencePanel.element);
const routerPanel = createRouterPanel();
viewportEl.appendChild(routerPanel.element);
const a11yPanel = createA11yPanel({
  onShow: highlightA11yIssue,
  onApply: applyA11yFix,
  onApplyAll: applyAllA11yFixes,
  onRecheck: () => refreshA11yIssues(true),
});
viewportEl.appendChild(a11yPanel.element);
const gesturesPanel = createGesturesPanel({ onChange: (m) => { gestureMap = m; } });
viewportEl.appendChild(gesturesPanel.element);

let gestureMap = gesturesPanel.getMap();
const gestureRecognizer = createGestureRecognizer();

// ---- hand-adaptive input (all on-device) ----
// Numbers computed from the operator's hand landmarks (never video) drive an
// on-device Nano pick of the interaction profile. The profile retunes the shared
// pointer layer, so it helps the pinch pointer AND is harmless to the mouse path.
const btnHands = el<HTMLButtonElement>('btn-hands');
const toastEl = el<HTMLDivElement>('mc-toast');
const metricsSampler = createHandMetricsSampler();
let adapting = false;
let adaptedOnce = false;
let toastTimer = 0;

const handsPanel = createHandProfilePanel({
  onOverride: () => applyActiveProfile(lastAdaptation),
  onReadapt: () => { adaptedOnce = false; void runAdaptation(true); },
});
viewportEl.appendChild(handsPanel.element);
let lastAdaptation: ProfileAdaptation = { profile: PROFILES.standard, reason: '', source: 'rules' };

function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 6000);
}

/**
 * Apply a resolved adaptation (Nano/rules pick, or a manual override) to the
 * shared pointer layer. Applied today: pinch thresholds (setPinchThreshold),
 * target/cursor size (--mc-target-scale), pointer smoothing (smoothAim, read
 * from activeProfile), and voice verbosity (say()). snapRadiusScale / clickMode
 * / dwellMs are carried on the profile as the chosen configuration for the
 * snap + dwell subsystems to read, but are not yet wired into the drag path —
 * summarizeAdaptation deliberately does not claim them.
 */
function applyActiveProfile(adaptation: ProfileAdaptation): void {
  const resolved = resolveActiveProfile(adaptation, handsPanel.getOverride());
  activeProfile = resolved.profile;
  tracker?.setPinchThreshold(activeProfile.pinchOn, activeProfile.pinchOff);
  document.documentElement.style.setProperty('--mc-target-scale', String(activeProfile.targetScale));
  handsPanel.setAdaptation(resolved);
}

/** Run the on-device adaptation once enough pinches are sampled. */
async function runAdaptation(force = false): Promise<void> {
  if (adapting) return;
  if (!force && (adaptedOnce || !metricsSampler.ready())) return;
  adapting = true;
  try {
    const metrics: HandMetrics = metricsSampler.snapshot();
    handsPanel.setMetrics(metrics);
    const result = await adaptHandProfile(metrics);
    lastAdaptation = result;
    adaptedOnce = true;
    applyActiveProfile(result);
    // Only toast when the choice is actually in force (not overridden away).
    if (handsPanel.getOverride() === 'auto') {
      showToast(summarizeAdaptation(result.profile));
      say(summarizeAdaptation(result.profile));
    }
  } finally {
    adapting = false;
  }
}

function toggleButton(btn: HTMLButtonElement, on: boolean): void {
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('active', on);
}

btnGestures.addEventListener('click', () => {
  gesturesPanel.toggle();
  toggleButton(btnGestures, gesturesPanel.isOpen());
});
btnHands.addEventListener('click', () => {
  handsPanel.setMetrics(metricsSampler.snapshot());
  handsPanel.toggle();
  toggleButton(btnHands, handsPanel.isOpen());
});
btnKeyboard.addEventListener('click', () => {
  if (keyboard.isOpen()) keyboard.close();
  else keyboard.open();
  toggleButton(btnKeyboard, keyboard.isOpen());
  say(keyboard.isOpen() ? 'On-screen keyboard shown.' : 'On-screen keyboard hidden.');
});
btnReference.addEventListener('click', () => {
  referencePanel.toggle();
  toggleButton(btnReference, referencePanel.isOpen());
  say(referencePanel.isOpen() ? 'Reference panel open.' : 'Reference panel closed.');
});
btnRouting.addEventListener('click', () => {
  routerPanel.toggle();
  toggleButton(btnRouting, routerPanel.isOpen());
  say(routerPanel.isOpen() ? 'Routing log open.' : 'Routing log closed.');
});
el<HTMLButtonElement>('btn-a11y').addEventListener('click', () => {
  if (a11yPanel.isOpen()) a11yPanel.toggle();
  else void runUtterance('check accessibility');
});

// Discrete gesture actions fire once on the gesture's rising edge. Continuous
// actions (select/drag/pan/zoom) are already driven by the pinch pointer, so
// they are intentionally no-ops here. Everything routes through existing
// handlers (the Undo button, the viewport's key handler), keeping undo/redo
// intact and camera-or-mouse agnostic.
const DISCRETE_ACTIONS: Partial<Record<GestureAction, () => void>> = {
  undo: () => btnUndo.click(),
  delete: () => viewportEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })),
  confirm: () => viewportEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  'open-palette': () => {
    const btn = viewportEl.querySelector<HTMLButtonElement>('.mc-palette-btn');
    if (btn) { btn.focus(); say('Palette.'); }
  },
};

function runGestureAction(action: GestureAction): void {
  DISCRETE_ACTIONS[action]?.();
}

function processGestureFrame(f: PresenceFrame): void {
  // Operator lock is respected upstream: f.hands already contains only the
  // locked operator's hands (empty while paused).
  if (f.paused) {
    gestureRecognizer.reset();
    gesturesPanel.feedPreview('none');
    return;
  }
  const res = gestureRecognizer.update({ hands: f.hands.map((h) => h.points), now: performance.now() });
  gesturesPanel.feedPreview(res.gesture);
  for (const g of res.fired) runGestureAction(gestureMap[g]);
  // Two-hand pinch-zoom nudges the viewport zoom when mapped to "zoom".
  if (res.gesture === 'two-hand-zoom' && gestureMap['two-hand-zoom'] === 'zoom' && Math.abs(res.zoomDelta) > 0.015) {
    const key = res.zoomDelta > 0 ? '=' : '-';
    viewportEl.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }
}

// ---- command pipeline (shared by voice, text, and sim) ----

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

/** Pointer/selection context handed to intent fusion (mode-agnostic: cursor and
 *  nearby elements stay empty until modes expose them — see ai/router.ts). */
function fusionContext(): FusionContext {
  const sel = controller.selectedId();
  return {
    space: mode.id as FusionContext['space'],
    unit: mode.id === 'ui' ? 'px' : 'mm',
    cursor: null,
    hoverId: null,
    selectedIds: sel ? [sel] : [],
    nearby: [],
  };
}

// ---- accessibility checker (deterministic checks + cloud explanations) ----

function currentA11yIssues(): A11yIssue[] {
  return mode.checkAccessibility ? mode.checkAccessibility(controller.snapshot()) : [];
}

/** Highlight an issue's targets using the normal selection (works for mouse,
 *  pinch, and the parts list alike): multi-select where the mode supports it
 *  (plan select_set), else select the first target. */
function highlightA11yIssue(issue: A11yIssue): void {
  if (issue.targetIds.length === 0) return;
  const multi = controller.applyOp({ op: 'select_set', ids: issue.targetIds });
  if (!multi.ok) controller.selectId(issue.targetIds[0]);
  renderAll();
  say(issue.message);
}

function applyA11yFix(issue: A11yIssue): void {
  if (!issue.fix) return;
  const step = controller.applyOp(issue.fix);
  if (!step.ok) {
    say(`Could not apply the fix: ${step.error ?? 'invalid op'}`);
    return;
  }
  say(step.message ?? 'Accessibility fix applied.');
  refreshA11yIssues();
}

/** Apply every remaining fix as ONE batch op — a single undoable step. */
function applyAllA11yFixes(fixable: A11yIssue[]): void {
  const ops = fixable.map((i) => i.fix).filter((f): f is Record<string, unknown> => !!f);
  if (ops.length === 0) return;
  const step = controller.applyOp(ops.length === 1 ? ops[0] : { op: 'batch', ops });
  if (!step.ok) {
    say(`Could not apply the fixes: ${step.error ?? 'invalid op'}`);
    return;
  }
  say(`Applied ${ops.length} accessibility ${ops.length === 1 ? 'fix' : 'fixes'}.`);
  refreshA11yIssues();
}

/** Re-run the deterministic checks and refresh the panel (after any fix). */
function refreshA11yIssues(announce = false): void {
  const issues = currentA11yIssues();
  a11yPanel.setIssues(issues);
  renderAll();
  if (announce) {
    say(issues.length === 0 ? 'No accessibility issues found.' : `${issues.length} accessibility issues remain.`);
  }
}

async function runAccessibilityCheck(): Promise<boolean> {
  if (!mode.checkAccessibility) {
    verifierEl.textContent = 'Accessibility checks are not available in this mode.';
    say('Accessibility checks are not available in this mode.');
    return false;
  }
  const issues = currentA11yIssues();
  a11yPanel.setIssues(issues, issues.length > 0);
  a11yPanel.open();
  opJsonEl.textContent = JSON.stringify(
    { check: 'accessibility', issues: issues.map((i) => ({ id: i.id, rule: i.rule, severity: i.severity })) },
    null,
    2,
  );
  if (issues.length === 0) {
    setBadge('rules');
    verifierEl.textContent = 'Accessibility check passed — no issues found (measured in code).';
    say('No accessibility issues found.');
    return true;
  }
  const fails = issues.filter((i) => i.severity === 'fail').length;
  verifierEl.textContent = `Accessibility: ${issues.length} issue(s), ${fails} hard fail(s) — see the panel.`;
  say(`Found ${issues.length} accessibility ${issues.length === 1 ? 'issue' : 'issues'}.`);
  // Highlight everything the checks flagged, then ask the cloud to explain.
  const allIds = [...new Set(issues.flatMap((i) => i.targetIds))];
  const sel = controller.applyOp({ op: 'select_set', ids: allIds });
  if (!sel.ok && allIds[0]) controller.selectId(allIds[0]);
  renderAll();
  const res = await explainAccessibility(
    issues.map(({ id, rule, message, citation }) => ({ id, rule, message, citation })),
    controller.summary(),
  );
  setBadge(res.source);
  a11yPanel.setExplanations(res.items, res.source);
  return true;
}

async function runUtteranceInner(utterance: string): Promise<boolean> {
  // Accessibility requests short-circuit BEFORE routing: "make this house
  // wheelchair friendly" would otherwise hit the plan-generate path on "house".
  if (isAccessibilityRequest(utterance)) return runAccessibilityCheck();

  // VISIBLE HYBRID ROUTER (ai/router.ts): exact rules → on-device fusion →
  // cloud escalation. The decision is pure; the badge shows the ACTUAL source
  // plus the reason, and every decision lands in the Routing dev panel.
  const t0 = performance.now();
  const env = routerEnv();
  const isBig = controller.isDesignRequest(utterance);
  const decision = planRoute(utterance, (u) => mode.parse(u), isBig, env);

  // Whole-design requests go to the cloud "generate" path (rules fallback
  // inside the controller), everything else through the single-op fusion path.
  if (isBig) {
    const { source, step, clarify } = await controller.generate(utterance);
    const reason = finalReason(decision, source, false);
    setBadge(source, reason);
    routerPanel.add({ utterance, planned: decision.path, source, reason, escalated: false, ms: performance.now() - t0 });
    // Keep the op/JSON panel fresh — reflect this command, not the previous op.
    opJsonEl.textContent = JSON.stringify({ generate: utterance, source }, null, 2);
    if (clarify) {
      opJsonEl.textContent = '';
      verifierEl.textContent = clarify;
      say(clarify);
      return false;
    }
    if (!step.ok) {
      verifierEl.textContent = `Could not build: ${step.error ?? 'unknown error'}`;
      say('Could not build that.');
      renderAll();
      return false;
    }
    verifierEl.textContent = `${step.message ?? 'Done.'} (${source}).`;
    say(step.message ?? 'Done.');
    renderAll();
    viewport.fit?.(); // re-fit whenever a whole plan is (re)generated
    announceWarnings();
    return true;
  }

  const before = controller.summary();
  let result: object;
  let source: Source;
  let confidence: number | undefined;
  let escalated = false;
  if (decision.ruleResult) {
    // Exact-rule short circuit: no model call at all.
    result = decision.ruleResult;
    source = 'rules';
    recordInference('rules', 'route-exact', performance.now() - t0);
  } else {
    let outcome = await fuseIntent(utterance, fusionContext());
    if (shouldEscalate(outcome.source, outcome.confidence, env)) {
      // Unsure on-device answer: re-ask the cloud twin, keep the better one.
      const retry = await fuseIntent(utterance, fusionContext(), { forceCloud: true });
      ({ outcome, escalated } = pickEscalated(outcome, retry));
    }
    result = outcome.result;
    source = outcome.source;
    confidence = outcome.confidence;
  }
  const reason = finalReason(decision, source, escalated);
  setBadge(source, reason);
  routerPanel.add({ utterance, planned: decision.path, source, reason, confidence, escalated, ms: performance.now() - t0 });

  if ('clarify' in result) {
    opJsonEl.textContent = '';
    verifierEl.textContent = (result as { clarify: string }).clarify;
    say((result as { clarify: string }).clarify);
    return false;
  }

  opJsonEl.textContent = JSON.stringify(result, null, 2);
  const step = controller.applyResult(result as Record<string, unknown>);
  if (!step.ok) {
    verifierEl.textContent = `Rejected: ${step.error ?? 'invalid'}`;
    say(`I couldn't do that: ${step.error ?? 'invalid command'}`);
    return false;
  }
  renderAll();

  // Single ops get the intent verifier; templates/generate skip it (no `op`).
  if (step.op) {
    const after = controller.summary();
    const verdict = await verifyOp(step.op as never, before, after, step.warnings);
    if (verdict.matchesIntent) {
      verifierEl.textContent = `${step.message ?? 'Matches intent'} (${verdict.source}).`;
    } else {
      verifierEl.textContent = `Possible mismatch: ${verdict.issue ?? 'unverified'} (${verdict.source}).`;
      say(verdict.issue ?? 'That may not match what you asked for.');
    }
  } else {
    verifierEl.textContent = step.message ?? 'Done.';
  }
  announceWarnings();
  if (step.message && step.op) say(step.message);
  return true;
}

function announceWarnings(): void {
  const w = controller.warnings();
  if (w.length > 0) say(w[0]);
}

commandForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = commandInput.value.trim();
  if (!text) return;
  commandInput.value = '';
  void runUtterance(text);
});

// ---- undo / redo / export / 3D ----

btnUndo.addEventListener('click', () => {
  controller.applyOp({ op: 'undo' });
  renderAll();
});
btnRedo.addEventListener('click', () => {
  controller.applyOp({ op: 'redo' });
  renderAll();
});
btnExport.addEventListener('click', async () => {
  // UI mode opens an accessible export panel (preview + code + download/copy)
  // instead of silently downloading files; other modes export directly.
  if (mode.id === 'ui') {
    const { uiHtmlOf, uiSvgOf, uiFrameSizeOf } = await import('./ui/design/controller');
    const html = uiHtmlOf(controller);
    if (!html) { say('Nothing to export yet — create a screen first.'); return; }
    const size = uiFrameSizeOf(controller);
    const { openExportPanel } = await import('./ui/design/exportPanel');
    openExportPanel({ html, svg: uiSvgOf(controller), frameW: size?.w, frameH: size?.h, onStatus: (m) => say(m) });
    return;
  }
  controller.export();
  say(`${mode.exportLabel}.`);
});

// UI mode only: copy the active frame's single-file HTML to the clipboard.
const btnCopyHtml = document.getElementById('btn-copy-html') as HTMLButtonElement | null;
if (btnCopyHtml) {
  btnCopyHtml.addEventListener('click', async () => {
    const { uiHtmlOf } = await import('./ui/design/controller');
    const html = uiHtmlOf(controller);
    if (!html) { say('Nothing to copy yet — create a screen first.'); return; }
    try {
      await navigator.clipboard.writeText(html);
      say('HTML copied to clipboard.');
    } catch {
      say('Could not access the clipboard.');
    }
  });
}

if (viewport.toggle3D) {
  btn3d.hidden = false;
  btn3d.addEventListener('click', () => {
    const on = btn3d.getAttribute('aria-pressed') !== 'true';
    const now = viewport.toggle3D!(on);
    btn3d.setAttribute('aria-pressed', String(now));
    btn3d.classList.toggle('active', now);
    btn3d.textContent = now ? '2D view' : '3D view';
    say(now ? '3D view.' : '2D view.');
  });
}

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

// Pointer smoothing for the AIMING phase only: the active profile's `smoothing`
// EMA steadies a shaky hover/cursor, while commit actions (tap, drag) stay on raw
// coordinates for accuracy. Reset whenever the pinch state changes.
let smX: number | null = null;
let smY: number | null = null;
function smoothAim(x: number, y: number): { x: number; y: number } {
  const keep = activeProfile.smoothing;
  if (keep <= 0 || smX === null || smY === null) { smX = x; smY = y; return { x, y }; }
  smX += (x - smX) * (1 - keep);
  smY += (y - smY) * (1 - keep);
  return { x: smX, y: smY };
}

function handleHandEvent(e: HandEvent): void {
  switch (e.type) {
    case 'tracking': {
      const s = smoothAim(e.x, e.y);
      placeCursor(s.x, s.y);
      const { clientX, clientY } = toClient(s.x, s.y);
      // When the on-screen keyboard is up, an open hand over it dwells on keys.
      if (keyboard.isOpen() && keyboard.hoverAt(clientX, clientY)) break;
      viewport.hover?.(clientX, clientY); // ghost previews track the open hand
      break;
    }
    case 'pinch-start': {
      smX = null; smY = null; // commit on raw coordinates
      placeCursor(e.x, e.y);
      handCursor.classList.add('pinching');
      const { clientX, clientY } = toClient(e.x, e.y);
      viewport.beginDrag?.(clientX, clientY);
      break;
    }
    case 'pinch-tap': {
      placeCursor(e.x, e.y);
      onboarding.notifyPinch();
      const { clientX, clientY } = toClient(e.x, e.y);
      // A pinch over the on-screen keyboard presses the key under the cursor.
      if (keyboard.isOpen() && keyboard.pressAt(clientX, clientY)) break;
      if (viewport.tap?.(clientX, clientY)) {
        renderAll(); // a palette/tool consumed the tap
        break;
      }
      const id = viewport.pick(clientX, clientY);
      if (id) {
        controller.selectId(id);
        renderAll();
      }
      break;
    }
    case 'pinch-move': {
      placeCursor(e.x, e.y);
      const { clientX, clientY } = toClient(e.x, e.y);
      if (viewport.drag?.(clientX, clientY)) break; // world-space drag with snap (plan)
      if (controller.selectedId()) {
        const step = controller.dragSelectedMm(e.dx * controller.dragRangeMm, -e.dy * controller.dragRangeMm);
        if (step?.ok) renderAll();
      }
      break;
    }
    case 'pinch-end':
      handCursor.classList.remove('pinching');
      viewport.endDrag?.();
      break;
    case 'lost':
      smX = null; smY = null;
      handCursor.hidden = true;
      viewport.endDrag?.();
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

  // Hand-adaptive input: sample the operator's primary hand (landmarks only,
  // never video) and, once enough pinches are seen, let on-device Nano pick the
  // interaction profile. Skipped while paused (no operator hand to measure).
  if (!f.paused && f.hands.length > 0) {
    metricsSampler.push({ t: performance.now(), points: f.hands[0].points });
    if (metricsSampler.ready() && !adaptedOnce) void runAdaptation();
  }

  processGestureFrame(f);
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
    // Hands mode on: focusing a text field now raises the on-screen keyboard.
    keyboard.setAutoOpen(true);
    announceStatus('Camera on.');
    say('Camera on. Pinch to select or drag. Press "Register me" to lock onto your face.');
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
  keyboard.setAutoOpen(false);
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

const DEVICE_LABELS: Record<DeviceModelStatus, string> = {
  idle: 'Checking on-device AI…',
  unsupported: 'On-device AI: unsupported',
  unavailable: 'On-device AI: unavailable',
  downloadable: 'Download on-device AI',
  downloading: 'Resume AI download',
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

// Mode switch: 'ready' modes reload the shell under the chosen mode.
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
      const url = new URL(window.location.href);
      url.searchParams.set('mode', id);
      window.location.assign(url.toString());
    }
  });
}

void prepareHybrid().then(async (status) => {
  if (status.appCheck === 'failed' || status.message) {
    fail('fail-appcheck', `${status.message ?? 'App Check is required. Using rules only.'}${status.lastError ? ` (${status.lastError})` : ''}`);
    setBadge('rules', 'offline');
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
      demoFor(mode.id),
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
          body.textContent = 'Turn on the camera to control objects by pinching. We will ask the browser for permission.';
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
          body.textContent = 'Registration locks tracking to your face so other people nearby cannot move your design. It needs the camera, which is off — you can set it up later from “Register me”.';
          actions.append(button('Skip', next, 'primary'));
        } else {
          body.textContent = 'Face the camera and press “Register me”. We will lock onto your face so only your hands control the design.';
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
          body.textContent = 'Pinching uses the camera, which is off. You can select and move objects with voice or the keyboard instead.';
          actions.append(button('Skip', next, 'primary'));
        } else {
          body.textContent = 'Touch your thumb and index finger together to pinch. Pinch now to select — this step advances as soon as a pinch is detected.';
          note.textContent = 'Waiting for a pinch…';
          actions.append(button('Skip', next, 'ghost'));
        }
        break;

      case 'command': {
        body.textContent = `Say or type a command. Try “${mode.exampleCommand}”. This step finishes when a command succeeds.`;
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
if (!onboardedAlready && !SIM_ACTIVE) onboarding.open(0);

if (!navigator.mediaDevices?.getUserMedia) {
  btnCamera.disabled = true;
  fail('fail-camera-unsupported', 'This browser cannot access a camera — pinch gestures are unavailable.');
}

renderAll();
