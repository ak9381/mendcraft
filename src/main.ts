import './style.css';
import './references/board.css';
import { getActiveMode, listModes, setActiveMode } from './core/modes';
import type { ModeController, StepResult, ViewportHandle } from './core/controller';
import type { HandEvent } from './input/hands';
import { createPresenceTracker, type PresenceTracker, type PresenceFrame } from './input/presence';
import { findLiveCameraStream } from './input/cameraShare';
import { createHandOverlay } from './ui/handOverlay';
import { createFaceOverlay } from './ui/faceOverlay';
import { createHandHover, magnetPull } from './ui/handHover';
import { createVoiceController, type VoiceController } from './input/voice';
import { createGestureRecognizer } from './input/gestures';
import { createTwoHandGesture, incrementalZoomPan, midpoint, IDENTITY, type SimilarityTransform, type Vec } from './input/twoHandTransform';
import type { GestureAction } from './input/gestureMap';
import { createGesturesPanel } from './ui/gesturesPanel';
import { createOnScreenKeyboard } from './ui/onscreenKeyboard';
import { createReferencePanel } from './ui/referencePanel';
import { createOverflowMenu, type OverflowMenu } from './ui/overflowMenu';
import { SIM_ACTIVE, createSimPlayback, demoFor, mountSimCursor, playDemo, type SimStep } from './sim';
import {
  TOUR_STEPS,
  resolveTourSteps,
  stepForward,
  stepBack,
  atFirst,
  atLast,
  stepCounter,
  tourDismissed,
  markTourDismissed,
  type TourStepDef,
} from './ui/tour';
import {
  initDeviceModel,
  checkDeviceAvailability,
  explainAccessibility,
  fuseIntent,
  resolveDeixis,
  verifyOp,
  prepareHybrid,
  warmCloud,
  warmOnDevice,
  getHybridStatus,
  routerEnv,
  adaptHandProfile,
  detectLanguageCloud,
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
import { DEFAULT_AIM_RADIUS_PX } from './plan/hitTest';
import {
  PROFILES, resolveActiveProfile, summarizeAdaptation,
  type InteractionProfile, type ProfileAdaptation,
} from './input/handProfile';
import { createHandProfilePanel } from './ui/handProfilePanel';
import {
  clearSavedVoice, loadSavedVoice, parseChangeVoice, pickSpokenVoice, previewPhrase,
  resolveChangeVoice, saveVoice, toSynthVoice, type ChangeVoiceIntent, type SynthVoice,
} from './ai/speechVoices';
import { createVoicePanel } from './ui/voicePanel';
import { isAccessibilityRequest, recheckFix, type A11yExplanation, type A11yIssue } from './core/a11y';
import { createA11yPanel } from './ui/a11yPanel';
import {
  SOURCE_TEXT,
  REASON_TEXT,
  finalReason,
  isPointing,
  pickEscalated,
  planRoute,
  shouldEscalate,
  type RouteDecision,
  type RouteReason,
} from './ai/router';
import {
  STATE_TEXT, buildChoices, choicePrompt, classifyConfidence, describeOp,
  isDestructiveOp, parseChoiceReply, suggestCommands,
  type Choice, type ConfidenceState,
} from './ai/confidence';
import { exactRuleParse } from './ai/intentFusion';
import { createRouterPanel } from './ui/routerPanel';
import {
  LANGUAGES, DEFAULT_LANGUAGE, AUTO_PICK, LANGUAGE_PROMISE, resolveLanguage, resolvePick,
  recognitionLanguage, autoLabel, findLanguage, isEnglish, shouldTranslate,
  translateInCloud, languageBadgeLabel, buildCaption, localize, pickVoice,
  pickReply, pickSpeechRoute, langRouteNote,
  type Language,
} from './ai/language';
import {
  chromeDetectorAvailable, detectOnDevice, detectionLabel, planDetection, type Detection,
} from './ai/langDetect';
import { simSpeechFor } from './sim';
import { checkLanguageAvailability, type FusionOutcome } from './ai/hybrid';
import { createLedger, type LedgerSource } from './core/ledger';
import { createLedgerPanel } from './ui/ledgerPanel';
import { recordInference } from './firebase/telemetry';
import { createChangeLog, planDigest, ACTOR_LABEL, type Actor, type ChangeEntry } from './cad/changeLog';
import { createSiteChecklist, fallbackEmail, isHardQuestion, mailtoUrl, type EmailDraft } from './cad/siteChecklist';
import { createGeminiReview, proposalForReview, unresolvedReview, waitingForGemini, type GeminiReviewItem } from './cad/geminiReview';
import { withChangeRecording } from './cad/recording';
import { checkGuidelines, summarizeReport, GUIDELINE_SETS, REGION_IDS, type GuidelineReport, type RegionId } from './cad/guidelines';
import { proposeStair } from './cad/stairs';
import { answerPlanQuestion, isPlanQuestion, isPlanJudgementQuestion, isSimplePlanQuestion } from './cad/planQA';
import { parseCopilot, isInstantCopilot, shouldNanoPickIntent, refineCadPick } from './cad/copilot';
import { raceHardQuestion, NANO_ROUTE_TIMEOUT_MS } from './cad/hardRace';
import {
  formatRouteLine,
  routeGemini,
  routeNanoCanvas,
  routeOffline,
  routePlanData,
  routeSpeculative,
  type RouteInfo,
} from './cad/routeReason';
import { createSpeculativeEngine, guessesAgree, type SpeculativeDraft, type SpeculativeStats } from './cad/speculative';
import { cadTool, describeCall, toolToAction, type ToolCall } from './cad/tools';
import { LAYER_LABEL, type LayerId } from './cad/layers';
import { presetFor, PHOTO_RENDER_NOTE, coerceSetMaterialsOp, isSetMaterialsOp, makeSetMaterialsOp, type MaterialPlan } from './cad/materials';
import { siteBookId, syncSiteBook } from './cad/sync';
import { createCopilotPanel, createWalkControls } from './ui/copilotPanel';
import { createDirectoryPanel } from './ui/directoryPanel';
import { mountStudioChrome, proposalFromChange } from './ux/mountStudio';
import { catalogRoute } from './ux/routeCatalog';
import { GETTING_QUICK_READY, LATER_LIST_PROMISE, OFFLINE_QUICK_ONLY, QUICK_READY } from './ux/wording';
import { deepWorkingLabel, playDeepChime, playDeepTick } from './ux/deepWait';
import { sharmaHouseOps, WARMUP_PROMPT } from './ux/demoKit';
import {
  IDLE_LEAVE, LEAVE_UNDO_MS, PINCH_HOLD_MS as LEAVE_HOLD_MS, armLeave, canUndoLeave,
  completeHold, leaveCardCopy, releaseHold, startHold, undoLeave, type LeaveState,
} from './ux/leaveApp';
import type { Focusable } from './ux/focusModel';
import { discoveryLevel } from './ux/suggestions';
import { askCopilot, condenseUtterance, draftClientEmail, pickCadTool, proposeMaterials } from './ai/hybrid';
import { shouldCondense } from './ai/condense';
import {
  bindDirectory, createDirectory, createIndexedDbDirectoryStore, fillVisible, protectText,
} from './privacy/directory';
import type { PlanDoc } from './plan/doc';
import { generatePlan } from './ai/hybrid';
import { isFirebaseConfigured } from './firebase/app';
import {
  createJobQueue, createIndexedDbStore, type JobKind, type QueuedJob,
} from './offline/queue';
import { isValidStaged } from './offline/staged';
import { createNetworkMonitor, routeBigJob } from './offline/network';
import {
  createPhrasebook, createIndexedDbPhrasebookStore,
  parseTeachCommand, parseCorrectionCommand,
} from './ai/phrasebook';
import { describeRecipe, type Recipe, type RecipeStep } from './recipes/model';
import {
  createRecipeRecorder, makeDesignerRecipe, opSignature, detectRepeat, type SaveResult,
} from './recipes/recorder';
import { parseRecipeMeta, matchRecipe } from './recipes/match';
import { buildReplayOps, buildReplayBatch } from './recipes/replay';
import { buildDeviceActions } from './recipes/deviceRun';
import { buildBrowserPlan, type BrowserStep } from './recipes/browser';
import { createRecipeStore } from './recipes/storage';
import { recipeBookId, syncRecipeBook } from './recipes/sync';
import { pickRecipeHybrid } from './ai/hybrid';
import { createPairPanel } from './ui/pairPanel';
import { createSetupPanel, type SetupTarget } from './ui/setupPanel';
import { loadSetup, bindingForPhrase, isSetupPhrase, restPhrase, type SetupData } from './setup/setupState';
import { remapToReach, isFullReach } from './setup/calibration';
import { createMotionRecognizer, type MotionEvent } from './input/motionGestures';
import { bindableGestures, catalogGesture } from './input/gestureCatalog';
import { resolveGesture, nextRestState } from './input/gestureDispatch';
import { matchTemplate } from './input/gestureTemplates';
import { createFaceCueDetector, faceRatios } from './input/faceCues';
import { createDwellClicker } from './input/dwell';
import { createOneEuroFilter } from './input/oneEuro';
import { createClickCooldown } from './input/clickCooldown';
import { parseListenPhrase } from './input/listening';
import { applyGestureHints, createGestureGuide, gestureLabel } from './ui/gestureHints';
import { createLampPanel } from './ui/lampPanel';
import { createMusicPanel } from './ui/musicPanel';
import { parseMusicIntent } from './music/musicIntent';
import { createReferenceBoard, isReferenceRecipe, recipeSearchQuery, DRAWING_REFERENCES_RECIPE, makeSearch, searchPageUrl, type RefHit, type SearchEngine } from './references';
import { refineSearchQuery, generateReferenceOptions } from './ai/hybrid';
import { parseChromeIntent, intentToRequest } from './extension/intents';
import { createExtensionBridge } from './extension/bridge';
import { addClip, emptyClips, type ClipsState } from './extension/clips';
import { describeConfirm, initialConfirm, reduceConfirm, trimPreview, type ConfirmState } from './extension/confirm';
import { createClipsLayer } from './ui/clipsLayer';
import { createAddDevicePanel } from './ui/addDevicePanel';
import type { AddMode, FlowDeps } from './devices/addDeviceFlow';
import { getCachedConnector, saveConnector as cacheConnector, saveDevice as cachePairedDevice } from './devices/connectorCache';
import { builtinWizConnector, connectorKey, isWizIdentity, runAction } from './devices/connector';
import { identityFromWords, deviceNameIn, isAddDevicePhrase } from './devices/identify';
import { bridgeHealthy, discoverDevices, makeTransports } from './devices/discovery';
import { aimGimbalAt, disableSystemTracking, getGimbalPlugin, isIosShell } from './devices/native';
import { createGimbalFollow } from './devices/gimbalFollow';
import { createSimWorld } from './devices/simDevice';
import { identifyDevice, writeDeviceConnector, checkDeviceEffect } from './ai/hybrid';
import { lampStateLabel, type LampState } from './devices/wiz';
import type { MusicStatus } from './relay/protocol';
import { createFakeTransport, type RelayTransport } from './relay/transport';
import { probeFirestore } from './relay/firestoreTransport';
import {
  createGuestSession, createHostSession, type GuestSession, type HostSession,
} from './relay/session';
import { buildJoinUrl, pairStateLabel, type RelayCommand, type RunStatusKind } from './relay/protocol';
import {
  buildControlSnapshot, type AiFeedInput, type ApplianceState, type DeviceId, type ScenePrimitive,
} from './relay/controlSnapshot';

const ONBOARD_KEY = 'mendcraft.onboarded';
const MODE_KEY = 'mendcraft.mode';
const LANG_KEY = 'mendcraft.lang';
const LANG_LAST_KEY = 'mendcraft.lang.last';
const MUTE_KEY = 'mendcraft.muted';

// Spoken replies can be muted (near the language picker). Restored per session.
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage blocked */ }

// "Polished in English. Speak any language." The picker holds 'auto' (the
// default: detect every command) or a language code. `lastDetected` is what
// Auto listens in next (Web Speech needs a language up front).
let langPick: string = AUTO_PICK;
let lastDetected: Language | null = null;
try {
  langPick = resolvePick(localStorage.getItem(LANG_KEY));
  lastDetected = findLanguage(localStorage.getItem(LANG_LAST_KEY)) ?? null;
} catch {
  // Storage blocked — Auto, listening in the browser language.
}
const browserLang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
// The language of the command being handled (set per utterance by detection;
// between commands, the language recognition listens in). Drives routing
// (translate when non-English), the badge, captions and spoken replies.
let currentLanguage: Language = recognitionLanguage(langPick, lastDetected, browserLang);
// Does Nano report it can run the current language on-device? Set per command
// after detection; false means the cloud does the translate.
let deviceLangReady = false;
// The model's short reply in her language for the command in flight (spoken by
// speakConfirm when the op is verified, if the browser has a voice for it).
let pendingReply: string | null = null;

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

const MODE_SHORT_LABEL: Record<string, string> = { plan: 'Plan' };
const modeSwitchHtml = listModes().length < 2 ? '' : listModes()
  .map((m) => {
    const active = m.id === mode.id;
    const soon = m.status === 'coming-soon';
    const short = MODE_SHORT_LABEL[m.id] ?? m.label;
    const title = soon ? `${m.label} — coming soon` : `${m.label}: ${m.description}`;
    return `<button type="button" class="mode-btn${active ? ' active' : ''}" data-mode="${m.id}" aria-pressed="${active}" ${soon ? 'disabled' : ''} title="${title}">${short}${soon ? ' · soon' : ''}</button>`;
  })
  .join('');

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="layout">
    <div id="viewport" tabindex="0" role="application" aria-label="Design viewport. Click an object to select it; arrow keys pan, +/- zoom. Dwell or speak if a pinch is hard.">
      <div id="resume-hint" class="resume-hint" role="status" hidden>Look at the screen to resume</div>
      <p id="privacy-line" class="privacy-line" hidden>Face and hand data stay on this device. Nothing is uploaded.</p>
      <div id="caption-bar" class="caption-bar" role="status" aria-live="polite" hidden>
        <span id="caption-heard" class="caption-heard"></span>
        <span id="caption-translation" class="caption-translation" hidden></span>
      </div>
      <div id="choice-bar" class="choice-bar" role="group" aria-label="Did you mean" hidden></div>
      <div id="chrome-confirm" class="recipe-confirm chrome-confirm" hidden></div>
      <button type="button" id="btn-panel-chip" class="mc-panel-chip" aria-expanded="false" aria-controls="panel" title="Objects and command">Objects</button>
      <div id="empty-hint" class="empty-hint">
        <p>${mode.hint}</p>
        <div class="hint-buttons">${hintButtonsHtml}</div>
      </div>
    </div>
    <aside id="panel" class="is-collapsed" aria-label="Design details" hidden>
      <div id="fail-states" role="alert"></div>
      <section id="queue-section" aria-label="Later list" hidden>
        <h2>Later list <span id="queue-count" class="queue-count"></span></h2>
        <p id="queue-note" class="queue-note"></p>
        <ul id="queue-list" class="queue-list"></ul>
      </section>
      <section id="recipes-section" aria-label="Recipe book" hidden>
        <h2>Recipe book <span id="recipes-count" class="queue-count"></span></h2>
        <p id="recipes-note" class="queue-note"></p>
        <div id="recipe-confirm" class="recipe-confirm" hidden></div>
        <ul id="recipes-list" class="recipe-list"></ul>
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
        <pre id="op-json" role="status" aria-live="off" aria-label="Last operation (JSON)"></pre>
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
  <div id="statusbar" role="group" aria-label="System status">
    <a class="brand" href="/">Mendcraft</a>
    ${SIM_ACTIVE ? '<span class="badge badge-sim" title="Judge/simulation mode — no camera or mic needed">SIM</span>' : ''}
    <div id="mode-switch" role="group" aria-label="Design mode">${modeSwitchHtml}</div>
    <label id="lang-pick" class="lang-pick" title="${LANGUAGE_PROMISE} Auto detects the language of each command and listens in the last one it heard; pick a language if it mishears you.">
      <span class="sr-only">Speech language</span>
      <select id="lang-select" aria-label="Speech language. ${LANGUAGE_PROMISE}"><option value="${AUTO_PICK}"${langPick === AUTO_PICK ? ' selected' : ''}>${autoLabel(currentLanguage)}</option>${LANGUAGES
        .map((l) => `<option value="${l.code}"${l.code === langPick ? ' selected' : ''}>${l.label}</option>`)
        .join('')}</select>
      <button id="btn-mute" type="button" class="ghost" aria-pressed="false" title="Mute or unmute spoken replies">🔊 <span class="btn-label">Voice</span></button>
    </label>
    <span id="listen-chip" class="status-chip" data-state="listening" title="Say ‘Mendcraft sleep’ so background speech cannot fire commands. Say ‘Mendcraft wake’ to listen again.">
      <span class="status-k">Mic</span>
      <span id="listen-state" class="status-v">Listening</span>
    </span>
    <span class="status-chip">
      <span class="status-k sr-only">Source</span>
      <span id="source-badge" class="badge badge-rules" tabindex="0" role="img">RULES</span>
      <span id="conf-state" class="conf-state" hidden></span>
    </span>
    <span class="status-chip" title="${LANGUAGE_PROMISE}"><span class="status-k">Language</span><span id="lang-state" class="status-v">${langPick === AUTO_PICK ? 'Auto' : 'Picked'} · ${currentLanguage.englishName}</span></span>
    <span class="status-chip"><span class="status-k">Quick</span><span id="model-state" class="status-v">checking…</span></span>
    <span class="status-chip"><span class="status-k">Facing</span><span id="facing-state" class="status-v">—</span></span>
    <span class="status-chip"><span class="status-k">Operator</span><span id="operator-state" class="status-v">—</span></span>
    <span class="status-chip"><span class="status-k">Hand</span><span id="tracking-state" class="status-v">Hand not seen</span></span>
    <span class="status-chip" id="pinch-chip" title="Pinch strength: close thumb and index until the bar fills and turns green. Hover and wait to select if a pinch is hard. You can also speak the command.">
      <span class="status-k">Pinch</span>
      <span id="pinch-meter" class="pinch-meter" role="meter" aria-label="Pinch strength" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="pinch-meter-fill"></span></span>
      <span id="pinch-meter-label" class="status-v">—</span>
    </span>
    <span class="status-chip"><span class="status-k">Network</span><span id="net-state" class="status-v net-online" tabindex="0">Online</span></span>
    <span id="chrome-ext-chip" class="status-chip" title="Load the Mendcraft Chrome extension (chrome://extensions, Developer mode, Load unpacked, pick the extension folder) to copy and paste in any Chrome tab.">
      <span class="status-k">Chrome</span>
      <span id="chrome-ext-state" class="status-v">not connected</span>
    </span>
  </div>
  <div id="history-island" class="mc-island mc-island-history" role="group" aria-label="Undo and redo">
    <button id="btn-undo" type="button">Undo</button>
    <button id="btn-redo" type="button">Redo</button>
  </div>
  <div id="zoom-island" class="mc-island mc-island-zoom" role="group" aria-label="Zoom">
    <button id="btn-zoom-out" type="button" title="Zoom out" aria-label="Zoom out">−</button>
    <button id="btn-zoom-fit" type="button" title="Zoom to fit the plan" aria-label="Zoom to fit">Fit</button>
    <button id="btn-zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>
  </div>
  <header id="topbar">
    <button id="btn-help" type="button" class="ghost" title="Help and guided tour">Help</button>
    <button id="btn-camera" type="button" aria-pressed="false">Camera</button>
    <button id="btn-register" type="button" hidden>Register me</button>
    <button id="btn-reregister" type="button" hidden>Re-register</button>
    <button id="btn-mic" type="button" aria-pressed="false">Mic</button>
    <button id="btn-add-device" type="button" aria-haspopup="dialog" aria-label="Add a device" title="Add a device: point a camera at it, or say “add the lamp”">+ <span class="btn-label">Device</span></button>
    <button id="btn-copilot" type="button" aria-pressed="false" title="Review and History">Review &amp; History</button>
    <button id="btn-3d" type="button" aria-pressed="false" hidden>3D view</button>
    <button id="btn-export" type="button">${mode.exportLabel}</button>
    ${SIM_ACTIVE ? '<button id="btn-demo" type="button">Play demo</button>' : ''}
    <div id="more-wrap" class="more-wrap">
      <button id="btn-more" type="button" class="ghost" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu" aria-label="More tools" title="More tools">More</button>
      <div id="more-menu" class="more-menu" role="menu" hidden>
        <button id="btn-setup" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="First-run setup: reach, pinch, steadiness, your own gestures and voice shortcuts (stays on this device)">Set up hands</button>
        <button id="btn-gestures" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog">Gesture guide</button>
        <button id="btn-hands" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="Adapt pointer sensitivity to your hands (on-device)">Pointer comfort</button>
        <button id="btn-voice" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="Pick the voice that speaks replies (voices already on this device)">Spoken voice</button>
        <button id="btn-directory" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="People directory: names stay on this device and are replaced with tokens before anything goes to Gemini">Directory</button>
        <button id="btn-keyboard" type="button" class="ghost" aria-pressed="false">Keyboard</button>
        <button id="btn-reference" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog">Reference</button>
        <button id="btn-routing" type="button" class="ghost" aria-pressed="false" title="Show how each command was routed (rules / on-device / cloud)">Routing</button>
        <button id="btn-ledger" type="button" class="ghost" aria-pressed="false" title="What left this device: a ledger of every cloud call vs. the private on-device events">What left device</button>
        <button id="btn-pair" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="Pair an iPad or phone as a remote and a second camera (scan a QR)">Pair iPad or phone</button>
        <button id="btn-lamp" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="Control a WiZ lamp over the local bridge (npm run wiz-bridge)">Lamp</button>
        <button id="btn-music" type="button" class="ghost" aria-pressed="false" aria-haspopup="dialog" title="Play music: Spotify Premium when connected, otherwise the built-in player">Music</button>
        <button id="btn-a11y" type="button" class="ghost" title="Guideline check: door widths, stairs, room sizes. Never certified code compliance. Also say “check the plan”.">Guideline check</button>
        <button id="btn-teach" type="button" class="ghost" aria-pressed="false" title="Teach a recipe: turn on, do the task once, then say 'save this as <name>'">Teach</button>
        <button id="btn-recipes" type="button" class="ghost" aria-pressed="false" title="Recipe book: taught-once tasks you can replay by saying 'do <name>'">Recipes</button>
        <button id="btn-ai" type="button" disabled>Checking on-device AI…</button>
        <div id="progress-wrap" hidden>
          <div id="progress-bar" role="progressbar" aria-label="Getting Quick ready" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="progress-fill"></div></div>
          <span id="progress-label">0%</span>
        </div>
      </div>
    </div>
  </header>
  <div id="sr-live" class="sr-only" aria-live="polite"></div>
  <div id="status-live" class="sr-only" aria-live="polite"></div>
  <div id="mc-toast" class="mc-toast" role="status" aria-live="polite" hidden></div>
  <div id="onboarding" hidden></div>
  <div id="tour" hidden></div>
