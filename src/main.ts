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
import { SIM_ACTIVE, demoFor, mountSimCursor, playDemo, type SimStep } from './sim';
import {
  initDeviceModel,
  checkDeviceAvailability,
  explainAccessibility,
  fuseIntent,
  resolveDeixis,
  verifyOp,
  prepareHybrid,
  getHybridStatus,
  routerEnv,
  adaptHandProfile,
  synthesizeSpeech,
  cloudTtsReady,
  type DeviceModelStatus,
  type DeixisImage,
  type FusionContext,
  type Source,
} from './ai/hybrid';
import {
  DEIXIS_MIN_CONFIDENCE, buildCropRect, deixisToOp, isDeicticAdjust, matchCandidateByLabel,
  type DeixisCandidate,
} from './ai/deixis';
import { captureCropFromVideo } from './input/frameCapture';
import { createHandMetricsSampler, type HandMetrics } from './input/handMetrics';
import {
  PROFILES, resolveActiveProfile, summarizeAdaptation,
  type InteractionProfile, type ProfileAdaptation,
} from './input/handProfile';
import { createHandProfilePanel } from './ui/handProfilePanel';
import { isAccessibilityRequest, type A11yExplanation, type A11yIssue } from './core/a11y';
import { createA11yPanel } from './ui/a11yPanel';
import {
  REASON_TEXT,
  finalReason,
  pickEscalated,
  planRoute,
  shouldEscalate,
  type RouteDecision,
  type RouteReason,
} from './ai/router';
import { createRouterPanel } from './ui/routerPanel';
import {
  LANGUAGES, DEFAULT_LANGUAGE, resolveLanguage, isEnglish, shouldTranslate,
  translateInCloud, languageBadgeLabel, buildCaption, localize, pickVoice,
  confirmPhrase, pickSpeechRoute,
  type Language,
} from './ai/language';
import { checkLanguageAvailability } from './ai/hybrid';
import { base64ToBytes, wrapPcmAsWav } from './core/audio';
import { createLedger, type LedgerSource } from './core/ledger';
import { createLedgerPanel } from './ui/ledgerPanel';
import { recordInference } from './firebase/telemetry';
import { generatePlan, generateUi } from './ai/hybrid';
import { isFirebaseConfigured } from './firebase/app';
import {
  createJobQueue, createIndexedDbStore, type JobKind, type QueuedJob,
} from './offline/queue';
import { createNetworkMonitor, routeBigJob } from './offline/network';
import {
  createPhrasebook, createIndexedDbPhrasebookStore,
  parseTeachCommand, parseCorrectionCommand,
} from './ai/phrasebook';
import { createPairPanel } from './ui/pairPanel';
import { createLampPanel } from './ui/lampPanel';
import { lampStateLabel, type LampState } from './devices/wiz';
import type { MusicStatus } from './relay/protocol';
import { createFakeTransport, type RelayTransport } from './relay/transport';
import { probeFirestore } from './relay/firestoreTransport';
import {
  createGuestSession, createHostSession, type GuestSession, type HostSession,
} from './relay/session';
import { buildJoinUrl, pairStateLabel, type RelayCommand } from './relay/protocol';
import {
  buildControlSnapshot, type AiFeedInput, type ApplianceState, type DeviceId, type ScenePrimitive,
} from './relay/controlSnapshot';

const ONBOARD_KEY = 'mendcraft.onboarded';
const MODE_KEY = 'mendcraft.mode';
const LANG_KEY = 'mendcraft.lang';
const MUTE_KEY = 'mendcraft.muted';

// Spoken replies can be muted (near the language picker). Restored per session.
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage blocked */ }

// The spoken/written language (Akash's mom speaks Kannada). Restored from a
// prior session; drives speech recognition lang, routing (translate in the
// cloud when non-English), the badge, captions, and confirmations.
let currentLanguage: Language = DEFAULT_LANGUAGE;
try {
  currentLanguage = resolveLanguage(localStorage.getItem(LANG_KEY));
} catch {
  // Storage blocked — default to English.
}
// Does Nano report it can run the current language on-device? Refreshed on
// startup and on every language change; false means the cloud does the translate.
let deviceLangReady = false;

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
    <label id="lang-pick" class="lang-pick" title="Spoken and written language">
      <span class="sr-only">Language</span>
      <select id="lang-select" aria-label="Language">${LANGUAGES
        .map((l) => `<option value="${l.code}"${l.code === currentLanguage.code ? ' selected' : ''}>${l.label}</option>`)
        .join('')}</select>
      <button id="btn-mute" type="button" class="ghost" aria-pressed="false" title="Mute or unmute spoken replies">🔊 Voice</button>
    </label>
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
    <button id="btn-ledger" type="button" class="ghost" aria-pressed="false" title="What left this device: a ledger of every cloud call vs. the private on-device events">What left device</button>
    <button id="btn-pair" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="Pair a phone as a remote control and camera (scan a QR)">Pair phone</button>
    <button id="btn-lamp" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="Control a WiZ lamp over the local bridge (npm run wiz-bridge)">Lamp</button>
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
    <span class="status-chip"><span class="status-k">Network</span><span id="net-state" class="status-v net-online" tabindex="0">Online</span></span>
  </div>
  <div id="layout">
    <div id="viewport" tabindex="0" role="application" aria-label="Design viewport. Click an object to select it; arrow keys pan, +/- zoom.">
      <div id="resume-hint" class="resume-hint" role="status" hidden>Look at the screen to resume</div>
      <p id="privacy-line" class="privacy-line" hidden>Face and hand data stay on this device. Nothing is uploaded.</p>
      <div id="caption-bar" class="caption-bar" role="status" aria-live="polite" hidden>
        <span id="caption-heard" class="caption-heard"></span>
        <span id="caption-translation" class="caption-translation" hidden></span>
      </div>
      <div id="empty-hint" class="empty-hint">
        <p>${mode.hint}</p>
        <div class="hint-buttons">${hintButtonsHtml}</div>
      </div>
    </div>
    <aside id="panel" aria-label="Design details">
      <div id="fail-states" role="alert"></div>
      <section id="queue-section" aria-label="Offline cloud job queue" hidden>
        <h2>Cloud queue <span id="queue-count" class="queue-count"></span></h2>
        <p id="queue-note" class="queue-note"></p>
        <ul id="queue-list" class="queue-list"></ul>
      </section>
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
const netStateEl = el<HTMLSpanElement>('net-state');
const langSelect = el<HTMLSelectElement>('lang-select');
const captionBar = el<HTMLDivElement>('caption-bar');
const captionHeard = el<HTMLSpanElement>('caption-heard');
const captionTranslation = el<HTMLSpanElement>('caption-translation');
const queueSection = el<HTMLElement>('queue-section');
const queueCountEl = el<HTMLSpanElement>('queue-count');
const queueNoteEl = el<HTMLParagraphElement>('queue-note');
const queueListEl = el<HTMLUListElement>('queue-list');

// The interaction profile currently in force (hand-adaptive input). Declared
// here so say() can honour its voiceVerbosity; retuned by applyActiveProfile().
let activeProfile: InteractionProfile = PROFILES.standard;