`;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewportEl = el<HTMLDivElement>('viewport');
const emptyHint = el<HTMLDivElement>('empty-hint');
const sourceBadge = el<HTMLSpanElement>('source-badge');
const confStateEl = el<HTMLSpanElement>('conf-state');
const choiceBarEl = el<HTMLDivElement>('choice-bar');
const chromeConfirmEl = el<HTMLDivElement>('chrome-confirm');
const chromeExtChip = el<HTMLSpanElement>('chrome-ext-chip');
const chromeExtState = el<HTMLSpanElement>('chrome-ext-state');
const modelStateEl = el<HTMLSpanElement>('model-state');
const facingStateEl = el<HTMLSpanElement>('facing-state');
const operatorStateEl = el<HTMLSpanElement>('operator-state');
const trackingStateEl = el<HTMLSpanElement>('tracking-state');
let lastHandState: 'seen' | 'paused' | 'off' = 'off';
let quickDownloadPercent: number | undefined;
let studioChrome: ReturnType<typeof mountStudioChrome> | null = null;
let leaveState: LeaveState = IDLE_LEAVE;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
let deepAudio: AudioContext | undefined;
function deepSound(): AudioContext | undefined {
  try { return deepAudio ??= new AudioContext(); } catch { return undefined; }
}
function beginDeepWait(kind: 'copilot' | 'lighting' | 'email' | 'connector' | 'plan' | 'other'): void {
  playDeepTick(deepSound());
  copilotPanel.setBusy(deepWorkingLabel(kind));
}
function endDeepWait(): void {
  copilotPanel.setBusy(null);
  playDeepChime(deepSound());
}
function refreshStudioStatus(): void {
  if (!studioChrome) return;
  const st = getHybridStatus();
  const quick = st.deviceModel === 'ready' ? 'ready'
    : st.deviceModel === 'downloading' ? 'getting-ready'
    : st.deviceModel === 'idle' ? 'checking'
    : 'unavailable';
  studioChrome.setStatus({
    online: typeof net !== 'undefined' ? net.online() : true,
    quick,
    quickPercent: typeof quickDownloadPercent === 'undefined' ? undefined : quickDownloadPercent,
    mic: voiceListening ? 'listening' : 'sleep',
    hand: lastHandState,
  });
}
function setTracking(text: string): void {
  const paused = /paused/i.test(text);
  const off = text === 'camera off' || /starting camera|camera off/i.test(text);
  const seen = !off && !paused && /(?:^|[^\d])([1-9]\d*)\s/.test(text);
  lastHandState = paused ? 'paused' : seen ? 'seen' : 'off';
  trackingStateEl.textContent = lastHandState === 'seen' ? 'Hand seen' : lastHandState === 'paused' ? 'Hands paused' : 'Hand not seen';
  trackingStateEl.title = text;
  trackingStateEl.closest('.status-chip')?.classList.toggle('is-live', lastHandState === 'seen');
  refreshStudioStatus();
}
const listenChip = el<HTMLSpanElement>('listen-chip');
const listenStateEl = el<HTMLSpanElement>('listen-state');
const pinchMeterEl = el<HTMLSpanElement>('pinch-meter');
const pinchMeterFill = el<HTMLSpanElement>('pinch-meter-fill');
const pinchMeterLabel = el<HTMLSpanElement>('pinch-meter-label');
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
const btnCopilot = el<HTMLButtonElement>('btn-copilot');
const btnExport = el<HTMLButtonElement>('btn-export');
const progressWrap = el<HTMLDivElement>('progress-wrap');
const progressBar = el<HTMLDivElement>('progress-bar');
const progressFill = el<HTMLDivElement>('progress-fill');
const progressLabel = el<HTMLSpanElement>('progress-label');
const commandForm = el<HTMLFormElement>('command-box');
const commandInput = el<HTMLInputElement>('command-input');
const netStateEl = el<HTMLSpanElement>('net-state');
const langSelect = el<HTMLSelectElement>('lang-select');
const langStateEl = el<HTMLSpanElement>('lang-state');
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

/** speechSynthesis. UI text is English-only, so say() speaks English; a reply
 *  in her language passes that language (and only when a voice exists for it —
 *  pickReply already fell back to English otherwise). */
function speakSynth(message: string, lang: Language = DEFAULT_LANGUAGE): void {
  if (!('speechSynthesis' in window)) return;
  const raw = window.speechSynthesis.getVoices();
  const picked = pickSpokenVoice(raw.map(toSynthVoice), { lang: lang.speechLang, saved: loadSavedVoice() });
  const voice = picked ? raw.find((v) => v.voiceURI === picked.voiceURI) ?? null : null;
  if (!voice && !isEnglish(lang)) return;
  const utter = new SpeechSynthesisUtterance(message);
  utter.rate = 1.1;
  utter.lang = lang.speechLang;
  if (voice) utter.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

/** Does speechSynthesis have a usable voice for this language? */
function synthHasVoice(lang: Language = currentLanguage): boolean {
  if (isEnglish(lang)) return true;
  if (!('speechSynthesis' in window)) return false;
  return pickVoice(window.speechSynthesis.getVoices(), lang) != null;
}

/**
 * Speak the short confirmation for an applied op: in her language (the model's
 * own short reply, or the offline Kannada phrase) when the browser has a voice
 * for it, otherwise the English verb in English. speechSynthesis only — nothing
 * leaves the device for a spoken reply.
 */
function speakConfirm(opName: string | null | undefined): void {
  const reply = pickReply(opName, currentLanguage, pendingReply, synthHasVoice());
  pendingReply = null;
  srLive.textContent = reply.text; // screen-reader text always updates
  if (activeProfile.voiceVerbosity === 'terse') return;
  if (pickSpeechRoute(reply.lang, { synthHasVoice: synthHasVoice(reply.lang) }, muted) === 'silent') return;
  speakSynth(reply.text, reply.lang);
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

// Change-log context (who / why for the next recorded edit).
let applyingReviewed = false;
let lastUtteranceAt = 0;
let lastUtteranceText = '';
let lastUtteranceSource: ChangeEntry['source'] = 'rules';

function setBadge(source: Source, reason?: RouteReason, translated = false, note?: string | null): void {
  lastUtteranceSource = source === 'cloud' ? 'cloud' : source === 'on-device' ? 'on-device' : 'rules';
  sourceBadge.className = `badge badge-${source}`;
  const label = reason
    ? languageBadgeLabel(source, reason, currentLanguage, translated)
    : SOURCE_TEXT[source];
  sourceBadge.textContent = label;
  const why = reason ? ` Route: ${REASON_TEXT[reason]}${note ? ` (${note})` : ''}.` : '';
  sourceBadge.title = `${SOURCE_TOOLTIP[source]}${why}`;
  sourceBadge.setAttribute('aria-label', `AI source: ${label}. ${SOURCE_TOOLTIP[source]}${why}`);
}
/** Honest badge when the numbers were read from the drawing, not invented by Nano. */
function setPlanDataBadge(note?: string): void {
  lastUtteranceSource = 'rules';
  sourceBadge.className = 'badge badge-rules';
  sourceBadge.textContent = 'Plan data · on device';
  const tip = note
    ? `${note} The numbers come from the drawing; no model guessed them.`
    : 'Read from the drawing on this device. No model was asked.';
  sourceBadge.title = tip;
  sourceBadge.setAttribute('aria-label', `AI source: Plan data · on device. ${tip}`);
}
setBadge('rules');

// ---- live caption bar (her words + the English translation) ----------------

/** Show what was heard; the translation line fills in once fusion returns.
 *  The bar is a compact caption (not a full-height column) and fades out. */
const CAPTION_HOLD_MS = 4000;
const CAPTION_FADE_MS = 600;
let captionHideTimer: ReturnType<typeof setTimeout> | undefined;
let captionFadeTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleCaptionHide(): void {
  captionBar.classList.remove('is-fading');
  if (captionHideTimer) clearTimeout(captionHideTimer);
  if (captionFadeTimer) clearTimeout(captionFadeTimer);
  const reduce = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  captionHideTimer = setTimeout(() => {
    if (reduce) {
      captionBar.hidden = true;
      return;
    }
    captionBar.classList.add('is-fading');
    captionFadeTimer = setTimeout(() => {
      captionBar.hidden = true;
      captionBar.classList.remove('is-fading');
    }, CAPTION_FADE_MS);
  }, CAPTION_HOLD_MS);
}

function showCaptionHeard(heard: string): void {
  const text = heard.trim();
  if (!text) return;
  captionHeard.textContent = text;
  captionHeard.lang = currentLanguage.speechLang;
  captionTranslation.hidden = true;
  captionTranslation.textContent = '';
  captionBar.hidden = false;
  scheduleCaptionHide();
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
  captionBar.hidden = false;
  scheduleCaptionHide();
  controlCaption = {
    heard: cap.heard, translation: cap.translation,
    langCode: currentLanguage.code, langLabel: currentLanguage.englishName,
  };
}

// ---- language picker -------------------------------------------------------

/** Nano language availability, cached per code (a cheap availability() query,
 *  no download). False = the cloud translates. */
const nanoLangCache = new Map<string, boolean>();
async function nanoCanRun(lang: Language): Promise<boolean> {
  if (SIM_ACTIVE) return simSpeechNano(lang.code);
  const hit = nanoLangCache.get(lang.code);
  if (hit !== undefined) return hit;
  const ready = await checkLanguageAvailability(lang.code);
  if (!isEnglish(lang)) nanoLangCache.set(lang.code, ready); // en follows the base model status
  return ready;
}

/** SIM: pretend Nano runs English, Spanish and Japanese (as real Chrome does). */
function simSpeechNano(code: string): boolean {
  return code === 'en' || code === 'es' || code === 'ja';
}

/** Show what recognition listens in and how the last command's language was found. */
function renderLangState(detection: Detection | null): void {
  const listening = recognitionLanguage(langPick, lastDetected, browserLang);
  const autoOpt = langSelect.querySelector<HTMLOptionElement>(`option[value="${AUTO_PICK}"]`);
  if (autoOpt) autoOpt.textContent = autoLabel(listening);
  const sim = SIM_ACTIVE && detection && (detection.via === 'cloud' || detection.via === 'chrome') ? 'SIM · ' : '';
  langStateEl.textContent = detection
    ? `${sim}${detectionLabel(detection)}`
    : `${langPick === AUTO_PICK ? 'Auto' : 'Picked'} · ${listening.englishName}`;
  langStateEl.title = `${LANGUAGE_PROMISE} Listening in ${listening.englishName}.`;
}

/**
 * Work out the language of one command (ai/langDetect): Chrome's on-device
 * Language Detector, then the on-device script/word checks, then — only in
 * Auto, only for ambiguous Latin text, only without Chrome's detector — Gemini
 * in the cloud (recorded in the ledger). Sets currentLanguage + deviceLangReady.
 */
async function detectCommandLanguage(text: string): Promise<Detection> {
  const listening = recognitionLanguage(langPick, lastDetected, browserLang);
  const sim = SIM_ACTIVE ? simSpeechFor(text) : null;
  const device = SIM_ACTIVE ? null : await detectOnDevice(text);
  const cloudReady = sim ? true : routerEnv().cloudReady && net.online();
  const plan = planDetection({
    text, pick: langPick, listening, device,
    deviceAvailable: SIM_ACTIVE ? false : chromeDetectorAvailable(),
    cloudReady,
  });
  let detection: Detection;
  if (plan.kind === 'done') {
    detection = plan.detection;
    if (detection.via === 'chrome' || detection.via === 'script' || detection.via === 'words') {
      recordLedger('on-device', 'lang-detect', REASON_TEXT.private, '');
    }
  } else if (sim) {
    // SIM: the model answer is faked; the ledger line says so.
    detection = { lang: resolveLanguage(sim.lang), confidence: 0.93, via: 'cloud' };
    recordLedger('cloud', 'lang-detect (simulated)', 'no on-device language detector', `detect language: ${JSON.stringify(text)}`, 0);
  } else {
    const t0 = performance.now();
    const r = await detectLanguageCloud(text, { planNames: planLabelNames() });
    // The transcript left the device whether or not an answer came back.
    recordLedger('cloud', 'lang-detect', 'no on-device language detector', `detect language: ${JSON.stringify(text)}`, r?.ms ?? performance.now() - t0);
    detection = r?.detection ?? plan.fallback;
  }
  currentLanguage = detection.lang;
  deviceLangReady = isEnglish(detection.lang) ? routerEnv().deviceReady : await nanoCanRun(detection.lang);
  // Auto follows her: a confident detection becomes the next listening language.
  if (langPick === AUTO_PICK && detection.via !== 'hint' && detection.confidence >= 0.6
    && detection.lang.code !== lastDetected?.code) {
    lastDetected = detection.lang;
    try { localStorage.setItem(LANG_LAST_KEY, detection.lang.code); } catch { /* storage blocked */ }
    voice.setLang(detection.lang.speechLang);
  }
  renderLangState(detection);
  return detection;
}

/** Apply the picker ('auto' or a code). UI and announcements stay English. */
function applyLanguage(pick: string, announce: boolean): void {
  langPick = resolvePick(pick);
  try { localStorage.setItem(LANG_KEY, langPick); } catch { /* storage blocked */ }
  currentLanguage = recognitionLanguage(langPick, lastDetected, browserLang);
  voice.setLang(currentLanguage.speechLang);
  void nanoCanRun(currentLanguage).then((ready) => { deviceLangReady = ready; });
  captionBar.hidden = true; // stale translation from the old language
  renderLangState(null);
  if (announce) {
    say(langPick === AUTO_PICK
      ? `Auto language. Listening in ${currentLanguage.englishName}. Speak any language.`
      : `Listening in ${currentLanguage.englishName}.`);
  }
}

// ---- controller + renderer (mode-provided) ----

// Every drawing change goes through the change log: her own edits are recorded
// as applied; accepted AI proposals and reverts are recorded by the log itself.
const changeLog = createChangeLog(typeof localStorage !== 'undefined' ? localStorage : null);
const siteChecklist = createSiteChecklist(typeof localStorage !== 'undefined' ? localStorage : null);
const geminiReview = createGeminiReview(typeof localStorage !== 'undefined' ? localStorage : null);
const peopleDirectory = createDirectory(createIndexedDbDirectoryStore());
bindDirectory(peopleDirectory);
window.addEventListener('pagehide', () => changeLog.flush());
const rawController: ModeController = await mode.createController();
const controller: ModeController = withChangeRecording(rawController, {
  log: changeLog,
  suppressed: () => applyingReviewed,
  why: () => (Date.now() - lastUtteranceAt < 8000 && lastUtteranceText ? `You said: "${lastUtteranceText}"` : 'Direct edit (pinch / mouse)'),
  source: () => (Date.now() - lastUtteranceAt < 8000 ? lastUtteranceSource : 'rules'),
});
const viewport: ViewportHandle = await mode.createRenderer(viewportEl, controller, (id) => {
  if (!id) return;
  controller.selectId(id);
  renderAll();
});

const btnPanelChip = el<HTMLButtonElement>('btn-panel-chip');
const panelEl = el<HTMLElement>('panel');
function setPanelOpen(on: boolean): void {
  panelEl.classList.toggle('is-collapsed', !on);
  panelEl.hidden = !on;
  btnPanelChip.setAttribute('aria-expanded', String(on));
  btnPanelChip.classList.toggle('is-open', on);
}
btnPanelChip.addEventListener('click', () => setPanelOpen(panelEl.classList.contains('is-collapsed')));
setPanelOpen(false);

(function dockUndoRedo(): void {
  const dock = viewportEl.querySelector('.mc-palette');
  const island = document.getElementById('history-island');
  if (!dock || !island) return;
  const group = document.createElement('div');
  group.className = 'mc-dock-edit';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Undo and redo');
  group.append(btnUndo, btnRedo);
  dock.append(group);
  island.remove();
})();

(function dockAsk(): void {
  const form = document.getElementById('command-box');
  const topbar = document.getElementById('topbar');
  if (!form || !topbar || !topbar.parentElement) return;
  form.classList.add('mc-ask');
  const input = document.getElementById('command-input');
  if (input instanceof HTMLInputElement) {
    input.placeholder = 'Say it, or type here';
    input.setAttribute('aria-label', 'Say or type a command');
  }
  const cluster = document.createElement('div');
  cluster.className = 'mc-session-cluster';
  cluster.setAttribute('role', 'group');
  cluster.setAttribute('aria-label', 'Session');
  topbar.parentElement.insertBefore(cluster, topbar);
  cluster.append(form, topbar);
  for (const sel of ['#last-command', '#op-json', '#verifier-result']) {
    const section = document.querySelector(sel)?.closest('section');
    if (section instanceof HTMLElement) section.hidden = true;
  }
})();

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
    // Wait for the spoken-caption pill to fade so the next-step hint is not covered.
    window.setTimeout(() => {
      if (controller.listItems().length > 0) {
        viewport.showHint?.('You can say: add a door, check the plan, or convert to 3D.');
      }
    }, 4500);
  } else if (count === 0) {
    hadContent = false;
  }
}

function renderParts(): void {
  const items = controller.listItems();
  const n = items.length;
  btnPanelChip.textContent = n ? `Objects · ${n}` : 'Objects';
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
// Chrome extension bridge: detect, show "Chrome extension connected", and
// route copy/paste/tab intents. Replies are treated as data only.
const chromeBridge = createExtensionBridge();
let clipsState: ClipsState = emptyClips();
const clipsLayer = createClipsLayer(clipsState);
clipsLayer.onChange((s) => { clipsState = s; });
viewportEl.appendChild(clipsLayer.element);
let chromeConfirm: ConfirmState = initialConfirm();

function updateChromeChip(): void {
  const connected = chromeBridge.isConnected();
  chromeExtChip.classList.toggle('chrome-ext-on', connected);
  chromeExtState.textContent = connected ? 'extension connected' : 'not connected';
  chromeExtChip.title = connected
    ? 'Chrome extension connected. Say copy this, copy the link, send to canvas, paste here, or switch to a tab by name.'
    : 'Load the Mendcraft Chrome extension (chrome://extensions, Developer mode, Load unpacked, pick the extension folder) to copy and paste in any Chrome tab.';
}

async function openViaExtension(url: string): Promise<boolean> {
  if (chromeBridge.isConnected()) {
    const res = await chromeBridge.request('openTab', { url });
    if (res.ok) return true;
  }
  try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* popups blocked */ }
  return false;
}

chromeBridge.subscribe(updateChromeChip);
chromeBridge.start();
updateChromeChip();

const referencePanel = createReferencePanel({
  onSaveRecipe: (steps) => saveBrowserRecipe(steps),
  openExternal: (url) => openViaExtension(url),
  extensionConnected: () => chromeBridge.isConnected(),
});
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
// Anchored two-hand pinch zoom/pan for the plan view: the grabbed points track
// the fingers (dead-zone/grace/clamp/smoothing from twoHandTransform.ts),
// driven incrementally through the renderer's zoomAt/panByPx.
const cadTwoHand = createTwoHandGesture({ rotate: false, minScale: 0.2, maxScale: 8 });
let cadGrabMid: Vec | null = null;
let cadLastT: SimilarityTransform = { ...IDENTITY };
/** A hand's pinch midpoint (thumb+index tips) mapped to client px, through the
 *  same mirror + calibrated reach + viewport mapping the hand cursor uses. */
function handPinchClient(h: ReadonlyArray<{ x: number; y: number }>): Vec {
  const mid = { x: (h[4].x + h[8].x) / 2, y: (h[4].y + h[8].y) / 2 };
  const p = reachPoint(1 - mid.x, mid.y);
  const c = toClient(p.x, p.y);
  return { x: c.clientX, y: c.clientY };
}

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
 * from activeProfile), and voice verbosity (say()). snapRadiusScale widens the
 * magnet that snaps the cursor onto the nearest canvas object; dwellMs is the
 * hover-to-select fallback (always on for objects, and for buttons too).
 */
function applyActiveProfile(adaptation: ProfileAdaptation): void {
  const resolved = resolveActiveProfile(adaptation, handsPanel.getOverride());
  activeProfile = resolved.profile;
  // Her calibrated pinch (setup) wins over the profile's preset thresholds.
  const cal = setupData.calibration;
  tracker?.setPinchThreshold(cal ? cal.pinchOn : activeProfile.pinchOn, cal ? cal.pinchOff : activeProfile.pinchOff);
  document.documentElement.style.setProperty('--mc-target-scale', String(activeProfile.targetScale));
  // The on-screen keyboard's hover-dwell follows the same per-profile dwell as
  // the canvas dwell (assist 900 / standard 700 / precise 600), honouring a
  // calibrated dwell when one exists.
  keyboard.setDwellMs(cal ? cal.dwellMs : activeProfile.dwellMs);
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

// ---- spoken voice picker (ai/speechVoices + ui/voicePanel) ----
// Free, on-device: replies speak with a voice the browser already has, and the
// choice stays in this browser's localStorage. No paid TTS, ever.
const btnVoice = el<HTMLButtonElement>('btn-voice');
const btnDirectory = el<HTMLButtonElement>('btn-directory');

function listSynthVoices(): SynthVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices().map(toSynthVoice);
}

/** Speak with one specific voice, even when mute or a terse profile would
 *  silence ordinary replies — she asked to hear this voice. */
function speakWithVoice(text: string, voice: SynthVoice | null): void {
  if (!('speechSynthesis' in window)) {
    srLive.textContent = 'This browser cannot speak. Replies stay as text.';
    return;
  }
  srLive.textContent = text;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.1;
  if (voice) {
    utter.lang = voice.lang;
    const raw = window.speechSynthesis.getVoices().find((x) => x.voiceURI === voice.voiceURI);
    if (raw) utter.voice = raw;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

const voicePanel = createVoicePanel({
  getVoices: listSynthVoices,
  onChange: (saved) => {
    const voice = pickSpokenVoice(listSynthVoices(), { lang: currentLanguage.speechLang, saved });
    const text = saved ? `Voice set to ${saved.name ?? 'your pick'}.` : 'Back to the usual voice.';
    if (muted) { srLive.textContent = text; return; } // mute still wins for the confirm
    speakWithVoice(text, voice);
  },
  onPreview: (voice) => speakWithVoice(previewPhrase(voice.lang), voice),
});
viewportEl.appendChild(voicePanel.element);
btnVoice.addEventListener('click', () => {
  overflowMenu.close();
  voicePanel.toggle();
  toggleButton(btnVoice, voicePanel.isOpen());
});
const directoryPanel = createDirectoryPanel(peopleDirectory);
viewportEl.appendChild(directoryPanel.element);
btnDirectory.addEventListener('click', () => {
  overflowMenu.close();
  directoryPanel.toggle();
  toggleButton(btnDirectory, directoryPanel.isOpen());
});
peopleDirectory.subscribe(() => {
  if (directoryPanel.isOpen()) directoryPanel.refresh();
  toggleButton(btnDirectory, directoryPanel.isOpen());
});
if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
  // Chrome fills getVoices() late; repaint the open panel when the list lands.
  window.speechSynthesis.addEventListener('voiceschanged', () => voicePanel.refresh());
}

/** "Change voice" / "use the Soumya voice" / "preview the voice": resolved by
 *  pure resolveChangeVoice; this applies the storage + panel side effects. */
function runChangeVoice(intent: ChangeVoiceIntent, utterance: string): boolean {
  const out = resolveChangeVoice(intent, listSynthVoices(), loadSavedVoice(), currentLanguage.speechLang);
  if (out.action === 'reset') clearSavedVoice();
  if (out.action === 'set' && out.voice) saveVoice(out.voice);
  if (out.action === 'open' || out.action === 'not-found') {
    voicePanel.open();
    toggleButton(btnVoice, true);
  }
  voicePanel.refresh();
  speakWithVoice(out.say, out.voice);
  setBadge('rules', 'exact');
  recordLedger('rules', 'command', 'voice picker', utterance);
  verifierEl.textContent = out.say;
  return true;
}


// ---- first-run setup + a gesture for every button ----
// Pure logic: setup/calibration, setup/setupState, input/motionGestures,
// input/gestureCatalog, input/gestureDispatch, input/gestureTemplates,
// input/faceCues, input/dwell. Everything measured stays in localStorage.
let setupData: SetupData = loadSetup();
const motion = createMotionRecognizer();
const dwell = createDwellClicker(900);
const cursorFilter = createOneEuroFilter();
const clickCooldown = createClickCooldown();
let voiceListening = true;
const faceCues = createFaceCueDetector();
let resting = false;
let lastClosedPanel: HTMLElement | null = null;
let lastHand: { x: number; y: number } | null = null;
let customHeld: { id: string; since: number; fired: boolean } | null = null;
const unwiredNoted = new Set<string>();

const gestureGuide = createGestureGuide();
gesturesPanel.element.appendChild(gestureGuide.element);

const restBanner = document.createElement('div');
restBanner.className = 'mc-rest-banner';
restBanner.setAttribute('role', 'status');
restBanner.hidden = true;
restBanner.textContent = 'Resting: gestures paused. Wave to wake.';
viewportEl.appendChild(restBanner);

const COMMAND_TARGETS: SetupTarget[] = [
  { id: 'confirm', label: 'Confirm (what is waiting)' },
  { id: 'cancel', label: 'Stop / cancel' },
  { id: 'rest-toggle', label: 'Rest mode on/off' },
];

function buttonLabel(b: HTMLElement): string {
  const c = b.cloneNode(true) as HTMLElement;
  c.querySelectorAll('.mc-ghint').forEach((n) => n.remove());
  return (b.getAttribute('aria-label') ?? c.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function setupTargets(): SetupTarget[] {
  const out: SetupTarget[] = [];
  for (const b of document.querySelectorAll<HTMLButtonElement>('#topbar button[id]')) {
    if (b.id === 'btn-ai' || b.id === 'btn-register' || b.id === 'btn-reregister') continue;
    const label = buttonLabel(b);
    if (label) out.push({ id: b.id, label });
  }
  return [...out, ...COMMAND_TARGETS];
}

const setupPanel = createSetupPanel({
  targets: setupTargets,
  gestures: () => bindableGestures().map((g) => ({ id: g.id, label: `${g.glyph} ${g.label}` })),
  cameraOn: () => tracker !== null,
  enableCamera: () => enableCamera(),
  onChange: (d) => { setupData = d; applySetup(); },
  say: (t) => say(t),
  extensionConnected: () => chromeBridge.isConnected(),
});
viewportEl.appendChild(setupPanel.element);
const btnSetup = el<HTMLButtonElement>('btn-setup');
btnSetup.addEventListener('click', () => {
  overflowMenu.close();
  if (setupPanel.isOpen()) setupPanel.close(); else setupPanel.open();
  toggleButton(btnSetup, setupPanel.isOpen());
});

function refreshHints(): void {
  applyGestureHints(el<HTMLElement>('topbar'), setupData.bindings, setupData.templates, setupData.showHints);
}

function applySetup(): void {
  const cal = setupData.calibration;
  if (cal) {
    motion.setReach(cal.reach.x1 - cal.reach.x0, cal.reach.y1 - cal.reach.y0);
    dwell.setDwell(cal.dwellMs);
  } else {
    motion.setReach(1, 1);
    dwell.setDwell(activeProfile.dwellMs);
  }
  if (setupData.faceBaseline) faceCues.setBaseline([setupData.faceBaseline]);
  applyActiveProfile(lastAdaptation);
  refreshHints();
}

/** Map a raw mirrored hand point through her calibrated reach box. */
function reachPoint(x: number, y: number): { x: number; y: number } {
  const r = setupData.calibration?.reach;
  if (!r || isFullReach(r)) return { x, y };
  return remapToReach({ x, y }, r);
}

function setResting(on: boolean): void {
  if (resting === on) return;
  resting = on;
  restBanner.hidden = !on;
  document.body.classList.toggle('mc-resting', on);
  if (on) { handCursor.classList.remove('pinching'); viewport.endDrag?.(); }
  say(on ? 'Resting. Gestures paused. Wave to wake.' : 'Awake. Gestures on.');
}

function setListening(on: boolean): void {
  if (voiceListening === on) {
    say(on ? 'Already listening.' : 'Already sleeping. Say Mendcraft wake to listen.');
    return;
  }
  voiceListening = on;
  listenChip.dataset.state = on ? 'listening' : 'sleep';
  listenStateEl.textContent = on ? 'Mic on' : 'Mic sleeping';
  document.body.classList.toggle('mc-voice-sleep', !on);
  say(on ? 'Listening. Commands are on.' : 'Sleeping. Say Mendcraft wake when you want me to listen.');
  refreshStudioStatus();
}

/** Panels a palm swipe "back" can close, newest first. */
function topOpenPanel(): HTMLElement | null {
  const open = [...viewportEl.children].filter((c): c is HTMLElement =>
    c instanceof HTMLElement && c.tagName === 'SECTION' && !c.hidden && c !== restBanner);
  return open[open.length - 1] ?? null;
}

function closeTopPanel(): boolean {
  if (refBoard.isGridOpen() || refBoard.isChooserOpen()) { refBoard.closeGrid(); say('References closed.'); return true; }
  if (refsTabOpen) { void chromeBridge.request('closeRefs'); refsTabOpen = false; say('References closed.'); return true; }
  if (overflowMenu.isOpen()) { overflowMenu.close(); return true; }
  const panel = topOpenPanel();
  if (!panel) return false;
  const x = panel.querySelector<HTMLButtonElement>('.mc-panel-x, .mc-ref-x, .mc-lamp-x, button[aria-label^="Close"]');
  if (x) x.click(); else panel.hidden = true;
  lastClosedPanel = panel;
  return true;
}

function scrollUnderCursor(dir: 1 | -1): void {
  let node: Element | null = lastPointer ? document.elementFromPoint(lastPointer.clientX, lastPointer.clientY) : null;
  while (node && node !== document.body) {
    const st = getComputedStyle(node);
    if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 2) break;
    node = node.parentElement;
  }
  const target = node && node !== document.body ? node : el<HTMLElement>('panel');
  target.scrollBy({ top: dir * 240, behavior: 'smooth' });
}

function selectArea(box: { x0: number; y0: number; x1: number; y1: number }): void {
  const a = reachPoint(box.x0, box.y0), b = reachPoint(box.x1, box.y1);
  const ids = new Set<string>();
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const { clientX, clientY } = toClient(a.x + ((b.x - a.x) * i) / 4, a.y + ((b.y - a.y) * j) / 4);
      const id = viewport.pick(clientX, clientY);
      if (id) ids.add(id);
    }
  }
  if (ids.size === 0) { say('Nothing inside the circle.'); return; }
  const multi = controller.applyOp({ op: 'select_set', ids: [...ids] });
  if (!multi.ok) controller.selectId([...ids][0]);
  renderAll();
  say(`${ids.size} selected.`);
}

let lampOn = true;
function lampButton(sel: string): void {
  lampPanel.element.querySelector<HTMLButtonElement>(sel)?.click();
}

/** Something is waiting for a yes (chips, recipe card, a11y preview)? */
function somethingPending(): boolean {
  return !choiceBarEl.hidden || !recipeConfirmEl.hidden || !chromeConfirmEl.hidden || refBoard.pendingConfirm() || document.querySelector('.mc-a11y-preview:not([hidden])') !== null;
}

/** Run a button or command target. Returns false if nothing ran. */
function runTarget(target: string, value?: number): boolean {
  switch (target) {
    case 'add-device': void openAddDevice(); return true;
    case 'confirm':
      if (refBoard.pendingConfirm() && refBoard.confirm()) return true;
      if (!chromeConfirmEl.hidden) { void confirmChromePaste('pinch'); return true; }
      if (addDevicePanel.confirm()) return true;
      viewportEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    case 'cancel':
      window.speechSynthesis?.cancel();
      if (refBoard.isGridOpen() || refBoard.isChooserOpen()) { refBoard.closeGrid(); say('References closed.'); return true; }
      if (refsTabOpen) { void chromeBridge.request('closeRefs'); refsTabOpen = false; say('References closed.'); return true; }
      if (!chromeConfirmEl.hidden) { clearChromeConfirm(); return true; }
      if (addDevicePanel.cancel()) return true;
      if (handleChoiceReply('cancel') !== null) return true;
      if (somethingPending()) return closeTopPanel();
      if (studioChrome?.palmOpen()) { studioChrome.closePalm(); return true; }
      studioChrome?.openPalm({ x: viewportEl.clientWidth / 2, y: viewportEl.clientHeight / 2 });
      say('Palm menu. Glide toward a slice and pinch, or say its name.');
      return true;
    case 'nav-back':
      return closeTopPanel();
    case 'nav-forward':
      if (lastClosedPanel && lastClosedPanel.hidden) { lastClosedPanel.hidden = false; return true; }
      return false;
    case 'scroll-up':
      if (refsTabOpen) { void chromeBridge.request('refsCommand', { cmd: 'scrollUp' }); return true; }
      scrollUnderCursor(-1); return true;
    case 'scroll-down':
      if (refsTabOpen) { void chromeBridge.request('refsCommand', { cmd: 'scrollDown' }); return true; }
      scrollUnderCursor(1); return true;
    case 'rotate': void runUtterance(`rotate ${value && value < 0 ? 345 : 15}`); return true;
    case 'tap':
      if (!lastHand) return false;
      handleHandEvent({ type: 'pinch-tap', x: lastHand.x, y: lastHand.y });
      return true;
    case 'lamp-up': lampButton('.lamp-dim-up'); return true;
    case 'lamp-down': lampButton('.lamp-dim-down'); return true;
    case 'lamp-toggle': lampOn = !lampOn; lampButton(lampOn ? '.lamp-on' : '.lamp-off'); return true;
    case 'volume':
      void musicPanel.apply({ type: 'volumeAdjust', delta: (value ?? 1) * 0.1 });
      return true;
    case 'next-track':
      void musicPanel.apply({ type: value !== undefined && value < 0 ? 'prev' : 'next' });
      return true;
    case 'rest-toggle':
    case 'wake':
      setResting(nextRestState(resting, target));
      return true;
    default: {
      const node = document.getElementById(target);
      if (node instanceof HTMLButtonElement && !node.disabled) { node.click(); return true; }
      return false;
    }
  }
}

function handleMotion(ev: MotionEvent): void {
  gestureGuide.highlight(ev.id);
  const r = resolveGesture(ev.id, {
    context: (lampPanel.isOpen() || musicPanel.isOpen()) ? 'devices' : 'studio',
    resting,
    bindings: setupData.bindings,
  });
  if (r.kind === 'ignored') {
    const g = catalogGesture(ev.id);
    if (r.reason === 'unwired' && g && !unwiredNoted.has(g.id)) {
      unwiredNoted.add(g.id);
      showToast(`${g.label}: recognised. ${g.note ?? 'Not wired yet.'}`);
    }
    return;
  }
  if (ev.id === 'circle' && r.target === 'select-area' && ev.box) { selectArea(ev.box); return; }
  const ran = runTarget(r.target, ev.value);
  const g = catalogGesture(ev.id);
  if (ran && g && g.kind === 'discrete' && !['rest-toggle', 'wake'].includes(r.target)) {
    const info = gestureLabel(ev.id, setupData.templates);
    announceStatus(`${info?.label ?? ev.id}: ${g.does}`);
  } else if (ran && r.source === 'custom') {
    announceStatus(`Your gesture: ${r.target}`);
  }
}

/** Custom recorded poses: fire once when held 500 ms. */
function matchCustom(points: readonly { x: number; y: number }[] | undefined, now: number): string | null {
  if (!points || setupData.templates.length === 0) { customHeld = null; return null; }
  const m = matchTemplate(points, setupData.templates);
  if (!m) { customHeld = null; return null; }
  const id = `custom:${m.id}`;
  if (!customHeld || customHeld.id !== id) { customHeld = { id, since: now, fired: false }; return null; }
  if (!customHeld.fired && now - customHeld.since >= 500) { customHeld.fired = true; return id; }
  return null;
}

/** Elements a pinch (or dwell) clicks directly: any button/link/control in the
 *  toolbar, menus, side panel and floating panels (the canvas keeps its own
 *  pick/drag path). */
const HAND_CLICK_ZONES = '#topbar, #panel, #btn-panel-chip, #statusbar, .mc-dock-edit, #zoom-island, #choice-bar, #chrome-confirm, .hint-buttons, [role="dialog"], [role="menu"], .mc-setup, .mc-lamp-panel, .mc-music-panel, .mc-add-device, .mc-ref-panel, .mc-ref-layer, .mc-clips, .mc-rest-banner, #onboarding, .mc-tour';
function handClickable(clientX: number, clientY: number): HTMLElement | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const ctl = hit?.closest<HTMLElement>('button, a[href], select, input, summary, label');
  if (!ctl || !ctl.closest(HAND_CLICK_ZONES)) return null;
  if ((ctl as HTMLButtonElement).disabled) return null;
  return ctl;
}
function activateControl(ctl: HTMLElement): void {
  if (ctl instanceof HTMLSelectElement || (ctl instanceof HTMLInputElement && ctl.type === 'text')) ctl.focus();
  else ctl.click();
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
  else void runUtterance('check the plan');
});

// ---- phone relay pairing (QR → /remote page → room over an injected transport)

const controlFeed: AiFeedInput[] = [];
let controlDevice: DeviceId = 'laptop';
let controlCaption: { heard: string; translation?: string | null; langCode?: string; langLabel?: string } | null = null;
let controlRev = 0;
// Appliance state mirrored to the /control dashboard. Lamp comes from the editor
// lamp panel (laptop ↔ bridge); music comes from Spotify / the built-in player
// (this laptop) and is also relayed from a paired phone remote.
// 'unknown' until we actually know — never a fabricated "connected".
let controlLamp: ApplianceState = 'unknown';
let controlLampDetail: string | undefined;
let controlMusic: ApplianceState = 'unknown';
let controlMusicTitle: string | undefined;

let hostSession: HostSession | null = null;
let relayTransport: RelayTransport | null = null;
let pairingInit: Promise<void> | null = null;

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

const btnMusic = el<HTMLButtonElement>('btn-music');
const musicPanel = createMusicPanel({
  onState: (s) => setControlMusic({
    title: s.via === 'spotify' && s.title ? `Spotify · ${s.title}` : s.title,
    playing: s.playing,
    volume: s.volume,
  }),
  onCall: ({ job, reason, sent, ms }) => recordLedger('cloud', job, reason, sent, ms),
});
viewportEl.appendChild(musicPanel.element);
btnMusic.addEventListener('click', () => {
  musicPanel.toggle();
  toggleButton(btnMusic, musicPanel.isOpen());
});

let refsTabOpen = false;
let lastRefsEngine: SearchEngine = 'google';
let lastRefsQuery = '';
let lastRefsCursorAt = 0;

function hitFromExtImage(data: { url?: string; title?: string; text?: string } | undefined, engine: SearchEngine, query: string): RefHit | null {
  if (!data?.url) return null;
  const src = engine === 'pinterest' ? 'Pinterest' : 'Google Images';
  return {
    id: `web-${Date.now()}`,
    title: (data.title || data.text || query || 'Reference').slice(0, 80),
    thumbUrl: data.url,
    fullUrl: data.url,
    pageUrl: data.url,
    creator: '',
    source: src,
    license: '',
    credit: src,
  };
}

const refBoard = createReferenceBoard({
  fixtures: SIM_ACTIVE,
  refineQuery: refineSearchQuery,
  speak: (text) => say(text),
  onStatus: (text) => { verifierEl.textContent = text; },
  onCall: ({ job, reason, sent, ms, source }) => {
    recordLedger(source === 'on-device' ? 'on-device' : source === 'rules' ? 'rules' : 'cloud', job, reason, sent, ms);
  },
  openWeb: (url) => {
    if (chromeBridge.isConnected()) {
      void chromeBridge.request('openTab', { url }).then((res) => {
        if (!res.ok) window.open(url, '_blank', 'noopener');
      });
      return;
    }
    window.open(url, '_blank', 'noopener');
  },
  extensionConnected: () => chromeBridge.isConnected(),
  isBrowserOpen: () => refsTabOpen,
  async openBrowserSearch(query, engine) {
    lastRefsEngine = engine;
    lastRefsQuery = query;
    const url = searchPageUrl(query, engine);
    const res = await chromeBridge.request('openRefs', { query, engine, url });
    if (!res.ok) {
      refsTabOpen = false;
      const detail = res.error === 'not-connected'
        ? 'Chrome extension not connected. Load it from chrome://extensions, then Reload, to search in a real tab.'
        : 'I could not open a Chrome tab for that search.';
      return { ok: false, detail };
    }
    refsTabOpen = true;
    const where = engine === 'pinterest' ? 'Pinterest' : 'Google Images';
    const detail = `Opened ${where} for “${query}”. Say number three, next page, or pinch the highlighted picture. Palm or “close” to come back.`;
    return { ok: true, detail };
  },
  async closeBrowser() {
    if (!refsTabOpen) return;
    await chromeBridge.request('closeRefs');
    refsTabOpen = false;
  },
  async sendBrowserCommand(cmd) {
    if (!refsTabOpen) return { ok: false, detail: 'No references tab is open.' };
    const payload =
      cmd.type === 'scroll' ? { cmd: cmd.dir === 'up' ? 'scrollUp' as const : 'scrollDown' as const }
      : cmd.type === 'nextPage' ? { cmd: 'nextPage' as const }
      : cmd.type === 'highlight' ? { cmd: 'highlight' as const, index: cmd.index }
      : cmd.type === 'cursor' ? { cmd: 'cursor' as const, cursor: { x: cmd.x ?? 0.5, y: cmd.y ?? 0.5 } }
      : cmd.type === 'pick' ? { cmd: 'pick' as const, index: cmd.index }
      : { cmd: 'pick' as const };
    if (cmd.type === 'close') {
      await chromeBridge.request('closeRefs');
      refsTabOpen = false;
      return { ok: true, detail: 'References tab closed.' };
    }
    const res = await chromeBridge.request('refsCommand', payload);
    if (!res.ok) {
      if (res.error === 'no-refs-tab') refsTabOpen = false;
      return { ok: false, detail: res.error || 'The references tab did not respond.' };
    }
    const hit = res.data?.kind === 'image' ? hitFromExtImage(res.data, lastRefsEngine, lastRefsQuery) : undefined;
    if (hit) refsTabOpen = true;
    return { ok: true, detail: hit ? `Picked “${hit.title}”.` : 'OK', hit: hit ?? undefined };
  },
  async generate(query, kind) {
    if (SIM_ACTIVE) {
      const { fixtureGenerated, generatedToHits } = await import('./references/mockups');
      return generatedToHits(fixtureGenerated(query, kind));
    }
    const r = await generateReferenceOptions(query, kind);
    if (!r) return null;
    recordLedger(
      'cloud',
      'ref-generate',
      kind === 'layout' ? 'Gemini layout frames' : 'Gemini reference drawings',
      query,
      r.ms,
    );
    return r.hits;
  },
});
viewportEl.appendChild(refBoard.element);

// ---- add a device (camera or voice → Nano names it → cached declarative
// connector → LAN → pinch to confirm → Nano checks the effect). No gimbal needed.

const simWorld = SIM_ACTIVE ? createSimWorld() : null;

/** One full camera still, downscaled (max 640 px wide), for identify/verify. */
function captureFullFrame(): { mimeType: string; dataBase64: string } | null {
  const video = tracker?.videoEl ?? null;
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  try {
    const scale = Math.min(1, 640 / video.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
    c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.7);
    return { mimeType: 'image/jpeg', dataBase64: url.slice(url.indexOf(',') + 1) };
  } catch { return null; }
}

function addDeviceDeps(mode: AddMode, hint: { pointer?: { x: number; y: number }; name?: string; words?: string }): Omit<FlowDeps, 'confirm' | 'askHost' | 'onStep'> {
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const words = hint.words ?? '';
  const name = hint.name ?? deviceNameIn(words)?.name;
  const flowHint = { ...(hint.pointer ? { pointer: hint.pointer } : {}), ...(name ? { name } : {}) };
  if (simWorld) {
    return {
      sim: true, mode, hint: flowHint, wait,
      identityFromWords: () => identityFromWords(words || 'add the lamp'),
      capture: () => simWorld.capture(mode),
      identify: (f, h) => simWorld.identify(f, h),
      cachedConnector: (id) => simWorld.cached(connectorKey(id.brand, id.kind)),
      writeConnector: () => simWorld.write(),
      saveConnector: () => { /* sim keeps its own in-memory cache */ },
      discover: () => simWorld.discover(),
      run: (c, a, h) => simWorld.run(c, a, h),
      check: () => simWorld.check(),
      saveDevice: () => { /* sim devices are not saved */ },
    };
  }
  const transports = makeTransports();
  return {
    sim: false, mode, hint: flowHint, wait,
    identityFromWords: () => identityFromWords(words),
    capture: async () => captureFullFrame(),
    identify: (f, h) => identifyDevice(f, h),
    cachedConnector: (id) => getCachedConnector(connectorKey(id.brand, id.kind)),
    writeConnector: async (id) => {
      const w = await writeDeviceConnector(id);
      if (w) return w;
      // Cloud unreachable (offline / no Firebase): WiZ has a built-in seed.
      return isWizIdentity(id.brand, id.kind) ? { connector: builtinWizConnector(), source: 'builtin' as const } : null;
    },
    saveConnector: (c) => cacheConnector(c),
    discover: (_id, c) => discoverDevices(c),
    aim: async (box) => {
      const ok = await aimGimbalAt(box);
      gimbalFollow.setMode('hold');
      return ok;
    },
    run: (c, a, h) => runAction(c, a, {}, h, transports),
    check: (b, a, cue) => checkDeviceEffect(b, a, cue),
    saveDevice: (d) => { cachePairedDevice(d); },
  };
}

const gimbalFollow = createGimbalFollow({
  aim: (box) => aimGimbalAt(box, globalThis, 0.45),
  nudge: async (yaw, pitch) => {
    const g = getGimbalPlugin();
    if (!g) return false;
    try {
      const a = await g.isAvailable();
      if (!a.available) return false;
      return (await g.aim({ yaw, pitch, seconds: 0.6 })).ok;
    } catch {
      return false;
    }
  },
});

const addDevicePanel = createAddDevicePanel({
  sim: SIM_ACTIVE,
  env: async () => {
    const g = getGimbalPlugin();
    let gimbal = false;
    if (g) { try { gimbal = (await g.isAvailable()).available; } catch { gimbal = false; } }
    return { camera: tracker !== null, iosApp: isIosShell(), bridge: SIM_ACTIVE ? false : await bridgeHealthy(), gimbal };
  },
  deps: addDeviceDeps,
  enableCamera: () => void enableCamera(),
  say: (t) => say(t),
  onOpen: () => gimbalFollow.setMode('point'),
  onClose: () => gimbalFollow.setMode('hands'),
  nudge: (dir) => { void gimbalFollow.nudge(dir); },
  // Honest ledger: each model call that ran, and what it sent if it was cloud.
  onStep: (ev) => {
    if (ev.sim || ev.state === 'active' || (ev.source !== 'cloud' && ev.source !== 'on-device')) return;
    const sent: Record<string, string> = {
      identify: 'one camera still (not stored)', connector: 'device kind + brand (text only)', verify: 'two camera stills (not stored)',
    };
    recordLedger(ev.source, `add device · ${ev.step}`, ev.source === 'cloud' ? 'needs the larger model' : 'private, on device',
      ev.source === 'cloud' ? (sent[ev.step] ?? 'text') : 'nothing', ev.ms);
  },
});
viewportEl.appendChild(addDevicePanel.element);

/** Start "add a device". With her words: a named device and no camera → voice
 *  mode; camera on → room mode with the name (and where she points); else the
 *  auto-detected chooser. */
async function openAddDevice(words?: string): Promise<void> {
  overflowMenu.close();
  const named = words ? deviceNameIn(words) : null;
  const camera = tracker !== null || SIM_ACTIVE;
  if (named && !camera) { await addDevicePanel.open({ mode: 'voice', words }); return; }
  if (named && camera) {
    await addDevicePanel.open({ mode: 'room', words, hint: { name: named.name, ...(lastPointer?.cameraNorm ? { pointer: lastPointer.cameraNorm } : {}) } });
    return;
  }
  await addDevicePanel.open();
}
el<HTMLButtonElement>('btn-add-device').addEventListener('click', () => {
  if (addDevicePanel.isOpen()) addDevicePanel.close(); else void openAddDevice();
});


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
  // Firestore (enabled on the project) and fall back gracefully if the room
  // can't be reached right now.
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
      pairPanel.setTransportNote(`Can't reach a room: ${probe.reason} A real phone cannot join yet; the demo transport is active.`);
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
  // A /control iPad (or phone) can request a saved recipe run. The laptop owns
  // the recipe book and the devices, so it executes and publishes live status.
  hostSession.onRun((run) => void handleRelayRun(run));
}

/** Execute a recipe requested over the relay and publish its status back. */
async function handleRelayRun(run: { runId: string; recipeId: string; device: string; by?: string }): Promise<void> {
  const recipe = recipeStore.get(run.recipeId);
  const status = (s: RunStatusKind, detail?: string, step?: number, total?: number): void => {
    void hostSession?.publishRunStatus({ runId: run.runId, recipeId: run.recipeId, status: s, detail, step, total }).catch(() => undefined);
  };
  if (!recipe) {
    status('error', 'recipe not found');
    return;
  }
  status('running', `${run.by ? `${run.by}: ` : ''}${recipe.name}`, 0, recipe.steps.length);
  if (recipe.device === 'designer') {
    // Designer recipes don't send anything; stage the usual confirm so a human
    // at the laptop approves before the scene changes.
    stageRecipeRun(recipe, 'rules', 'exact');
    status('awaiting-confirm', 'confirm on the laptop to apply', 0, recipe.steps.length);
    return;
  }
  const res = await runDeviceRecipe(recipe);
  status(res.ok ? 'done' : 'error', res.detail, recipe.steps.length, recipe.steps.length);
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
    motion.reset();
    gesturesPanel.feedPreview('none');
    setupPanel.feedHand(null, performance.now());
    return;
  }
  const now = performance.now();
  const hands = f.hands.map((h) => h.points);
  setupPanel.feedHand(hands[0] ?? null, now);
  setupPanel.feedFace(f.operatorFace ?? null);
  // While the setup wizard is capturing, gestures don't trigger buttons.
  if (setupPanel.isOpen()) { motion.reset(); return; }
  const evs = motion.update({ hands, now });
  const custom = matchCustom(hands[0], now);
  if (custom) evs.push({ id: custom });
  for (const ev of evs) handleMotion(ev);
  // Optional face cues only CONFIRM something already waiting.
  if (setupData.faceCues && faceCues.hasBaseline()) {
    const cue = faceCues.update(faceRatios(f.operatorFace ?? []), now);
    if (cue && !resting && somethingPending()) { runTarget('confirm'); announceStatus(cue === 'smile' ? 'Smile: confirmed.' : 'Eyebrows: confirmed.'); }
  }
  if (resting) { gestureRecognizer.reset(); return; }
  const res = gestureRecognizer.update({ hands, now });
  gesturesPanel.feedPreview(res.gesture);
  for (const g of res.fired) { gestureGuide.highlight(g === 'pinch' ? null : g); runGestureAction(gestureMap[g]); }
  // Two-hand pinch = anchored zoom/pan (the grabbed points track the fingers),
  // when mapped to "zoom" (the gestureMap remap still gates it). Feeding null
  // when the pose isn't held lets the controller end + apply grace.
  if (gestureMap['two-hand-zoom'] === 'zoom') {
    const bothPinch = res.gesture === 'two-hand-zoom' && !!hands[0] && !!hands[1];
    const p = bothPinch ? handPinchClient(hands[0]) : null;
    const q = bothPinch ? handPinchClient(hands[1]) : null;
    const r = cadTwoHand.update({ p, q, now });
    if (r.started && p && q) {
      cadGrabMid = midpoint(p, q);
      cadLastT = { ...IDENTITY };
    } else if (r.active && cadGrabMid) {
      const step = incrementalZoomPan(cadLastT, r.transform, cadGrabMid);
      viewport.zoomAt?.(step.factor, step.anchor.x, step.anchor.y);
      if (step.pan.x || step.pan.y) viewport.panByPx?.(step.pan.x, step.pan.y);
      cadLastT = r.transform;
    }
    if (r.ended) cadGrabMid = null;
  }
}

// ---- command pipeline (shared by voice, text, and sim) ----