function say(message: string): void {
  srLive.textContent = message; // screen-reader text always updates
  // The active hand profile's voiceVerbosity tunes spoken output: 'terse' keeps
  // the screen-reader text but skips text-to-speech (less chatter for confident
  // users); 'standard'/'coached' speak normally. Mute silences it too.
  if (activeProfile.voiceVerbosity === 'terse' || muted) return;
  speakSynth(message);
}

/** speechSynthesis in the active language. If no matching voice exists for a
 *  non-English language, stay text-only (the screen-reader line already
 *  updated) rather than mispronouncing it with an English voice. */
function speakSynth(message: string): void {
  if (!('speechSynthesis' in window)) return;
  const voice = pickVoice(window.speechSynthesis.getVoices(), currentLanguage);
  if (!voice && !isEnglish(currentLanguage)) return;
  const utter = new SpeechSynthesisUtterance(message);
  utter.rate = 1.1;
  utter.lang = currentLanguage.speechLang;
  if (voice) utter.voice = voice as SpeechSynthesisVoice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

/** Does speechSynthesis have a usable voice for the active language? English
 *  always does; a non-English language needs an actual matching voice. */
function synthHasVoice(): boolean {
  if (isEnglish(currentLanguage)) return true;
  if (!('speechSynthesis' in window)) return false;
  return pickVoice(window.speechSynthesis.getVoices(), currentLanguage) != null;
}

/**
 * Speak the SHORT fixed confirmation for an applied op in the active language
 * (language.confirmPhrase — never free text). English and the offline/no-cloud
 * case use speechSynthesis; her language, when the cloud + SDK audio are
 * available, uses the Gemini cloud voice (logged to the ledger as a cloud call).
 */
function speakConfirm(opName: string | null | undefined): void {
  const text = confirmPhrase(opName, currentLanguage);
  srLive.textContent = text; // screen-reader text always updates
  if (activeProfile.voiceVerbosity === 'terse') return;
  const route = pickSpeechRoute(
    currentLanguage,
    {
      cloudReady: routerEnv().cloudReady && net.online(),
      audioSupported: cloudTtsReady(),
      synthHasVoice: synthHasVoice(),
    },
    muted,
  );
  if (route === 'silent') return;
  if (route === 'synth') { speakSynth(text); return; }
  void speakCloud(text);
}

/** Synthesize a confirmation in the cloud and play it with Web Audio; log the
 *  cloud call in the ledger. Any failure falls back to speechSynthesis so a
 *  reply is never lost. */
async function speakCloud(text: string): Promise<void> {
  try {
    const audio = await synthesizeSpeech(text);
    if (!audio) { speakSynth(text); return; }
    // The audio bytes DID leave the device — record the honest cloud call.
    recordLedger('cloud', 'tts', 'spoken reply', `speak: ${JSON.stringify(text)} (${currentLanguage.englishName})`, audio.ms);
    await playCloudAudio(audio.dataBase64, audio.mimeType);
  } catch {
    speakSynth(text);
  }
}

let audioCtx: AudioContext | null = null;
/** Decode base64 cloud audio (PCM wrapped as WAV, or a container format) and
 *  play it through Web Audio. */
async function playCloudAudio(dataBase64: string, mimeType: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx) throw new Error('no Web Audio'); // caller falls back to speechSynthesis
  audioCtx ??= new Ctx();
  const bytes = wrapPcmAsWav(base64ToBytes(dataBase64), mimeType);
  const copy = bytes.slice(); // own ArrayBuffer for decodeAudioData
  const buffer = await audioCtx.decodeAudioData(copy.buffer);
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  source.start();
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

function setBadge(source: Source, reason?: RouteReason, translated = false): void {
  sourceBadge.className = `badge badge-${source}`;
  const label = reason
    ? languageBadgeLabel(source, reason, currentLanguage, translated)
    : source.toUpperCase().replace('-', ' ');
  sourceBadge.textContent = label;
  const why = reason ? ` Route: ${REASON_TEXT[reason]}.` : '';
  sourceBadge.title = `${SOURCE_TOOLTIP[source]}${why}`;
  sourceBadge.setAttribute('aria-label', `AI source: ${label}. ${SOURCE_TOOLTIP[source]}${why}`);
}
setBadge('rules');

// ---- live caption bar (her words + the English translation) ----------------

/** Show what was heard; the translation line fills in once fusion returns. */
function showCaptionHeard(heard: string): void {
  const text = heard.trim();
  if (!text) return;
  captionHeard.textContent = text;
  captionHeard.lang = currentLanguage.speechLang;
  captionTranslation.hidden = true;
  captionTranslation.textContent = '';
  captionBar.hidden = false;
  controlCaption = {
    heard: text, translation: null,
    langCode: currentLanguage.code, langLabel: currentLanguage.englishName,
  };
}

/** Pair the heard text with its English translation (no-op when there is none). */
function showCaptionTranslation(heard: string, translation?: string): void {
  const cap = buildCaption(heard, translation, currentLanguage);
  if (!cap.translation) return;
  captionTranslation.textContent = `→ ${cap.translation}`;
  captionTranslation.lang = 'en';
  captionTranslation.hidden = false;
  controlCaption = {
    heard: cap.heard, translation: cap.translation,
    langCode: currentLanguage.code, langLabel: currentLanguage.englishName,
  };
}

// ---- language picker -------------------------------------------------------

/** Re-ask Nano whether it can run the current language on-device. Reset to
 *  false synchronously first so a command spoken before the probe resolves never
 *  routes on the PREVIOUS language's cached answer (safe default: cloud). */
function refreshDeviceLangReady(): void {
  const lang = currentLanguage;
  deviceLangReady = false;
  void checkLanguageAvailability(lang.code).then((ready) => {
    if (currentLanguage === lang) deviceLangReady = ready;
  });
}

function applyLanguage(lang: Language, announce: boolean): void {
  currentLanguage = lang;
  try { localStorage.setItem(LANG_KEY, lang.code); } catch { /* storage blocked */ }
  voice.setLang(lang.speechLang);
  refreshDeviceLangReady();
  captionBar.hidden = true; // stale translation from the old language
  if (announce) say(localize('languageSet', lang));
}

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
const btnLedger = el<HTMLButtonElement>('btn-ledger');

// On-screen keyboard lives at the bottom of the page (fixed), so elementFromPoint
// hit-testing works for the hand pointer; the float panels sit over the canvas.
const keyboard = createOnScreenKeyboard();
document.body.appendChild(keyboard.element);
const referencePanel = createReferencePanel();
viewportEl.appendChild(referencePanel.element);
const routerPanel = createRouterPanel();
viewportEl.appendChild(routerPanel.element);
// "What left this device" ledger: pure accounting (core/ledger) + a pinned panel.
const ledger = createLedger();
const ledgerPanel = createLedgerPanel(ledger);
viewportEl.appendChild(ledgerPanel.element);
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

/** Run the on-device adaptation once enough pinches are sampled. `injected` lets
 *  the judge path feed simulated metrics (no camera) through the same pick. */
async function runAdaptation(force = false, injected?: HandMetrics): Promise<void> {
  if (adapting) return;
  if (!force && (adaptedOnce || !metricsSampler.ready())) return;
  adapting = true;
  try {
    const metrics: HandMetrics = injected ?? metricsSampler.snapshot();
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
btnLedger.addEventListener('click', () => {
  ledgerPanel.toggle();
  toggleButton(btnLedger, ledgerPanel.isOpen());
  const c = ledger.counts();
  say(ledgerPanel.isOpen()
    ? `What left this device: ${c.cloud} cloud call${c.cloud === 1 ? '' : 's'}, ${c.private} private on-device event${c.private === 1 ? '' : 's'}.`
    : 'Ledger closed.');
});
el<HTMLButtonElement>('btn-a11y').addEventListener('click', () => {
  if (a11yPanel.isOpen()) a11yPanel.toggle();
  else void runUtterance('check accessibility');
});

// ---- phone relay pairing (QR → /remote page → room over an injected transport)

const btnPair = el<HTMLButtonElement>('btn-pair');
const pairPanel = createPairPanel({
  onOpen: () => void ensurePairing(),
  onDisconnect: () => {
    void hostSession?.close();
  },
});
viewportEl.appendChild(pairPanel.element);

const btnLamp = el<HTMLButtonElement>('btn-lamp');
const lampPanel = createLampPanel({ onState: (state, online) => setControlLamp(state, online) });
viewportEl.appendChild(lampPanel.element);
btnLamp.addEventListener('click', () => {
  lampPanel.toggle();
  toggleButton(btnLamp, lampPanel.isOpen());
});

let hostSession: HostSession | null = null;
let relayTransport: RelayTransport | null = null;
let pairingInit: Promise<void> | null = null;

/** Incoming phone commands ride the exact paths mouse/pinch already use:
 *  the Undo/Redo/Mic buttons, the shared runUtterance pipeline, and the
 *  viewport's arrow-key pan — so undo history and the op log stay intact. */
function handleRemoteCommand(cmd: RelayCommand): void {
  // The operator is driving from the phone now — reflect that on the dashboard.
  setControlDevice('phone');
  switch (cmd.kind) {
    case 'undo':
      btnUndo.click();
      break;
    case 'redo':
      btnRedo.click();
      break;
    case 'mic':
      btnMic.click();
      break;
    case 'command':
      if (cmd.text) void runUtterance(cmd.text);
      break;
    case 'nudge': {
      const key =
        cmd.dx === -1 ? 'ArrowLeft' : cmd.dx === 1 ? 'ArrowRight' : cmd.dy === -1 ? 'ArrowUp' : 'ArrowDown';
      viewportEl.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      break;
    }
  }
}

function ensurePairing(): Promise<void> {
  if (!pairingInit) pairingInit = initPairing();
  return pairingInit;
}

async function initPairing(): Promise<void> {
  pairPanel.setStatus('Starting a room…');
  // SIM and unconfigured builds use the in-page fake transport; otherwise probe
  // Firestore and fall back gracefully (it is not enabled on the project yet).
  if (SIM_ACTIVE || !isFirebaseConfigured()) {
    relayTransport = createFakeTransport();
    pairPanel.setTransportNote(SIM_ACTIVE
      ? 'SIM: in-page demo transport — no network used.'
      : 'Firebase is not configured — in-page demo transport only.');
  } else {
    const probe = await probeFirestore();
    if (probe.ok) {
      relayTransport = probe.transport;
      pairPanel.setTransportNote('Transport: Firestore room (commands + low-rate camera stills).');
    } else {
      relayTransport = createFakeTransport();
      pairPanel.setTransportNote(`Waiting for Firestore: ${probe.reason} A real phone cannot join yet; the demo transport is active.`);
    }
  }
  hostSession = await createHostSession(relayTransport);
  pairPanel.setRoom(buildJoinUrl(window.location.origin, hostSession.token), hostSession.code);
  let frames = 0;
  hostSession.onState((s) => {
    pairPanel.setStatus(pairStateLabel(s, 'host'));
    pairPanel.setPaired(s === 'paired');
    if (s === 'paired') {
      say('Phone remote connected.');
      // Push current state so a /control iPad in the room populates immediately.
      publishControlSnapshot();
      // Honest ledger: pairing over Firestore is a cloud call — but only the
      // room token + handshake. Camera stills are REDACTED by design: they go
      // laptop-ward only and are never logged, stored, or sent to any model.
      if (relayTransport?.kind === 'firestore') {
        recordLedger('cloud', 'phone pairing', 'phone remote paired over the room doc',
          'room token + pairing handshake — no design data, no media, never to AI');
      }
    } else if (s === 'gone') {
      say('Phone left the room.');
      setControlDevice('laptop');
    } else if (s === 'idle') {
      // Session closed — the next panel open mints a fresh room + QR.
      hostSession = null;
      pairingInit = null;
      frames = 0;
    }
  });
  hostSession.onCommand(handleRemoteCommand);
  hostSession.onFrame((f) => {
    frames += 1;
    pairPanel.setFrame(f.mimeType, f.dataBase64);
    pairPanel.setStatus(`Phone remote connected — camera live (${frames} stills received).`);
  });
  // The phone's music player relays its state (title/playing/volume, no audio);
  // mirror it onto the /control dashboard.
  hostSession.onMusic((music) => setControlMusic(music));
}

btnPair.addEventListener('click', () => {
  pairPanel.toggle();
  toggleButton(btnPair, pairPanel.isOpen());
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

// ---- point and say "this" (deixis via camera crop + pointer) ----

/** Last known pointer: viewport client px (mouse or pinch alike), plus the
 *  pinch position in CAMERA-frame coordinates (un-mirrored) when a hand drove
 *  it — that is where the camera crop is taken. Mouse pointers have no camera
 *  mapping, so they send no image at all. */
let lastPointer: {
  clientX: number;
  clientY: number;
  cameraNorm: { x: number; y: number } | null;
} | null = null;

/**
 * POINT AND SAY: resolve "make this brighter" from ONE tight JPEG crop of the
 * camera around the pinch position (hand pointer only; never a face/hand
 * identity crop, never stored) plus the element under the pointer, via
 * hybrid.resolveDeixis (PREFER_ON_DEVICE, image input, Firebase AI Logic only).
 * Returns null to fall through to the ordinary fusion path — pointing can
 * never make a command worse.
 */
async function runPointAndSay(utterance: string, t0: number, decision: RouteDecision): Promise<boolean | null> {
  if (!lastPointer || !controller.deixisInfo) return null;
  const pointedId = viewport.pick(lastPointer.clientX, lastPointer.clientY);
  const kindOf = (id: string): string => controller.deixisInfo?.(id)?.kind ?? id.replace(/[-_]?\d+$/, '');
  const items = controller.listItems();
  // ui listItems indent children with "· " markers — prompt noise, strip them.
  const cleanLabel = (l: string): string => l.replace(/^(?:· )+/, '').trim();
  // Pointed element first — the prompt tells the model "pointed" = the first.
  const candidates: DeixisCandidate[] = [
    ...(pointedId ? [{ id: pointedId, kind: kindOf(pointedId), label: cleanLabel(items.find((i) => i.id === pointedId)?.label ?? '') || undefined }] : []),
    ...items.filter((i) => i.id !== pointedId).map((i) => ({ id: i.id, kind: kindOf(i.id), label: cleanLabel(i.label) || undefined })),
  ];
  let image: DeixisImage | null = null;
  let pointerPx: { x: number; y: number } | null = null;
  let imageNote = 'no image';
  const video = tracker?.videoEl ?? null;
  if (video && lastPointer.cameraNorm) {
    const crop = buildCropRect(video.videoWidth, video.videoHeight, lastPointer.cameraNorm);
    const cap = captureCropFromVideo(video, crop);
    if (cap) {
      image = { mimeType: cap.mimeType, dataBase64: cap.dataBase64 };
      pointerPx = crop.pointer;
      imageNote = `one ${cap.w}x${cap.h}px JPEG crop around the pointer`;
    }
  }
  const outcome = await resolveDeixis(utterance, image, {
    pointer: pointerPx, candidates, space: mode.id as 'plan' | 'ui',
  });
  if (!outcome) return null;
  const res = outcome.resolution;
  // Honest ledger entry for the call that DID run: the crop + command left the
  // device only if the cloud answered; on-device stays a private event.
  recordLedger(
    outcome.source, 'point+say', REASON_TEXT.pointed,
    `${commandPayload(utterance)}\nimage: ${imageNote}\npointer: ${pointedId ? `on ${pointedId}` : 'not on a canvas element'}`,
    outcome.ms,
  );
  // A guessed target is worse than no answer: fall through to fusion, which
  // never applies an op on a hunch (it clarifies or escalates instead).
  if (res.confidence < DEIXIS_MIN_CONFIDENCE) return null;
  const finish = (ok: boolean, msg: string): boolean => {
    setBadge(outcome.source, 'pointed');
    routerPanel.add({
      utterance, planned: decision.path, source: outcome.source, reason: 'pointed',
      confidence: res.confidence, escalated: false, ms: performance.now() - t0,
    });
    verifierEl.textContent = msg;
    say(msg);
    return ok;
  };
  const targetId = res.target === 'pointed' ? pointedId
    : res.target === 'none' ? matchCandidateByLabel(res.object, candidates)
      : res.target;
  if (!targetId) {
    // The camera saw a nameable real object with no canvas twin → say so;
    // otherwise let the ordinary fusion path have its normal go.
    if (!res.object) return null;
    opJsonEl.textContent = JSON.stringify({ pointAndSay: res }, null, 2);
    return finish(false, `I can see the ${res.object}, but nothing matching it on the canvas.`);
  }
  const info = controller.deixisInfo(targetId);
  const op = info ? deixisToOp(res, info) : null;
  if (!op) return finish(false, `I can't change the ${res.property} of a ${info?.kind ?? 'part'} here.`);
  controller.selectId(targetId);
  const step = controller.applyOp(op);
  opJsonEl.textContent = JSON.stringify(op, null, 2);
  if (!step.ok) return finish(false, `I couldn't do that: ${step.error ?? 'invalid command'}`);
  renderAll();
  announceWarnings();
  return finish(true, step.message ?? 'Done.');
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
  // Offline: the deterministic checks + fixes already ran above; queue only the
  // cloud PROSE (explanations) for reconnect, as a previewable fix.
  if (routeBigJob(netEnv()) === 'enqueue') {
    await enqueueA11yJob(issues, controller.summary());
    verifierEl.textContent += ' Cloud explanations queued for when you reconnect.';
    say('Offline — queued cloud accessibility explanations for when you reconnect.');
    return true;
  }
  const summary = controller.summary();
  const sent = issues.map(({ id, rule, message, citation }) => ({ id, rule, message, citation }));
  const res = await explainAccessibility(sent, summary);
  setBadge(res.source);
  recordLedger(
    res.source, 'a11y-explain',
    res.source === 'cloud' ? 'explain issues' : REASON_TEXT.private,
    `issues: ${JSON.stringify(sent)}\ndesign: ${summary}`,
  );
  a11yPanel.setExplanations(res.items, res.source);
  return true;
}

// ---- offline-first cloud job queue --------------------------------------
// Big cloud jobs (whole-plan + screen generation, the a11y audit's cloud
// explanations) are the only things that NEED the network. Offline, we persist
// them to IndexedDB and keep working locally; on reconnect the queue drains to
// the cloud automatically and each result becomes a previewable fix (Apply /
// Reject). Single-op edits never queue — they stay on-device (Nano / rules).

// In the judge path there is no real Firebase key, but the offline-first queue is
// one of the features the demo needs to show. Treating the cloud as "configured"
// in SIM (only) lets a big job queue while offline and then drain to the honest
// rules result on reconnect — the real queue mechanism, labelled SIM throughout.
const cloudConfigured = isFirebaseConfigured() || SIM_ACTIVE;
const jobQueue = createJobQueue(createIndexedDbStore());

// ---- iPad /control dashboard publisher ----------------------------------
// When a room is live (hostSession), the laptop publishes a small, privacy-safe
// snapshot (relay/controlSnapshot) the /control page renders. It carries source
// + reason for every AI event, cloud utterances only (private text stays here),
// the ledger, the queue, captions and a compact scene — never camera, landmarks
// or audio. Built fresh on every change; a no-op until a phone/iPad pairs.
const controlFeed: AiFeedInput[] = [];
let controlDevice: DeviceId = 'laptop';
let controlCaption: { heard: string; translation?: string | null; langCode?: string; langLabel?: string } | null = null;
let controlRev = 0;
// Appliance state mirrored to the /control dashboard. Lamp comes from the editor
// lamp panel (laptop ↔ bridge); music arrives from the phone over the relay.
// 'unknown' until we actually know — never a fabricated "connected".
let controlLamp: ApplianceState = 'unknown';
let controlLampDetail: string | undefined;
let controlMusic: ApplianceState = 'unknown';
let controlMusicTitle: string | undefined;

/** Compact 2D primitives for the dashboard's wireframe preview. Plan walls are
 *  line segments; other modes fall back to summary-only (empty primitives). */
function controlScenePrimitives(): ScenePrimitive[] {
  try {
    const snap = controller.snapshot() as { walls?: { a: { x: number; y: number }; b: { x: number; y: number } }[] };
    if (Array.isArray(snap.walls)) {
      return snap.walls.map((w) => ({ t: 'seg', x1: w.a.x, y1: w.a.y, x2: w.b.x, y2: w.b.y }));
    }
  } catch {
    // Snapshot shape varies by mode; a preview is best-effort, never load-bearing.
  }
  return [];
}

function publishControlSnapshot(): void {
  if (!hostSession) return;
  controlRev += 1;
  const snap = buildControlSnapshot({
    rev: controlRev,
    activeDevice: controlDevice,
    ai: controlFeed,
    ledger: { calls: ledger.calls(), counts: ledger.counts() },
    queue: jobQueue.jobs(),
    appliances: { lamp: controlLamp, music: controlMusic, lampDetail: controlLampDetail, musicTitle: controlMusicTitle },
    caption: controlCaption,
    scene: {
      mode: mode.id,
      summary: controller.summary().slice(0, 240),
      rev: controlRev,
      primitives: controlScenePrimitives(),
    },
  });
  void hostSession.publishState(snap).catch(() => undefined);
}

function noteControlAi(ai: AiFeedInput): void {
  controlFeed.push(ai);
  if (controlFeed.length > 24) controlFeed.shift();
  publishControlSnapshot();
}
function setControlDevice(device: DeviceId): void {
  if (controlDevice === device) return;
  controlDevice = device;
  publishControlSnapshot();
}

/** Lamp panel → snapshot. Offline bridge = 'unknown' (no fake connectivity). */
function setControlLamp(state: LampState | null, online: boolean): void {
  controlLamp = !online || !state ? 'unknown' : state.on ? 'on' : 'off';
  controlLampDetail = online && state ? lampStateLabel(state) : undefined;
  publishControlSnapshot();
}

/** Phone music status (over the relay) → snapshot. */
function setControlMusic(music: MusicStatus): void {
  controlMusic = music.playing ? 'on' : 'off';
  controlMusicTitle = music.title || undefined;
  publishControlSnapshot();
}
ledger.subscribe(() => publishControlSnapshot());
jobQueue.subscribe(() => publishControlSnapshot());

// PERSONAL PHRASEBOOK (ai/phrasebook): the user's own phrasings + corrections,
// kept on-device in IndexedDB and fed to Nano as few-shot examples. Private —
// it only ever rides a cloud call on a sanctioned escalation (see fuseIntent).
const phrasebook = createPhrasebook(createIndexedDbPhrasebookStore());
// The previous real command, so a correction ("no, I meant …") knows what phrase
// it is fixing.
let lastCommand: string | null = null;
const net = createNetworkMonitor({ navigator, target: window });
let draining = false;

/** Cloud results awaiting the user's accept/reject. Kept in memory only (large,
 *  and re-fetchable on the next reconnect), keyed by job id. */
type StagedResult =
  | { kind: 'plan'; payload: { ops: unknown[] }; source: Source }
  | { kind: 'ui'; payload: { frame: unknown }; source: Source }
  | { kind: 'a11y'; items: A11yExplanation[]; source: Source };
const staged = new Map<string, StagedResult>();
/** Job ids with an accept/reject in flight — guards against a double-click
 *  re-entering acceptJob before the async remove settles (double-apply). */
const settling = new Set<string>();

const KIND_LABEL: Record<JobKind, string> = { plan: 'Plan', ui: 'Screen', a11y: 'A11y audit' };

/** Only plan/ui modes queue generation jobs; part stays fully synchronous. */
function bigJobKind(): JobKind | null {
  return mode.id === 'plan' || mode.id === 'ui' ? (mode.id as JobKind) : null;
}

function netEnv() {
  return { online: net.online(), cloudConfigured };
}

function renderNetState(): void {
  const online = net.online();
  const n = jobQueue.count();
  netStateEl.classList.toggle('net-online', online);
  netStateEl.classList.toggle('net-offline', !online);
  netStateEl.textContent = online
    ? n ? `Online · ${n} in queue` : 'Online'
    : n ? `Offline · ${n} queued` : 'Offline';
  netStateEl.title = online
    ? 'Connected. Queued cloud jobs run automatically.'
    : 'Offline. Edits keep working on-device; big cloud jobs are queued until you reconnect.';
}

function renderQueue(jobs: QueuedJob[] = jobQueue.jobs()): void {
  queueSection.hidden = jobs.length === 0;
  queueCountEl.textContent = jobs.length ? String(jobs.length) : '';
  queueNoteEl.textContent = jobs.length
    ? net.online()
      ? 'Back online — running queued jobs on the cloud…'
      : 'Queued — these run automatically when you reconnect.'
    : '';
  queueListEl.replaceChildren(...jobs.map(renderJobRow));
  renderNetState();
}

function renderJobRow(job: QueuedJob): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `queue-item queue-${job.status}`;
  const head = document.createElement('div');
  head.className = 'queue-item-head';
  const title = document.createElement('span');
  title.className = 'queue-item-label';
  title.textContent = `${KIND_LABEL[job.kind]}: ${job.label}`;
  const status = document.createElement('span');
  status.className = 'queue-item-status';
  status.textContent =
    job.status === 'ready' ? 'ready to apply'
    : job.status === 'running' ? 'running…'
    : job.status === 'error' ? `failed${job.error ? ` — ${job.error}` : ''}`
    : 'queued';
  head.append(title, status);

  const actions = document.createElement('div');
  actions.className = 'queue-item-actions';
  const result = staged.get(job.id);
  if (job.status === 'ready' && result) {
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = 'Apply';
    if (result.kind !== 'a11y' && job.mode !== mode.id) {
      apply.disabled = true;
      apply.title = `Switch to ${job.mode} mode to apply.`;
    }
    apply.addEventListener('click', () => void acceptJob(job.id));
    actions.append(apply);
  }
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'ghost';
  dismiss.textContent = job.status === 'ready' ? 'Reject' : 'Remove';
  dismiss.addEventListener('click', () => void dismissJob(job.id));
  actions.append(dismiss);

  li.append(head, actions);
  return li;
}

async function acceptJob(id: string): Promise<void> {
  if (settling.has(id)) return; // a prior click is still applying/removing
  const result = staged.get(id);
  const job = jobQueue.jobs().find((j) => j.id === id);
  if (!result || !job) return;
  settling.add(id);
  try {
  if (result.kind === 'a11y') {
    // The deterministic issues are re-measured for the CURRENT scene; the cloud
    // only supplied the prose, keyed by issue id.
    a11yPanel.setIssues(currentA11yIssues());
    a11yPanel.setExplanations(result.items, result.source);
    a11yPanel.open();
    setBadge(result.source);
    say('Accessibility explanations applied.');
  } else {
    if (job.mode !== mode.id) { say(`Switch to ${job.mode} mode to apply this.`); return; }
    const step = controller.applyGenerated?.(result.payload)
      ?? { ok: false, error: 'This mode cannot apply generated designs.', warnings: [] };
    if (!step.ok) {
      verifierEl.textContent = `Could not apply queued job: ${step.error ?? 'invalid'}`;
      say(`Could not apply: ${step.error ?? 'invalid'}`);
      return;
    }
    setBadge(result.source);
    verifierEl.textContent = `${step.message ?? 'Applied.'} (queued · ${result.source}).`;
    say(step.message ?? 'Applied queued design.');
    renderAll();
    viewport.fit?.();
  }
  staged.delete(id);
  await jobQueue.remove(id);
  } finally {
    settling.delete(id);
  }
}

async function dismissJob(id: string): Promise<void> {
  if (settling.has(id)) return;
  settling.add(id);
  try {
    staged.delete(id);
    await jobQueue.remove(id);
    say('Removed from the queue.');
  } finally {
    settling.delete(id);
  }
}

async function enqueueBigJob(utterance: string): Promise<void> {
  const kind = bigJobKind();
  if (!kind) return;
  await jobQueue.enqueue({ kind, mode: mode.id, label: utterance, payload: { prompt: utterance } });
}

async function enqueueA11yJob(issues: A11yIssue[], summary: string): Promise<void> {
  await jobQueue.enqueue({
    kind: 'a11y',
    mode: mode.id,
    label: `${issues.length} issue${issues.length === 1 ? '' : 's'}`,
    payload: {
      issues: issues.map(({ id, rule, message, citation }) => ({ id, rule, message, citation })),
      summary,
    },
  });
}

/** Run one queued job on the cloud and stage its result (or mark it failed). */
async function runJobOnCloud(job: QueuedJob): Promise<void> {
  if (job.kind === 'a11y') {
    const res = await explainAccessibility(job.payload.issues ?? [], job.payload.summary ?? '');
    recordLedger(res.source, 'a11y-explain (queued)',
      res.source === 'cloud' ? 'drained on reconnect' : REASON_TEXT.private,
      `issues: ${JSON.stringify(job.payload.issues ?? [])}\ndesign: ${job.payload.summary ?? ''}`);
    staged.set(job.id, { kind: 'a11y', items: res.items, source: res.source });
    await jobQueue.setStatus(job.id, 'ready');
    return;
  }
  const prompt = job.payload.prompt ?? '';
  if (job.kind === 'plan') {
    const res = await generatePlan(prompt);
    recordLedger(res.source, 'generate (queued)',
      res.source === 'cloud' ? 'drained on reconnect' : REASON_TEXT.private, commandPayload(prompt));
    if (res.ops?.length) {
      staged.set(job.id, { kind: 'plan', payload: { ops: res.ops }, source: res.source });
      await jobQueue.setStatus(job.id, 'ready');
    } else {
      await jobQueue.setStatus(job.id, 'error', res.clarify ?? 'cloud returned no plan');
    }
  } else {
    const res = await generateUi(prompt);
    recordLedger(res.source, 'generate (queued)',
      res.source === 'cloud' ? 'drained on reconnect' : REASON_TEXT.private, commandPayload(prompt));
    if (res.frame) {
      staged.set(job.id, { kind: 'ui', payload: { frame: res.frame }, source: res.source });
      await jobQueue.setStatus(job.id, 'ready');
    } else {
      await jobQueue.setStatus(job.id, 'error', res.clarify ?? 'cloud returned no screen');
    }
  }
}

/** Drain the queue once: run each still-pending job on the cloud, in FIFO order.
 *  Errored jobs are left for the next reconnect rather than retried in a loop. */
async function drainQueue(): Promise<void> {
  if (draining || !net.online()) return;
  draining = true;
  try {
    const pending = jobQueue.jobs().filter((j) => j.status === 'queued' || j.status === 'error');
    for (const job of pending) {
      if (!net.online()) break; // went offline mid-drain — stop, resume on reconnect
      await jobQueue.setStatus(job.id, 'running');
      try {
        await runJobOnCloud(job);
      } catch (err) {
        await jobQueue.setStatus(job.id, 'error', err instanceof Error ? err.message : 'cloud error');
      }
    }
  } finally {
    draining = false;
    renderQueue();
  }
}

jobQueue.subscribe((jobs) => renderQueue(jobs));
net.subscribe((online) => {
  renderNetState();
  renderQueue();
  if (online) {
    const n = jobQueue.count();
    if (n) say(`Back online — running ${n} queued cloud job${n === 1 ? '' : 's'}.`);
    void drainQueue();
  } else {
    say('Offline — edits keep working on-device; big cloud jobs will be queued.');
  }
});
void jobQueue.init().then(() => {
  renderQueue();
  if (net.online()) void drainQueue(); // finish anything left queued from a prior session
});
void phrasebook.init(); // load any phrases taught in a previous session
renderNetState();

// ---- "what left this device" ledger recording ----------------------------
// Mirrors the badge's honesty contract: each AI event is recorded with the SAME
// source the badge shows. A `cloud` event stores the abstract design payload that
// was actually sent (design ops + command text only — the camera, face, hand and
// voice never reach this layer); `on-device`/`rules` events are counted as
// private, with nothing stored because nothing left the machine.

/** The abstract design payload sent for a command: the command text plus the
 *  compact scene context the model needs — never any device-only signal. */
function commandPayload(utterance: string, ctx?: FusionContext): string {
  const base = `command: ${JSON.stringify(utterance)}`;
  if (!ctx) return base;
  return `${base}\ncontext: ${JSON.stringify({ space: ctx.space, unit: ctx.unit, selected: ctx.selectedIds })}`;
}

function recordLedger(source: Source, job: string, reason: string, sent: string, ms?: number): void {
  ledger.record({ source: source as LedgerSource, job, reason, sent, ms });
}

/**
 * PERSONAL PHRASEBOOK meta-commands, resolved entirely on-device (no model call,
 * nothing leaves the machine):
 *   - teach: "when I say X, do Y" / "teach X means Y" — map phrase X to the op
 *     the deterministic parser makes of Y, and remember it.
 *   - correction: "no, I meant Y" / "actually Y" — remember that the PREVIOUS
 *     command should have meant Y, then apply Y now.
 * The target Y is turned into an op by the mode's rule parser (so a phrase is
 * only saved when it maps to a real, validated op). Non-English voice goes
 * through the cloud translate path and never reaches these English patterns.
 * Returns true/false when it handled the utterance, or null when it is not a
 * phrasebook meta-command (→ normal routing).
 */
async function handlePhrasebookMeta(utterance: string): Promise<boolean | null> {
  if (!isEnglish(currentLanguage)) return null;

  const teach = parseTeachCommand(utterance);
  if (teach) {
    const op = mode.parse(teach.target);
    if ('clarify' in op) {
      verifierEl.textContent = `I couldn't turn "${teach.target}" into a command, so I didn't save it.`;
      say(`I couldn't turn ${teach.target} into a command, so I didn't save it.`);
      return false;
    }
    await phrasebook.add({ phrase: teach.phrase, op: op as Record<string, unknown>, mode: mode.id, kind: 'phrase' });
    setBadge('rules', 'exact'); // learned locally — private
    opJsonEl.textContent = JSON.stringify({ learn: teach.phrase, as: op }, null, 2);
    verifierEl.textContent = `Learned: when you say "${teach.phrase}", I'll ${teach.target}. (${phrasebook.count()} saved)`;
    say(`Got it. When you say ${teach.phrase}, I'll ${teach.target}.`);
    return true;
  }

  const corr = parseCorrectionCommand(utterance);
  if (corr && lastCommand) {
    const op = mode.parse(corr.target);
    if ('clarify' in op) {
      verifierEl.textContent = `I couldn't turn "${corr.target}" into a command, so I didn't save the correction.`;
      say(`I couldn't understand ${corr.target}, so I didn't save it.`);
      return false;
    }
    await phrasebook.add({ phrase: lastCommand, op: op as Record<string, unknown>, mode: mode.id, kind: 'correction' });
    setBadge('rules', 'exact'); // correction stored + applied locally — private
    opJsonEl.textContent = JSON.stringify(op, null, 2);
    const step = controller.applyResult(op as Record<string, unknown>);
    if (step.ok) renderAll();
    verifierEl.textContent = step.ok
      ? `Fixed, and I'll remember "${lastCommand}" means ${corr.target}.`
      : `Saved the correction, but couldn't apply it: ${step.error ?? 'invalid'}.`;
    say(`Thanks — I'll remember that next time.`);
    return true;
  }

  return null;
}

async function runUtteranceInner(utterance: string): Promise<boolean> {
  // Accessibility requests short-circuit BEFORE routing: "make this house
  // wheelchair friendly" would otherwise hit the plan-generate path on "house".
  if (isAccessibilityRequest(utterance)) return runAccessibilityCheck();

  // Show her words immediately; the English translation fills in once the cloud
  // (or on-device) fusion call returns it.
  showCaptionHeard(utterance);

  // PERSONAL PHRASEBOOK: teach ("when I say X, do Y") and correction ("no, I
  // meant …") are handled locally — no model call, nothing leaves the device.
  const metaHandled = await handlePhrasebookMeta(utterance);
  if (metaHandled !== null) return metaHandled;
  // This is a real command: a later correction ("no, I meant …") refers to it.
  lastCommand = utterance;

  // VISIBLE HYBRID ROUTER (ai/router.ts): exact rules → on-device fusion →
  // cloud escalation. The decision is pure; the badge shows the ACTUAL source
  // plus the reason, and every decision lands in the Routing dev panel.
  const t0 = performance.now();
  const translated = shouldTranslate(currentLanguage); // non-English → translate path
  const env = routerEnv();
  const isBig = controller.isDesignRequest(utterance);
  const decision = planRoute(utterance, (u) => mode.parse(u), isBig, env);

  // Whole-design requests go to the cloud "generate" path (rules fallback
  // inside the controller), everything else through the single-op fusion path.
  if (isBig) {
    // Offline + a queueable mode → persist a cloud job for reconnect, then still
    // apply the on-device/rules result now so the edit keeps working.
    const route = bigJobKind() ? routeBigJob(netEnv()) : 'run-now';
    if (route === 'enqueue') await enqueueBigJob(utterance);
    const { source, step, clarify } = await controller.generate(utterance);
    const reason = finalReason(decision, source, false);
    // NOT translated: the whole-design generate path has no translate guide and
    // returns no translation, so the badge must stay generic ("Cloud · big job")
    // and never claim "· Kannada" for a call that didn't translate.
    setBadge(source, reason);
    routerPanel.add({ utterance, planned: decision.path, source, reason, escalated: false, ms: performance.now() - t0 });
    recordLedger(source, 'generate', REASON_TEXT[reason], commandPayload(utterance), performance.now() - t0);
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
      say(localize('couldNotBuild', currentLanguage));
      renderAll();
      return false;
    }
    const queuedNote = route === 'enqueue' ? ' Queued a cloud version for when you reconnect.' : '';
    verifierEl.textContent = `${step.message ?? 'Done.'} (${source}).${queuedNote}`;
    // Spoken reply comes from the fixed phrase table in the active language
    // (whole-design generate has no single op → generic "Done."); the detailed
    // English message stays on-screen above.
    speakConfirm('done');
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
  let translation: string | undefined;
  if (decision.ruleResult) {
    // Exact-rule short circuit: no model call at all — a private local event.
    result = decision.ruleResult;
    source = 'rules';
    recordInference('rules', 'route-exact', performance.now() - t0);
    recordLedger('rules', 'command', REASON_TEXT.exact, '');
  } else {
    // POINT AND SAY: an English deictic adjustment ("make this brighter") with
    // a live pointer tries the camera-crop resolver first; a null result falls
    // through to the ordinary fusion path below.
    if ((mode.id === 'plan' || mode.id === 'ui') && isEnglish(currentLanguage)
      && isDeicticAdjust(utterance) && lastPointer) {
      const handled = await runPointAndSay(utterance, t0, decision);
      if (handled !== null) return handled;
    }
    const ctx = fusionContext();
    // Non-English (or a language Nano can't run) goes to the cloud, which
    // TRANSLATES and emits the same typed op in one Firebase AI Logic call.
    const toCloud = translateInCloud(currentLanguage, { ...env, deviceLangReady });
    const langOpt = translated ? currentLanguage : undefined;
    // PERSONAL PHRASEBOOK few-shot: the user's learned mappings for this command.
    // Attached to the on-device Nano call only (it stays on the device). It is
    // withheld from a first cloud call (no-device / translate) and only sent to
    // the cloud on the escalation below, where the router already went cloud.
    const fewShot = phrasebook.fewShotFor(utterance, mode.id);
    let outcome = await fuseIntent(utterance, ctx, {
      forceCloud: toCloud, lang: langOpt,
      fewShot: toCloud ? undefined : fewShot,
    });
    // Primary inference: a cloud answer stores its payload; on-device/rules are
    // private. The reason follows the planned route (on-device → private).
    recordLedger(
      outcome.source, 'intent',
      outcome.source === 'cloud' ? REASON_TEXT[decision.reason] : REASON_TEXT.private,
      commandPayload(utterance, ctx), outcome.ms,
    );
    if (shouldEscalate(outcome.source, outcome.confidence, env)) {
      // Unsure on-device answer: re-ask the cloud twin, keep the better one. The
      // retry physically contacts the cloud, so its send is recorded even if the
      // on-device answer is ultimately kept.
      // Sanctioned escalation: the router already went to the cloud, so the few
      // relevant phrasebook examples may ride along (and only those).
      const retry = await fuseIntent(utterance, ctx, {
        forceCloud: true, lang: langOpt, fewShot, examplesCloudOk: true,
      });
      const escalatedPayload = fewShot
        ? `${commandPayload(utterance, ctx)}\nphrasebook examples: ${phrasebook.select(utterance, mode.id).length}`
        : commandPayload(utterance, ctx);
      recordLedger(retry.source, 'intent (escalated)', REASON_TEXT['low-confidence'], escalatedPayload, retry.ms);
      ({ outcome, escalated } = pickEscalated(outcome, retry));
    }
    result = outcome.result;
    source = outcome.source;
    confidence = outcome.confidence;
    translation = outcome.translation;
  }
  // Pair her words with the English translation the model returned.
  showCaptionTranslation(utterance, translation);
  const reason = finalReason(decision, source, escalated);
  setBadge(source, reason, translated);
  routerPanel.add({ utterance, planned: decision.path, source, reason, confidence, escalated, ms: performance.now() - t0 });
  // Mirror the routed event to the /control dashboard feed. Only a cloud event
  // carries its utterance (it already left the device); private events are
  // source+reason only — the raw command text stays on the laptop.
  noteControlAi({ source, reason, utterance, ms: performance.now() - t0 });

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
    // The verifier also leaves the device when it resolves in the cloud: it sends
    // the op plus before/after scene summaries (abstract geometry, no raw input).
    recordLedger(
      verdict.source, 'verify',
      verdict.source === 'cloud' ? 'verify op' : REASON_TEXT.private,
      `op: ${JSON.stringify(step.op)}\nbefore: ${before}\nafter: ${after}\nwarnings: ${JSON.stringify(step.warnings)}`,
    );
    if (verdict.matchesIntent) {
      verifierEl.textContent = `${step.message ?? 'Matches intent'} (${verdict.source}).`;
      // Spoken reply: the fixed confirmation phrase for this op in the active
      // language (cloud voice for her language, else speechSynthesis). The
      // detailed English message stays on-screen above.
      speakConfirm((step.op as { op?: string }).op);
    } else {
      verifierEl.textContent = `Possible mismatch: ${verdict.issue ?? 'unverified'} (${verdict.source}).`;
      say(verdict.issue ?? 'That may not match what you asked for.');
    }
  } else {
    verifierEl.textContent = step.message ?? 'Done.';
  }
  announceWarnings();
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
    say(now ? localize('view3d', currentLanguage) : localize('view2d', currentLanguage));
  });
}

// ---- voice ----

const voice: VoiceController = createVoiceController((utterance) => void runUtterance(utterance));

if (!voice.supported) {
  btnMic.disabled = true;
  fail('fail-mic', 'Voice recognition is not supported in this browser — use the text command box instead.');
}

// ---- language picker wiring (after `voice`, which applyLanguage drives) ----

langSelect.value = currentLanguage.code;
langSelect.addEventListener('change', () => {
  applyLanguage(resolveLanguage(langSelect.value), true);
});

// Mute toggle for spoken replies (next to the language picker).
const btnMute = el<HTMLButtonElement>('btn-mute');
function renderMute(): void {
  btnMute.setAttribute('aria-pressed', String(muted));
  btnMute.classList.toggle('active', muted);
  btnMute.textContent = muted ? '🔇 Muted' : '🔊 Voice';
}
renderMute();
btnMute.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* storage blocked */ }
  if (muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  renderMute();
  // Confirm the toggle itself (unmute speaks; mute is already silent).
  if (!muted) speakConfirm('done');
});
// Apply the restored language once at startup: set recognition lang + probe Nano.
voice.setLang(currentLanguage.speechLang);
refreshDeviceLangReady();