async function runUtterance(utterance: string): Promise<void> {
  const listen = parseListenPhrase(utterance);
  if (listen === 'wake') {
    lastCommandEl.textContent = `"${utterance}"`;
    setListening(true);
    return;
  }
  if (listen === 'sleep') {
    lastCommandEl.textContent = `"${utterance}"`;
    setListening(false);
    return;
  }
  if (!voiceListening) {
    lastCommandEl.textContent = 'Sleeping. Say “Mendcraft wake” to listen.';
    return;
  }
  lastCommandEl.textContent = `"${utterance}"`;
  if (leaveState.phase === 'sent' && /^undo$/i.test(utterance.trim())) {
    const next = undoLeave(leaveState, Date.now());
    if (next.phase === 'undone') {
      leaveState = IDLE_LEAVE;
      studioChrome?.setProposal(null);
      say('Undone. Nothing was sent from Mendcraft.');
      return;
    }
  }
  if (studioChrome) {
    const handled = studioChrome.handleUtterance(utterance);
    if (handled) {
      studioChrome.refresh();
      return;
    }
  }
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
    pointer: pointerPx, candidates, space: 'plan',
    planNames: planLabelNames(),
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

/** CONFIRM STEP for every accessibility fix: show a preview (highlight +
 *  Apply/Cancel) — never auto-applied, whether the fix was computed by the
 *  rules or suggested by the AI. On Apply the fix is applied, then re-checked
 *  by the deterministic rules and UNDONE if it didn't fix the issue or broke
 *  another rule (fixed rules decide; the AI only proposes). */
function stageA11yFix(label: string, op: Record<string, unknown>, fixedIds: string[], suggestedBy: string): void {
  const provenance = `Checked by rules · fix suggested by ${suggestedBy}`;
  presentChoices(`${label} — ${provenance}`, [{ label, result: op, source: 'rules' }], () => {
    applyCheckedA11yFix(op, fixedIds);
  }, () => {
    verifierEl.textContent = 'Fix cancelled — nothing was applied.';
  });
  verifierEl.textContent = `Preview: ${label}. ${provenance}. ${choicePrompt('en', 1)}`;
  say(`Preview ready: ${label}. Say apply or cancel.`);
}

function applyCheckedA11yFix(op: Record<string, unknown>, fixedIds: string[]): void {
  const beforeIssues = currentA11yIssues();
  const step = controller.applyOp(op);
  if (!step.ok) {
    say(`Could not apply the fix: ${step.error ?? 'invalid op'}`);
    verifierEl.textContent = `Fix rejected by the op validator: ${step.error ?? 'invalid op'}`;
    return;
  }
  // FIXED RULES DECIDE: re-run the deterministic checks; an applied fix that
  // doesn't fix (or breaks another rule) is undone, not kept.
  const verdict = recheckFix(beforeIssues, currentA11yIssues(), fixedIds);
  if (!verdict.ok) {
    controller.applyOp({ op: 'undo' });
    const why = verdict.reason === 'not-fixed'
      ? `it didn't fix the issue (${verdict.detail})`
      : `it broke another rule (${verdict.detail})`;
    verifierEl.textContent = `Fix rejected by the rules re-check — ${why}. Undone.`;
    say('The rules re-check rejected that fix, so I undid it.');
    refreshA11yIssues();
    return;
  }
  verifierEl.textContent = `${fixedIds.length === 1 ? 'Fix' : `${fixedIds.length} fixes`} applied and re-checked by the rules — issue resolved.`;
  say(step.message ?? 'Accessibility fix applied and re-checked.');
  refreshA11yIssues();
}

function applyA11yFix(issue: A11yIssue): void {
  if (!issue.fix) return;
  highlightA11yIssue(issue); // ghost the change target before the confirm
  stageA11yFix(issue.fixLabel ?? `Fix: ${issue.rule}`, issue.fix, [issue.id], issue.fixSource ?? 'rules (code)');
}

/** Stage every remaining fix as ONE batch op — a single confirm + undo step. */
function applyAllA11yFixes(fixable: A11yIssue[]): void {
  const withFix = fixable.filter((i): i is A11yIssue & { fix: Record<string, unknown> } => !!i.fix);
  const ops = withFix.map((i) => i.fix);
  if (ops.length === 0) return;
  const suggestedBy = withFix.some((i) => i.fixSource === 'cloud') ? 'cloud + rules' : 'rules (code)';
  stageA11yFix(
    `Apply ${ops.length} accessibility ${ops.length === 1 ? 'fix' : 'fixes'}`,
    ops.length === 1 ? ops[0] : { op: 'batch', ops },
    withFix.map((i) => i.id),
    suggestedBy,
  );
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
  const res = await explainAccessibility(sent, summary, planLabelNames());
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
    changes: controlChanges(),
    checklist: controlChecklist(),
    recipes: recipeStore.list().map((r) => ({
      id: r.id, name: r.name, device: r.device,
      taughtBy: r.taughtBy, summary: describeRecipe(r), steps: r.steps.length,
    })),
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

// ---- CAD copilot + reviewed changes + site checklist (src/cad) -----------
// Her words → a typed CAD tool. When Nano is ready it picks the intent first
// (including phrases the rules already know, like "convert 2D to 3D") and
// hands heavy work (materials, guideline research) to Gemini. The rules
// parser is the fallback when Nano is unavailable. Every AI canvas change is
// a PENDING proposal in the change log until she accepts it (pinch / click /
// "accept"); her own edits are logged as applied. Offline, hard questions
// become the site checklist.

const REGION_KEY = 'mendcraft.region';
let guidelineRegion: RegionId = (() => {
  try {
    const r = localStorage.getItem(REGION_KEY);
    return r && (REGION_IDS as readonly string[]).includes(r) ? (r as RegionId) : 'international';
  } catch { return 'international'; }
})();
let lastReport: GuidelineReport | null = null;

function planDoc(): PlanDoc {
  return rawController.snapshot() as PlanDoc;
}
function isOnline(): boolean {
  return net.online();
}
function sourceToActor(source: Source): Actor {
  return source === 'cloud' ? 'gemini' : source === 'on-device' ? 'nano' : 'rules';
}

function applyReviewedOp(op: Record<string, unknown>): { ok: boolean; error?: string } {
  const mat = coerceSetMaterialsOp(op);
  if (mat) {
    void viewport.setMaterials?.(mat.plan);
    btn3d.setAttribute('aria-pressed', 'true');
    btn3d.classList.toggle('active', true);
    btn3d.textContent = '2D view';
    return { ok: true };
  }
  const step = rawController.applyOp(op);
  return { ok: step.ok, error: step.error };
}

function restoreMaterialsOp(op: Record<string, unknown> | null | undefined): void {
  const mat = coerceSetMaterialsOp(op);
  if (!mat) return;
  if (mat.previous) void viewport.setMaterials?.(mat.previous);
  if (mat.previous3d === false) {
    viewport.toggle3D?.(false);
    btn3d.setAttribute('aria-pressed', 'false');
    btn3d.classList.toggle('active', false);
    btn3d.textContent = '3D view';
  }
}

let speculative: ReturnType<typeof createSpeculativeEngine>;
const copilotPanel = createCopilotPanel({
  onAccept: (id) => acceptChange(id),
  onReject: (id) => rejectChange(id),
  onAcceptAll: () => acceptAllChanges(),
  onRevert: (id) => stageRevert(id),
  onIssueShow: (issue) => highlightA11yIssue(issue),
  onIssueFix: (issue) => proposeIssueFix(issue, 'rules'),
  onRegion: (r) => {
    guidelineRegion = r;
    try { localStorage.setItem(REGION_KEY, r); } catch { /* session only */ }
    void runGuidelineCheck(r, false);
  },
  onRecheck: () => void runGuidelineCheck(guidelineRegion, false),
  onAskGemini: (id) => void askChecklistItem(id),
  onRemoveItem: (id) => { siteChecklist.remove(id); },
  onEmailClient: () => void emailClient(),
  onOpenDraft: (d) => confirmOpenDraft(d),
  onCancelDraft: () => { copilotPanel.setDraft(null); say('Email draft closed. Nothing was sent.'); },
  onReviewAccept: (id) => acceptGeminiReview(id),
  onReviewDrop: (id) => dropGeminiReview(id),
  onReviewRemove: (id) => { geminiReview.remove(id); },
});
viewportEl.appendChild(copilotPanel.element);
const walkControls = createWalkControls(
  (step) => { viewport.walkStep?.(step); },
  () => { void runCadTool({ tool: 'walkthrough', args: { on: false } }, 'her', 'Exit walk', 'rules'); },
);
viewportEl.appendChild(walkControls.element);

let cpRenderQueued = false;
function refreshCopilot(): void {
  if (cpRenderQueued) return;
  cpRenderQueued = true;
  requestAnimationFrame(() => {
    cpRenderQueued = false;
    copilotPanel.setChanges(changeLog.entries());
    copilotPanel.setChecklist(siteChecklist.items(), isOnline());
    copilotPanel.setGeminiReview(geminiReview.items());
    const pendN = changeLog.pending().length;
    const toCheck = unresolvedReview(geminiReview.items()).length;
    btnCopilot.textContent = toCheck ? `Review · ${toCheck} to check`
      : pendN ? `Review · ${pendN} waiting`
      : 'Review & History';
    btnCopilot.setAttribute('aria-label', btnCopilot.textContent);
    studioChrome?.refresh();
    const waiting = changeLog.pending()[0];
    const reviewWait = geminiReview.items().find((i) => i.awaitingPinch);
    if (waiting && leaveState.phase === 'idle') {
      studioChrome?.setProposal(proposalFromChange(waiting), {
        onKeep: () => acceptChange(waiting.id),
        onDrop: () => rejectChange(waiting.id),
      });
    } else if (reviewWait && leaveState.phase === 'idle') {
      studioChrome?.setProposal(proposalFromReviewItem(reviewWait), {
        onKeep: () => acceptGeminiReview(reviewWait.id),
        onDrop: () => dropGeminiReview(reviewWait.id),
      });
    } else if (leaveState.phase === 'idle' && new URLSearchParams(location.search).get('ux') !== 'proposal' && new URLSearchParams(location.search).get('ux') !== 'demo' && new URLSearchParams(location.search).get('ux') !== 'tocheck') {
      studioChrome?.setProposal(null);
    }
    publishControlSnapshot();
  });
}
changeLog.subscribe(refreshCopilot);
siteChecklist.subscribe(refreshCopilot);
geminiReview.subscribe(refreshCopilot);
net.subscribe((online) => {
  refreshCopilot();
  if (online) {
    void warmCloud();
    void syncSite();
    const open = siteChecklist.open().length;
    const reviewN = waitingForGemini(geminiReview.items()).length;
    if (reviewN) {
      showToast(`Back online. ${geminiReview.waitingCountLine()}.`);
      say(`Back online. ${geminiReview.waitingCountLine()}.`);
    }
    if (open) {
      showToast(`Back online. ${open} site question${open === 1 ? '' : 's'} waiting in your checklist.`);
      say(`Back online. You have ${open} site question${open === 1 ? '' : 's'}. Ask Gemini, or email the client.`);
    }
  }
});
btnCopilot.addEventListener('click', () => {
  if (copilotPanel.isOpen()) copilotPanel.close();
  else copilotPanel.open(changeLog.pending().length ? 'review' : copilotPanel.tab());
  toggleButton(btnCopilot, copilotPanel.isOpen());
});

function focusablesFromPlan(): Focusable[] {
  const items = controller.listItems();
  return items.map((it, i) => {
    const label = it.label.toLowerCase();
    const kind: Focusable['kind'] =
      /stair/.test(label) ? 'stair'
      : /door/.test(label) || it.id.startsWith('d') ? 'door'
      : /window/.test(label) ? 'window'
      : /room|kitchen|bedroom|bath|living/.test(label) || it.id.startsWith('r') ? 'room'
      : /wall/.test(label) || it.id.startsWith('w') ? 'wall'
      : 'plan';
    return { id: it.id, kind, name: it.label, x: i * 80, y: 0 };
  });
}
function currentFocus(): Focusable | null {
  const id = controller.selectedId();
  const all = focusablesFromPlan();
  return all.find((f) => f.id === id) ?? (all.length ? { id: 'plan', kind: 'plan', name: 'the plan', x: 0, y: 0 } : null);
}
function loadSampleHouse(): void {
  const step = controller.applyGenerated?.({ ops: sharmaHouseOps() });
  if (step?.ok) {
    renderAll();
    say('Sharma House is ready. The site and levels are set. No rooms yet.');
  } else {
    say(step?.error ?? 'Could not load the sample house.');
  }
}
async function warmupQuick(): Promise<void> {
  try {
    if (getHybridStatus().deviceModel !== 'ready') return;
    if (sessionStorage.getItem('mendcraft:warmed') === '1') return;
    sessionStorage.setItem('mendcraft:warmed', '1');
    const { compileCommand } = await import('./ai/hybrid');
    await compileCommand(WARMUP_PROMPT, controller.summary(), controller.selectedId());
  } catch {
    // Warm-up is best-effort and must never block the studio.
  }
}

const layoutEl = document.getElementById('layout') ?? viewportEl;
studioChrome = mountStudioChrome(layoutEl, {
  getFocus: currentFocus,
  getFocusables: focusablesFromPlan,
  getChanges: () => changeLog.entries(),
  getSuggestionSituation: () => {
    const items = controller.listItems();
    const rooms = items.filter((it) => /room|kitchen|bedroom|bath|living/i.test(it.label)).length;
    return {
      level: discoveryLevel({ hasClosedRoom: rooms > 0, roomCount: rooms, offline: !isOnline() }),
      hasClosedRoom: rooms > 0,
      emptyCanvas: items.length === 0,
      keptChanges: changeLog.entries().filter((e) => e.status === 'applied').length,
      offline: !isOnline(),
      trigger: items.length === 0 ? 'empty-plan' : 'kept-change',
    };
  },
  onPalmSlice(id) {
    if (id === 'review') {
      copilotPanel.open(changeLog.pending().length ? 'review' : 'history');
      toggleButton(btnCopilot, true);
    } else if (id === 'view') {
      void runUtterance('walk in');
    } else if (id === 'devices') {
      void openAddDevice();
    } else if (id === 'site') {
      copilotPanel.open('checklist');
      toggleButton(btnCopilot, true);
    } else if (id === 'settings') {
      document.getElementById('btn-setup')?.click();
    } else if (id === 'studio') {
      studioChrome?.closeHere();
    }
  },
  onHereAction(phrase) { void runUtterance(phrase); },
  onSuggestionAccept(s) { void runUtterance(s.say); },
  onFirstRunSpeak(text) { say(text); },
  onLoadSampleHouse: loadSampleHouse,
});
studioChrome.setReviewButton(btnCopilot);
studioChrome.refresh();
refreshStudioStatus();
const uxShot = new URLSearchParams(location.search).get('ux');
if (uxShot === 'here' || uxShot === 'demo') studioChrome.openHere();
if (uxShot === 'proposal' || uxShot === 'demo') {
  studioChrome.setProposal({
    id: 'demo-proposal',
    title: 'Door D2: 750 → 900 mm',
    youAsked: 'make this door wheelchair friendly',
    why: 'our wheelchair guideline uses 900 mm clear',
    catalog: catalogRoute({ route: routeGemini({ nano: 'unsure' }), kind: 'escalation', sent: 'make this door wheelchair friendly' }),
    status: 'waiting',
  });
}
if (uxShot === 'tocheck' || uxShot === 'demo') {
  if (!geminiReview.items().length) {
    const seeds = [
      { question: 'Is the kitchen wide enough for a wheelchair turn?', offlineAnswer: 'Yes — 1600 mm clear.' },
      { question: 'Door D2 clear width?', offlineAnswer: '750 mm' },
      { question: 'What is the ramp slope to the porch?', offlineAnswer: '1:12' },
    ];
    for (const s of seeds) geminiReview.recordOffline(s);
    const door = geminiReview.findByQuestion('Door D2 clear width?');
    if (door) geminiReview.recordGeminiResult(door.id, { geminiAnswer: '800 mm on the plan', agreed: false, because: 'the plan door is 800 mm, not 750 mm' });
  }
  copilotPanel.open('review');
  toggleButton(btnCopilot, true);
  const waiting = geminiReview.items().find((i) => i.awaitingPinch);
  if (waiting) {
    studioChrome.setProposal(proposalFromReviewItem(waiting), {
      onKeep: () => acceptGeminiReview(waiting.id),
      onDrop: () => dropGeminiReview(waiting.id),
    });
  }
}
if (uxShot === 'directory') {
  if (!peopleDirectory.people().length) {
    peopleDirectory.add({ name: 'Priya Sharma', role: 'client', phone: '+91 98765 43210', email: 'priya@example.com', note: 'Wants a wider front door' });
    peopleDirectory.add({ name: 'Lakshmi', role: 'mother', note: 'Uses a walker' });
    peopleDirectory.add({ name: 'Ravi', role: 'contractor' });
  }
  directoryPanel.open();
  toggleButton(btnDirectory, true);
}

const siteBook = (() => {
  try { return siteBookId(localStorage); } catch { return null; }
})();
async function syncSite(): Promise<void> {
  if (!siteBook || !isOnline()) return;
  const r = await syncSiteBook(changeLog, siteChecklist, siteBook);
  if (!r.ok) {
    console.info('[mendcraft]', r.reason);
    document.body.dataset.siteSync = 'error';
    return;
  }
  console.info('[mendcraft] site checklist cloud sync ok');
  document.body.dataset.siteSync = 'ok';
}

function publishRoute(route?: RouteInfo): void {
  if (!route) {
    delete document.body.dataset.routeLine;
    delete document.body.dataset.routeTier;
    return;
  }
  document.body.dataset.routeLine = formatRouteLine(route);
  document.body.dataset.routeTier = route.tier;
}

/** Stage an AI (or rules) drawing change for her review. Nothing applies yet. */
function proposeChange(p: { actor: Actor; tool: string; title: string; why: string; op: Record<string, unknown>; source: ChangeEntry['source']; tag?: ChangeEntry['tag']; route?: RouteInfo }): ChangeEntry {
  const e = changeLog.propose({ ...p, before: planDigest(rawController.snapshot()) });
  copilotPanel.open('review');
  toggleButton(btnCopilot, true);
  const by = p.tag === 'nano-guess' ? "Nano's guess"
    : p.tag === 'confirmed' ? "Gemini confirmed Nano's guess"
    : p.tag === 'corrected' ? 'Gemini corrected a guess'
    : ACTOR_LABEL[p.actor];
  verifierEl.textContent = `${by} suggests: ${p.title}. Waiting for you. Pinch Accept, or say "accept".`;
  // The confirm chip doubles as the pinch target for the newest proposal.
  presentChoices(`${by} suggests: ${p.title}`, [{ label: p.title, result: p.op, source: p.source }], () => acceptChange(e.id), () => rejectChange(e.id));
  return e;
}

function acceptChange(id: string): void {
  const e = changeLog.get(id);
  if (!e) return;
  applyingReviewed = true;
  let res: { ok: boolean; error?: string };
  try {
    res = changeLog.accept(id, {
      snapshot: () => rawController.snapshot(),
      apply: applyReviewedOp,
      summary: () => planDigest(rawController.snapshot()),
    });
  } finally {
    applyingReviewed = false;
  }
  if (pendingChoices) clearChoices();
  if (!res.ok) {
    verifierEl.textContent = `Couldn't apply "${e.title}": ${res.error ?? 'invalid'}`;
    say(`I couldn't apply that: ${res.error ?? 'invalid change'}.`);
    return;
  }
  renderAll();
  verifierEl.textContent = `Accepted: ${e.title}. Undo or revert it any time from History.`;
  say(`Done. ${e.title}.`);
  if (lastReport) void runGuidelineCheck(guidelineRegion, false, true);
}

function rejectChange(id: string): void {
  const e = changeLog.get(id);
  if (!e || !changeLog.reject(id)) return;
  restoreMaterialsOp(e.op);
  verifierEl.textContent = `Rejected: ${e.title}. Nothing changed.`;
  say('Rejected. Nothing changed.');
}

function acceptAllChanges(): void {
  const ids = changeLog.pending().map((e) => e.id);
  for (const id of ids) acceptChange(id);
  if (ids.length > 1) say(`Accepted ${ids.length} changes.`);
}

function stageRevert(id: string): void {
  const e = changeLog.get(id);
  if (!e) return;
  const later = changeLog.revertImpact(id);
  const label = later.length ? `Revert "${e.title}" and ${later.length} later change${later.length === 1 ? '' : 's'}` : `Revert "${e.title}"`;
  presentChoices(label, [{ label: 'Revert', result: { revert: id }, source: 'rules' }], () => {
    applyingReviewed = true;
    let r: { ok: boolean; error?: string; count?: number };
    try {
      r = changeLog.revert(id, {
        restore: (doc) => {
          const step = rawController.restoreSnapshot?.(doc) ?? { ok: false, error: 'This view cannot restore.' };
          return { ok: step.ok, error: step.error };
        },
        summary: () => planDigest(rawController.snapshot()),
      });
    } finally {
      applyingReviewed = false;
    }
    if (!r.ok) { say(r.error ?? 'Could not revert.'); verifierEl.textContent = r.error ?? 'Could not revert.'; return; }
    const chain = [e, ...later].sort((a, b) => a.at - b.at);
    const firstMat = chain.map((x) => x.op).find((op) => isSetMaterialsOp(op));
    if (firstMat) restoreMaterialsOp(firstMat);
    renderAll();
    verifierEl.textContent = `Reverted ${r.count} change${r.count === 1 ? '' : 's'}. You can undo the revert too.`;
    say(`Reverted ${r.count === 1 ? 'that change' : `${r.count} changes`}.`);
  }, () => { verifierEl.textContent = 'Revert cancelled.'; });
  say(`${label}? Say apply or cancel.`);
}

/** The deterministic guideline check (+ Gemini explanations when online). */
async function runGuidelineCheck(region: RegionId, speak = true, quiet = false): Promise<boolean> {
  const report = checkGuidelines(planDoc(), region);
  lastReport = report;
  const summary = summarizeReport(report);
  copilotPanel.setReport(report.issues, region, summary);
  if (quiet) return true;
  copilotPanel.open('review');
  toggleButton(btnCopilot, true);
  setBadge('rules', 'exact');
  recordLedger('rules', 'guideline-check', 'measured on this device', '');
  verifierEl.textContent = summary;
  if (speak) say(report.issues.length ? `${summary.replace(/^.*?: /, '')} I've marked them on the plan.` : 'Guideline check: nothing flagged.');
  const ids = [...new Set(report.issues.flatMap((i) => i.targetIds))];
  if (ids.length) {
    const sel = rawController.applyOp({ op: 'select_set', ids });
    if (!sel.ok && ids[0]) rawController.selectId(ids[0]);
    renderAll();
  }
  if (!report.issues.length) return true;
  if (!isOnline() || !cloudConfigured) {
    siteChecklist.add(`Explain the guideline findings (${report.region.label}) and suggest fixes`, controller.summary().slice(0, 300), true);
    verifierEl.textContent += ' Gemini will explain these when you are back online (saved to your site checklist).';
    return true;
  }
  const sent = report.issues.map(({ id, rule, message, citation }) => ({ id, rule, message, citation }));
  beginDeepWait('copilot');
  const res = await explainAccessibility(sent, controller.summary(), planLabelNames());
  endDeepWait();
  recordLedger(res.source, 'guideline-explain', res.source === 'cloud' ? 'explain findings' : REASON_TEXT.private, `issues: ${JSON.stringify(sent)}`);
  if (res.items.length) {
    const byId = new Map(res.items.map((x) => [x.id, x]));
    const merged = report.issues.map((i) => {
      const x = byId.get(i.id);
      if (!x) return i;
      return { ...i, message: `${i.message} ${x.explanation}`, ...(x.fix && !i.fix ? { fix: x.fix as Record<string, unknown>, fixLabel: 'Gemini fix', fixSource: res.source } : {}) };
    });
    lastReport = { ...report, issues: merged };
    const route = res.source === 'cloud'
      ? routeGemini({ kind: 'guideline', model: res.model })
      : routeOffline();
    publishRoute(route);
    copilotPanel.setReport(merged, region, summary, route);
  }
  return true;
}

function proposeIssueFix(issue: A11yIssue, by: 'rules' | 'cloud' | 'on-device'): void {
  if (!issue.fix) return;
  const src = issue.fixSource ?? by;
  highlightA11yIssue(issue);
  proposeChange({
    actor: sourceToActor(src as Source), tool: 'fix_guideline', title: issue.fixLabel ?? 'Guideline fix',
    why: issue.message.slice(0, 280), op: issue.fix, source: src === 'cloud' ? 'cloud' : src === 'on-device' ? 'on-device' : 'rules',
  });
}

/** Answer a hard question: Gemini when online, else the site checklist. */
function applyPlanAnswer(ans: { text: string; ids: string[] }, question: string, by: string, badgeNote?: string, route?: RouteInfo): true {
  setPlanDataBadge(badgeNote);
  const ids = 'ids' in ans && Array.isArray(ans.ids) ? ans.ids : [];
  if (ids.length) {
    const sel = rawController.applyOp({ op: 'select_set', ids });
    if (!sel.ok) rawController.selectId(ids[0]);
    renderAll();
  }
  const info = route ?? routePlanData({ nanoUnderstood: Boolean(badgeNote) });
  publishRoute(info);
  copilotPanel.setAnswer({ question, text: ans.text, by, route: info });
  copilotPanel.open('review');
  toggleButton(btnCopilot, true);
  verifierEl.textContent = ans.text;
  say(ans.text);
  return true;
}

async function handleHardQuestion(
  question: string,
  opts?: { condensed?: { from: number; to: number } },
): Promise<boolean> {
  if (isSimplePlanQuestion(question)) {
    const local = answerPlanQuestion(planDoc(), question);
    if (local) {
      recordLedger('rules', 'plan-qa', 'read from the drawing', question);
      const refine = await maybeQueueOfflineCheck(question, local.text);
      return applyPlanAnswer(local, question, 'Plan data · on device', undefined, refine ?? undefined);
    }
  }
  // Rules-first redaction (ai/redact): only the SENT text swaps her names for
  // neutral tokens; the question shown on the card keeps her real words.
  const sent = protectText(question, planLabelNames());
  const redacted = { names: sent.names, details: sent.details };
  const judgement = isPlanJudgementQuestion(question);
  const hard = judgement || isHardQuestion(question);
  const online = isOnline() && cloudConfigured;
  if (online && hard) beginDeepWait('copilot');
  // Apply the early Gemini result (or fire once more if the final transcript
  // changed). This is what marks Nano's guess confirmed / corrected / withdrawn.
  if (speculative && (hard || isPlanQuestion(question))) {
    try {
      await speculative.onFinal(question);
    } catch {
      // Fall through to the parallel race below.
    }
  }
  const existing = speculative?.getDraft();
  const same = existing && existing.utterance.trim().toLowerCase() === question.trim().toLowerCase();
  if (same && existing && (existing.state === 'confirmed' || existing.state === 'corrected' || existing.state === 'withdrawn' || existing.geminiAnswer)) {
    endDeepWait();
    if (existing.geminiAnswer || existing.state !== 'draft') setBadge('cloud', 'big-job');
    showSpeculativeDraft(existing, speculative.stats(), { speak: true });
    return true;
  }
  const raced = await raceHardQuestion({
    judgement,
    hard,
    online,
    deviceReady: routerEnv().deviceReady,
    nanoTimeoutMs: NANO_ROUTE_TIMEOUT_MS,
    pickNano: () => pickCadTool(question, controller.summary(), { allowCloud: false, timeoutMs: NANO_ROUTE_TIMEOUT_MS }),
    askCloud: () => askCopilot(sent.text, controller.summary(), GUIDELINE_SETS[guidelineRegion].label, (partial) => {
      const streamRoute = routeGemini({ kind: judgement ? 'judgment' : 'hard', condensed: opts?.condensed, redacted });
      publishRoute(streamRoute);
      copilotPanel.setAnswer({ question, text: revealAnswer(partial, streamRoute).text, by: 'Gemini · cloud', route: revealAnswer(partial, streamRoute).route ?? streamRoute });
    }, planLabelNames()).then((res) => res ? { answer: res.answer, calls: res.calls, why: res.why, source: res.source, ms: res.ms, model: res.model } : null),
  });
  endDeepWait();
  if (raced.kind === 'nano-tool') {
    const picked = raced.pick;
    if (picked.call.tool === 'measure') {
      const q = String(picked.call.args.question ?? question);
      const ans = answerPlanQuestion(planDoc(), q);
      if (ans) {
        recordLedger('on-device', 'cad-tool', 'private', '', picked.ms);
        lastUtteranceSource = 'on-device';
        return applyPlanAnswer(ans, q, 'Plan data · on device', 'Nano understood the question.');
      }
    }
    recordLedger(picked.source, 'cad-tool', picked.source === 'cloud' ? 'pick a CAD tool' : 'private', '', picked.ms);
    lastUtteranceSource = picked.source === 'cloud' ? 'cloud' : picked.source === 'on-device' ? 'on-device' : 'rules';
    setBadge(picked.source === 'cloud' ? 'cloud' : picked.source === 'on-device' ? 'on-device' : 'rules', picked.source === 'on-device' ? 'private' : 'exact');
    const call = refineCadPick(question, picked.call);
    const tool = cadTool(call.tool);
    const actor: Actor = (tool?.kind === 'edit' || call.tool === 'set_materials') ? (picked.source === 'cloud' ? 'gemini' : picked.source === 'on-device' ? 'nano' : 'her') : 'her';
    return runCadTool(call, actor, question, picked.source, picked.source === 'on-device' ? routeNanoCanvas() : undefined);
  }
  if (raced.kind === 'offline') {
    const route = routeOffline();
    publishRoute(route);
    siteChecklist.add(question, controller.summary().slice(0, 300), !isOnline());
    copilotPanel.setAnswer({
      question,
      text: `Saved to your site checklist: "${question}". When the signal is back, ask Gemini or email the client.`,
      by: 'Offline · on device',
      route,
    });
    copilotPanel.open('review');
    toggleButton(btnCopilot, true);
    setBadge('rules', 'offline');
    recordLedger('rules', 'site-checklist', 'saved on this device (offline)', '');
    verifierEl.textContent = `Saved to your site checklist: "${question}". When the signal is back, ask Gemini or email the client.`;
    say('No signal right now. I saved that to your site checklist.');
    return true;
  }
  if (raced.kind === 'cloud') {
    const res = raced.cloud;
    const route = routeGemini({
      kind: judgement ? 'judgment' : 'hard',
      nano: raced.nano,
      nanoTimeoutMs: NANO_ROUTE_TIMEOUT_MS,
      model: res.model,
      why: res.why,
      condensed: opts?.condensed,
      redacted,
    });
    const shown = revealAnswer(res.answer, route);
    const shownRoute = shown.route ?? route;
    publishRoute(shownRoute);
    setBadge('cloud', 'big-job');
    recordLedger('cloud', 'copilot-answer', res.model ? `hard question · ${res.model}` : 'hard question', `question: ${JSON.stringify(sent.text)}\nplan: ${controller.summary().slice(0, 400)}`, res.ms);
    copilotPanel.setAnswer({ question, text: shown.text, by: res.model ? `Gemini · ${res.model}` : 'Gemini · cloud', route: shownRoute });
    copilotPanel.open('review');
    toggleButton(btnCopilot, true);
    verifierEl.textContent = shown.text;
    say(shown.text);
    for (const call of res.calls) {
      const act = toolToAction(call);
      if (act.kind === 'op') {
        proposeChange({ actor: 'gemini', tool: call.tool, title: describeCall(call), why: res.why || question, op: act.op, source: 'cloud', route });
      }
    }
    return true;
  }
  siteChecklist.add(question, controller.summary().slice(0, 300), false);
  verifierEl.textContent = `Gemini couldn't answer right now. Saved to your site checklist: "${question}".`;
  say("Gemini couldn't answer right now, so I saved it to your checklist.");
  copilotPanel.open('checklist');
  return true;
}

async function askChecklistItem(id: string): Promise<void> {
  const it = siteChecklist.get(id);
  if (!it) return;
  if (!isOnline() || !cloudConfigured) { say('Still no signal. I will keep it on the list.'); return; }
  beginDeepWait('copilot');
  const sent = protectText(it.question, planLabelNames());
  const res = await askCopilot(sent.text, controller.summary(), GUIDELINE_SETS[guidelineRegion].label, undefined, planLabelNames());
  endDeepWait();
  if (!res) { say("Gemini couldn't answer that right now."); return; }
  const shown = revealAnswer(res.answer, routeGemini({ kind: 'hard', model: res.model, why: res.why }));
  const route = shown.route ?? routeGemini({ kind: 'hard', model: res.model, why: res.why });
  publishRoute(route);
  recordLedger('cloud', 'copilot-answer', 'site checklist item', `question: ${JSON.stringify(sent.text)}`, res.ms);
  siteChecklist.answer(id, shown.text, 'gemini');
  copilotPanel.setAnswer({ question: it.question, text: shown.text, by: res.model ? `Gemini · ${res.model}` : 'Gemini · cloud', route });
  say(shown.text);
  for (const call of res.calls) {
    const act = toolToAction(call);
    if (act.kind === 'op') proposeChange({ actor: 'gemini', tool: call.tool, title: describeCall(call), why: res.why || it.question, op: act.op, source: 'cloud', route });
  }
}

async function emailClient(): Promise<boolean> {
  const items = siteChecklist.items().filter((i) => i.status === 'open' || i.status === 'answered');
  if (!items.length) { say('Your site checklist is empty.'); return false; }
  copilotPanel.open('checklist');
  toggleButton(btnCopilot, true);
  let draft = fallbackEmail(items);
  let by = 'Drafted on this device (no signal). Gemini can polish it when you are online.';
  let route: RouteInfo = routeOffline();
  if (isOnline() && cloudConfigured) {
    beginDeepWait('email');
    const res = await draftClientEmail(items.map((i) => ({ question: i.question, answer: i.answer })), controller.summary(), planLabelNames());
    endDeepWait();
    if (res) {
      const subj = fillVisible(res.draft.subject);
      const body = fillVisible(res.draft.body);
      const to = fillVisible(res.draft.to);
      draft = { ...res.draft, subject: subj.text, body: body.text, to: to.text };
      const filled = subj.filled + body.filled + to.filled;
      by = 'Drafted by Gemini · cloud. Read it first.';
      route = routeGemini({ kind: 'email', model: res.model });
      if (filled) route = { ...route, filledOnDevice: true };
      recordLedger('cloud', 'client-email', 'draft from site checklist', `questions: ${items.length}`, res.ms);
    }
  }
  publishRoute(route);
  copilotPanel.setDraft({ draft, by, route });
  verifierEl.textContent = 'Email draft ready below. Nothing is sent. Pinch "Open in my mail app" to open it there.';
  say('Here is the draft. Read it, then pinch Open in my mail app. Nothing is sent until you press send there.');
  return true;
}

/** Her confirm (pinch) → open her own mail app with the draft. Never sends. */
function confirmOpenDraft(d: EmailDraft): void {
  leaveState = armLeave({ kind: 'email', title: d.subject || 'Client email', detail: 'Opens your mail app. You press send there.' });
  renderLeaveCard(d);
  say('Pinch and hold to open this email in your mail app. You can undo for 10 seconds. Nothing is sent from Mendcraft.');
}

function renderLeaveCard(d?: EmailDraft): void {
  if (!studioChrome) return;
  const now = Date.now();
  const copy = leaveCardCopy(leaveState, now);
  const req = leaveState.request;
  const catalog = catalogRoute({
    route: { tier: 'gemini', engine: 'gemini', reason: 'needs writing (client email)' },
    kind: req?.kind === 'connector' ? 'connector' : 'email',
    sent: 'the draft and your words',
  });
  const sent = leaveState.phase === 'sent' || leaveState.phase === 'undone';
  studioChrome.setProposal({
    id: 'leave-app',
    title: req ? (req.kind === 'connector' ? req.title : `Email: ${req.title}`) : 'Send',
    why: req?.detail,
    catalog,
    status: sent ? 'leave-sent' : 'leave',
    leaveAction: copy.action,
    undoLabel: copy.undo,
  }, {
    onHoldStart: () => {
      leaveState = startHold(leaveState, Date.now());
      renderLeaveCard(d);
      const started = leaveState.holdStartedAt ?? Date.now();
      window.setTimeout(() => {
        if (leaveState.phase !== 'holding') return;
        finishLeave(d);
      }, LEAVE_HOLD_MS + 30);
      void started;
    },
    onHoldEnd: () => {
      if (leaveState.phase === 'holding') {
        leaveState = releaseHold(leaveState);
        renderLeaveCard(d);
      }
    },
    onDrop: () => {
      leaveState = IDLE_LEAVE;
      studioChrome?.setProposal(null);
      say('Dropped. Nothing left the app.');
    },
    onUndo: () => {
      const next = undoLeave(leaveState, Date.now());
      if (next.phase !== 'undone') return;
      leaveState = next;
      if (leaveTimer) clearTimeout(leaveTimer);
      studioChrome?.setProposal(null);
      leaveState = IDLE_LEAVE;
      say('Undone. If your mail app opened, delete the draft there if you did not mean to send it. Nothing was sent from Mendcraft.');
    },
  });
}

function finishLeave(d?: EmailDraft): void {
  leaveState = completeHold(leaveState, Date.now());
  if (leaveState.phase !== 'sent') return;
  if (leaveState.request?.kind === 'email' && d) {
    window.open(mailtoUrl(d), '_blank');
    for (const it of siteChecklist.items()) if (it.status === 'open' || it.status === 'answered') siteChecklist.mark(it.id, 'emailed');
    copilotPanel.setDraft(null);
    verifierEl.textContent = 'Opened in your mail app. Nothing was sent from Mendcraft. You have 10 seconds to undo.';
    say('Opened in your mail app. Brush or say undo within 10 seconds if you did not mean to.');
  }
  renderLeaveCard(d);
  if (leaveTimer) clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    if (leaveState.phase === 'sent' && !canUndoLeave(leaveState, Date.now())) {
      leaveState = IDLE_LEAVE;
      studioChrome?.setProposal(null);
      studioChrome?.refresh();
    }
  }, LEAVE_UNDO_MS + 50);
}

/** Run one typed CAD tool call. `actor` = who asked (her) or proposed (AI). */
async function runCadTool(call: ToolCall, actor: Actor, why: string, source: Source, route?: RouteInfo): Promise<boolean> {
  const act = toolToAction(call);
  if (act.kind === 'error') { verifierEl.textContent = act.error; say(act.error); return false; }
  opJsonEl.textContent = JSON.stringify({ tool: call.tool, args: call.args, by: actor }, null, 2);
  if (act.kind === 'op') {
    if (actor === 'her' || act.op.op === 'select') {
      const step = controller.applyOp(act.op);
      if (!step.ok) { say(`I couldn't do that: ${step.error ?? 'invalid'}`); verifierEl.textContent = `Rejected: ${step.error}`; return false; }
      renderAll();
      verifierEl.textContent = step.message ?? 'Done.';
      speakConfirm(String(act.op.op));
      return true;
    }
    const info = route ?? (source === 'on-device' ? routeNanoCanvas() : source === 'cloud' ? routeGemini({ kind: 'hard', why }) : undefined);
    if (info) publishRoute(info);
    proposeChange({ actor, tool: call.tool, title: describeCall(call), why, op: act.op, source: source === 'cloud' ? 'cloud' : source === 'on-device' ? 'on-device' : 'rules', route: info });
    return true;
  }
  const a = call.args;
  switch (act.action) {
    case 'add_stair': {
      const p = proposeStair(planDoc(), {
        floorHeight: typeof a.floorHeight === 'number' ? a.floorHeight : null,
        region: guidelineRegion, width: typeof a.width === 'number' ? a.width : undefined,
        dir: a.dir === 'down' ? 'down' : 'up',
      });
      setBadge(source, source === 'rules' ? 'exact' : 'private');
      recordLedger(source, 'stair-design', 'computed on this device', '');
      // Staircase math is deterministic code, so the proposer is the rules
      // (or Nano/Gemini if they picked the tool); it still waits for her OK.
      proposeChange({
        actor: actor === 'her' ? 'rules' : actor, tool: 'add_stair',
        title: `Add a staircase: ${p.plan.risers} steps × ${Math.round(p.plan.rise)} mm, tread ${p.plan.tread} mm`,
        why: `${p.summary} ${why ? `You said: "${why}".` : ''}`.trim(), op: p.op, source: 'rules',
      });
      say(`${p.summary} Pinch Accept to place it.`);
      return true;
    }
    case 'fix_guideline': {
      const issue = lastReport?.issues.find((i) => i.id === a.issueId);
      if (!issue?.fix) { say('I could not find that finding. Run the guideline check first.'); return false; }
      proposeIssueFix(issue, source === 'cloud' ? 'cloud' : source === 'on-device' ? 'on-device' : 'rules');
      return true;
    }
    case 'guideline_check': {
      const region = typeof a.region === 'string' && (REGION_IDS as readonly string[]).includes(a.region) ? (a.region as RegionId) : guidelineRegion;
      if (region !== guidelineRegion) { guidelineRegion = region; try { localStorage.setItem(REGION_KEY, region); } catch { /* */ } }
      return runGuidelineCheck(region);
    }
    case 'measure': {
      const q = String(a.question ?? why);
      const ans = answerPlanQuestion(planDoc(), q);
      if (!ans) return handleHardQuestion(q);
      recordLedger('rules', 'plan-question', 'read from the drawing on this device', '');
      const info = routePlanData({ nanoUnderstood: source === 'on-device' });
      publishRoute(info);
      setPlanDataBadge(source === 'on-device' ? 'Nano understood the question.' : undefined);
      copilotPanel.setAnswer({ question: q, text: ans.text, by: source === 'on-device' ? 'Plan data · on device (Nano understood the question)' : 'Plan data · on device', route: info });
      if (ans.ids.length) {
        const sel = rawController.applyOp({ op: 'select_set', ids: ans.ids });
        if (!sel.ok) rawController.selectId(ans.ids[0]);
        renderAll();
      }
      verifierEl.textContent = ans.text;
      say(ans.text);
      return true;
    }
    case 'ask_gemini':
      return handleHardQuestion(String(a.question ?? why));
    case 'zoom': {
      if (a.to === 'fit') viewport.fit?.();
      else viewport.zoom?.(a.to === 'in' ? 1.4 : 1 / 1.4);
      say(a.to === 'fit' ? 'Whole plan.' : a.to === 'in' ? 'Zoomed in.' : 'Zoomed out.');
      return true;
    }
    case 'show_layer': {
      const visible = a.visible !== false;
      viewport.setLayerHidden?.(String(a.layer), !visible);
      const label = LAYER_LABEL[a.layer as LayerId] ?? String(a.layer);
      verifierEl.textContent = `${label} ${visible ? 'shown' : 'hidden'} (view only, the drawing is unchanged).`;
      say(`${label} ${visible ? 'shown' : 'hidden'}.`);
      return true;
    }
    case 'view_3d': {
      const on = a.on !== false;
      if (!on && viewport.walking?.()) { await viewport.walk?.(false); walkControls.show(false); }
      const now = viewport.toggle3D ? viewport.toggle3D(on) : false;
      btn3d.setAttribute('aria-pressed', String(now));
      say(now ? '3D view.' : 'Plan view.');
      return true;
    }
    case 'walkthrough': {
      if (a.on === false) {
        await viewport.walk?.(false);
        walkControls.show(false);
        verifierEl.textContent = 'Walk ended. Still in 3D; say "back to plan" for the drawing.';
        say('Walk ended.');
        return true;
      }
      if (!viewport.walk) { say('Walkthrough is not available here.'); return false; }
      const ok = await viewport.walk(true, typeof a.room === 'string' ? a.room : undefined);
      btn3d.setAttribute('aria-pressed', 'true');
      walkControls.show(ok);
      setBadge('rules', 'private');
      recordLedger('rules', 'walkthrough', 'runs on this device', '');
      verifierEl.textContent = 'Walking through your plan, on this device. Say forward, back, turn left, turn right, or stop. Or pinch the big buttons.';
      say('Walking through your plan. Say forward, turn left, turn right, or stop.');
      return ok;
    }
    case 'walk_step':
      viewport.walkStep?.(String(a.step));
      return true;
    case 'set_materials': {
      const style = String(a.style ?? why);
      let plan: MaterialPlan = presetFor(style);
      let by = 'a preset on this device';
      let handedOff = false;
      if (isOnline() && cloudConfigured) {
        copilotPanel.open('review');
        toggleButton(btnCopilot, true);
        beginDeepWait('lighting');
        verifierEl.textContent = deepWorkingLabel('lighting');
        const res = await proposeMaterials(style, controller.summary(), planLabelNames());
        endDeepWait();
        if (res) {
          plan = res.plan;
          by = 'Gemini · cloud';
          handedOff = source === 'on-device' || actor === 'nano';
          recordLedger('cloud', 'materials', handedOff ? 'Nano → Gemini' : '3D materials as data', `request: ${JSON.stringify(style)}\nrooms: ${controller.summary().slice(0, 300)}`, res.ms);
          setBadge('cloud', handedOff ? 'handed-off' : 'big-job', false, handedOff ? 'Nano picked the tool, Gemini chose materials' : null);
          if (handedOff) {
            routerPanel.add({
              utterance: why || style, planned: 'on-device', source: 'cloud',
              reason: 'handed-off', escalated: true, ms: res.ms,
              note: 'Nano picked set_materials; Gemini chose materials and light',
            });
          }
        }
      } else {
        setBadge(source === 'on-device' ? 'on-device' : 'rules', source === 'on-device' ? 'private' : (isOnline() ? 'private' : 'offline'));
      }
      const names = `walls ${plan.walls.name}, floor ${plan.floor.name}`;
      // Convert-to-3D always waits for Accept — even a local preset is a look change.
      {
        const previous = (viewport.currentMaterials?.() as MaterialPlan | undefined) ?? null;
        const previous3d = viewport.is3D?.() === true || btn3d.getAttribute('aria-pressed') === 'true';
        await viewport.setMaterials?.(plan);
        btn3d.setAttribute('aria-pressed', 'true');
        btn3d.classList.toggle('active', true);
        btn3d.textContent = '2D view';
        const title = `3D look: ${plan.label} (${names})`;
        const info = handedOff
          ? routeGemini({ kind: 'hard', why: 'Nano picked the tool; Gemini chose materials and light' })
          : by === 'Gemini · cloud' ? routeGemini({ kind: 'hard' })
          : source === 'on-device' ? routeNanoCanvas() : undefined;
        if (info) publishRoute(info);
        copilotPanel.setAnswer({ question: 'Convert to 3D', text: `${plan.label}: ${names}. ${plan.notes}`, by: `${handedOff ? 'Nano → Gemini' : by}. ${PHOTO_RENDER_NOTE}`, route: info });
        proposeChange({
          actor: actor === 'her' ? 'gemini' : actor,
          tool: 'set_materials',
          title,
          why: `${plan.notes}${why ? ` You said: "${why}".` : ''} ${PHOTO_RENDER_NOTE}`.trim(),
          op: makeSetMaterialsOp(plan, previous, previous3d),
          source: handedOff || by === 'Gemini · cloud' ? 'cloud' : (source === 'on-device' ? 'on-device' : 'rules'),
          route: info,
        });
        return true;
      }
    }
    default:
      return false;
  }
}

/** Copilot pass (early in the pipeline). Instant review/walk commands stay on
 *  rules. When Nano is ready, recognised canvas tools (including
 *  "convert 2D to 3D") go to Nano first; rules are the fallback. Null = not a
 *  copilot request. */
async function handleCopilot(utterance: string): Promise<boolean | null> {
  if (isSimplePlanQuestion(utterance)) {
    const t0 = performance.now();
    const local = answerPlanQuestion(planDoc(), utterance);
    if (local) {
      lastUtteranceText = utterance;
      lastUtteranceAt = Date.now();
      lastUtteranceSource = 'rules';
      recordLedger('rules', 'plan-qa', 'read from the drawing', utterance);
      document.body.dataset.planQaMs = String(Math.round(performance.now() - t0));
      return applyPlanAnswer(local, utterance, 'Plan data · on device');
    }
  }
  // Judgement questions ("should we take down this wall?", wheelchair width)
  // go to the copilot — never become a canvas edit via Nano.
  if (isPlanJudgementQuestion(utterance)) {
    lastUtteranceText = utterance;
    lastUtteranceAt = Date.now();
    return handleHardQuestion(utterance);
  }
  const intent = parseCopilot(utterance, { walking: viewport.walking?.() ?? false });
  if (intent && isInstantCopilot(intent) && intent.kind !== 'tool') {
    lastUtteranceText = utterance;
    lastUtteranceAt = Date.now();
    lastUtteranceSource = 'rules';
    if (intent.kind === 'checklist-add') {
      return handleCopilotRules(intent, utterance);
    }
    if (intent.kind === 'meta') {
      return handleCopilotRules(intent, utterance);
    }
  }
  if (shouldNanoPickIntent(routerEnv().deviceReady, intent)) {
    const picked = await pickCadTool(utterance, controller.summary(), { allowCloud: false });
    if (picked && picked.call.tool !== 'ask_gemini' && picked.confidence >= 0.5) {
      const call = refineCadPick(utterance, picked.call);
      recordLedger('on-device', 'cad-tool', REASON_TEXT.private, '', picked.ms);
      lastUtteranceText = utterance;
      lastUtteranceAt = Date.now();
      lastUtteranceSource = 'on-device';
      setBadge('on-device', 'private');
      routerPanel.add({
        utterance, planned: 'on-device', source: 'on-device', reason: 'private',
        confidence: picked.confidence, escalated: false, ms: picked.ms,
        note: call.tool === picked.call.tool ? `Nano picked ${call.tool}` : `Nano picked ${picked.call.tool}; using ${call.tool}`,
      });
      const tool = cadTool(call.tool);
      const actor: Actor = (tool?.kind === 'edit' || call.tool === 'set_materials') ? 'nano' : 'her';
      return runCadTool(call, actor, utterance, 'on-device', routeNanoCanvas());
    }
    // Nano missed or was unsure — fall through to the rules parse.
  }
  if (!intent) return null;
  lastUtteranceText = utterance;
  lastUtteranceAt = Date.now();
  lastUtteranceSource = 'rules';
  return handleCopilotRules(intent, utterance);
}

async function handleCopilotRules(intent: NonNullable<ReturnType<typeof parseCopilot>>, utterance: string): Promise<boolean | null> {
  if (intent.kind === 'checklist-add') {
    siteChecklist.add(intent.question, controller.summary().slice(0, 300), !isOnline());
    copilotPanel.open('checklist');
    say('Added to your site checklist.');
    return true;
  }
  if (intent.kind === 'meta') {
    switch (intent.meta) {
      case 'open-checklist': copilotPanel.open('checklist'); toggleButton(btnCopilot, true); say(`${siteChecklist.open().length} open site questions.`); return true;
      case 'open-changes': copilotPanel.open('history'); toggleButton(btnCopilot, true); say('Here is every change.'); return true;
      case 'email-client': return emailClient();
      case 'accept': {
        const p = changeLog.pending();
        if (!p.length) return null; // let the chip/other handlers have it
        acceptChange(p[p.length - 1].id);
        return true;
      }
      case 'accept-all': if (!changeLog.pending().length) { say('Nothing is waiting.'); return true; } acceptAllChanges(); return true;
      case 'reject': {
        const p = changeLog.pending();
        if (!p.length) return null;
        rejectChange(p[p.length - 1].id);
        return true;
      }
      case 'reject-all': {
        const pending = changeLog.pending();
        if (!pending.length) { say('Nothing is waiting.'); return true; }
        for (const e of pending) rejectChange(e.id);
        say('Rejected everything waiting.');
        return true;
      }
      case 'revert-last': {
        const last = [...changeLog.entries()].reverse().find((e) => e.status === 'applied');
        if (!last) { say('Nothing to revert.'); return true; }
        stageRevert(last.id);
        return true;
      }
    }
  }
  if (intent.kind === 'tool') return runCadTool(intent.call, 'her', utterance, 'rules');
  return null;
}

/** Copilot fallback for questions the rules didn't catch: Nano understands
 *  (on device, works offline), numbers still come from the drawing; hard
 *  questions go to Gemini, or to the site checklist with no signal. */
async function handleCopilotQuestion(
  utterance: string,
  opts?: { condensed?: { from: number; to: number } },
): Promise<boolean | null> {
  if (isSimplePlanQuestion(utterance)) {
    const local = answerPlanQuestion(planDoc(), utterance);
    if (local) {
      recordLedger('rules', 'plan-qa', 'read from the drawing', utterance);
      lastUtteranceSource = 'rules';
      const refine = await maybeQueueOfflineCheck(utterance, local.text);
      return applyPlanAnswer(local, utterance, 'Plan data · on device', undefined, refine ?? undefined);
    }
  }
  if (isPlanJudgementQuestion(utterance) || isHardQuestion(utterance) || isPlanQuestion(utterance)) {
    return handleHardQuestion(utterance, opts);
  }
  return null;
}

/** Put directory names back into a cloud reply before she sees it. */
function revealAnswer(text: string, route?: RouteInfo): { text: string; route?: RouteInfo; filled: number } {
  const { text: filledText, filled } = fillVisible(text);
  if (!filled) return { text, route, filled: 0 };
  return { text: filledText, route: route ? { ...route, filledOnDevice: true } : undefined, filled };
}

function proposalFromReviewItem(item: GeminiReviewItem) {
  const p = proposalForReview(item);
  const sent = protectText(item.question, planLabelNames()).text;
  const filled = item.geminiAnswer ? fillVisible(item.geminiAnswer).filled : 0;
  return {
    id: `review-${item.id}`,
    title: p.title,
    youAsked: item.question,
    why: p.why,
    catalog: catalogRoute({
      route: {
        tier: 'gemini' as const,
        engine: 'gemini' as const,
        reason: item.because ?? 'checked the offline answer',
        filledOnDevice: filled > 0,
      },
      kind: 'hard' as const,
      sent,
      filledOnDevice: filled > 0,
    }),
    status: 'waiting' as const,
  };
}

function acceptGeminiReview(id: string): void {
  const kept = geminiReview.accept(id);
  if (!kept) return;
  const raw = kept.geminiAnswer ?? kept.offlineAnswer;
  const shown = revealAnswer(raw, {
    tier: 'gemini', engine: 'gemini',
    reason: kept.because ?? 'checked the offline answer',
    filledOnDevice: fillVisible(raw).filled > 0,
  });
  copilotPanel.setAnswer({
    question: kept.question,
    text: shown.text,
    by: kept.status === 'corrected' ? 'Gemini corrected an offline answer' : 'Gemini confirmed the offline answer',
    route: shown.route,
  });
  if (shown.route) publishRoute(shown.route);
  verifierEl.textContent = shown.text;
  say(kept.status === 'corrected' ? 'Kept Gemini’s correction.' : 'Kept Gemini’s check.');
  refreshCopilot();
}

function dropGeminiReview(id: string): void {
  const kept = geminiReview.drop(id);
  if (!kept) return;
  say('Kept the offline answer.');
  refreshCopilot();
}

/** Offline, a plan-data answer still earns Gemini's second opinion: queue a
 *  'question' job (drained on reconnect) and say so on the route line. Also
 *  adds a visible item to the Gemini review checklist. */
async function maybeQueueOfflineCheck(question: string, offlineAnswer: string): Promise<RouteInfo | null> {
  if (isOnline() || !cloudConfigured) return null;
  const job = await jobQueue.enqueue({
    kind: 'question',
    mode: mode.id,
    label: question,
    payload: { prompt: question, offlineAnswer },
  });
  geminiReview.recordOffline({ question, offlineAnswer, jobId: job.id });
  return routeOffline({ refineQueued: true });
}

function controlChanges() {
  return changeLog.entries().map((e) => ({ id: e.id, actor: e.actor, title: e.title, why: e.why, status: e.status }));
}
function controlChecklist() {
  return siteChecklist.items().map((i) => ({ id: i.id, question: i.question, status: i.status, askedOffline: i.askedOffline, answer: i.answer }));
}
refreshCopilot();
void syncSite();

/** Cloud results awaiting the user's accept/reject, keyed by job id. Also mirrored
 *  onto the job in the queue store (QueuedJob.staged) so a `ready` job survives a
 *  reload and can be restored with Apply/Discard; this map is rehydrated from the
 *  store on init. Only ever what was already staged locally — never re-sent to the
 *  cloud. */
type StagedResult =
  | { kind: 'plan'; payload: { ops: unknown[] }; source: Source }
  | { kind: 'a11y'; items: A11yExplanation[]; source: Source };
const staged = new Map<string, StagedResult>();
/** Job ids with an accept/reject in flight — guards against a double-click
 *  re-entering acceptJob before the async remove settles (double-apply). */
const settling = new Set<string>();

const KIND_LABEL: Record<JobKind, string> = { plan: 'Plan', a11y: 'A11y audit', question: 'Question' };

/** Plan generation jobs queue when offline. */
function bigJobKind(): JobKind | null {
  return mode.id === 'plan' ? 'plan' : null;
}

function netEnv() {
  return { online: net.online(), cloudConfigured };
}

function renderNetState(): void {
  const online = net.online();
  const n = jobQueue.count();
  netStateEl.classList.toggle('net-online', online);
  netStateEl.classList.toggle('net-offline', !online);
  netStateEl.textContent = online ? 'Online' : OFFLINE_QUICK_ONLY;
  netStateEl.title = online
    ? (n ? `Online. ${n} in the Later list.` : 'Online.')
    : (n ? `${OFFLINE_QUICK_ONLY}. ${n} in the Later list.` : OFFLINE_QUICK_ONLY);
  refreshStudioStatus();
}