btnMic.addEventListener('click', () => {
  const nowOn = btnMic.getAttribute('aria-pressed') !== 'true';
  btnMic.setAttribute('aria-pressed', String(nowOn));
  btnMic.classList.toggle('active', nowOn);
  btnMic.textContent = nowOn ? 'Mic on' : 'Enable mic';
  voice.setAlwaysOn(nowOn);
  say(nowOn ? localize('listening', currentLanguage) : localize('micOff', currentLanguage));
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

// Mouse/touch pointers feed point-and-say too (same pointer layer as pinch);
// a mouse has no camera mapping, so those commands send no image at all.
viewportEl.addEventListener('pointermove', (e: PointerEvent) => {
  lastPointer = { clientX: e.clientX, clientY: e.clientY, cameraNorm: null };
}, { passive: true });

function handleHandEvent(e: HandEvent): void {
  switch (e.type) {
    case 'tracking': {
      const s = smoothAim(e.x, e.y);
      placeCursor(s.x, s.y);
      const { clientX, clientY } = toClient(s.x, s.y);
      // Hand coords are mirrored to screen space (x = 1 - camera x); store the
      // camera-frame position so point-and-say can crop the frame there.
      lastPointer = { clientX, clientY, cameraNorm: { x: 1 - s.x, y: s.y } };
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
      lastPointer = { clientX, clientY, cameraNorm: { x: 1 - e.x, y: e.y } };
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

// Plausible-but-simulated hand metrics (numbers only — never video) so the judge
// path can drive the on-device profile pick and see the toast without a camera.
const SIM_HAND_METRICS: HandMetrics = {
  pinchEffort: 0.82, tremor: 0.055, pinchMs: 520, fatigue: 0.55,
  pinches: 14, frames: 420, sessionMs: 90_000,
};

/** Perform a declarative feature beat from the demo script (hand-adapt, offline
 *  toggle, accept an accessibility fix, switch language). Mirrors what a judge
 *  would do by hand, so the same code paths run as in real use. */
async function runSimFeature(step: SimStep): Promise<void> {
  if (step.lang) {
    const lang = resolveLanguage(step.lang);
    langSelect.value = lang.code;
    applyLanguage(lang, true);
  }
  switch (step.feature) {
    case 'adapt':
      await runAdaptation(true, SIM_HAND_METRICS);
      break;
    case 'offline':
      net.simForce(false);
      break;
    case 'online':
      net.simForce(true);
      break;
    case 'accept-a11y': {
      const fixables = currentA11yIssues().filter((i) => i.fix);
      if (fixables.length) applyAllA11yFixes(fixables);
      else say('No automatic accessibility fixes to accept.');
      break;
    }
    // Relay beats: a simulated phone joins the real host session over the
    // in-page fake transport and drives the editor through the same envelope
    // validation + command path a real phone would.
    case 'relay-pair': {
      pairPanel.open();
      toggleButton(btnPair, true);
      await ensurePairing();
      if (relayTransport && hostSession) {
        simPhone = await createGuestSession(relayTransport, hostSession.token);
      }
      break;
    }
    case 'relay-undo':
      await simPhone?.sendCommand({ kind: 'undo' });
      break;
    case 'relay-cmd':
      await simPhone?.sendCommand({ kind: 'command', text: 'make this wall 3 meters' });
      break;
    case 'relay-gone':
      await simPhone?.close();
      simPhone = null;
      break;
  }
}
let simPhone: GuestSession | null = null;

if (SIM_ACTIVE) {
  mountSimCursor(viewportEl, handleHandEvent);
  // A tiny judge-path seam the screenshot walk uses to drive a camera-less beat
  // (the hand-adapt pick) through the real on-device path.
  (window as unknown as { mcSim?: Record<string, () => void> }).mcSim = {
    adapt: () => {
      void runAdaptation(true, SIM_HAND_METRICS);
      // Open the hand-profile panel showing the SAME simulated numbers the pick
      // used (clicking the toolbar button would reset them to the empty sampler).
      handsPanel.setMetrics(SIM_HAND_METRICS);
      handsPanel.open();
      toggleButton(btnHands, true);
    },
  };
  const btnDemo = document.getElementById('btn-demo') as HTMLButtonElement | null;
  btnDemo?.addEventListener('click', () => {
    btnDemo.disabled = true;
    void playDemo(
      demoFor(mode.id),
      runUtterance,
      (step) => {
        lastCommandEl.textContent = `SIM: ${step.label}`;
        if (step.revealLedger) {
          ledgerPanel.open();
          toggleButton(btnLedger, true);
          const c = ledger.counts();
          say(`What left this device: ${c.cloud} cloud call${c.cloud === 1 ? '' : 's'} (${c.bytesSent} bytes), ${c.private} private on-device events.`);
        }
      },
      () => btnExport.click(),
      runSimFeature,
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