function renderQueue(jobs: QueuedJob[] = jobQueue.jobs()): void {
  queueSection.hidden = jobs.length === 0;
  queueCountEl.textContent = jobs.length ? String(jobs.length) : '';
  queueNoteEl.textContent = jobs.length
    ? net.online()
      ? 'Back online — running the Later list…'
      : LATER_LIST_PROMISE
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
  if (job.status === 'ready') {
    if (result && isValidStaged(result)) {
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.textContent = 'Apply';
      if (result.kind !== 'a11y' && job.mode !== mode.id) {
        apply.disabled = true;
        apply.title = `Switch to ${job.mode} mode to apply.`;
      }
      apply.addEventListener('click', () => void acceptJob(job.id));
      actions.append(apply);
    } else {
      // A ready job whose staged result didn't survive the reload (an older
      // build that didn't persist it, or a corrupt record): don't leave it stuck
      // with only Discard — offer Re-run so the cloud can produce it again.
      const rerun = document.createElement('button');
      rerun.type = 'button';
      rerun.textContent = 'Re-run';
      rerun.title = 'The saved result is missing — run this on the cloud again.';
      rerun.addEventListener('click', () => void rerunJob(job.id));
      actions.append(rerun);
    }
  }
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'ghost';
  dismiss.textContent = job.status === 'ready' ? 'Discard' : 'Remove';
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

/** Re-queue a restored `ready` job whose staged cloud result was lost on reload,
 *  so the cloud can produce it again rather than the job staying stuck. Clearing
 *  the staged field happens inside setStatus (any status other than `ready`). */
async function rerunJob(id: string): Promise<void> {
  if (settling.has(id)) return;
  settling.add(id);
  try {
    staged.delete(id);
    await jobQueue.setStatus(id, 'queued');
    say('Re-running this on the cloud.');
    if (net.online()) void drainQueue();
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
  if (job.kind === 'question') {
    // Offline she already got an answer from the drawing; on reconnect Gemini
    // checks it. The agreement compare is the speculative engine's (exported),
    // so confirmed/corrected is earned, never invented; with nothing to
    // compare it only claims "checked".
    const question = job.payload.prompt ?? '';
    const sent = protectText(question, planLabelNames());
    const res = await askCopilot(sent.text, controller.summary(), GUIDELINE_SETS[guidelineRegion].label, undefined, planLabelNames());
    if (!res) {
      await jobQueue.setStatus(job.id, 'error', 'Gemini could not check this yet');
      return;
    }
    recordLedger('cloud', 'copilot-answer (queued)', 'drained on reconnect', `question: ${JSON.stringify(sent.text)}`, res.ms);
    const offline = job.payload.offlineAnswer;
    const agreed = offline ? guessesAgree({ answer: offline }, { answer: res.answer, calls: res.calls }) : null;
    const why = agreed === null
      ? 'checked the offline answer after reconnect'
      : agreed
        ? 'confirmed the offline answer after reconnect'
        : 'corrected the offline answer after reconnect';
    const item = geminiReview.items().find((i) => i.jobId === job.id)
      ?? geminiReview.findByQuestion(question)
      ?? (offline ? geminiReview.recordOffline({ question, offlineAnswer: offline, jobId: job.id }) : null);
    if (item) geminiReview.recordGeminiResult(item.id, { geminiAnswer: res.answer, agreed, because: why });
    const route = routeGemini({ model: res.model, why, redacted: { names: sent.names, details: sent.details } });
    publishRoute(route);
    copilotPanel.open('review');
    toggleButton(btnCopilot, true);
    verifierEl.textContent = geminiReview.waitingCountLine();
    say('Gemini has a review waiting for you.');
    await jobQueue.remove(job.id);
    refreshCopilot();
    return;
  }
  if (job.kind === 'a11y') {
    const res = await explainAccessibility(job.payload.issues ?? [], job.payload.summary ?? '', planLabelNames());
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
    void warmCloud();
    const n = jobQueue.count();
    if (n) say(`Back online — running ${n} queued cloud job${n === 1 ? '' : 's'}.`);
    void drainQueue();
  } else {
    say('Offline — edits keep working on-device; big cloud jobs will be queued.');
  }
});
void jobQueue.init().then(() => {
  // Rehydrate the in-memory staged map from any `ready` jobs that survived the
  // reload, so their cloud result is restored with Apply/Discard instead of
  // being stuck with no button. A ready job with a missing/corrupt payload is
  // left un-staged — renderJobRow then offers Re-run.
  for (const job of jobQueue.jobs()) {
    if (job.status === 'ready' && isValidStaged(job.staged)) {
      staged.set(job.id, job.staged as StagedResult);
    }
  }
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
// ---------------------------------------------------------------------------
// "TAUGHT ONCE, DONE FOREVER" RECIPES (src/recipes/*): a Teach toggle records
// applied ops from the shared op log into a draft; "save this as <name>" keeps
// it as a validated JSON recipe (local-first, best-effort Firestore sync);
// "do <name>" replays it — rules alias/fuzzy match first, then the hybrid Nano
// pick (Kannada forced to the cloud like other Kannada text, ledger-recorded) —
// always behind an explicit confirm, applied as ONE undoable step.

const recipeStore = createRecipeStore(typeof localStorage !== 'undefined' ? localStorage : null);
if (!recipeStore.get(DRAWING_REFERENCES_RECIPE.id) && !recipeStore.list().some((r) => r.name === DRAWING_REFERENCES_RECIPE.name)) {
  recipeStore.upsert({ ...DRAWING_REFERENCES_RECIPE, createdAt: Date.now(), updatedAt: Date.now() });
}

const recipeRecorder = createRecipeRecorder();
/** Hard allowlist for browser recipes — the ONLY hosts a browser step may open
 *  (same-origin app pages + the demo mail host). Everything else is refused. */
const BROWSER_ALLOWLIST: readonly string[] = [
  typeof window !== 'undefined' ? window.location.hostname : 'localhost',
  'mail.example.com',
];
const btnTeach = el<HTMLButtonElement>('btn-teach');
const btnRecipes = el<HTMLButtonElement>('btn-recipes');
const recipesSection = el<HTMLElement>('recipes-section');
const recipesNote = el<HTMLParagraphElement>('recipes-note');
const recipesCountEl = el<HTMLSpanElement>('recipes-count');
const recipesListEl = el<HTMLUListElement>('recipes-list');
const recipeConfirmEl = el<HTMLDivElement>('recipe-confirm');

/** Guard so a replay's own batch never re-enters the recorder/repeat detector. */
let replayingRecipe = false;
/** Rolling applied-op window for the "that looked like a repeat" offer. */
const recentOps: Record<string, unknown>[] = [];
const recentSigs: string[] = [];
/** The detected repeated sequence, held until "save this as <name>" (or lost
 *  to the next detection). NEVER auto-saved. */
let suggestedSteps: RecipeStep[] | null = null;
let pendingRun: Recipe | null = null;

function newRecipeId(): string {
  return `rcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Save a teach-recorded browser recipe (clicks/typing in a same-origin page). */
function saveBrowserRecipe(steps: readonly BrowserStep[]): void {
  if (!steps.length) return;
  const name = window.prompt(`Save ${steps.length} recorded step(s) as a browser recipe named:`)?.trim();
  if (!name) { verifierEl.textContent = 'Recording discarded — no name given.'; return; }
  const now = Date.now();
  const recipe: Recipe = {
    id: newRecipeId(), name, aliases: [], language: currentLanguage.code,
    device: 'browser', taughtBy: 'you',
    steps: steps.map((s) => ({ op: { ...s } as Record<string, unknown> })),
    createdAt: now, updatedAt: now,
  };
  const err = recipeStore.upsert(recipe);
  if (err) { verifierEl.textContent = `Couldn't save: ${err}`; return; }
  recipesSection.hidden = false;
  renderRecipes();
  void syncRecipes();
  verifierEl.textContent = `Saved browser recipe “${name}” (${steps.length} step(s)). Say "do ${name}" to replay.`;
  say(`Saved ${name}.`);
}

/** Seed one example browser recipe (same-origin demo page) on first run so a
 *  replay — including the Send-message confirm stop — is there to demo. */
function seedBrowserDemoRecipe(): void {
  if (typeof window === 'undefined') return;
  const id = 'rcp-demo-browser';
  const existing = recipeStore.book();
  if (existing.recipes[id] || existing.deleted[id]) return; // respect a user delete
  const url = `${window.location.origin}/demo-form.html`;
  const now = Date.now();
  const step = (o: Record<string, unknown>): RecipeStep => ({ op: o });
  const recipe: Recipe = {
    id, name: 'Demo: search & message', aliases: ['browser demo', 'demo form'],
    language: 'en', device: 'browser', taughtBy: 'demo',
    steps: [
      step({ op: 'open', url }),
      step({ op: 'find', by: 'placeholder', value: 'Search parts' }),
      step({ op: 'type', text: 'handrail bracket' }),
      step({ op: 'click', by: 'button', text: 'Search' }),
      step({ op: 'wait_for', text: 'Showing results' }),
      step({ op: 'find', by: 'placeholder', value: 'Your name' }),
      step({ op: 'type', text: 'Amma' }),
      step({ op: 'find', by: 'placeholder', value: 'Message' }),
      step({ op: 'type', text: 'Please call me about the ramp.' }),
      step({ op: 'click', by: 'button', text: 'Send message' }),
      step({ op: 'wait_for', text: 'Message sent' }),
    ],
    createdAt: now, updatedAt: now,
  };
  recipeStore.upsert(recipe);
}

function noteAppliedOp(step: StepResult): void {
  if (replayingRecipe || !step.ok || !step.op || typeof step.op !== 'object') return;
  const op = step.op as Record<string, unknown>;
  if (typeof op.op !== 'string') return;
  if (recipeRecorder.active()) {
    recipeRecorder.note(op);
    renderTeachState();
    return;
  }
  if (op.op === 'select' || op.op === 'select_set' || op.op === 'undo' || op.op === 'redo') return;
  recentOps.push(op);
  recentSigs.push(opSignature(op));
  if (recentOps.length > 24) {
    recentOps.shift();
    recentSigs.shift();
  }
  const len = detectRepeat(recentSigs);
  if (len) {
    suggestedSteps = recentOps.slice(-len).map((o) => ({ op: o }));
    recentOps.length = 0;
    recentSigs.length = 0; // one offer per detection
    showToast(`That looked like the same ${len} steps twice — say "save this as <name>" to keep it as a recipe.`);
  }
}

// Wrap the controller ONCE so every applied op — voice, text, pinch drag
// fallback, a11y fix — reaches the recorder through the same op-log seam.
{
  const rawApplyResult = controller.applyResult.bind(controller);
  controller.applyResult = (r) => {
    const s = rawApplyResult(r);
    noteAppliedOp(s);
    return s;
  };
  const rawApplyOp = controller.applyOp.bind(controller);
  controller.applyOp = (r) => {
    const s = rawApplyOp(r);
    noteAppliedOp(s);
    return s;
  };
}

function renderTeachState(): void {
  const on = recipeRecorder.active();
  btnTeach.setAttribute('aria-pressed', String(on));
  btnTeach.classList.toggle('teach-on', on);
  btnTeach.textContent = on ? `● Teaching (${recipeRecorder.count()})` : 'Teach';
}

function startTeaching(): void {
  recipeRecorder.start();
  renderTeachState();
  showToast('Teaching. Do the task once, then say "save this as <name>".');
  say('Teaching. Do the task once, then say save this as, and a name.');
}

function cancelTeaching(): void {
  recipeRecorder.cancel();
  renderTeachState();
  verifierEl.textContent = 'Stopped teaching — nothing was saved.';
  say('Stopped teaching.');
}

function saveRecipeAs(name: string): boolean {
  const meta = {
    id: newRecipeId(),
    name,
    language: currentLanguage.code,
    mode: mode.id,
    taughtBy: 'you',
    now: Date.now(),
  };
  let result: SaveResult;
  if (recipeRecorder.active()) {
    result = recipeRecorder.save(meta);
  } else if (suggestedSteps) {
    result = makeDesignerRecipe(suggestedSteps, meta);
    if (result.ok) suggestedSteps = null;
  } else {
    verifierEl.textContent = 'Nothing to save — press Teach (or say "start teaching") first.';
    say('Nothing to save yet. Say start teaching first.');
    return false;
  }
  if (!result.ok) {
    verifierEl.textContent = `Couldn't save the recipe: ${result.error}`;
    say('I could not save that recipe.');
    return false;
  }
  const err = recipeStore.upsert(result.recipe);
  if (err) {
    verifierEl.textContent = `Couldn't save the recipe: ${err}`;
    return false;
  }
  renderTeachState();
  recipesSection.hidden = false;
  opJsonEl.textContent = JSON.stringify({ savedRecipe: result.recipe.name, steps: result.recipe.steps.length }, null, 2);
  verifierEl.textContent = `Saved “${result.recipe.name}” — ${describeRecipe(result.recipe)}. Say "do ${result.recipe.name}" to run it.`;
  say(`Saved ${result.recipe.name}. Say do ${result.recipe.name} to run it.`);
  void syncRecipes();
  return true;
}

/** Show the explicit confirm (pinch/click) before any replay touches the doc. */
function stageRecipeRun(recipe: Recipe, source: Source, reason: RouteReason, translated = false): void {
  pendingRun = recipe;
  recipesSection.hidden = false;
  recipeConfirmEl.hidden = false;
  recipeConfirmEl.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = `Run “${recipe.name}”? ${describeRecipe(recipe)}. Applies as one undo step.`;
  const run = document.createElement('button');
  run.type = 'button';
  run.textContent = `Run “${recipe.name}”`;
  run.addEventListener('click', () => runPendingRecipe());
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    clearRecipeConfirm();
    verifierEl.textContent = 'Recipe cancelled — nothing was applied.';
  });
  recipeConfirmEl.append(p, run, cancel);
  setBadge(source, reason, translated);
  verifierEl.textContent = `Found recipe “${recipe.name}”. Confirm to run it.`;
  say(`Ready to run ${recipe.name}, ${recipe.steps.length} steps. Press run to confirm.`);
  run.focus();
}

function clearRecipeConfirm(): void {
  pendingRun = null;
  recipeConfirmEl.hidden = true;
  recipeConfirmEl.innerHTML = '';
}

/** Run a lamp recipe through the shared lamp panel (same path as the buttons,
 *  so a bridge-offline state is surfaced honestly). Returns a status line. */
async function runLampRecipe(recipe: Recipe): Promise<{ ok: boolean; detail: string }> {
  const plan = buildDeviceActions('lamp', recipe.steps);
  if (!plan.ok) return { ok: false, detail: plan.error };
  try {
    for (const a of plan.actions) if (a.device === 'lamp') await lampPanel.apply(a.intent);
    return { ok: true, detail: `${plan.actions.length} lamp step(s)` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/** Dispatch a non-designer recipe to its device. Music plays on the paired phone
 *  (no audio on the laptop), browser recipes open the in-canvas panel. */
async function runDeviceRecipe(recipe: Recipe): Promise<{ ok: boolean; detail: string }> {
  if (recipe.device === 'lamp') return runLampRecipe(recipe);
  if (recipe.device === 'music') {
    const plan = buildDeviceActions('music', recipe.steps);
    if (!plan.ok) return { ok: false, detail: plan.error };
    for (const a of plan.actions) if (a.device === 'music') await musicPanel.applyAction(a.action);
    return { ok: true, detail: `${plan.actions.length} music step(s)` };
  }
  if (recipe.device === 'browser') {
    const plan = buildBrowserPlan(recipe.steps, { allowedHosts: BROWSER_ALLOWLIST, slots: recipe.slots });
    if (!plan.ok) return { ok: false, detail: plan.error };
    // Actually replay inside the in-canvas panel. A cross-origin page falls back
    // to open-in-tab; a send/submit step stops for an explicit confirm.
    const res = await referencePanel.runRecipe(plan.steps);
    return { ok: res.status !== 'error', detail: res.detail };
  }
  return { ok: false, detail: `no runner for ${recipe.device}` };
}

function runPendingRecipe(): void {
  const recipe = pendingRun;
  if (!recipe) return;
  clearRecipeConfirm();
  if (recipe.device !== 'designer') {
    verifierEl.textContent = `Running “${recipe.name}” on the ${recipe.device}…`;
    void runDeviceRecipe(recipe).then((res) => {
      verifierEl.textContent = res.ok
        ? `Ran “${recipe.name}” — ${res.detail}.`
        : `Couldn't run “${recipe.name}”: ${res.detail}`;
      if (res.ok) speakConfirm('done');
    });
    return;
  }
  // No cursor plumbing yet, so a replay lands at the recipe's recorded spot
  // (steps are stored anchor-relative; buildReplayOps rebases them).
  const ops = buildReplayOps(recipe);
  replayingRecipe = true;
  let step: StepResult;
  try {
    if (mode.id === 'part') {
      // Part mode has no 'batch' op — apply sequentially (one undo per step).
      let okCount = 0;
      let lastErr: string | undefined;
      for (const op of ops) {
        const s = controller.applyOp(op);
        if (s.ok) okCount++;
        else lastErr = s.error;
      }
      step = okCount > 0 ? { ok: true, warnings: [] } : { ok: false, error: lastErr, warnings: [] };
    } else {
      step = controller.applyOp(buildReplayBatch(ops));
    }
  } finally {
    replayingRecipe = false;
  }
  if (!step.ok) {
    verifierEl.textContent = `Couldn't run “${recipe.name}”: ${step.error ?? 'invalid steps'}`;
    say(`I couldn't run ${recipe.name}.`);
    return;
  }
  renderAll();
  opJsonEl.textContent = JSON.stringify({ ranRecipe: recipe.name, steps: ops.length }, null, 2);
  verifierEl.textContent = `Ran “${recipe.name}” — ${ops.length} steps as one undo.`;
  speakConfirm('done');
  announceWarnings();
}

function mkCardBtn(label: string, ghost: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  if (ghost) b.className = 'ghost';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function renderRecipes(): void {
  const recipes = recipeStore.list();
  recipesCountEl.textContent = recipes.length ? String(recipes.length) : '';
  recipesListEl.innerHTML = '';
  recipesNote.textContent = recipes.length
    ? 'Say "do <name>" (or press Run). A recipe replays as one undoable step.'
    : 'No recipes yet. Press Teach, do a task once, then say "save this as <name>".';
  for (const r of recipes) {
    const li = document.createElement('li');
    li.className = 'recipe-card';
    const title = document.createElement('p');
    title.className = 'recipe-name';
    title.textContent = r.name;
    const desc = document.createElement('p');
    desc.className = 'recipe-desc';
    const aka = r.aliases.length ? ` · aka ${r.aliases.join(', ')}` : '';
    desc.textContent = `${describeRecipe(r)} · ${r.device} · taught by ${r.taughtBy || 'you'}${aka}`;
    const actions = document.createElement('div');
    actions.className = 'recipe-actions';
    actions.append(
      mkCardBtn('Run', false, () => stageRecipeRun(r, 'rules', 'exact')),
      mkCardBtn('Rename', true, () => {
        const name = window.prompt(`Rename “${r.name}” to:`, r.name)?.trim();
        if (name && recipeStore.rename(r.id, name, Date.now())) void syncRecipes();
      }),
      mkCardBtn('Aliases', true, () => {
        const raw = window.prompt('Other phrases that should run this recipe (comma-separated):', r.aliases.join(', '));
        if (raw === null) return;
        if (recipeStore.setAliases(r.id, raw.split(','), Date.now())) void syncRecipes();
      }),
      mkCardBtn('Delete', true, () => {
        if (!window.confirm(`Delete recipe “${r.name}”? This can't be undone.`)) return;
        if (recipeStore.remove(r.id, Date.now())) void syncRecipes();
      }),
    );
    li.append(title, desc, actions);
    recipesListEl.appendChild(li);
  }
}

btnTeach.addEventListener('click', () => {
  if (!recipeRecorder.active()) {
    startTeaching();
    return;
  }
  if (recipeRecorder.count() === 0) {
    cancelTeaching();
    return;
  }
  const name = window.prompt(`Save these ${recipeRecorder.count()} steps as:`)?.trim();
  if (name) saveRecipeAs(name);
  else cancelTeaching();
});

btnRecipes.addEventListener('click', () => {
  recipesSection.hidden = !recipesSection.hidden;
  btnRecipes.setAttribute('aria-pressed', String(!recipesSection.hidden));
});

/**
 * Recipe meta-commands, checked BEFORE routing:
 *   teach:  "start teaching" / ಕಲಿಸು — local, no model.
 *   save:   "save this as <name>" / "<ಹೆಸರು> ಅಂತ ಉಳಿಸು" — local, no model.
 *   run:    "do <name>" / "<ಹೆಸರು> ಮಾಡು" — alias/fuzzy rules match first, then
 *           the hybrid Nano pick (structured recipe-id output; Kannada forces
 *           the cloud like all Kannada text, and that send hits the ledger).
 * A 'run' with no matching recipe returns null → the utterance routes normally.
 */
async function handleRecipeMeta(utterance: string): Promise<boolean | null> {
  const meta = parseRecipeMeta(utterance);
  if (!meta) return null;
  if (meta.kind === 'start') {
    setBadge('rules', 'exact');
    startTeaching();
    return true;
  }
  if (meta.kind === 'cancel') {
    if (!recipeRecorder.active()) return null; // plain "stop" → normal routing
    setBadge('rules', 'exact');
    cancelTeaching();
    return true;
  }
  if (meta.kind === 'save') {
    setBadge('rules', 'exact');
    return saveRecipeAs(meta.name);
  }
  // meta.kind === 'run'
  const candidates = recipeStore.list().map((r) => ({ id: r.id, name: r.name, aliases: r.aliases }));
  if (candidates.length === 0) return null;
  const t0 = performance.now();
  const ruleHit = matchRecipe(meta.name, candidates) ?? matchRecipe(utterance, candidates);
  if (ruleHit) {
    const recipe = recipeStore.get(ruleHit.id)!;
    recordLedger('rules', 'recipe pick', REASON_TEXT.exact, '');
    routerPanel.add({ utterance, planned: 'rules', source: 'rules', reason: 'exact', escalated: false, ms: performance.now() - t0 });
    if (isReferenceRecipe(recipe)) {
      const result = await refBoard.apply(makeSearch(recipeSearchQuery(recipe), utterance, { fuzzy: false, explicit: true, preferred: 'search' }));
      verifierEl.textContent = result.detail;
      return result.ok;
    }
    stageRecipeRun(recipe, 'rules', 'exact');
    return true;
  }
  const env = routerEnv();
  if (!env.deviceReady && !env.cloudReady) return null;
  const translated = shouldTranslate(currentLanguage);
  const toCloud = translateInCloud(currentLanguage, { ...env, deviceLangReady });
  const pick = await pickRecipeHybrid(utterance, candidates, {
    forceCloud: toCloud,
    lang: translated ? currentLanguage : undefined,
    planNames: planLabelNames(),
  });
  if (!pick) return null;
  const reason: RouteReason = pick.source === 'on-device' ? 'private' : 'no-device';
  // Honest ledger line for the pick — a cloud call shows exactly what rode along
  // (the utterance + the recipe names it had to choose from).
  recordLedger(
    pick.source, 'recipe pick',
    pick.source === 'cloud' ? REASON_TEXT[reason] : REASON_TEXT.private,
    `${commandPayload(utterance)}\nrecipes: ${candidates.map((c) => c.name).join(', ')}`,
    pick.ms,
  );
  if (!pick.id || pick.confidence < 0.4) return null; // not a recipe → route normally
  const recipe = recipeStore.get(pick.id);
  if (!recipe) return null;
  routerPanel.add({
    utterance, planned: toCloud ? 'cloud' : 'on-device',
    source: pick.source, reason, confidence: pick.confidence, escalated: false,
    ms: performance.now() - t0,
  });
  stageRecipeRun(recipe, pick.source, reason, translated);
  return true;
}

const recipeBook = recipeBookId({
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
});

async function syncRecipes(): Promise<void> {
  const res = await syncRecipeBook(recipeStore, recipeBook);
  if (!res.ok) recipesNote.title = res.reason; // quiet: local book still works
}

recipeStore.subscribe(renderRecipes);
seedBrowserDemoRecipe();
renderRecipes();
renderTeachState();
void syncRecipes(); // best-effort cloud merge at boot (fails soft offline)

/** The plan's text labels, for the rules-first redactor (person-like filtering
 *  happens inside protectText; room-like labels pass through untouched). */
function planLabelNames(): string[] {
  if (mode.id !== 'plan') return [];
  try {
    return planDoc().texts.map((t) => t.text);
  } catch {
    return [];
  }
}

function commandPayload(utterance: string, ctx?: FusionContext): string {
  // Rules-first redaction (ai/redact): the payload recorded as sent — and
  // shown in the ledger — carries neutral tokens, never her family's names.
  const base = `command: ${JSON.stringify(protectText(utterance, planLabelNames()).text)}`;
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

// ---- confidence states: sure / unsure ("Did you mean…?") / unknown ---------
// Decisions live in ai/confidence.ts (pure, tested); this block is only the
// chips' DOM + the voice reply intercept. Nothing is applied until a chip is
// picked (pinch/click, or say "first"/"second"/"apply"/"cancel" — Kannada too).

interface PendingChoices {
  choices: Choice[];
  apply: (choice: Choice) => void;
  onCancel?: () => void;
}
let pendingChoices: PendingChoices | null = null;

/** Show the confidence state next to the honest source badge. */
function setConfidenceState(state: ConfidenceState | null): void {
  if (!state || state === 'sure') {
    confStateEl.hidden = true;
    confStateEl.textContent = '';
    return;
  }
  confStateEl.hidden = false;
  confStateEl.textContent = STATE_TEXT[state];
  confStateEl.className = `conf-state conf-${state}`;
  confStateEl.title = {
    sure: 'Applied: rules agreed or the model was confident.',
    unsure: 'Not applied — pick a chip (or say "first"/"second"/"cancel").',
    unknown: 'Not understood — nothing was applied.',
  }[state];
}

function clearChoices(): void {
  pendingChoices = null;
  choiceBarEl.hidden = true;
  choiceBarEl.innerHTML = '';
}

/** Up to 3 big chips + Cancel. Works with pinch (same pointer stream as the
 *  mouse), click, and voice via handleChoiceReply. */
function presentChoices(title: string, choices: Choice[], apply: (c: Choice) => void, onCancel?: () => void): void {
  clearChoices();
  pendingChoices = { choices, apply, onCancel };
  const p = document.createElement('p');
  p.className = 'choice-title';
  p.textContent = title;
  const row = document.createElement('div');
  row.className = 'choice-row';
  choices.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice-chip';
    b.textContent = choices.length === 1 ? `Apply: ${c.label}` : `${i + 1}. ${c.label}`;
    b.title = JSON.stringify(c.result);
    b.addEventListener('click', () => {
      clearChoices();
      apply(c);
    });
    row.appendChild(b);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'choice-chip choice-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    clearChoices();
    onCancel?.();
  });
  row.appendChild(cancel);
  choiceBarEl.append(p, row);
  choiceBarEl.hidden = false;
}

/** Voice/text reply while chips are up. true/false = handled; null = not a
 *  choice reply → the stale chips are dropped and the utterance runs as a new
 *  command (still nothing applied from the old one). */
function handleChoiceReply(utterance: string): boolean | null {
  if (!pendingChoices) return null;
  const pc = pendingChoices;
  const reply = parseChoiceReply(utterance, pc.choices.length);
  if (!reply) {
    clearChoices(); // moved on — the unsure proposal is silently dropped
    return null;
  }
  clearChoices();
  if (reply.kind === 'cancel') {
    verifierEl.textContent = 'Cancelled — nothing was applied.';
    say('Cancelled. Nothing was applied.');
    pc.onCancel?.();
    return true;
  }
  const chosen = pc.choices[reply.index];
  if (!chosen) {
    verifierEl.textContent = `There were only ${pc.choices.length} choices — nothing was applied.`;
    return false;
  }
  pc.apply(chosen);
  return true;
}

/** Sim/demo confirm: accept a staged single-choice preview programmatically
 *  (the judge's "Apply" tap, one beat after the preview is shown). */
function acceptPendingChoice(): void {
  if (!pendingChoices) return;
  const pc = pendingChoices;
  clearChoices();
  pc.apply(pc.choices[0]);
}

/** Apply a confirmed/sure command result: op log → render → intent verifier.
 *  (The tail of the old runUtteranceInner, shared with chip picks.) */
async function applyCommandResult(result: object, before: string): Promise<boolean> {
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


function clearChromeConfirm(): void {
  chromeConfirm = initialConfirm();
  chromeConfirmEl.hidden = true;
  chromeConfirmEl.innerHTML = '';
}

function stageChromePaste(preview: string, fieldLabel?: string, tabTitle?: string): void {
  const step = reduceConfirm(initialConfirm(), {
    type: 'stage',
    request: { kind: 'paste', preview, fieldLabel, tabTitle },
  });
  chromeConfirm = step.state;
  chromeConfirmEl.hidden = false;
  chromeConfirmEl.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = describeConfirm(step.state.request!);
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.textContent = 'Confirm paste';
  yes.addEventListener('click', () => { void confirmChromePaste('button'); });
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'ghost';
  no.textContent = 'Cancel';
  no.addEventListener('click', () => {
    clearChromeConfirm();
    verifierEl.textContent = 'Paste cancelled — nothing was inserted.';
  });
  chromeConfirmEl.append(p, yes, no);
  yes.focus();
}

async function confirmChromePaste(source: 'pinch' | 'button'): Promise<boolean> {
  const step = reduceConfirm(chromeConfirm, { type: 'confirm', source });
  if (!step.performPaste) return false;
  const clip = chromeBridge.lastCopied();
  const res = await chromeBridge.request('pasteHere', { text: clip?.text, confirmed: true });
  clearChromeConfirm();
  if (!res.ok) {
    const err = res.error === 'password' || res.error === 'payment'
      ? `That field looks like a ${res.error} field, so I did not paste.`
      : (res.error === 'no-field' ? 'No text field is focused in the other tab.' : 'Could not paste.');
    verifierEl.textContent = err;
    say(err);
    return false;
  }
  const msg = 'Pasted. The form was not submitted.';
  verifierEl.textContent = msg;
  say(msg);
  return true;
}

/**
 * Chrome-extension voice commands, resolved on this device. The extension's
 * replies are parsed as data only. Returns true/false when handled, or null
 * when the utterance is not a chrome command.
 */
async function handleChromeIntent(utterance: string): Promise<boolean | null> {
  const intent = parseChromeIntent(utterance);
  if (!intent) return null;
  setBadge('rules', 'exact');
  recordLedger('rules', 'command', 'chrome extension intent', utterance);

  if (intent.type === 'send-to-canvas') {
    let clip = chromeBridge.lastCopied();
    if (!clip && chromeBridge.isConnected()) {
      const res = await chromeBridge.request('getLastCopied');
      clip = res.data ?? null;
    }
    const kind = clip?.kind === 'link' ? 'link' as const : clip?.kind === 'text' ? 'text' as const : undefined;
    const added = addClip(clipsState, { kind, text: clip?.text, url: clip?.url, title: clip?.title });
    if (!added.clip) {
      const msg = 'Nothing to send. Say copy this or copy the link first.';
      verifierEl.textContent = msg;
      say(msg);
      return false;
    }
    clipsState = added.state;
    clipsLayer.render(clipsState);
    const msg = added.clip.kind === 'link' ? 'Link added to the canvas.' : 'Text added to the canvas.';
    verifierEl.textContent = msg;
    say(msg);
    return true;
  }

  if (!chromeBridge.isConnected()) {
    const msg = 'Chrome extension not connected. In Chrome open chrome://extensions, turn on Developer mode, and Load unpacked the extension folder.';
    verifierEl.textContent = msg;
    say(msg);
    return false;
  }

  if (intent.type === 'copy-this' || intent.type === 'copy-link') {
    const req = intentToRequest(intent);
    if (req.action === 'sendToCanvas') return false;
    const res = await chromeBridge.request(req.action, 'payload' in req ? req.payload : undefined);
    if (!res.ok) {
      const msg = res.error === 'no-tab' ? 'I could not find another Chrome tab to copy from.' : 'Could not copy from the other tab.';
      verifierEl.textContent = msg;
      say(msg);
      return false;
    }
    const label = res.data?.kind === 'link' ? (res.data.url || 'the link') : trimPreview(res.data?.text || 'the text', 60);
    verifierEl.textContent = `Copied ${label}. Say send to canvas, or paste here.`;
    say('Copied.');
    return true;
  }

  if (intent.type === 'paste-here') {
    const inspect = await chromeBridge.request('pasteHere', { confirmed: false });
    const skipped = inspect.data?.skipped ?? (inspect.error === 'password' || inspect.error === 'payment' ? inspect.error : undefined);
    if (skipped === 'password' || skipped === 'payment') {
      const msg = `That field looks like a ${skipped} field, so I will not paste into it.`;
      verifierEl.textContent = msg;
      say(msg);
      return false;
    }
    if (inspect.error === 'no-field') {
      const msg = 'Focus a text field in the other tab first, then say paste here.';
      verifierEl.textContent = msg;
      say(msg);
      return false;
    }
    let clip = chromeBridge.lastCopied();
    if (!clip?.text) {
      const remembered = await chromeBridge.request('getLastCopied');
      clip = remembered.data ?? null;
    }
    if (!clip?.text) {
      const msg = 'Nothing to paste. Say copy this first.';
      verifierEl.textContent = msg;
      say(msg);
      return false;
    }
    stageChromePaste(clip.text, inspect.data?.fieldLabel, inspect.data?.title || clip.title);
    verifierEl.textContent = 'Confirm the paste with a pinch, or press Confirm. The form will not be submitted.';
    say('Pinch to confirm the paste.');
    return true;
  }

  if (intent.type === 'switch-tab') {
    const res = await chromeBridge.request('switchTab', { query: intent.query });
    const msg = res.ok ? `Switched to ${res.data?.title || intent.query}.` : `I could not find a tab named ${intent.query}.`;
    verifierEl.textContent = msg;
    say(msg);
    return res.ok;
  }
  return null;
}

async function runUtteranceInner(utterance: string): Promise<boolean> {
  // Reference grid: "the second one" / "next" / "close" must win over choice
  // chips and music while results are on the canvas.
  if (refBoard.isGridOpen() || refBoard.hasSelection() || refBoard.isChooserOpen() || refsTabOpen) {
    const handled = await refBoard.handleUtterance(utterance);
    if (handled) {
      setBadge('rules', 'exact');
      recordLedger('rules', 'command', 'reference intent', utterance);
      verifierEl.textContent = handled.detail;
      return handled.ok;
    }
  }
  // A reply to open "Did you mean…?" chips (or a confirm preview) is resolved
  // FIRST — before recipes, phrasebook, or routing can eat "first"/"cancel".
  const choiceHandled = handleChoiceReply(utterance);
  if (choiceHandled !== null) return choiceHandled;
  // Her own voice shortcuts (setup) and the setup / rest phrases run locally.
  const boundTarget = bindingForPhrase(setupData, utterance);
  if (boundTarget) return runTarget(boundTarget);
  if (isAddDevicePhrase(utterance)) { void openAddDevice(utterance); return true; }
  if (isSetupPhrase(utterance)) { setupPanel.open(); toggleButton(btnSetup, true); return true; }
  const rp = restPhrase(utterance);
  if (rp) { setResting(rp === 'rest'); return true; }
  // SPOKEN VOICE: "change voice" / "use the Soumya voice" / "preview the
  // voice" run locally — the picker, not the plan parser, owns these.
  const voiceIntent = parseChangeVoice(utterance);
  if (voiceIntent) return runChangeVoice(voiceIntent, utterance);
  setConfidenceState(null); // each command earns its own state

  // Accessibility requests short-circuit BEFORE routing: "make this house
  // wheelchair friendly" would otherwise hit the plan-generate path on "house".
  if (isAccessibilityRequest(utterance)) return runAccessibilityCheck();

  // CAD COPILOT (src/cad): guideline check, staircase, 2D→3D, walkthrough,
  // plan questions, layers/zoom, review (accept/reject/revert), site checklist.
  const copilotHandled = await handleCopilot(utterance);
  if (copilotHandled !== null) return copilotHandled;
  lastUtteranceText = utterance;
  lastUtteranceAt = Date.now();

  // ANY LANGUAGE: find out which language this command is in (on-device
  // first; a cloud check only when it must, and the ledger records it).
  pendingReply = null;
  await detectCommandLanguage(utterance);

  // Show her words immediately; the English translation fills in once the cloud
  // (or on-device) fusion call returns it.
  showCaptionHeard(utterance);

  // RECIPES: "start teaching" / "save this as <name>" / "do <name>" (English
  // and Kannada fixed phrases). Teach/save are local; a recipe run is matched
  // by rules first, then the hybrid Nano pick. Null → not a recipe command.
  const recipeHandled = await handleRecipeMeta(utterance);
  if (recipeHandled !== null) return recipeHandled;

  // PERSONAL PHRASEBOOK: teach ("when I say X, do Y") and correction ("no, I
  // meant …") are handled locally — no model call, nothing leaves the device.
  const metaHandled = await handlePhrasebookMeta(utterance);
  if (metaHandled !== null) return metaHandled;
  // This is a real command: a later correction ("no, I meant …") refers to it.
  lastCommand = utterance;

  // MUSIC: "play / pause / next / play some old Kannada songs" run here, so
  // they never hit the design model. Spotify if connected, else the built-in
  // player. Unrecognised utterances fall through to the hybrid router.
  const musicIntent = parseMusicIntent(utterance);
  if (musicIntent) {
    const result = await musicPanel.apply(musicIntent);
    setBadge('rules', 'exact');
    recordLedger('rules', 'command', 'music intent', utterance);
    verifierEl.textContent = result.detail;
    say(result.detail);
    return result.ok;
  }

  // CHROME EXTENSION: copy this / copy the link / send to canvas / paste here
  // (pinch-confirm) / switch to a tab by name. Local rules; the extension
  // stays on this computer. Null → not a chrome command.
  const chromeHandled = await handleChromeIntent(utterance);
  if (chromeHandled !== null) return chromeHandled;

  // REFERENCES: "find me references for drawings" opens a numbered grid on
  // the canvas (Openverse + Wikimedia). Unrecognised utterances fall through.
  const refHandled = await refBoard.handleUtterance(utterance);
  if (refHandled) {
    setBadge('rules', 'exact');
    recordLedger('rules', 'command', 'reference intent', utterance);
    verifierEl.textContent = refHandled.detail;
    return refHandled.ok;
  }

  // NANO RAMBLE CONDENSER (ai/condense): a long natural ramble is condensed to
  // one short command ON DEVICE (ONLY_ON_DEVICE, ~1.5 s cap) before the
  // copilot and fusion paths — and the cloud payload — see it. The caption and
  // history keep her real words; a miss keeps them everywhere and the route
  // line is unchanged.
  let command = utterance;
  let condensedWords: { from: number; to: number } | undefined;
  if (isEnglish(currentLanguage)
    && shouldCondense(utterance, (u) => !('clarify' in (mode.parse(u) as Record<string, unknown>)))) {
    const c = await condenseUtterance(utterance);
    if (c) {
      command = c.text;
      condensedWords = { from: c.fromWords, to: c.toWords };
      recordLedger('on-device', 'condense', REASON_TEXT.private, '', c.ms);
      showCaptionTranslation(utterance, c.text); // her words + the short command
    }
  }

  // Questions the copilot rules missed: Nano understands on the device; hard
  // ones go to Gemini, or to the site checklist with no signal.
  if (!decisionIsExactEdit(command)) {
    const q = await handleCopilotQuestion(command, { condensed: condensedWords });
    if (q !== null) return q;
  }

  // VISIBLE HYBRID ROUTER (ai/router.ts): exact rules → on-device fusion →
  // cloud escalation. The decision is pure; the badge shows the ACTUAL source
  // plus the reason, and every decision lands in the Routing dev panel.
  const t0 = performance.now();
  const translated = shouldTranslate(currentLanguage); // non-English → translate path
  // SIM: a fake any-language transcript runs as if Nano + cloud were both here,
  // so the judge sees the router pick on-device (es/ja) vs cloud (kn/hi).
  const env = SIM_ACTIVE && simSpeechFor(utterance) ? { deviceReady: true, cloudReady: true } : routerEnv();
  const isBig = controller.isDesignRequest(command);
  const decision = planRoute(command, (u) => mode.parse(u), isBig, env);

  // Whole-design requests go to the cloud "generate" path (rules fallback
  // inside the controller), everything else through the single-op fusion path.
  if (isBig) {
    // Offline + a queueable mode → persist a cloud job for reconnect, then still
    // apply the on-device/rules result now so the edit keeps working.
    const route = bigJobKind() ? routeBigJob(netEnv()) : 'run-now';
    if (route === 'enqueue') await enqueueBigJob(command);
    const { source, step, clarify } = await controller.generate(command);
    const reason = finalReason(decision, source, false);
    // NOT translated: the whole-design generate path has no translate guide and
    // returns no translation, so the badge must stay generic ("Cloud · big job")
    // and never claim "· Kannada" for a call that didn't translate.
    setBadge(source, reason);
    routerPanel.add({ utterance, planned: decision.path, source, reason, escalated: false, ms: performance.now() - t0 });
    recordLedger(source, 'generate', REASON_TEXT[reason], commandPayload(command), performance.now() - t0);
    // Keep the op/JSON panel fresh — reflect this command, not the previous op.
    opJsonEl.textContent = JSON.stringify({ generate: command, source }, null, 2);
    if (clarify) {
      opJsonEl.textContent = '';
      verifierEl.textContent = clarify;
      say(clarify);
      return false;
    }
    if (!step.ok) {
      verifierEl.textContent = `Could not build: ${step.error ?? 'unknown error'}`;
      say(localize('couldNotBuild', DEFAULT_LANGUAGE));
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
  let simulated = false;
  let deixisAmbiguous = false;
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
    // Pointing language with several candidates and nothing under the cursor
    // is ambiguous deixis — the confidence classifier raises the bar for it.
    deixisAmbiguous = isPointing(utterance) && !ctx.hoverId && ctx.nearby.length > 1;
    // Non-English (or a language Nano can't run) goes to the cloud, which
    // TRANSLATES and emits the same typed op in one Firebase AI Logic call.
    const toCloud = translateInCloud(currentLanguage, { ...env, deviceLangReady });
    const langOpt = translated ? currentLanguage : undefined;
    // PERSONAL PHRASEBOOK few-shot: the user's learned mappings for this command.
    // Attached to the on-device Nano call only (it stays on the device). It is
    // withheld from a first cloud call (no-device / translate) and only sent to
    // the cloud on the escalation below, where the router already went cloud.
    const fewShot = phrasebook.fewShotFor(command, mode.id);
    // SIM: a fake any-language transcript gets a faked model answer (labelled
    // SIM); everything around it — detection, routing, badge, ledger — is real.
    const simOutcome = SIM_ACTIVE ? simFuse(utterance, toCloud) : null;
    let outcome = simOutcome ?? await fuseIntent(command, ctx, {
      forceCloud: toCloud, lang: langOpt,
      fewShot: toCloud ? undefined : fewShot,
      planNames: planLabelNames(),
    });
    // Primary inference: a cloud answer stores its payload; on-device/rules are
    // private. The reason follows the planned route (on-device → private).
    const langNoteNow = langRouteNote(currentLanguage, { ...env, deviceLangReady }, outcome.source, false);
    recordLedger(
      outcome.source, simOutcome ? 'intent (simulated)' : 'intent',
      outcome.source === 'cloud' ? (langNoteNow ?? REASON_TEXT[decision.reason]) : REASON_TEXT.private,
      commandPayload(command, ctx), outcome.ms,
    );
    if (!simOutcome && shouldEscalate(outcome.source, outcome.confidence, env)) {
      // Unsure on-device answer: re-ask the cloud twin, keep the better one. The
      // retry physically contacts the cloud, so its send is recorded even if the
      // on-device answer is ultimately kept.
      // Sanctioned escalation: the router already went to the cloud, so the few
      // relevant phrasebook examples may ride along (and only those).
      const retry = await fuseIntent(command, ctx, {
        forceCloud: true, lang: langOpt, fewShot, examplesCloudOk: true,
        planNames: planLabelNames(),
      });
      const escalatedPayload = fewShot
        ? `${commandPayload(command, ctx)}\nphrasebook examples: ${phrasebook.select(command, mode.id).length}`
        : commandPayload(command, ctx);
      recordLedger(retry.source, 'intent (escalated)', REASON_TEXT['low-confidence'], escalatedPayload, retry.ms);
      ({ outcome, escalated } = pickEscalated(outcome, retry));
    }
    result = outcome.result;
    source = outcome.source;
    confidence = outcome.confidence;
    translation = outcome.translation;
    if (translated) pendingReply = outcome.reply ?? null;
    simulated = !!simOutcome;
  }
  // Pair her words with the English translation the model returned (or the
  // condensed command when the on-device condenser produced one).
  showCaptionTranslation(utterance, translation ?? (condensedWords ? command : undefined));
  const reason = finalReason(decision, source, escalated);
  const langNote = langRouteNote(currentLanguage, { ...env, deviceLangReady }, source, escalated);
  const note = langNote && simulated ? `SIM · ${langNote}` : langNote;
  setBadge(source, reason, translated, note);
  routerPanel.add({ utterance, planned: decision.path, source, reason, confidence, escalated, ms: performance.now() - t0, note: note ?? undefined });
  // Mirror the routed event to the /control dashboard feed. Only a cloud event
  // carries its utterance (it already left the device); private events are
  // source+reason only — the raw command text stays on the laptop.
  noteControlAi({ source, reason, utterance, ms: performance.now() - t0 });

  // CONFIDENCE STATE (ai/confidence.ts): sure applies; unsure shows "Did you
  // mean…?" chips and applies NOTHING until one is picked; unknown explains
  // itself and suggests commands. The exact-rule path is deterministic → sure.
  // ruleAgrees = does an independent deterministic parse produce the same op?
  const isClarifyResult = 'clarify' in result;
  const altRule = decision.ruleResult ? null : exactRuleParse((u) => mode.parse(u), command);
  const ruleAgrees = altRule ? JSON.stringify(altRule) === JSON.stringify(result) : null;
  const state = classifyConfidence({
    valid: !isClarifyResult, clarify: isClarifyResult, source, confidence, ruleAgrees, deixisAmbiguous,
  });
  setConfidenceState(state);

  if (state === 'unknown') {
    opJsonEl.textContent = '';
    const q = isClarifyResult ? (result as { clarify: string }).clarify : 'I did not understand that.';
    const tips = suggestCommands(mode.id).map((s) => `“${s}”`).join(', ');
    verifierEl.textContent = `${q} Try: ${tips}.`;
    say(q);
    return false;
  }

  const op = result as Record<string, unknown>;
  const cancelNote = () => {
    verifierEl.textContent = 'Cancelled — nothing was applied.';
  };

  if (state === 'unsure') {
    const choices = buildChoices([
      { label: describeOp(op), result: op, source },
      altRule
        ? { label: describeOp(altRule as Record<string, unknown>), result: altRule as Record<string, unknown>, source: 'rules' }
        : null,
    ]);
    opJsonEl.textContent = JSON.stringify({ didYouMean: choices.map((c) => c.result) }, null, 2);
    const prompt = choicePrompt('en', choices.length);
    verifierEl.textContent = `Not sure (${Math.round((confidence ?? 0) * 100)}% from ${source}) — nothing applied yet. ${prompt}`;
    say(prompt);
    presentChoices('Did you mean…?', choices, (c) => {
      // The pick IS the confirm; the badge stays honest about who proposed
      // the chosen interpretation.
      setBadge(c.source, c.source === 'rules' ? 'exact' : reason, translated);
      setConfidenceState('sure');
      void applyCommandResult(c.result, before);
    }, cancelNote);
    return false;
  }

  // Sure but destructive (delete many / clear / overwrite): preview + explicit
  // Apply / Cancel — never auto-applied.
  if (isDestructiveOp(op, fusionContext().selectedIds.length)) {
    opJsonEl.textContent = JSON.stringify({ preview: op }, null, 2);
    const prompt = choicePrompt('en', 1);
    verifierEl.textContent = `Destructive step: ${describeOp(op)} — not applied yet. ${prompt}`;
    say(prompt);
    presentChoices(`Destructive: ${describeOp(op)} — apply?`, [{ label: describeOp(op), result: op, source }], (c) => {
      void applyCommandResult(c.result, before);
    }, cancelNote);
    return false;
  }

  return applyCommandResult(result, before);
}

/** SIM only: the faked Gemini answer for a fake any-language transcript —
 *  the English command it maps to, run through the real rule parser. Nano
 *  "answers" for languages it accepts (es/ja) unless the router chose cloud. */
function simFuse(utterance: string, toCloud: boolean): FusionOutcome | null {
  const sim = simSpeechFor(utterance);
  if (!sim) return null;
  const result = mode.parse(sim.english);
  return {
    result,
    confidence: 0.9,
    source: sim.nano && !toCloud ? 'on-device' : 'cloud',
    ms: sim.nano && !toCloud ? 180 : 620,
    translation: sim.english,
    reply: sim.reply,
  };
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

el<HTMLButtonElement>('btn-zoom-in').addEventListener('click', () => {
  viewportEl.focus();
  viewportEl.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true }));
});
el<HTMLButtonElement>('btn-zoom-out').addEventListener('click', () => {
  viewportEl.focus();
  viewportEl.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
});
el<HTMLButtonElement>('btn-zoom-fit').addEventListener('click', () => {
  viewport.fit?.();
});
btnUndo.addEventListener('click', () => {
  controller.applyOp({ op: 'undo' });
  renderAll();
});
btnRedo.addEventListener('click', () => {
  controller.applyOp({ op: 'redo' });
  renderAll();
});
btnExport.addEventListener('click', async () => {
  controller.export();
  say(`${mode.exportLabel}.`);
});

if (viewport.toggle3D) {
  btn3d.hidden = false;
  btn3d.addEventListener('click', () => {
    const on = btn3d.getAttribute('aria-pressed') !== 'true';
    const now = viewport.toggle3D!(on);
    btn3d.setAttribute('aria-pressed', String(now));
    btn3d.classList.toggle('active', now);
    btn3d.textContent = now ? '2D view' : '3D view';
    say(now ? localize('view3d', DEFAULT_LANGUAGE) : localize('view2d', DEFAULT_LANGUAGE));
  });
}

// One-row toolbar: overflow tools live under More. Relayout when 3D appears.
const overflowMenu: OverflowMenu = createOverflowMenu({
  topbar: el<HTMLElement>('topbar'),
  wrap: el<HTMLElement>('more-wrap'),
});
overflowMenu.layout();

// ---- voice ----

const specChangeByDraft = new Map<string, string>();
function showSpeculativeDraft(d: SpeculativeDraft, stats: SpeculativeStats, opts?: { speak?: boolean }): void {
  copilotPanel.open('review');
  toggleButton(btnCopilot, true);
  copilotPanel.setSpeculativeStats(stats);
  document.body.dataset.specState = d.state;
  document.body.dataset.specVisibleMs = String(d.visibleAt);
  if (d.answer) {
    const by = d.state === 'confirmed' ? "Gemini confirmed Nano's guess"
      : d.state === 'corrected' || d.state === 'withdrawn' ? (d.geminiModel ? `Gemini · ${d.geminiModel}` : 'Gemini · cloud')
      : "Nano's guess · on device";
    const route = d.fromNano
      ? routeSpeculative({
          state: d.state === 'confirmed' || d.state === 'corrected' || d.state === 'withdrawn' || d.state === 'draft' ? d.state : 'draft',
          because: d.why,
        })
      : routeGemini({ kind: isPlanJudgementQuestion(d.utterance) ? 'judgment' : 'hard', model: d.geminiModel, why: d.why });
    const shown = revealAnswer(d.answer, route);
    const shownRoute = shown.route ?? route;
    publishRoute(shownRoute);
    copilotPanel.setAnswer({
      question: d.utterance,
      text: shown.text,
      by: d.fromNano ? by : (d.geminiModel ? `Gemini · ${d.geminiModel}` : 'Gemini · cloud'),
      guess: Boolean(d.fromNano && d.state === 'draft'),
      confirmed: Boolean(d.fromNano && d.state === 'confirmed'),
      route: shownRoute,
    });
    verifierEl.textContent = d.state === 'draft' ? `Nano's guess: ${shown.text}` : shown.text;
    if (opts?.speak && d.state !== 'draft') say(shown.text);
  }
  if (d.tool && d.state !== 'withdrawn') {
    const call: ToolCall = { tool: d.tool, args: d.args ?? {} };
    const act = toolToAction(call);
    if (act.kind === 'op') {
      const existingId = specChangeByDraft.get(d.id);
      const specRoute = d.fromNano
        ? routeSpeculative({
            state: d.state === 'confirmed' || d.state === 'corrected' || d.state === 'draft' ? d.state : 'draft',
            because: d.why,
          })
        : routeGemini({ kind: isPlanJudgementQuestion(d.utterance) ? 'judgment' : 'hard', model: d.geminiModel, why: d.why });
      if (d.state === 'corrected' && existingId) {
        changeLog.amend(existingId, { tag: 'corrected', why: d.why ?? 'Gemini corrected Nano’s guess.', route: specRoute });
        changeLog.reject(existingId);
        specChangeByDraft.delete(d.id);
        const e = proposeChange({
          actor: 'gemini', tool: d.tool, title: describeCall(call),
          why: d.why ?? 'Gemini corrected Nano’s guess.',
          op: act.op, source: 'cloud', tag: 'corrected', route: specRoute,
        });
        specChangeByDraft.set(d.id, e.id);
      } else if (!existingId) {
        const e = proposeChange({
          actor: d.state === 'corrected' ? 'gemini' : 'nano',
          tool: d.tool, title: describeCall(call),
          why: d.why ?? "Nano's guess while you were still speaking.",
          op: act.op,
          source: d.state === 'corrected' ? 'cloud' : 'on-device',
          tag: d.state === 'confirmed' ? 'confirmed' : d.state === 'corrected' ? 'corrected' : 'nano-guess',
          route: specRoute,
        });
        specChangeByDraft.set(d.id, e.id);
      } else if (d.state === 'confirmed') {
        changeLog.amend(existingId, { tag: 'confirmed', why: d.why ?? "Gemini confirmed Nano's guess.", route: specRoute });
      }
    }
  }
  if (d.state === 'withdrawn') {
    const id = specChangeByDraft.get(d.id);
    if (id) {
      changeLog.amend(id, { tag: 'withdrawn', why: d.why ?? "Withdrawn: Gemini disagreed with Nano's guess.", route: routeSpeculative({ state: 'withdrawn', because: d.why }) });
      changeLog.reject(id);
      specChangeByDraft.delete(d.id);
    }
  }
}

speculative = createSpeculativeEngine({
  online: () => isOnline() && cloudConfigured,
  isSimplePlan: isSimplePlanQuestion,
  isJudgement: isPlanJudgementQuestion,
  isHard: isHardQuestion,
  answerPlan: (s) => answerPlanQuestion(planDoc(), s),
  pickNano: async (s) => {
    if (!routerEnv().deviceReady) return null;
    const picked = await pickCadTool(s, controller.summary(), { allowCloud: false, timeoutMs: NANO_ROUTE_TIMEOUT_MS });
    if (!picked) return null;
    const plan = picked.call.tool === 'measure' ? answerPlanQuestion(planDoc(), String(picked.call.args.question ?? s)) : null;
    return { call: picked.call, confidence: picked.confidence, answer: plan?.text };
  },
  askCloud: async (s) => {
    // Same rules-first redaction as the hard-question race: the SENT text
    // swaps her names for neutral tokens; the draft card keeps her words.
    const res = await askCopilot(protectText(s, planLabelNames()).text, controller.summary(), GUIDELINE_SETS[guidelineRegion].label, undefined, planLabelNames());
    return res ? { answer: res.answer, calls: res.calls, why: res.why, model: res.model } : null;
  },
  onUpdate: (d, stats) => {
    copilotPanel.setSpeculativeStats(stats);
    if (d) showSpeculativeDraft(d, stats);
  },
});

const voice: VoiceController = createVoiceController(
  (utterance) => void runUtterance(utterance),
  (interim) => speculative.onInterim(interim),
);

const onSpeculativeEvent = (ev: Event): void => {
  const d = (ev as CustomEvent<{ kind?: string; text?: string }>).detail;
  if (!d || typeof d.text !== 'string') return;
  if (d.kind === 'interim') speculative.onInterim(d.text);
  if (d.kind === 'final') void speculative.onFinal(d.text);
};
window.addEventListener('mc-speculative', onSpeculativeEvent);
document.addEventListener('mc-speculative', onSpeculativeEvent);

if (!voice.supported) {
  btnMic.disabled = true;
  fail('fail-mic', 'Voice recognition is not supported in this browser — use the text command box instead.');
}

// ---- language picker wiring (after `voice`, which applyLanguage drives) ----

langSelect.value = langPick;
langSelect.addEventListener('change', () => {
  applyLanguage(langSelect.value, true);
});

// Mute toggle for spoken replies (next to the language picker).
const btnMute = el<HTMLButtonElement>('btn-mute');
function renderMute(): void {
  btnMute.setAttribute('aria-pressed', String(muted));
  btnMute.setAttribute('aria-label', muted ? 'Muted' : 'Voice');
  btnMute.classList.toggle('active', muted);
  btnMute.innerHTML = muted
    ? '🔇 <span class="btn-label">Muted</span>'
    : '🔊 <span class="btn-label">Voice</span>';
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
overflowMenu.layout();
// Apply the restored picker once at startup: set recognition lang + probe Nano.
voice.setLang(currentLanguage.speechLang);
void nanoCanRun(currentLanguage).then((ready) => { deviceLangReady = ready; });

btnMic.addEventListener('click', () => {
  const nowOn = btnMic.getAttribute('aria-pressed') !== 'true';
  btnMic.setAttribute('aria-pressed', String(nowOn));
  btnMic.classList.toggle('active', nowOn);
  btnMic.textContent = nowOn ? 'Mic on' : 'Mic';
  refreshHints();
  voice.setAlwaysOn(nowOn);
  say(nowOn ? localize('listening', DEFAULT_LANGUAGE) : localize('micOff', DEFAULT_LANGUAGE));
});

// ---- hand tracking ----

const handOverlay = createHandOverlay(viewportEl);
const faceOverlay = createFaceOverlay(viewportEl);
const handCursor = document.createElement('div');
handCursor.className = 'hand-cursor';
handCursor.hidden = true;
viewportEl.appendChild(handCursor);
const handHover = createHandHover();
/** How strongly the visual cursor eases toward a hovered control's centre
 *  (0 = none, 1 = snaps straight there); the real aim point used for hit
 *  testing is never touched, only where the cursor is drawn. */
const MAGNET_PULL = 0.35;

function placeCursor(x: number, y: number): void {
  const rect = viewportEl.getBoundingClientRect();
  const size = handCursor.offsetWidth || 22;
  const half = size / 2;
  const left = Math.min(Math.max(x * rect.width, half), Math.max(half, rect.width - half));
  const top = Math.min(Math.max(y * rect.height, half), Math.max(half, rect.height - half));
  handCursor.hidden = false;
  handCursor.style.left = `${left}px`;
  handCursor.style.top = `${top}px`;
}

function placeCursorClient(clientX: number, clientY: number): void {
  const rect = viewportEl.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  placeCursor((clientX - rect.left) / w, (clientY - rect.top) / h);
}

function toClient(x: number, y: number): { clientX: number; clientY: number } {
  const rect = viewportEl.getBoundingClientRect();
  return { clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height };
}

/** Magnet radius in CSS px, scaled by the active interaction profile. */
function aimRadiusPx(): number {
  return DEFAULT_AIM_RADIUS_PX * (activeProfile.targetScale ?? 1) * (activeProfile.snapRadiusScale ?? 1);
}

function aimPointer(clientX: number, clientY: number): { clientX: number; clientY: number; id: string | null } {
  if (viewport.aim) return viewport.aim(clientX, clientY, aimRadiusPx());
  const id = viewport.pick(clientX, clientY);
  return { clientX, clientY, id };
}

// Pointer smoothing for the AIMING phase only: a One-Euro filter steadies a
// shaky hover/cursor (cutoff rises with speed so a reach is not laggy), while
// commit actions (tap, drag) stay on raw coordinates. Reset on pinch or lost.
function smoothAim(x: number, y: number, now = performance.now()): { x: number; y: number } {
  const keep = setupData.calibration?.smoothing ?? activeProfile.smoothing;
  cursorFilter.setSmoothing(keep);
  return cursorFilter.filter(x, y, now);
}

// Mouse/touch pointers feed point-and-say too (same pointer layer as pinch);
// a mouse has no camera mapping, so those commands send no image at all.
viewportEl.addEventListener('pointermove', (e: PointerEvent) => {
  lastPointer = { clientX: e.clientX, clientY: e.clientY, cameraNorm: null };
}, { passive: true });

function driveRefsHand(e: HandEvent): boolean {
  if (!refsTabOpen) return false;
  if (e.type === 'tracking') {
    const now = performance.now();
    if (now - lastRefsCursorAt > 120) {
      lastRefsCursorAt = now;
      void chromeBridge.request('refsCommand', { cmd: 'cursor', cursor: { x: e.x, y: e.y } });
    }
    return false;
  }
  if (e.type === 'pinch-tap' || e.type === 'pinch-start') {
    void (async () => {
      const res = await chromeBridge.request('refsCommand', { cmd: 'pick' });
      const hit = res.data?.kind === 'image' ? hitFromExtImage(res.data, lastRefsEngine, lastRefsQuery) : null;
      if (hit) {
        refBoard.placeExternal(hit);
        say(`Placed “${hit.title}” on the canvas.`);
      }
    })();
    return true;
  }
  return false;
}

function handleHandEvent(raw: HandEvent): void {
  // Calibrated reach: her comfortable box covers the whole screen.
  let e = raw;
  if ('x' in raw && 'y' in raw) {
    const p = reachPoint(raw.x, raw.y);
    e = { ...raw, x: p.x, y: p.y } as HandEvent;
    lastHand = { x: raw.x, y: raw.y };
  }
  if (resting && e.type !== 'tracking' && e.type !== 'lost') return;
  switch (e.type) {
    case 'tracking': {
      const s = smoothAim(e.x, e.y, performance.now());
      const raw = toClient(s.x, s.y);
      const aimed = aimPointer(raw.clientX, raw.clientY);
      // The real DOM control under the aim point (if any) gets its own
      // outline+scale highlight instead of a ring on the cursor — no second,
      // redundant dot sitting on top of the thing it's pointing at.
      const ctl = !resting ? handClickable(aimed.clientX, aimed.clientY) : null;
      handHover.setTarget(ctl);
      const snapped = !!ctl || !!aimed.id;
      // Visual-only magnetic pull toward the hovered control's centre; the
      // aim point used for hit-testing below stays exact.
      const drawAt = ctl
        ? magnetPull({ x: aimed.clientX, y: aimed.clientY }, ctl.getBoundingClientRect(), MAGNET_PULL)
        : { x: aimed.clientX, y: aimed.clientY };
      placeCursorClient(drawAt.x, drawAt.y);
      handCursor.classList.toggle('snapped', snapped);
      // Hand coords are mirrored to screen space (x = 1 - camera x); store the
      // camera-frame position so point-and-say can crop the frame there.
      lastPointer = { clientX: aimed.clientX, clientY: aimed.clientY, cameraNorm: { x: 1 - s.x, y: s.y } };
      driveRefsHand(e);
      refBoard.handleHand(e, { x: aimed.clientX, y: aimed.clientY });
      // When the on-screen keyboard is up, an open hand over it dwells on keys.
      if (keyboard.isOpen() && keyboard.hoverAt(aimed.clientX, aimed.clientY)) break;
      // Dwell is a first-class click, equal to pinch and voice (a pinch can
      // hurt). Hover a button or a canvas object and wait for the ring to fill.
      if (!resting) {
        const now = performance.now();
        const target: unknown = ctl ?? aimed.id ?? null;
        const d = dwell.update(target, now);
        handCursor.style.setProperty('--dwell', String(d.progress));
        handCursor.classList.toggle('dwelling', d.progress > 0);
        if (d.fire) {
          handCursor.classList.remove('dwelling');
          if (!clickCooldown.ready(now)) {
            dwell.reset();
          } else {
            clickCooldown.arm(now);
            if (ctl) activateControl(ctl);
            else if (aimed.id) {
              if (!viewport.tap?.(aimed.clientX, aimed.clientY)) controller.selectId(aimed.id);
              renderAll();
            }
          }
        }
      }
      viewport.hover?.(aimed.clientX, aimed.clientY);
      break;
    }
    case 'pinch-start': {
      cursorFilter.reset(); // commit on raw coordinates
      const raw = toClient(e.x, e.y);
      const aimed = aimPointer(raw.clientX, raw.clientY);
      placeCursorClient(aimed.clientX, aimed.clientY);
      handCursor.classList.add('pinching');
      handCursor.classList.toggle('snapped', !!aimed.id);
      lastPointer = { clientX: aimed.clientX, clientY: aimed.clientY, cameraNorm: { x: 1 - e.x, y: e.y } };
      if (driveRefsHand(e) || refBoard.handleHand(e, { x: aimed.clientX, y: aimed.clientY })) break;
      viewport.beginDrag?.(aimed.clientX, aimed.clientY);
      break;
    }
    case 'pinch-tap': {
      const now = performance.now();
      const raw = toClient(e.x, e.y);
      const aimed = aimPointer(raw.clientX, raw.clientY);
      placeCursorClient(aimed.clientX, aimed.clientY);
      onboarding.notifyPinch();
      lastPointer = { clientX: aimed.clientX, clientY: aimed.clientY, cameraNorm: { x: 1 - e.x, y: e.y } };
      if (!clickCooldown.ready(now)) break;
      const consumed = (): void => { clickCooldown.arm(now); };
      if (driveRefsHand(e) || refBoard.handleHand(e, { x: aimed.clientX, y: aimed.clientY })) { consumed(); break; }
      // A pinch over the on-screen keyboard presses the key under the cursor.
      if (keyboard.isOpen() && keyboard.pressAt(aimed.clientX, aimed.clientY)) { consumed(); break; }
      // Every button is pinchable: toolbar, More menu, panels, setup, chips.
      const ctl = handClickable(aimed.clientX, aimed.clientY);
      if (ctl) { activateControl(ctl); consumed(); break; }
      if (viewport.tap?.(aimed.clientX, aimed.clientY)) {
        renderAll(); // a palette/tool consumed the tap
        consumed();
        break;
      }
      const id = aimed.id ?? viewport.pick(aimed.clientX, aimed.clientY);
      if (id) {
        controller.selectId(id);
        renderAll();
        consumed();
      }
      break;
    }
    case 'pinch-move': {
      // Follow the hand during a drag — don't remagnet mid-gesture.
      placeCursor(e.x, e.y);
      const { clientX, clientY } = toClient(e.x, e.y);
      if (refBoard.handleHand(e, { x: clientX, y: clientY })) break;
      if (viewport.drag?.(clientX, clientY)) break; // world-space drag with snap (plan)
      if (controller.selectedId()) {
        const step = controller.dragSelectedMm(e.dx * controller.dragRangeMm, -e.dy * controller.dragRangeMm);
        if (step?.ok) renderAll();
      }
      break;
    }
    case 'pinch-end':
      handCursor.classList.remove('pinching');
      if (lastPointer && refBoard.handleHand(e, { x: lastPointer.clientX, y: lastPointer.clientY })) break;
      viewport.endDrag?.();
      break;
    case 'lost':
      cursorFilter.reset();
      handCursor.hidden = true;
      handHover.setTarget(null);
      keyboard.cancelDwell(); // a pending hover-dwell must not fire after the hand is gone
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
    setTracking('paused · look at screen');
  } else {
    const quality = handCount > 0 && fps >= 12 ? 'good' : handCount > 0 ? 'poor' : 'searching';
    const plural = handCount === 1 ? 'hand' : 'hands';
    setTracking(`${handCount} ${plural} · ${fps} fps · ${quality}`);
  }
  const primary = f.hands[0];
  updatePinchMeter(primary ? primary.pinchStrength : 0, primary?.pinching ?? false, !f.paused && !!primary);

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
  gimbalFollow.onFrame(f.hands, performance.now());
}

function updatePinchMeter(strength: number, pinching: boolean, visible: boolean): void {
  const pct = visible ? Math.round(Math.max(0, Math.min(1, strength)) * 100) : 0;
  pinchMeterFill.style.width = `${pct}%`;
  pinchMeterEl.setAttribute('aria-valuenow', String(pct));
  pinchMeterEl.classList.toggle('armed', visible && !pinching && strength >= 0.6);
  pinchMeterEl.classList.toggle('pinching', visible && pinching);
  pinchMeterLabel.textContent = !visible ? '—' : pinching ? 'pinching' : `${pct}%`;
}

function resetPresenceStatus(): void {
  fpsStamps = [];
  facingStateEl.textContent = '—';
  operatorStateEl.textContent = '—';
  setTracking('camera off');
  updatePinchMeter(0, false, false);
}

function setCameraBusy(busy: boolean): void {
  btnCamera.setAttribute('aria-busy', String(busy));
  if (busy) {
    btnCamera.textContent = 'Starting camera…';
    btnCamera.disabled = true;
    setTracking('starting camera…');
  } else {
    btnCamera.disabled = false;
  }
}

async function enableCamera(): Promise<boolean> {
  if (tracker) return true;
  const live = findLiveCameraStream();
  if (!live && !navigator.mediaDevices?.getUserMedia) {
    fail('fail-camera-unsupported', 'This browser cannot access a camera — pinch gestures are unavailable. Voice and text still work.');
    return false;
  }
  setCameraBusy(true);
  let t: PresenceTracker | null = null;
  try {
    t = createPresenceTracker(handleHandEvent, onPresenceFrame);
    t.onPauseChange((paused) => {
      resumeHint.hidden = !paused;
      if (paused) {
        handCursor.classList.remove('pinching');
        say('Look at the screen to resume.');
      } else {
        say('Resumed.');
      }
    });
    await t.start(live ?? undefined);
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
    applyActiveProfile(lastAdaptation);
    if (!setupData.completed && !SIM_ACTIVE && !setupPanel.isOpen()) {
      setupPanel.open();
      toggleButton(btnSetup, true);
      return true;
    }
    say('Camera on. Pinch to select or drag. Press "Register me" to lock onto your face.');
    return true;
  } catch {
    t?.stop();
    tracker = null;
    setCameraBusy(false);
    btnCamera.setAttribute('aria-pressed', 'false');
    btnCamera.classList.remove('active');
    btnCamera.textContent = 'Camera';
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
  btnCamera.textContent = 'Camera';
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

void disableSystemTracking();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void disableSystemTracking();
});
window.addEventListener('focus', () => { void disableSystemTracking(); });

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
  const cloud = st.appCheck === 'ready' ? 'Deep available' : st.appCheck === 'failed' ? 'Deep off' : 'Quick only';
  const nanoOn = st.deviceModel === 'ready';
  modelStateEl.textContent = nanoOn
    ? QUICK_READY
    : st.deviceModel === 'downloading'
      ? (quickDownloadPercent != null ? `${GETTING_QUICK_READY} ${quickDownloadPercent}%` : GETTING_QUICK_READY)
      : `${DEVICE_STATE_TEXT[st.deviceModel]}${cloud === 'Deep available' ? '' : ` · ${cloud}`}`;
  modelStateEl.title = st.lastError || `${DEVICE_STATE_TEXT[st.deviceModel]}. ${cloud}.`;
  refreshStudioStatus();
}

btnAi.addEventListener('click', async () => {
  btnAi.disabled = true;
  btnAi.textContent = GETTING_QUICK_READY + '…';
  progressWrap.hidden = false;
  progressFill.style.width = '0%';
  progressBar.setAttribute('aria-valuenow', '0');
  progressLabel.textContent = 'starting…';
  clearFail('fail-ai');
  let sawProgress = false;
  const ok = await initDeviceModel((p) => {
    sawProgress = true;
    const pct = Math.round(p * 100);
    quickDownloadPercent = pct;
    progressFill.style.width = `${pct}%`;
    progressBar.setAttribute('aria-valuenow', String(pct));
    progressLabel.textContent = `${pct}%`;
    renderAiStatus();
  });
  progressWrap.hidden = true;
  const status = getHybridStatus();
  renderDeviceButton(status.deviceModel);
  renderAiStatus();
  if (ok) {
    announceStatus(QUICK_READY + '.');
    say(sawProgress ? 'Quick is ready on this device.' : 'Quick is ready.');
    void warmupQuick();
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
  if (getHybridStatus().deviceModel === 'ready') void warmOnDevice();
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
    const pick = resolvePick(step.lang);
    langSelect.value = pick;
    applyLanguage(pick, true);
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
      if (fixables.length) {
        applyAllA11yFixes(fixables); // stages the confirm preview…
        acceptPendingChoice(); // …and the judge's "Apply" tap confirms it
      } else say('No automatic accessibility fixes to accept.');
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
  const startDemo = () => {
    if (!btnDemo || btnDemo.disabled) return;
    btnDemo.disabled = true;
    const playback = createSimPlayback();
    const controls = mountSimControls(playback);
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
      playback,
    ).finally(() => {
      controls.remove();
      btnDemo.disabled = false;
      if (!playback.isAborted()) showTryItYourself();
    });
  };
  btnDemo?.addEventListener('click', startDemo);
  // Judges' page deep-links (/?sim=1&play=1) auto-start the walk after mount.
  if (new URLSearchParams(window.location.search).get('play') === '1') {
    setTimeout(startDemo, 600);
  }
}

/** Floating Pause / Next / Skip bar shown while a sim walk plays. Pinch-operable
 *  (real buttons, ≥44px) and keyboard-operable like any toolbar button. */
function mountSimControls(playback: ReturnType<typeof createSimPlayback>): { remove: () => void } {
  const bar = document.createElement('div');
  bar.className = 'sim-controls';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Demo playback controls');
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.textContent = 'Pause';
  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'Next';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.textContent = 'Skip';
  bar.append(pause, next, skip);
  document.body.appendChild(bar);
  pause.addEventListener('click', () => {
    const paused = playback.toggle();
    pause.textContent = paused ? 'Resume' : 'Pause';
  });
  next.addEventListener('click', () => playback.requestNext());
  skip.addEventListener('click', () => playback.skip());
  return { remove: () => bar.remove() };
}

/** After a walk ends, invite the judge into the live app with three real
 *  commands to try. Non-blocking toast-style card; Esc or a button dismisses. */
function showTryItYourself(): void {
  const existing = document.getElementById('try-yourself');
  if (existing) existing.remove();
  const card = document.createElement('div');
  card.id = 'try-yourself';
  card.className = 'try-yourself';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Try it yourself');
  const hints = mode.hints.slice(0, 3).map((h) => h.command);
  card.innerHTML = `
    <h2>Now try it yourself</h2>
    <p>Say or type one of these:</p>
    <ul>${hints.map((h) => `<li>“${h}”</li>`).join('')}</ul>
    <div class="try-actions">
      <a class="primary" href="/studio">Exit the demo → live app</a>
      <button type="button" class="ghost" id="try-close">Keep exploring here</button>
    </div>`;
  document.body.appendChild(card);
  const close = () => card.remove();
  card.querySelector<HTMLButtonElement>('#try-close')?.addEventListener('click', close);
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  card.querySelector<HTMLAnchorElement>('a')?.focus();
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
const tour = createTour();
// "Help / tour" (and the first-load prompt) open the judges' chooser, which
// leads to either the guided tour, the camera setup, or the /judges page.
btnHelp.addEventListener('click', () => tour.openWelcome());

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

// ---- judges' guided tour over the REAL app ----
//
// A welcome chooser (tour / camera / judges page), then steps that spotlight
// actual controls in the running editor, then a chooser of the three walks.
// Steps whose element is absent in the current mode are skipped (resolveTourSteps).
function createTour() {
  const overlay = el<HTMLDivElement>('tour');
  let phase: 'welcome' | 'steps' | 'end' | null = null;
  let steps: TourStepDef[] = [];
  let index = 0;
  let restoreFocus: HTMLElement | null = null;

  function close(remember = true): void {
    if (remember) markTourDismissed(localStorage);
    phase = null;
    overflowMenu.close();
    overlay.hidden = true;
    overlay.innerHTML = '';
    window.removeEventListener('resize', reposition);
    restoreFocus?.focus();
  }

  function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = 'tour-btn' + (variant ? ` ${variant}` : '');
    b.addEventListener('click', onClick);
    return b;
  }

  // --- welcome chooser ---
  function renderWelcome(): void {
    overlay.innerHTML = '';
    overlay.classList.remove('tour-spotlighting');
    const card = document.createElement('div');
    card.className = 'tour-card tour-centered';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Welcome to Mendcraft');
    const h = document.createElement('h2');
    h.tabIndex = -1;
    h.textContent = 'Welcome to Mendcraft';
    const p = document.createElement('p');
    p.textContent =
      'This is your floor-plan studio. Take a short tour of the controls, set up the camera for pinch and voice, or start drawing. ' +
      'Judges can also open the 30-second path.';
    const actions = document.createElement('div');
    actions.className = 'tour-actions';
    actions.append(
      button('Take the tour', () => startSteps(), 'primary'),
      button('Set up the camera', () => { close(); onboarding.open(0); }, 'ghost'),
      button('Judges’ page →', () => { close(); window.location.href = '/judges'; }, 'ghost'),
      button('Not now', () => close(), 'ghost skip-tour'),
    );
    card.append(h, p, actions);
    overlay.appendChild(card);
    h.focus();
  }

  // --- spotlight steps ---
  function startSteps(): void {
    steps = resolveTourSteps(TOUR_STEPS, (sel) => document.querySelector(sel) != null);
    index = 0;
    phase = 'steps';
    if (steps.length === 0) { renderEnd(); return; }
    window.addEventListener('resize', reposition);
    renderStep();
  }

  let spotlightEl: HTMLDivElement | null = null;
  let calloutEl: HTMLDivElement | null = null;

  function reposition(): void {
    if (phase !== 'steps' || !spotlightEl || !calloutEl) return;
    const target = document.querySelector(steps[index].selector) as HTMLElement | null;
    if (!target) return;
    overflowMenu.reveal(target);
    const r = target.getBoundingClientRect();
    spotlightEl.style.left = `${r.left - 8}px`;
    spotlightEl.style.top = `${r.top - 8}px`;
    spotlightEl.style.width = `${r.width + 16}px`;
    spotlightEl.style.height = `${r.height + 16}px`;
    const cardW = Math.min(360, window.innerWidth - 24);
    let left = r.left + r.width / 2 - cardW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12));
    let top = r.bottom + 14;
    if (top + 200 > window.innerHeight) top = Math.max(12, r.top - 214);
    calloutEl.style.left = `${left}px`;
    calloutEl.style.top = `${top}px`;
    calloutEl.style.width = `${cardW}px`;
  }

  function renderStep(): void {
    overlay.innerHTML = '';
    overlay.classList.add('tour-spotlighting');
    const step = steps[index];
    const target = document.querySelector(step.selector) as HTMLElement | null;
    overflowMenu.reveal(target);
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    spotlightEl = document.createElement('div');
    spotlightEl.className = 'tour-spotlight';
    overlay.appendChild(spotlightEl);

    calloutEl = document.createElement('div');
    calloutEl.className = 'tour-card tour-callout';
    calloutEl.setAttribute('role', 'dialog');
    calloutEl.setAttribute('aria-modal', 'true');
    calloutEl.setAttribute('aria-label', step.title);
    const counter = document.createElement('p');
    counter.className = 'tour-counter';
    counter.textContent = stepCounter(index, steps.length);
    const h = document.createElement('h2');
    h.tabIndex = -1;
    h.textContent = step.title;
    const p = document.createElement('p');
    p.textContent = step.body;
    const actions = document.createElement('div');
    actions.className = 'tour-actions';
    if (!atFirst(index)) {
      actions.append(button('Back', () => { index = stepBack(index, steps.length); renderStep(); }, 'ghost'));
    }
    const last = atLast(index, steps.length);
    actions.append(button(last ? 'Choose a walk' : 'Next', () => {
      if (last) { renderEnd(); return; }
      index = stepForward(index, steps.length);
      renderStep();
    }, 'primary'));
    actions.append(button('Skip', () => close(), 'ghost skip-tour'));
    calloutEl.append(counter, h, p, actions);
    overlay.appendChild(calloutEl);
    reposition();
    h.focus();
  }

  // --- end: choose a walk ---
  function renderEnd(): void {
    phase = 'end';
    overlay.innerHTML = '';
    overlay.classList.remove('tour-spotlighting');
    window.removeEventListener('resize', reposition);
    const card = document.createElement('div');
    card.className = 'tour-card tour-centered';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Choose a walk');
    const h = document.createElement('h2');
    h.tabIndex = -1;
    h.textContent = 'That’s the tour. Watch a 1-minute walk:';
    const p = document.createElement('p');
    p.textContent = 'Each walk is scripted and deterministic — Pause / Next / Skip included, then “Try it yourself”.';
    const walks = document.createElement('div');
    walks.className = 'tour-actions tour-walks';
    walks.append(
      button('Plan · 2D floor plan', () => { window.location.href = '/?sim=1&play=1'; }, 'primary'),
    );
    const foot = document.createElement('div');
    foot.className = 'tour-actions';
    foot.append(
      button('Judges’ page →', () => { close(); window.location.href = '/judges'; }, 'ghost'),
      button('Close', () => close(), 'ghost skip-tour'),
    );
    card.append(h, p, walks, foot);
    overlay.appendChild(card);
    h.focus();
  }

  overlay.addEventListener('keydown', (e) => {
    if (phase == null) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (phase === 'steps' && e.key === 'ArrowRight') {
      e.preventDefault();
      if (atLast(index, steps.length)) renderEnd();
      else { index = stepForward(index, steps.length); renderStep(); }
      return;
    }
    if (phase === 'steps' && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (!atFirst(index)) { index = stepBack(index, steps.length); renderStep(); }
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = overlay.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });

  return {
    openWelcome(): void {
      restoreFocus = (document.activeElement as HTMLElement) ?? btnHelp;
      phase = 'welcome';
      overlay.hidden = false;
      renderWelcome();
    },
  };
}

let onboardedAlready = false;
try {
  onboardedAlready = localStorage.getItem(ONBOARD_KEY) === '1';
} catch {
  onboardedAlready = false;
}
// First run v1 (7 minutes, skippable, resumable) is the default welcome.
// The older tour stays one click away from Help. Simulation / judges walks
// are left alone so they can start on the canvas.
if (!SIM_ACTIVE) {
  studioChrome?.openFirstRun();
} else if (!tourDismissed(localStorage) && !onboardedAlready) {
  // sim: do not auto-block the canvas
}

if (!navigator.mediaDevices?.getUserMedia) {
  btnCamera.disabled = true;
  fail('fail-camera-unsupported', 'This browser cannot access a camera — pinch gestures are unavailable.');
}

renderAll();

// Apply saved setup (calibration, hints) once everything above exists.
applySetup();

/** Does the plan rule parser read this as a concrete edit? (then it is not a
 *  question for the copilot, even if it ends with "?"). */
function decisionIsExactEdit(utterance: string): boolean {
  const r = mode.parse(utterance) as Record<string, unknown>;
  return !!r && typeof r === 'object' && !('clarify' in r);
}
