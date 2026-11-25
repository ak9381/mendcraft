// Smart canvas shell (sim-main): an infinite canvas of boards. Overview is for
// viewing and flying; Focus fits one board at exactly 1:1 for editing.
// Board contents are A2UI surfaces built from surface plans, gated, and
// (for anything a model proposes) held in a Proposal until kept.
import '@a2ui/lit/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { cameraTransform, fitRects, focusOnInsets, lerpCamera, MIN_Z, panBy, twoHandCamera, zoomAbout, type Camera, type Viewport } from './camera';
import { isTypingTarget, stepZoom, wheelIntent, zoomCameraTo } from './canvasNav';
import { mountZoomHud } from './zoomHud';
import { attachBoardDrag } from './boardDrag';
import { applyTransform, createTwoHandGesture, type Vec } from '../input/twoHandTransform';
import { CANVAS_DOC_VERSION, createFrameRegistry, parseCanvasDoc, type CanvasDoc, type Frame, type FrameRegistry } from './frames';
import { resolveFrame, saveShouldOpenNextBoard, saveShouldPin } from './canvasCommands';
import { expandPlan, tileComponentId, type A2uiMessage, type DeviceState, type SurfacePlan, type TileSpec } from './surfacePlan';
import { gateMessages } from './gate';
import { CATALOG_SCHEMAS } from './catalogApi';
import { createSurfaceProposal, type SurfaceProposal } from './proposalBuffer';
import { createCanvasHistory, parseModelPlan, parsePartialPlan, runSurfaceTurn, scriptedEngine, type DeviceHint, type EngineId, type PartialPlan, type SentInfo, type SurfaceEngine } from './aiTurn';
import { byName, foundAfterScan, mergeTiles, pickPointChoice, pointConnectFromIdentity, pointFailureReceipt, roomScan, SIM_POINT_IDENTITY, type ConnectTurnResult, type PointIdentifyResult } from './connectTurns';
import { createSteadyHold, cropAlongRay, cropAroundPoint, isIndexExtended, phoneCropFraction, pointerInCrop, rayOutOfFrame, rayTarget, type Pt as CropPt, type SteadyHold } from './pointCrop';
import { createPhoneSensor, type PhoneSensor } from './phoneSensor';
import { coercePointResult, coerceSenseStatus, encodePointResult, phoneSubState, PHONE_POINT_FALLBACK, PHONE_POINT_LINE, POINT_OUT_OF_FRAME, type PhonePointResult, type PhoneSenseStatus } from './phonePoint';
import { captureCrop, findLiveVideo, openCameraOnce } from './pointCapture';
import { palmCenter, PHONE_HAND_FEEL, phoneReach } from './handFeel';
import { buildIdentifyPrompt } from '../devices/identify';
import { lampStep } from './deviceGuard';
import { openEndedAsk } from './openEndedAsk';
import { breakEngine, breakPrompt, impossibleAttempt, runBreakTurn, scriptedReply, type Attempt } from './tryToBreak';
import { createPairFirst, isBuildDashboard, pairedRowHtml } from './pairedRow';
import { mountConnectSheet, showPairing, type ConnectSheet, type PairingView } from './connectSheet';
import { startPhoneJoin } from './phoneJoin';
import { dispatchRelayCommand } from './relayCommands';
import { boardSendLine, createBoardEdgeTransferController, createEdgeTransferController, createSentBoardMemo, pairedEdgeLayout } from './edgeTransfer';
import { applyTileToPlan, parseTransfer, removeTileFromPlan, type TileTransfer } from './tileTransfer';
import { assignSide, coerceLayout, defaultLayout, sideFor, type PhonePlatform, type ScreenLayout, type Side } from './screenLayout';
import { loadHostToken, saveHostToken, loadLayout, saveLayout } from '../relay/pairingStore';
import { buildControlSnapshot } from '../relay/controlSnapshot';
import type { HostSession } from '../relay/session';
import { createCanvasInputs } from './canvasInputs';
import { followWhileBuilding, parseGimbalSpeech, POINT_NEEDS_LAPTOP, SCAN_LIVE_WHY } from './gimbalCanvas';
import { renderProposalCard, type ProposalStatus } from '../ux/proposal';
import { createDeviceStore, type DeviceConnector } from './deviceActions';
import { createDeviceSurfaceIndex } from './deviceSurfaceIndex';
import { createWizAwareConnector, isWizDevice, type BridgeStatus } from './wizDevices';
import { createSpotifyAwareConnector } from './spotifyConnector';
import * as spotifyApi from '../music/spotifyApi';
import { getValidAccessToken, isNativeMusicShell, loadTokens } from '../music/spotifyAuth';
import { startWebPlayback, type SdkPlayer } from '../music/spotifySdk';
import { createWizClient, resolveWizToken, type WizClient } from '../devices/wizClient';
import { esc } from '../core/esc';
import {
  CardTileElement, ChartTileElement, ConnectTileElement, FormTileElement, GridTileElement,
  LampTileElement, MusicTileElement, PlanBoardElement, RowTileElement, SceneTileElement,
  SplitTileElement, StatTileElement, SwitchTileElement, TableTileElement, TabsTileElement,
  VisualTileElement, smartCanvasCatalog,
} from './widgets';
import { resolvePointedDevice, type DeviceKind, type DeviceRef } from './deviceCommands';
import { initialDoc } from './firstOpen';
import { buildEnergyShowcaseDoc } from './showcaseFixture';
import { createConnectivity } from './connectivity';
import { EN_PACK, SCRIPTED_KN_PACK, coerceLanguagePack, routePackPhrase, statusText, INTENT_ENGLISH, type IntentKey, type LangStringKey, type LanguagePack, type StatusKey } from './languagePack';
import { createCanvasLedger, ledgerPanelLines, utf8ByteLength } from './ledger';
import { mountCanvasHands, shouldAutoStartHands, type CanvasHandsHandle } from './canvasHands';
import {
  SCAN_DEFAULTS, SCAN_SIM, createScanFlow, loadOwner, ownerHandsOf, registerButtonLabel, replayInputFor, storeOwner,
  type OwnerRecord,
} from './scanRegistration';
import { mountScanPanel } from './scanPanel';
import { computeSignature } from '../input/faceLogic';
import type { PresenceFrame } from '../input/presence';
import { mountTeachPanel } from './teachPanel';
import { LATER_LIST_PROMISE, OFFLINE_QUICK_ONLY } from '../ux/wording';
import { ROUTE_LINES } from '../ux/routeCatalog';
import { resolveLanguage } from '../ai/language';
import { activePeople, fillVisible, protectTurn } from '../privacy/directory';
import { createDeviceIdSession } from '../privacy/deviceRedact';
import { attachPrivacyHub } from '../relay/privacyHub';
import { mountPhoneMenu } from './phoneMenu';
import { createHandPointer, mapToScreen, REACH, type HandPointer } from './handPointer';
import { mountPhoneHands } from './phoneHands';
import { createGestureControl, type GestureControl } from './gestureControl';
import { createPalmHighlight } from './palmHighlight';
import { LAPTOP_GESTURES, PHONE_GESTURES } from './gestureBindings';
import { syntheticHand } from './handShapeFixtures';
import type { PhoneCamera } from './phoneCamera';
import { matchCursors } from '../ui/handOverlay';
import { setLivePinchThresholds } from '../input/handLogic';
import { loadSetup } from '../setup/setupState';

import { cameraHandsFromSelfie } from './handSpace';
import type { PlanExtra } from './planExtras';
import { mountMicFab, MIC_ICON_SVG, LISTENING_STATUS, type MicFab } from './micFab';
import { mountToolPalette } from './toolPalette';
import { cloudReceivedDetail, logTurnReceipt, MODEL_PANELS_HTML, mountModelPanels } from './modelPanels';
import { mountDraggablePanel, mountResizablePanel } from './dragPanel';
import { mountEditBoard, topLevelOf, type EditEl, type EditItemRef } from './editBoard';
import { createReviewReceipts, mountReviewDialog, type ReviewFacts } from './reviewDialog';
import { diffPlans, diffTile, languagePackChanges } from './planDiff';
import { AI_PANEL_ALWAYS_OPEN, createActivityLog } from './activityLog';
import { mountEngineBar, type EngineBar } from './engineBar';
import { createCanvasAiFeed, type AiFeed } from './aiFeed';
import { createPhoneAiRepublisher, teeFeed } from './phoneAiFeed';
import { boardForJourney } from './journey';
import { createNextStepChips, planExtraRan, type NextChips } from './nextSteps';
import { routeLine, type RouteWorld } from './routeLine';
import type { ReplayHost } from './journeyReplay';
import { identifyDevice, pickNextStepsOnDevice, type VisionTrace } from '../ai/hybrid';
import { buildMixedSwarmPlan, buildSwarmAgents, createSwarmLayer, type SwarmKind, type SwarmLayer, type SwarmPlanInput, type SwarmTask } from './swarmAgents';
import { mountSwarmDock, type SwarmDockUi } from './swarmDock';
import { mountMorphCard } from './morphCard';
import { attachMorphPointers, createMorphFlow, type MorphFlow } from './morphFlow';
import { enumerateMorphTiles, resolveMorphTarget, type MorphDoc, type MorphTargetRef } from './morphTarget';
import { applyMorphPatch, parseMorphTile, tileAtPath } from '../ai/morphEdit';
import { runSelfCheck, scriptedFixJson, selectSelfCheckTargets, waitForLayout } from './selfCheck';
import {
  CAMERA_LOST_REGISTER, INCOMPLETE_KN_LINE, MORPH_UNVERIFIED_LINE,
  phoneDropLine, saveSpokenLine, tryWriteStorage,
} from './failLines';
import { isPhoneCanvasShell } from './iphoneShell';
import { getGimbalPlugin, isIosShell } from '../devices/native';
import { LOOK_TO_EDIT_HINT, nextPhoneEditLock, readLookToEdit } from './phoneEditLock';

export const STORAGE_KEY = 'mc.canvas.v1';

export interface CanvasOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  connector?: DeviceConnector;
  devices?: Record<string, DeviceState>;
  reducedMotion?: boolean;
  engines?: Partial<Record<EngineId, (json: string) => SurfaceEngine>>;
  voice?: { supported: boolean; pushToTalkStart(): void; pushToTalkStop(): void; setLang?(lang: string): void } | null;
  /** ?seed=1: open today's finished canvas instead of one empty board. */
  seed?: boolean;
  /** Start offline (navigator.onLine at mount); the bar toggle can also force it. */
  online?: boolean;
  /** ?fresh=1 with nothing stored: open fully blank, zero boards, for the
   *  "let's build something fun" prompt instead of a seeded Board 1. */
  fresh?: boolean;
  /** ?sim=1: teach-a-gesture records a deterministic synthetic sample and
   *  keeps taught gestures in memory instead of IndexedDB. */
  sim?: boolean;
  /** Desktop hub: run Gemini on a redacted prompt for a connected phone. */
  privacyGemini?: (redacted: string) => Promise<string>;
  /** Phone shell only: a tap that forwards this phone's AI terminal activity
   *  to the paired laptop's AI monitor (see phoneAiFeed.ts). */
  phoneAiFeed?: AiFeed;
  /** Real WiZ bridge client; defaults to one pointed at the configured bridge
   *  URL/token. Pass a fake in tests. Unused when `sim` is set. */
  wizClient?: WizClient;
  /** ?showcase=energy: open the rich multi-section home-energy dashboard
   *  fixture instead of any stored/seeded/fresh doc — a deliberate opt-in
   *  demo of nested layouts, never reachable from the default boot paths. */
  showcase?: 'energy';
  /** Hands + face tracking start automatically on mount (default). ?hands=0
   *  opts out. Where getUserMedia doesn't exist (jsdom) it is a silent no-op. */
  autoHands?: boolean;
  /** Phone-simple shell: canvas + mic + route badge only (iOS/Android / <600px). */
  phoneShell?: boolean;
  /** iPhone shell: the hand SENSING layer (phoneSensor.ts) on the shared
   *  phone camera — feeds the gimbal and point-to-connect, never the UI. */
  phoneSensing?: boolean;
  /** iPhone shell: send a point-to-connect result to the laptop (relay). */
  sendPointResult?: (text: string) => void;
  /** ?gimbalKeepAlive=1: opt-in native camera keep-alive while DockKit face
   *  tracking is on (iPhone test option; also "keep alive on/off" by voice). */
  gimbalKeepAlive?: boolean;
  /** Initial routing badge, e.g. 'Apple · on device'. */
  routeBadge?: string;
  /** Spotify Web API calls (job 'spotify') for the outbound ledger; never carries a token. */
  onSpotifyCall?: spotifyApi.SpotifyLedger;
  /** Clock for the look-to-edit re-lock timer (tests). */
  now?: () => number;
  /** Look-away re-lock delay in ms (tests). */
  lookAwayMs?: number;
  /** Opt-in look-to-edit (default: persisted mc.lookToEdit, off). */
  lookToEdit?: boolean;
  /** Phone shell: the ONE shared front camera (phoneCamera.ts) — hand control
   *  and look-to-edit both run on it. Without it the phone has no Hands pill. */
  phoneCamera?: PhoneCamera;
}

const STUB_DEVICES: Record<string, DeviceState> = {
  'wiz-desk': { on: false, brightness: 40 },
  'wiz-ceiling': { on: true, brightness: 70 },
  'speaker-1': { on: false, brightness: 0, playing: false, trackTitle: 'Morning light', volume: 40 },
};
const TRACKS = ['Morning light', 'Monsoon raga', 'Evening calm'];

// ---- edit mode: tile discovery across both render paths ----
// Live A2UI (widgets.ts) renders each tile as a custom element in light DOM
// (the Column and the surface host don't use shadow roots); the fallback
// renderer (fallbackRenderer.ts) renders the same tiles as plain divs. Both
// land as direct children of the same Column/`.mc-fb-column` host, in the
// same order as the surface plan's tiles — so editBoard.ts's stable key is
// just that tile's `tileComponentId`, zipped by position.
//
// Nested layouts complicate this: a Card can contain a StatTile, and both
// match the same tag/class list below (any depth). `topLevelOf` (editBoard.ts)
// is what keeps nested children from getting their own independent chrome —
// it keeps only the matches with no OTHER match as an ancestor, so the Card
// (or Grid, Row, Tabs, Split) is the edit item and its children just move
// with it.
const LIVE_TILE_TAGS = [
  'mc-lamp-tile', 'mc-music-tile', 'mc-switch-tile', 'mc-scene-tile', 'mc-connect-tile', 'mc-plan-board',
  'mc-row', 'mc-grid', 'mc-card', 'mc-tabs', 'mc-split',
  'mc-stat-tile', 'mc-chart-tile', 'mc-table-tile', 'mc-form-tile', 'mc-visual-tile',
];
const FALLBACK_TILE_SELECTOR = '.mc-fb-tile, .mc-fb-row, .mc-fb-grid, .mc-fb-card, .mc-fb-tabs, .mc-fb-split';

function collectTileEls(surfaceEl: HTMLElement): HTMLElement[] {
  const live = Array.from(surfaceEl.querySelectorAll<HTMLElement>(LIVE_TILE_TAGS.join(',')));
  const all = live.length ? live : Array.from(surfaceEl.querySelectorAll<HTMLElement>(FALLBACK_TILE_SELECTOR));
  return topLevelOf(all);
}

function tileEditLabel(t: TileSpec): string {
  if (t.type === 'lamp' || t.type === 'music' || t.type === 'switch' || t.type === 'scene') return t.label;
  if (t.type === 'connect') return t.label ?? 'Connect a device';
  if (t.type === 'plan') return 'Floor plan';
  if (t.type === 'stat') return t.label;
  if (t.type === 'chart' || t.type === 'table' || t.type === 'form' || t.type === 'visual') return t.title;
  if (t.type === 'card') return t.title || 'Card';
  if (t.type === 'row') return 'Row';
  if (t.type === 'grid') return 'Grid';
  if (t.type === 'tabs') return 'Tabs';
  return 'Split';
}

export function seedDoc(): CanvasDoc {
  const r = createFrameRegistry();
  const room = r.add('room', 'Living room');
  const plan = r.add('plan', 'Floor plan');
  return {
    version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: r.list(),
    surfaces: {
      [room.id]: { kind: 'room', title: 'Living room', tiles: [
        { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' },
        { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling light' },
      ] },
      [plan.id]: { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: `${plan.id}-cad`, template: 'twoBedroom' }] },
    },
  };
}

/** The size a focused board is SHOWN at so it clears the chrome: narrower
 *  than `free` only when it fits ≥480 px, shorter than `freeH` (not on a
 *  phone). null = its own size fits. Pure; never persisted. */
export function fitFocusedSize(rect: { w: number; h: number }, o: { free: number; freeH: number; phone: boolean }): { w: number; h: number } | null {
  const w = o.free >= 480 && rect.w > o.free ? o.free : rect.w;
  const h = !o.phone && rect.h > o.freeH ? o.freeH : rect.h;
  return w === rect.w && h === rect.h ? null : { w, h };
}

export function mountCanvas(root: HTMLElement, opts: CanvasOptions = {}) {
  for (const El of [
    LampTileElement, PlanBoardElement, MusicTileElement, SwitchTileElement, SceneTileElement, ConnectTileElement,
    RowTileElement, GridTileElement, CardTileElement, TabsTileElement, SplitTileElement,
    StatTileElement, ChartTileElement, TableTileElement, FormTileElement, VisualTileElement,
  ]) {
    if (!customElements.get(El.tagName)) customElements.define(El.tagName, El as unknown as CustomElementConstructor);
  }
  const storage = opts.storage ?? localStorage;
  const reduced = opts.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stored: CanvasDoc | null = null;
  try { stored = parseCanvasDoc(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')); } catch { stored = null; }
  // Showcase is a deliberate opt-in detour: it never consults storage/seed/
  // fresh, and nothing in the default boot paths (?fresh=1&sim=1 included)
  // can reach it.
  const doc = opts.showcase === 'energy' ? buildEnergyShowcaseDoc() : initialDoc(stored, { seed: opts.seed, fresh: opts.fresh }, seedDoc);
  const reg: FrameRegistry = createFrameRegistry(doc.frames);
  const surfaces: Record<string, SurfacePlan> = { ...doc.surfaces };
  let camera: Camera = doc.camera;
  let focusId: string | null = doc.focusId;
  let lastFocus: string | null = focusId;
  let savedAt: string | null = null;
  let pack: LanguagePack | null = doc.pack ?? null;
  const net = createConnectivity<string>(opts.online ?? (typeof navigator !== 'undefined' ? navigator.onLine : true));
  /** Display-only fitted size of the focused board (fitBoardWidth). */
  const focusFit = new Map<string, { w: number; h: number }>();
  let nextChips: NextChips | null = null; // next-step chips on the focused board (set up below)

  const phoneShell = opts.phoneShell ?? (typeof window !== 'undefined' && isPhoneCanvasShell({
    capacitor: (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor ?? null,
    viewportWidth: window.innerWidth,
  }));
  const nowFn = opts.now ?? (() => Date.now());
  // Touch works by default; look-to-edit is opt-in (mc.lookToEdit) and an
  // unknown face signal (null) never locks.
  let editUnlocked = true;
  let awaySince: number | null = null;
  let facingNow: boolean | null = null;
  let faceSeen = false;
  const lookToEdit = opts.lookToEdit ?? readLookToEdit();
  let lockTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedTileHost: HTMLElement | null = null;
  root.classList.add('mc-canvas');
  if (phoneShell) root.classList.add('mc-phone-simple');
  root.innerHTML = `
    <div class="mc-viewport" tabindex="-1"><div class="mc-world"></div><div class="mc-swarm" hidden></div></div>
    <div class="mc-blank" hidden>
      <p class="mc-blank-lead">Let's build something fun.</p>
      <p class="mc-blank-hint">Say &ldquo;show tools&rdquo;, or click Tools.</p>
      <button type="button" class="mc-btn mc-blank-register" data-cmd="register">Register</button>
      <p class="mc-blank-phone">Hold the mic and say what you need.</p>
    </div>
    <header class="mc-bar">
      <div class="mc-bar-tools">
      <div class="mc-bar-btns">
      <button data-cmd="everything" class="mc-btn" data-i18n="showEverything">Show everything</button>
      <button data-cmd="new" class="mc-btn" data-i18n="newBoard">New board</button>
      <button data-cmd="save" class="mc-btn" data-i18n="save">Save</button>
      <button data-cmd="undo" class="mc-btn mc-btn-quiet" data-i18n="undo">Undo</button>
      <button data-cmd="ai" class="mc-btn" aria-expanded="false" data-i18n="ai">AI activity</button>
      <div class="mc-more">
        <button type="button" class="mc-btn mc-more-btn" aria-expanded="false" aria-controls="mc-more-menu">More<span class="mc-more-caret" aria-hidden="true"></span></button>
        <div class="mc-more-menu" id="mc-more-menu" role="group" aria-label="More tools" hidden>
          <section class="mc-more-group" aria-label="Hands"><h3 class="mc-more-title">Hands</h3>
            <button data-cmd="hands" class="mc-btn" aria-pressed="false" data-i18n="hands">Hands</button>
            <button data-cmd="dwell" class="mc-btn" aria-pressed="false">Hover to click</button>
            <button data-cmd="teach" class="mc-btn">Teach a gesture</button>
            <button data-cmd="gestures" class="mc-btn">Custom gestures</button>
            <button data-cmd="reregister" class="mc-btn" hidden>Register again</button></section>
          <section class="mc-more-group" aria-label="Screens"><h3 class="mc-more-title">Screens</h3>
            <button data-cmd="monitor" class="mc-btn">AI monitor</button>
            <button data-cmd="swap" class="mc-btn" hidden>Swap phone sides</button></section>
          <section class="mc-more-group" aria-label="Demo"><h3 class="mc-more-title">Demo</h3>
            <button data-cmd="offline" class="mc-btn" aria-pressed="false" data-i18n="simulateOffline">Simulate offline</button></section>
        </div>
      </div>
      </div>
      <form class="mc-say"><label class="mc-sr" for="mc-say-in">Say or type a command</label>
        <input id="mc-say-in" autocomplete="off" data-i18n="sayPlaceholder" placeholder="Type or say a command…" />
        <button class="mc-btn primary" type="submit" data-i18n="go">Go</button></form>
      </div>
      <div class="mc-status-row"><p class="mc-canvas-status" role="status" aria-live="polite"></p>
        <button class="mc-btn mc-retry" type="button" hidden aria-label="Retry the request that failed">Retry</button></div>
    </header>
    <aside class="mc-dock" aria-label="Pinned board" hidden>
      <div class="mc-dock-head"><span class="mc-dock-title"></span>
        <button class="mc-btn mc-dock-unpin" type="button">Unpin</button></div>
      <div class="mc-dock-surface"></div>
    </aside>
    <div class="mc-ai-scrim" data-hand-dismiss hidden></div>
    <aside class="mc-ai" aria-label="AI activity" hidden>
      <div class="mc-ai-head">
        <h2 class="mc-ai-h">AI activity</h2>
        <button type="button" class="mc-ai-close" aria-label="Close AI activity">×</button>
      </div>
      <div class="mc-ai-body">
        <h3 class="mc-ai-h3">Live</h3>
        <ol class="mc-ai-live-log" aria-live="polite"></ol>
        <p class="mc-ai-empty">When Nano or Gemini works on a board, you see the prompt going in, what left this device, and the reply as it streams. Clicks, hover-selects and two-fist moves show up here too.</p>
        ${MODEL_PANELS_HTML}
        <h3 class="mc-ai-h3">History</h3>
        <p class="mc-ai-ledger-total"></p>
        <p class="mc-ai-ledger-spotify" hidden></p>
        <p class="mc-ai-history-empty">Turns you keep will show up here.</p>
        <ol class="mc-ai-history" tabindex="-1"></ol>
      </div>
      <div class="mc-ai-pending">
        <p class="mc-ai-state" aria-live="polite"></p>
      </div>
    </aside>`;
  // Every Proposal that needs a decision opens in the compact floating
  // review window — the board stays visible behind it.
  const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 600px)').matches;
  if (phoneShell) {
    root.querySelector('[data-cmd=monitor]')?.remove();
    const badge = document.createElement('div');
    badge.className = 'mc-route-badge';
    badge.setAttribute('role', 'status');
    if (opts.routeBadge) badge.textContent = opts.routeBadge;
    else badge.hidden = true;
    const hint = document.createElement('p');
    hint.className = 'mc-look-hint';
    hint.setAttribute('role', 'status');
    hint.textContent = LOOK_TO_EDIT_HINT;
    hint.hidden = true; // only shown while actually locked
    root.append(badge, hint);
  }
  function setRouteBadge(text: string): void {
    const badge = root.querySelector<HTMLElement>('.mc-route-badge');
    if (!badge) return;
    badge.hidden = !text;
    badge.textContent = text;
  }
  function phoneLocked(): boolean { return phoneShell && !editUnlocked; }
  function clearPhoneSelection(): void {
    selectedTileHost = null;
    root.querySelectorAll('.is-phone-selected').forEach((n) => n.classList.remove('is-phone-selected'));
  }
  function selectPhoneTile(el: HTMLElement): void {
    const host = el.closest<HTMLElement>('[data-mc-tile]') ?? el;
    clearPhoneSelection();
    selectedTileHost = host;
    host.classList.add('is-phone-selected');
  }
  const viewport = root.querySelector<HTMLElement>('.mc-viewport')!;
  const world = root.querySelector<HTMLElement>('.mc-world')!;
  const swarmEl = root.querySelector<HTMLElement>('.mc-swarm')!;
  // One cursor per engine, parked on a tile of the focused board (never
  // floating loose over the canvas); the other agents only light their tiles.
  const swarmAnchor = (tileIndex: number | undefined): { x: number; y: number } | null => {
    const id = focusId ?? lastFocus;
    const frame = id ? world.querySelector<HTMLElement>(`[data-frame="${id}"]`) : null;
    if (!frame) return null;
    const tile = tileIndex == null ? null
      : frame.querySelector<HTMLElement>(`.mc-ghost-tile[data-tile-i="${tileIndex}"]`) ?? frame.querySelectorAll<HTMLElement>('[data-mc-tile]')[tileIndex] ?? null;
    const box = swarmEl.getBoundingClientRect();
    const r = (tile ?? frame).getBoundingClientRect();
    if (!box.width || !box.height || !r.width) return null;
    const x = Math.min(r.right - 24, r.left + Math.max(r.width * 0.72, 90));
    const y = r.top + Math.min(tile ? 26 : 40, r.height / 2);
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    return { x: (x - box.left) / box.width, y: (y - box.top) / box.height };
  };
  const swarm: SwarmLayer = createSwarmLayer(swarmEl, {
    reducedMotion: reduced,
    maxPerKind: 1,
    anchor: swarmAnchor,
    onReachTarget: (tileIndex, kind) => flashGhostTarget(tileIndex, kind),
  });
  const blankEl = root.querySelector<HTMLElement>('.mc-blank')!;
  const statusEl = root.querySelector<HTMLElement>('.mc-canvas-status')!;
  const aiPanel = root.querySelector<HTMLElement>('.mc-ai')!;
  const activityLog = createActivityLog(aiPanel.querySelector<HTMLElement>('.mc-ai-live-log'));
  // Engine bar: Nano + Gemini always visible (desktop only; CSS also hides it
  // in the phone shell). The terminals mirror their state into it; a failed
  // engine also pins the AI panel open so the reason stays readable.
  // Engines whose failure/queued state must keep the AI panel open (with the reason).
  const aiHold = new Set<EngineId>();
  // The laptop's AI feed (monitor.html). A phone shell also tees its terminals
  // into opts.phoneAiFeed, which forwards compact aiEvents to the laptop.
  const aiFeed = createCanvasAiFeed(phoneShell, { sim: !!opts.sim });
  const engineBar: EngineBar | null = phoneShell ? null : mountEngineBar(root, { onOpen: () => showAi(true, true) });
  const panels = mountModelPanels(aiPanel, document, engineBar ? {
    set: (engine, state, line) => {
      // Only a failure opens the drawer by itself (the reason must be readable);
      // a queued turn is shown on the engine bar and the AI monitor.
      if (state === 'failed' || state === 'queued') { aiHold.add(engine); if (state === 'failed') showAi(true); } else aiHold.delete(engine);
      engineBar.set(engine, state, line);
    },
    handoff: (from, to) => engineBar.handoff(from, to),
    setCloudBytes: (b, sim) => engineBar.setCloudBytes(b, sim),
    clearQueued: (engine) => { aiHold.delete(engine); engineBar.clearQueued(engine); },
  } : undefined, opts.phoneAiFeed ? teeFeed(aiFeed, opts.phoneAiFeed) : aiFeed);
  // A turn ended: the bar and the AI feed (monitor) both stop saying Working.
  const settleEngines = (): void => { engineBar?.settle(); panels.settle(); };
  // The bar replaces the swarm pill on desktop: mirror its agent summary
  // (minus the bytes tail, which the bar shows from the ledger) into the bar.
  const swarmPillEl = swarmEl.querySelector<HTMLElement>('.mc-swarm-pill');
  const swarmPillObserver = engineBar && swarmPillEl && typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => engineBar.setAgents(swarmPillEl.hidden ? '' : (swarmPillEl.textContent ?? '').replace(/\s*·\s*[^·]*to cloud\s*$/, '')))
    : null;
  if (swarmPillObserver && swarmPillEl) swarmPillObserver.observe(swarmPillEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  // ---- cross-device screen arrangement + edge tile transfer ----------------
  // The laptop remembers which phone sits on which side (Nothing left, iPhone
  // right by default). A one-hand/mouse MOVE drag past the viewport's left/right
  // edge sends that tile to the phone on that side (editBoard.onItemDrag →
  // edgeTransfer, which guards against tremor and never fires on a two-hand
  // pinch). The committed transfer + updated board ride the host `state`
  // snapshot, so both phones see it with no new Relay message type.
  let hostSession: HostSession | null = null;
  let screenLayout: ScreenLayout = coerceLayout(loadLayout(storage) ?? defaultLayout({ android: true, ios: true }));
  let snapshotRev = 0;
  let dragFrame: string | null = null;

  function setScreenLayout(next: ScreenLayout): void {
    screenLayout = next;
    saveLayout(storage, next);
    republishCurrentBoard();
  }

  // A board sent to one phone stays on that phone across routine republishes
  // (announce, layout swap, rejoin) until the laptop's focused board changes.
  const sentBoard = createSentBoardMemo();
  function republishCurrentBoard(): void {
    const cur = sentBoard.current(focusId, focusId ? surfaces[focusId] ?? null : null);
    publishBoardTransfer(focusId ?? '', cur.board, null, cur.boardFor);
  }

  function setEdgeGlow(side: 'left' | 'right' | null, glow: number): void {
    viewport.classList.toggle('mc-edge-glow-left', side === 'left' && glow > 0.05);
    viewport.classList.toggle('mc-edge-glow-right', side === 'right' && glow > 0.05);
    // The phones strip shows which phone sits on that side while a board nears an edge.
    const near = !!side && glow > 0.05;
    if (near !== edgeNear) { edgeNear = near; showArrangeStrip(); }
  }

  function publishBoardTransfer(_frameId: string, board: SurfacePlan | null, t: TileTransfer | null, boardFor?: PhonePlatform): void {
    if (!hostSession) return;
    try {
      const snap = buildControlSnapshot({
        rev: ++snapshotRev,
        layout: screenLayout,
        ...(board ? { board } : {}),
        ...(board && boardFor ? { boardFor } : {}),
        ...(t ? { transfer: { componentId: t.componentId, to: t.to, enterEdge: t.enterEdge, rev: snapshotRev } } : {}),
      });
      void hostSession.publishState(snap).catch(() => undefined);
    } catch {
      // Snapshot build/publish is best-effort — never breaks the local drag.
    }
  }

  function commitLaptopTransfer(frameId: string, t: TileTransfer): void {
    const plan = surfaces[frameId];
    if (!plan) return;
    const next = removeTileFromPlan(plan, t.componentId);
    if (next === plan) return; // the tile was not a top-level tile here
    surfaces[frameId] = next;
    renderSurface(frameId);
    sync(); persist();
    history.push({ frameId, before: plan, after: next, by: 'her', summary: `Sent a tile to the ${t.to} phone` });
    historyRender();
    say(`Sent that tile to the ${t.to} phone.`);
    publishBoardTransfer(frameId, next, t);
  }

  // Phones that announced themselves → their AI activity on the laptop's monitor.
  const phoneAi = createPhoneAiRepublisher({ feed: aiFeed });
  /** A phone 'announce' (which side it is on), 'transfer' (a tile sent back) or
   *  'aiEvent' (its AI activity line), intercepted before dispatchRelayCommand.
   *  All carry JSON in cmd.text. */
  function handlePhoneDeviceCommand(kind: 'announce' | 'transfer' | 'aiEvent', text: string): void {
    if (kind === 'aiEvent') {
      // Tagged by device; display only — never ledgered, never counted in the
      // laptop's cloud total.
      phoneAi.handle(text);
      return;
    }
    if (kind === 'announce') {
      let platform: PhonePlatform | null = null;
      let wantedSide: Side | null = null;
      let deviceId: unknown;
      let native: unknown;
      let refresh = false;
      let sense: PhoneSenseStatus | null = null;
      try {
        const o = JSON.parse(text) as { platform?: unknown; side?: unknown; deviceId?: unknown; native?: unknown; refresh?: unknown };
        if (o.platform === 'android' || o.platform === 'ios') platform = o.platform;
        sense = coerceSenseStatus(o);
        if (o.side === 'left' || o.side === 'right') wantedSide = o.side;
        deviceId = o.deviceId;
        native = o.native;
        refresh = o.refresh === true;
      } catch {
        return;
      }
      if (!platform) return;
      const prevSense = phoneSense.get(platform);
      if (sense) phoneSense.set(platform, sense); else phoneSense.delete(platform);
      if (JSON.stringify(prevSense) !== JSON.stringify(sense ?? undefined)) pairFirst.refresh();
      // A keep-alive re-announce only re-learns who the phone is for the AI
      // monitor — no re-placing, no board republish every 20 s.
      if (refresh) { phoneAi.announce(platform, deviceId, native); return; }
      pairFirst.addPhone({ id: platform, label: phoneAi.announce(platform, deviceId, native) });
      // Honour an explicit side; otherwise place it on its default side only if
      // that side is empty — never overwrite a manual swap the user already made.
      let next = screenLayout;
      if (wantedSide) next = assignSide(screenLayout, wantedSide, platform);
      else if (!sideFor(screenLayout, platform)) {
        next = defaultLayout({ [platform === 'android' ? 'android' : 'ios']: true } as { android?: boolean; ios?: boolean }, screenLayout);
      }
      if (next !== screenLayout) {
        setScreenLayout(next);
        const side = sideFor(next, platform);
        if (side) say(`${platform === 'android' ? 'The Nothing phone' : 'The iPhone'} is on the ${side}.`);
      } else {
        // Already placed — still republish so the phone gets the current board.
        republishCurrentBoard();
      }
      return;
    }
    // kind === 'transfer'
    const t = parseTransfer(text);
    if (!t) return;
    const frameId = focusId ?? lastFocus ?? '';
    if (t.to === 'laptop') {
      const plan = surfaces[frameId];
      if (plan) {
        const next = applyTileToPlan(plan, t.tile);
        if (next !== plan) {
          surfaces[frameId] = next;
          renderSurface(frameId);
          sync(); persist();
          history.push({ frameId, before: plan, after: next, by: 'her', summary: 'A tile came back from a phone' });
          historyRender();
          say('A tile came back from a phone.');
        }
      }
    }
    // Republish so the OTHER phone (a left↔right hop, or a return) also sees it.
    publishBoardTransfer(frameId, surfaces[frameId] ?? null, t);
  }

  const edgeTransfer = createEdgeTransferController({
    getViewportWidth: () => viewport.getBoundingClientRect().width || (typeof window !== 'undefined' ? window.innerWidth : 0),
    getLayout: () => screenLayout,
    getBoard: () => (dragFrame ? surfaces[dragFrame] ?? null : null),
    onGlow: (g) => setEdgeGlow(g.side, g.glow),
    onCommit: (t) => { if (dragFrame) commitLaptopTransfer(dragFrame, t); },
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  });

  // Whole board → phone: a board dragged (held fist or mouse title) to a PAIRED
  // phone's edge and held for the dwell goes to that phone over the same `state`
  // snapshot; the laptop board snaps back. SIM phones: same glow, no network.
  // Not an AI action, so it never reaches the AI feed — status line only.
  let boardSends = 0;
  const boardEdge = createBoardEdgeTransferController({
    getViewportWidth: () => viewport.getBoundingClientRect().width || (typeof window !== 'undefined' ? window.innerWidth : 0),
    getLayout: () => pairedEdgeLayout(screenLayout, pairFirst.phones(), { live: !!hostSession }),
    getRect: (id) => { const f = reg.get(id); return f ? { ...f.rect } : null; },
    restoreRect: (id, rect) => { reg.setRect(id, rect); sync(); persist(); },
    getBoard: (id) => surfaces[id] ?? null,
    onGlow: (g) => setEdgeGlow(g.side, g.glow),
    onCommit: (s) => {
      if (hostSession) {
        // Only the phone on that side shows it (boardFor); the other ignores it.
        sentBoard.remember({ boardFor: s.target, board: s.board }, focusId, focusId ? surfaces[focusId] ?? null : null);
        publishBoardTransfer(s.frameId, s.board, null, s.target);
      }
      boardSends++;
      say(boardSendLine(s.target, s.board.title || reg.get(s.frameId)?.title || '', !!hostSession));
    },
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  });

  // Screen-arrangement strip (set once, remembered): Left | This laptop | Right,
  // showing which phone is on which side. Only while a phone is paired AND
  // either Tools is open or a board is held near a screen edge — never
  // permanent chrome. Swapping sides lives in Tools > More > Screens (and
  // voice "swap phone sides").
  const arrangeStrip = document.createElement('div');
  arrangeStrip.className = 'mc-arrange';
  arrangeStrip.setAttribute('aria-label', 'Phone screen arrangement');
  arrangeStrip.hidden = true;
  root.appendChild(arrangeStrip);
  let edgeNear = false;
  const platformLabel = (p: PhonePlatform | null): string => (p === 'android' ? 'Nothing' : p === 'ios' ? 'iPhone' : 'none');
  /** Phones are on the table: sim scripts them, or a real one joined. */
  const phonesPaired = (): boolean => !phoneShell && (pairFirst.phones().length > 0 || !!hostSession);
  function showArrangeStrip(): void {
    const toolsOpen = !!root.querySelector('.mc-bar-tools:not([hidden]):not(.mc-bar-tools-peek)');
    const was = arrangeStrip.hidden;
    arrangeStrip.hidden = !(phonesPaired() && (toolsOpen || edgeNear));
    const swap = root.querySelector<HTMLElement>('[data-cmd=swap]');
    if (swap) swap.hidden = phoneShell || !(opts.sim || hostSession);
    if (was !== arrangeStrip.hidden && focusId && !edgeNear) queueMicrotask(() => { const f = focusId ? reg.get(focusId) : undefined; if (f) void flyTo(focusCam(fitBoardWidth(f))); });
  }
  function renderArrangeStrip(): void {
    arrangeStrip.innerHTML = `
      <span class="mc-arrange-label">Phones</span>
      <span class="mc-arrange-slot" data-side="left">◀ ${platformLabel(screenLayout.left)} · left</span>
      <span class="mc-arrange-laptop">This laptop</span>
      <span class="mc-arrange-slot" data-side="right">${platformLabel(screenLayout.right)} · right ▶</span>`;
  }
  function swapPhoneSides(): void {
    setScreenLayout({ left: screenLayout.right, right: screenLayout.left });
    renderArrangeStrip();
    say(`Swapped: ${platformLabel(screenLayout.left)} on the left, ${platformLabel(screenLayout.right)} on the right.`);
  }
  renderArrangeStrip();

  // "Connect devices": pair phones first (connected-device row with a check per
  // phone), then ask what to connect next. The lamp dashboard review waits for
  // "build the dashboard" (see pairedRow.ts).
  const pairedRow = document.createElement('div');
  pairedRow.className = 'mc-arrange mc-paired-row';
  pairedRow.setAttribute('aria-label', 'Connected devices');
  pairedRow.hidden = true;
  root.appendChild(pairedRow);
  let pairFrame: string | null = null;
  let pairingHost: HTMLElement | null = null;
  let flowOpening = false;
  let flowOwnsHost = false; // only the pair-first flow may auto-hide the pairing host
  /** iPhone sensing status per announced phone (phonePoint.ts), from its
   *  announce — only what the phone reports is really on. */
  const phoneSense = new Map<string, PhoneSenseStatus>();
  const isIphoneRow = (p: { id: string; label: string; sim: boolean }): boolean => p.id === 'ios' || (p.sim && /iphone/i.test(p.label));
  const pairFirst = createPairFirst({
    say: (t) => say(t),
    sim: () => simEnv(),
    busy: () => reviewBusy(),
    openPairing: async () => {
      let id = pairFrame ?? focusId ?? lastFocus;
      if (!id || !reg.get(id)) { // no board yet: make and focus one, never blame the relay
        id = reg.add('note', `Board ${reg.list().length + 1}`).id;
        sync(); void focus(id);
      }
      pairFrame = id;
      flowOpening = true;
      try { openConnectSheet(id); } finally { flowOpening = false; }
      return joinPhone(id);
    },
    buildDashboard: () => {
      const id = pairFrame ?? focusId ?? lastFocus; // phones stay paired: do not close the pairing card's session
      if (id) void connectRoom(id);
    },
    onChange: () => {
      const html = pairedRowHtml(pairFirst.phones(), pairFirst.phase(), (p) => phoneSubState(phoneSense.get(p.id), { sim: p.sim, ios: isIphoneRow(p) }));
      const rowWasHidden = pairedRow.hidden;
      pairedRow.hidden = !html || phoneShell;
      // The row changes the bottom inset: re-fit the focused board above it.
      if (rowWasHidden !== pairedRow.hidden && focusId) queueMicrotask(() => { const f = focusId ? reg.get(focusId) : undefined; if (f) void flyTo(focusCam(fitBoardWidth(f))); });
      pairedRow.innerHTML = html;
      showArrangeStrip();
      pairedRow.querySelector<HTMLButtonElement>('.mc-paired-continue')?.addEventListener('click', () => { pairFirst.continueNext(); });
      pairedRow.querySelector<HTMLButtonElement>('.mc-paired-disconnect')?.addEventListener('click', () => { disconnectPhones(); say('Phones disconnected.'); });
      // Past the pairing step the card collapses into the row's "N phones connected"
      // chip (relay stays alive) so it never covers the review.
      if (pairingHost && flowOwnsHost && pairFirst.phase() !== 'pairing') { pairingHost.hidden = true; flowOwnsHost = false; }
      nextChips?.refresh();
    },
  });

  // Edit mode: a hand-reachable Edit/Done/Reset trio (near the Tools chip)
  // that lets anything on the focused board — tiles, widgets, floor plans,
  // live A2UI or the fallback renderer alike — be moved and resized by
  // pinch, mouse or touch. See editBoard.ts for the move/resize/clamp logic;
  // `getItems` below is the only place that knows about A2UI/catalog specifics.
  const editBoard = mountEditBoard(root as unknown as EditEl, {
    createElement: (tag) => document.createElement(tag) as unknown as EditEl,
    getAiPanelEl: () => aiPanel as unknown as EditEl,
    getItems: (frameId) => {
      const plan = surfaces[frameId];
      const surfaceEl = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-surface`);
      if (!plan || !surfaceEl) return [];
      const els = collectTileEls(surfaceEl);
      const out: EditItemRef[] = [];
      plan.tiles.forEach((t, i) => {
        const el = els[i];
        if (el) out.push({ key: tileComponentId(t, [i]), el: el as unknown as EditEl, label: tileEditLabel(t) });
      });
      return out;
    },
    onItemCommit: (frameId, key) => {
      const plan = surfaces[frameId];
      const entry = plan ? enumerateMorphTiles(plan).find((e) => e.id === key) : undefined;
      if (entry) selfCheckTiles(frameId, entry.path);
    },
    // One-hand/mouse move only (never resize, never two-hand pinch): drive the
    // edge glow + cross-device transfer. `dragFrame` tells the controller which
    // board the tile belongs to.
    onItemDrag: (ev) => { dragFrame = ev.frameId; edgeTransfer.handleItemDrag(ev); },
    // Self-check overlap (Akash, 23 Nov): a move/resize that landed on other
    // tiles was nudged clear — say so, and make the whole move one undo step.
    onItemNudged: (frameId, key, before, after) => {
      const plan = surfaces[frameId];
      const label = plan ? enumerateMorphTiles(plan).find((e) => e.id === key)?.label : undefined;
      history.push({ frameId, before: null, after: null, by: 'her', summary: `Moved ${label ?? 'tile'} (nudged clear of other tiles)`, kind: 'layout', layoutBefore: before, layoutAfter: after });
      historyRender();
      say(`Moved ${label ?? 'the tile'} to the nearest free spot so it doesn't cover other tiles. Say "undo" to put it back.`);
    },
  });
  // Nano/Gemini terminals: pinch-hold the title bar (or mouse/touch-drag it)
  // to float the terminal anywhere on screen; the reset button puts it back
  // in its column slot. Position persists in sessionStorage per engine.
  (['nano', 'gemini'] as const).forEach((engine) => {
    const panel = aiPanel.querySelector<HTMLElement>(`.mc-terminal-${engine}`)!;
    const handle = panel.querySelector<HTMLElement>('.mc-term-drag')!;
    const resizeHandle = panel.querySelector<HTMLElement>('.mc-term-resize')!;
    const resetBtn = aiPanel.querySelector<HTMLElement>(`.mc-term-reset-pos[data-engine="${engine}"]`)!;
    const drag = mountDraggablePanel(panel, handle, { id: engine }, () => {
      const spacer = document.createElement('div');
      spacer.className = 'mc-terminal-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      return spacer;
    });
    const resize = mountResizablePanel(panel, resizeHandle, { id: engine });
    resetBtn.addEventListener('click', () => { drag.resetPosition(); resize.resetSize(); });
  });
  // Dock chips (one per swarm agent, under its engine's terminal) stay in
  // lockstep with the canvas cursors: tapping a chip rings the matching
  // `.mc-swarm-cursor` so the two views of the same agent read as one thing.
  const swarmDock: SwarmDockUi = mountSwarmDock(aiPanel, root, {
    onOpenAgent: (agentId) => swarmEl.querySelector(`[data-agent-id="${agentId}"]`)?.classList.add('is-dock-open'),
    onCloseAgent: (agentId) => swarmEl.querySelector(`[data-agent-id="${agentId}"]`)?.classList.remove('is-dock-open'),
  });
  const settleSwarm = (): void => { swarm.settle(); swarmDock.settle(); };
  const dockEl = root.querySelector<HTMLElement>('.mc-dock')!;
  const dockSurfaceEl = dockEl.querySelector<HTMLElement>('.mc-dock-surface')!;
  const history = createCanvasHistory();
  const ledger = createCanvasLedger();
  // A7-024: a request that failed mid-flight offers Retry (re-sends the same
  // request). Any later status line means the moment has passed — hide it.
  const retryBtn = root.querySelector<HTMLButtonElement>('.mc-retry')!;
  let retryFn: (() => void) | null = null;
  const hideRetry = () => { retryFn = null; retryBtn.hidden = true; };
  const offerRetry = (fn: () => void) => { retryFn = fn; retryBtn.hidden = false; };
  retryBtn.addEventListener('click', () => { const f = retryFn; hideRetry(); f?.(); });
  // Every status line, in order (the journey replay reads what each step said).
  const statusLog: string[] = [];
  let statusBase = 0;
  // The status line is a toast, not permanent chrome: it fades ~6 s after the
  // last line, except while a review waits, a Retry is offered or the mic
  // listens (those lines stay until something replaces them).
  const STATUS_FADE_MS = 6000;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  const fadeStatus = (t: string): void => {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
    if (!t || typeof window === 'undefined') return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      if (statusEl.textContent !== t) return;
      if (reviewBusy() || !retryBtn.hidden || t === LISTENING_STATUS) { fadeStatus(t); return; }
      statusEl.textContent = '';
    }, STATUS_FADE_MS);
  };
  const say = (t: string) => {
    statusEl.textContent = t; hideRetry();
    statusLog.push(t);
    if (statusLog.length > 400) { statusLog.splice(0, 200); statusBase += 200; }
    fadeStatus(t);
  };

  {
    const saved = loadSetup()?.calibration;
    if (saved && saved.pinchOn >= 0.16 && saved.pinchOn <= 0.40 && saved.pinchOff > saved.pinchOn) {
      setLivePinchThresholds(saved.pinchOn, saved.pinchOff);
    }
  }

  // The floating mic is mounted later; "ask for something else" starts it.
  let micFabRef: MicFab | null = null;
  const reviewDialog = mountReviewDialog(root, {
    onAskElse: () => {
      if (voice?.supported) micFabRef?.toggle();
      else root.querySelector<HTMLInputElement>('#mc-say-in')?.focus();
      say('What would you like instead?');
    },
  });
  // Every review opens through here so the phone menu sheet (z-index 61, above
  // the review's 50) can never cover Approve/Reject/Ask-else. No-op on desktop
  // (phoneMenu is null there). Keeps the human-in-the-loop gate reachable.
  function showReview(model: Parameters<typeof reviewDialog.open>[0]): void {
    phoneMenu?.close();
    reviewDialog.open(model);
  }
  /** Per-turn ledger receipts: each SentInfo a turn hands to the ledger
   *  (aiSent / recordSent) is the token that turn later passes to its own
   *  review, so a footer can only ever show THAT turn's engine, route and
   *  bytes — never whatever turn happened to run last. */
  const receipts = createReviewReceipts();
  /** The review's honesty footer for the turn that owns `si`. No token means
   *  no AI call made this change: say so, and claim no bytes. */
  const reviewFacts = (si: SentInfo | null, youAsked?: string): ReviewFacts => receipts.facts(si, { youAsked, sim: opts.sim });
  /** The teach turn's own ledger token, when a model (not the rules) parsed it. */
  let teachSent: SentInfo | null = null;
  /** Teach runs on rules/Nano/Gemini; its card already names which. */
  function teachFacts(card: HTMLElement): ReviewFacts {
    const label = card.querySelector('.mc-proposal-engine')?.textContent?.trim() ?? '';
    const engine = /gemini/i.test(label) ? 'gemini' : /nano/i.test(label) ? 'nano' : 'rules';
    const si = teachSent;
    teachSent = null;
    if (engine === 'gemini') {
      // The bytes the ledger booked for this teach turn (onModelSent), never a guess.
      const booked = si ? receipts.facts(si) : null;
      return { engine, engineLabel: label, sim: !!opts.sim, why: 'turning your words into a canvas action', sentWhat: 'your description of the action', bytes: booked?.bytes ?? 0, ...(booked?.simBytes ? { simBytes: booked.simBytes } : {}) };
    }
    return { engine, engineLabel: label || undefined, sim: !!opts.sim, bytes: 0 };
  }

  const teachPanel = mountTeachPanel(root, {
    devices: () => deviceRefs(),
    sim: opts.sim,
    say,
    onModelSent: (engine, prompt) => {
      const cloud = engine === 'gemini';
      teachSent = {
        engine, prompt, sim: !!opts.sim,
        sent: cloud ? 'your description of the action' : null,
        routeLine: cloud ? 'Gemini · cloud — turning your words into a canvas action' : 'Nano · on device — nothing left this device',
      };
      recordSent(teachSent, cloud ? protectTurn('', prompt).promptText : '');
    },
    openReview: (title, card) => showReview({
      title, card,
      changes: [{ op: 'add', label: 'New gesture', detail: title.replace(/^Teach: /, '') }],
      facts: teachFacts(card),
    }),
    onSaved: () => {},
    onTriggered: (gesture) => {
      const text = typeof gesture.action.text === 'string' ? gesture.action.text : '';
      if (text) run(text);
      const frameId = focusId ?? lastFocus ?? reg.list()[0]?.id ?? '';
      history.push({ frameId, before: null, after: null, by: 'her', summary: `Custom gesture ${gesture.name} triggered -> ${gesture.actionSummary}` });
      historyRender();
    },
  });

  // ---- language pack: UI strings via data-i18n, English when no pack ----
  const str = (k: LangStringKey): string => pack?.strings[k] ?? EN_PACK.strings[k]!;
  function applyStrings(): void {
    // <html lang> follows the pack so screen readers and font fallback pick the right script.
    document.documentElement.lang = pack?.lang ?? 'en';
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const k = el.dataset.i18n as LangStringKey;
      if (el instanceof HTMLInputElement) el.placeholder = str(k);
      else el.textContent = str(k);
    });
  }
  const tagCardI18n = (card: HTMLElement) => {
    card.querySelector('.mc-proposal-keep')?.setAttribute('data-i18n', 'keep');
    card.querySelector('.mc-proposal-drop')?.setAttribute('data-i18n', 'drop');
    applyStrings();
  };

  // ---- A2UI ----
  const processor = new MessageProcessor([smartCanvasCatalog]);
  const live = new Set<string>();
  // Which live surfaces have a tile bound to a given deviceId — built from
  // each plan's tiles whenever a surface is (re)rendered, so device patches
  // fan out only to surfaces that actually show that device.
  const deviceSurfaces = createDeviceSurfaceIndex();
  // One mapping for this whole session: a device id gets the same "Device N"
  // placeholder every time it reaches Gemini, for as long as this canvas
  // stays open (never persisted — a reload renumbers from Device 1).
  const deviceIdSession = createDeviceIdSession();
  const simulatedConnector: DeviceConnector = {
    run: (i) => new Promise((res) => setTimeout(() => {
      const cur = store.get(i.deviceId);
      const ack: Partial<DeviceState> = { on: i.on ?? cur.on, brightness: i.brightness ?? cur.brightness };
      if (i.playing !== undefined) ack.playing = i.playing;
      if (i.volume !== undefined) ack.volume = i.volume;
      if (i.next) { ack.trackTitle = TRACKS[(TRACKS.indexOf(cur.trackTitle ?? '') + 1 + TRACKS.length) % TRACKS.length]; ack.playing = true; }
      res(ack);
    }, 300)),
  };
  // ?sim=1 stays fully simulated and deterministic — no bridge probing at all.
  // Otherwise, a real WiZ bridge (scripts/wiz-bridge.mjs) takes over the
  // wiz-* lamp tiles when it's reachable; everything else, and those lamps
  // while the bridge is down, stays on the simulated connector (labelled SIM).
  // No bridge token means the bridge would refuse us anyway (401), so don't
  // probe localhost at all: no console noise for visitors without a lamp.
  const wizClient = opts.sim ? null : (opts.wizClient ?? (resolveWizToken() ? createWizClient() : null));
  const bridgeStatus: BridgeStatus = { up: false };
  const lampConnector = wizClient
    ? createWizAwareConnector({ client: wizClient, fallback: simulatedConnector, status: bridgeStatus })
    : simulatedConnector;
  // Speaker tiles play through Spotify when she is connected; ?sim=1 stays fully simulated.
  const spOpts = (): spotifyApi.SpotifyApiOptions => ({
    // Path + short query only (redacted in the api layer); never a token.
    onCall: (i) => {
      ledger.record({ engine: 'spotify', sentText: i.sent });
      activityLog.push({ kind: 'spotify', text: i.reason });
      ledgerTotalRender();
      opts.onSpotifyCall?.(i);
    },
  });
  let webPlayer: SdkPlayer | null = null;
  const defaultConnector = opts.sim ? lampConnector : createSpotifyAwareConnector({
    inner: lampConnector,
    isConnected: () => !!loadTokens(),
    listDevices: () => spotifyApi.listDevices(spOpts()),
    transferPlayback: (id, play) => spotifyApi.transferPlayback(id, spOpts(), play),
    searchAndPlay: (q, id) => spotifyApi.searchAndPlay(q, spOpts(), id),
    // Web Playback SDK doesn't run in iOS WKWebView: the phone shell never offers it.
    browserDevice: phoneShell || isNativeMusicShell() ? undefined : async () => {
      if (!webPlayer) webPlayer = await startWebPlayback({ getToken: () => getValidAccessToken() });
      return webPlayer.deviceId;
    },
    pause: () => spotifyApi.pause(spOpts()),
    resume: () => spotifyApi.play(spOpts()),
    next: async () => { await spotifyApi.next(spOpts()); const pb = await spotifyApi.getPlayback(spOpts()); return pb?.title ? { title: pb.title } : null; },
    setVolume: (pct) => spotifyApi.setVolumePercent(pct, spOpts()),
    say,
  });
  const store = createDeviceStore(opts.devices ?? STUB_DEVICES, opts.connector ?? defaultConnector, (m) => {
    const u = (m as unknown as { updateDataModel: Record<string, unknown> }).updateDataModel;
    const path = typeof u.path === 'string' ? u.path : '';
    const deviceId = path.startsWith('/devices/') ? path.slice('/devices/'.length) : '';
    const targets = deviceId ? deviceSurfaces.targetsFor(deviceId) : undefined;
    const sids = targets && targets.size ? targets : live;
    for (const sid of sids) processor.processMessages([{ ...m, updateDataModel: { ...u, surfaceId: sid } }] as never);
  }, () => 'fanout');
  if (wizClient && !opts.connector) {
    void wizClient.health().then((up) => {
      bridgeStatus.up = up;
      for (const id of Object.keys(store.all())) if (isWizDevice(id)) store.setSim(id, !up);
    });
  }

  processor.onSurfaceCreated((s: unknown) => {
    const sid = (s as { id: string }).id;
    const host = sid.endsWith('-dock')
      ? dockSurfaceEl
      : world.querySelector<HTMLElement>(`[data-frame="${sid}"] .mc-surface`);
    if (!host) return;
    host.innerHTML = '';
    const el = document.createElement('a2ui-surface') as HTMLElement & { surface: unknown };
    el.surface = s;
    host.append(el);
    live.add(sid);
    type WidgetAction = { name: string; context?: Record<string, unknown>; metadata?: Record<string, unknown> };
    // A2UI only allows `metadata.extensions` (anything else throws in
    // validateMetadata), so the live Lit widgets carry per-click data there.
    const ext = (a: WidgetAction) => (a.metadata?.extensions as Record<string, unknown> | undefined) ?? a.metadata;
    (s as { onAction: { subscribe(f: (a: WidgetAction) => void): void } }).onAction.subscribe((a) => {
      if (a.name === 'connect.start') { openConnectSheet(sid); return; }
      // New general-purpose widgets: wired through the same onAction bus as
      // every device tile, but their payload has no deviceId — the live
      // (Lit) path carries per-click specifics in `metadata` (the A2UI
      // controller's calling convention for dynamic action data), the
      // fallback (plain-DOM) path puts the same thing straight in `context`.
      if (a.name === 'table.rowAction') {
        const row = (a.context?.row ?? ext(a)?.row) as string[] | undefined;
        say(row ? `Opened ${row[0]}.` : 'Opened row.');
        return;
      }
      if (a.name === 'form.submit') {
        say('Form submitted.');
        return;
      }
      if (a.name === 'visual.action') {
        const label = (a.context?.label ?? ext(a)?.label) as string | undefined;
        const action = (a.context?.action ?? ext(a)?.action) as string | undefined;
        say(label ? `${label}.` : action ? `${action}.` : 'Activated.');
        return;
      }
      const id = a.context?.deviceId as string | undefined; const cur = id ? store.get(id) : undefined;
      if (!cur || !id) return;
      if (a.name === 'lamp.toggle' || a.name === 'switch.toggle') void store.act({ deviceId: id, on: !cur.on });
      if (a.name === 'lamp.brighter') void store.act({ deviceId: id, on: true, brightness: lampStep(cur.brightness + 20) });
      if (a.name === 'lamp.dimmer') void store.act({ deviceId: id, brightness: lampStep(cur.brightness - 20) });
      if (a.name === 'music.playPause') void store.act({ deviceId: id, playing: !cur.playing });
      if (a.name === 'music.next') void store.act({ deviceId: id, next: true });
      if (a.name === 'music.louder') void store.act({ deviceId: id, volume: Math.min(100, (cur.volume ?? 50) + 10) });
      if (a.name === 'music.softer') void store.act({ deviceId: id, volume: Math.max(0, (cur.volume ?? 50) - 10) });
    });
  });

  function renderSurface(id: string): boolean {
    const plan = surfaces[id];
    if (!plan) return false;
    const msgs: A2uiMessage[] = [
      ...(live.has(id) ? [{ version: 'v0.9', deleteSurface: { surfaceId: id } } as A2uiMessage] : []),
      // The frame head already shows the title: no second heading inside.
      ...expandPlan(plan, id, store.all(), { heading: false }),
    ];
    const g = gateMessages(msgs, CATALOG_SCHEMAS);
    if (!g.ok) { say(`Blocked a board that did not pass the check: ${g.errors[0]}`); return false; }
    live.delete(id);
    processor.processMessages(g.messages as never);
    deviceSurfaces.track(id, plan);
    // The re-render replaces the tile DOM, and with it Edit mode's wrapper
    // (handles, saved layout). sync()'s setFocus runs before the new tiles
    // exist, so re-apply once they have laid out — otherwise a self-check fix
    // after a tile move left "Done" showing with no handles and the saved
    // layout gone.
    if (id === focusId) waitForLayout(() => { if (focusId === id && surfaces[id]) editBoard.setFocus(id, !!surfaces[id]?.tiles.length); });
    return true;
  }

  // ---- pinned-board dock: a second A2UI surface fed by the same device store ----
  // Control tiles only (lamp / music / switch / scene) — never plan or connect.
  const isDockTile = (t: SurfacePlan['tiles'][number]) =>
    t.type === 'lamp' || t.type === 'music' || t.type === 'switch' || t.type === 'scene';
  const DOCK_GAP = 24;
  const dockInset = () => (dockEl.hidden ? 0 : (dockEl.offsetWidth || 300) + DOCK_GAP);
  /** Width the right-side hand cluster takes out of the board area (0 when hidden). */
  const clusterInset = () => {
    const c = root.querySelector<HTMLElement>('.mc-hand-cluster');
    if (!c || !c.offsetWidth) return 0;
    const left = c.getBoundingClientRect().left - viewport.getBoundingClientRect().left;
    return Math.max(0, vp().w - left + DOCK_GAP);
  };
  /** Height the bottom chrome takes: the engine bar, plus the phones arrange
   *  strip and the connected-device row when they float above it. */
  const bottomInset = () => {
    let b = engineBar ? (engineBar.el.offsetHeight || 68) + 24 : 92;
    const h = viewport.getBoundingClientRect().bottom || vp().h;
    for (const el of [arrangeStrip, pairedRow]) {
      if (!el.hidden && el.offsetHeight) b = Math.max(b, Math.round(h - el.getBoundingClientRect().top) + DOCK_GAP);
    }
    return b;
  };
  const insets = () => phoneShell ? { top: 0, left: 0, right: 0 } : ({ top: barH(), left: dockInset(), right: clusterInset(), bottom: bottomInset() });

  function clearDock(): void {
    // Delete the dock surface in the processor too: forgetting it only here made
    // the next renderDock re-create it ("Surface f1-dock already exists").
    for (const sid of [...live]) if (sid.endsWith('-dock')) { live.delete(sid); deviceSurfaces.untrack(sid); processor.processMessages([{ version: 'v0.9', deleteSurface: { surfaceId: sid } }] as never); }
    dockSurfaceEl.innerHTML = '';
    dockEl.hidden = true;
  }
  function renderDock(frameId: string): void {
    const plan = surfaces[frameId];
    if (!plan) return;
    const sid = `${frameId}-dock`;
    const tiles = plan.tiles.filter(isDockTile).slice(0, 4); // plan + connect tiles excluded, at most 4
    const dockPlan: SurfacePlan = { kind: 'room', title: plan.title, tiles };
    const msgs: A2uiMessage[] = [
      ...(live.has(sid) ? [{ version: 'v0.9', deleteSurface: { surfaceId: sid } } as A2uiMessage] : []),
      ...expandPlan(dockPlan, sid, store.all(), { heading: false }),
    ];
    const g = gateMessages(msgs, CATALOG_SCHEMAS);
    if (!g.ok) return;
    live.delete(sid);
    processor.processMessages(g.messages as never);
    deviceSurfaces.track(sid, dockPlan);
  }
  /** Show the dock when a pinned room board is NOT the one being edited. */
  function updateDock(): void {
    const pinned = focusId
      ? reg.list().find((f) => f.id !== focusId && f.pinned && surfaces[f.id]?.kind === 'room')
      : undefined;
    if (!pinned || !surfaces[pinned.id]?.tiles.some(isDockTile)) { clearDock(); return; }
    dockEl.hidden = false;
    dockEl.dataset.frame = pinned.id;
    dockEl.querySelector('.mc-dock-title')!.textContent = pinned.title;
    renderDock(pinned.id);
  }

  // ---- frames DOM ----
  function frameEl(f: Frame): HTMLElement {
    let el = world.querySelector<HTMLElement>(`[data-frame="${f.id}"]`);
    if (!el) {
      el = document.createElement('section');
      el.className = 'mc-frame';
      el.dataset.frame = f.id;
      el.innerHTML = `<div class="mc-frame-head"><button class="mc-frame-title" data-focus="${f.id}"></button><span class="mc-chip"></span></div>
        <div class="mc-frame-body"><div class="mc-connect-host" hidden></div><div class="mc-ghost" hidden aria-hidden="true"></div><div class="mc-surface"></div><div class="mc-empty" hidden></div></div>`;
      world.append(el);
      if (!phoneShell) attachBoardDrag(el.querySelector<HTMLElement>('.mc-frame-title')!, {
        frameId: f.id,
        getZoom: () => camera.z,
        onMove: (id, dx, dy, clientX, clientY) => {
          if (!boardEdge.handleBoardDrag({ frameId: id, phase: 'move', clientX, clientY })) return;
          const cur = reg.get(id); if (!cur) return;
          reg.setRect(id, { ...cur.rect, x: cur.rect.x + dx, y: cur.rect.y + dy });
          const moved = reg.get(id); if (!moved) return;
          el!.style.left = `${moved.rect.x}px`; el!.style.top = `${moved.rect.y}px`;
        },
        onEnd: (id, cancelled) => {
          boardEdge.handleBoardDrag({ frameId: id, phase: cancelled ? 'cancel' : 'end', clientX: NaN, clientY: NaN });
          sync(); persist();
        },
      });
      if (surfaces[f.id]) queueMicrotask(() => {
        renderSurface(f.id);
        if (f.id === focusId) editBoard.setFocus(focusId, !!surfaces[f.id]?.tiles.length);
      });
    }
    return el;
  }

  function sync(): void {
    const frames = reg.list();
    blankEl.hidden = frames.length > 0;
    const ids = new Set(frames.map((f) => f.id));
    world.querySelectorAll<HTMLElement>('.mc-frame').forEach((el) => { if (!ids.has(el.dataset.frame!)) { live.delete(el.dataset.frame!); deviceSurfaces.untrack(el.dataset.frame!); el.remove(); } });
    for (const f of frames) {
      const el = frameEl(f);
      // The focused board may show narrower/shorter than its own size (see
      // fitBoardWidth); that fit is display-only, never stored.
      const fit = focusId === f.id ? focusFit.get(f.id) : undefined;
      const w = fit?.w ?? f.rect.w, h = fit?.h ?? f.rect.h;
      Object.assign(el.style, { left: `${f.rect.x}px`, top: `${f.rect.y}px`, width: `${w}px`, height: `${h}px` });
      el.querySelector('.mc-frame-title')!.textContent = f.title;
      // The kind chip only when it says something the title doesn't ("Floor plan" twice did not).
      const chip = el.querySelector<HTMLElement>('.mc-chip')!;
      const kindLabel = labelFor(f);
      chip.textContent = f.pinned ? `${kindLabel} · pinned` : kindLabel;
      chip.hidden = !f.pinned && kindLabel.trim().toLowerCase() === f.title.trim().toLowerCase();
      const focused = focusId === f.id;
      el.classList.toggle('focused', focused);
      el.classList.toggle('dim', focusId !== null && !focused);
      const body = el.querySelector<HTMLElement>('.mc-frame-body')!;
      body.inert = !focused; // overview is view-only: the plan engine hit-tests in unscaled pixels
      el.setAttribute('aria-label', `${f.title} board${focused ? ', editing' : ''}`);
      const empty = el.querySelector<HTMLElement>('.mc-empty')!;
      empty.hidden = !!surfaces[f.id];
      if (!surfaces[f.id] && !empty.querySelector(".mc-empty-talk")) {
        empty.innerHTML = `<p class="mc-empty-lead" data-i18n="emptyLead">What would you like to build on this board?</p>
          <button type="button" class="mc-btn primary mc-empty-talk" data-act="talk" aria-label="Talk: start listening">${MIC_ICON_SVG}<span>Talk</span></button>
          <p class="mc-empty-talk-caption" hidden></p>
          <div class="mc-row"><button class="mc-btn" data-act="connect" data-i18n="emptyConnect">Connect this room</button><button class="mc-btn" data-act="floorplan" data-i18n="emptyFloorplan">Floor plan</button></div>`;
      }
    }
    root.dataset.mode = focusId ? 'focus' : 'overview';
    applyStrings();
    applyCamera();
    editBoard.setFocus(focusId, !!focusId && !!surfaces[focusId]?.tiles.length);
    if (phoneShell && focusId) stampMorphTiles(focusId);
    nextChips?.refresh();
  }

  const labelFor = (f: Frame) => (surfaces[f.id]?.kind === 'plan' || f.kind === 'plan' ? 'Floor plan' : surfaces[f.id] ? 'Room dashboard' : 'Empty');

  let zoomHud: ReturnType<typeof mountZoomHud> | null = null;
  function applyCamera(): void {
    root.style.setProperty('--mc-bar-h', `${barH()}px`);
    world.style.transform = cameraTransform(camera);
    const g = 40 * camera.z;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${-camera.x * camera.z}px ${-camera.y * camera.z}px`;
    root.dataset.zoom = camera.z.toFixed(2);
    zoomHud?.setZoom(camera.z);
  }

  let aiAuto = false; // the AI panel is open because a turn opened it (overlay)
  const vp = (): Viewport => {
    const w = viewport.clientWidth || innerWidth;
    const h = viewport.clientHeight || innerHeight;
    if (phoneShell) return { w, h };
    // An auto-opened panel overlays the boards (no re-fly, no narrowing);
    // only a panel the user opened takes its width out of the board area.
    return { w: w - (aiPanel.hidden || aiAuto ? 0 : aiPanel.offsetWidth + 24), h };
  };
  const barH = () => phoneShell ? 0 : (root.querySelector<HTMLElement>('.mc-bar')!.offsetHeight + 32);
  /** Phone: one board at a time, at 1:1 (readable — the whole-canvas fit
   *  shrank a laptop-sized board to ~8px text), filling the width minus
   *  16px gutters and the height between the top badge and the mic; the
   *  board scrolls inside. Display-only, like fitBoardWidth. */
  function fitPhone(): void {
    const list = reg.list();
    if (!list.length) return;
    const f = (focusId ? reg.get(focusId) : undefined) ?? (lastFocus ? reg.get(lastFocus) : undefined) ?? list[0];
    if (focusId !== f.id) { focusId = f.id; lastFocus = f.id; }
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(viewport) : null;
    const padTop = parseFloat(cs?.paddingTop ?? '0') || 0;
    const padBottom = parseFloat(cs?.paddingBottom ?? '0') || 0;
    const v = vp();
    const GUTTER = 16, TOP = 60 + padTop, BOTTOM = 128 + padBottom;
    const fit = { w: Math.max(240, Math.floor(v.w - 2 * GUTTER)), h: Math.max(240, Math.floor(v.h - TOP - BOTTOM)) };
    focusFit.set(f.id, fit);
    sync();
    camera = { x: f.rect.x - GUTTER, y: f.rect.y - TOP, z: 1 };
    applyCamera();
  }

  let flight = 0;
  function flyTo(target: Camera): Promise<void> {
    cancelAnimationFrame(flight);
    const from = camera; const v = vp();
    if (reduced) { camera = target; applyCamera(); persist(); return Promise.resolve(); }
    return new Promise((done) => {
      const t0 = performance.now(); const ms = 420;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        camera = lerpCamera(from, target, t, v); applyCamera();
        if (t < 1) flight = requestAnimationFrame(step); else { persist(); done(); }
      };
      flight = requestAnimationFrame(step);
    });
  }

  // ---- persistence ----
  let persistTimer = 0;
  function snapshot(): CanvasDoc {
    return { version: CANVAS_DOC_VERSION, camera, focusId, frames: reg.list(), surfaces: { ...surfaces }, lang: pack?.lang, pack: pack ?? undefined };
  }
  function persist(now = false): boolean {
    clearTimeout(persistTimer);
    const write = (): boolean => tryWriteStorage(storage, STORAGE_KEY, JSON.stringify(snapshot()));
    if (now) return write();
    persistTimer = window.setTimeout(write, 250);
    return true;
  }

  // ---- navigation ----
  /** 1:1 focus camera. A board with content that is wider/taller than the screen
   *  (a dashboard on a phone) opens at its top-left; an empty board stays centred
   *  so its "Connect this room" call-to-action is on screen. */
  /** Narrow a focused board to the free width between the dock and the hand
   *  cluster, so nothing on it sits under chrome. Never below 480px.
   *  Display-only: the board's own size (registry + storage) is never
   *  changed, so it grows back when the space returns, in overview, and
   *  across reloads. Returns the board as it is shown (for the camera). */
  function fitBoardWidth(f: Frame): Frame {
    const ins = insets();
    const free = Math.floor(vp().w - ins.left - ins.right - 32);
    // Also clamp height to the space above the phones strip + engine bar (the
    // board scrolls inside), so its bottom stays reachable.
    const freeH = Math.max(360, Math.floor(vp().h - ins.top - (ins.bottom ?? 0) - 32));
    const fit = fitFocusedSize(f.rect, { free, freeH, phone: phoneShell });
    const had = focusFit.get(f.id);
    if (fit) focusFit.set(f.id, fit); else focusFit.delete(f.id);
    if (had?.w !== fit?.w || had?.h !== fit?.h) sync();
    return fit ? { ...f, rect: { ...f.rect, ...fit } } : f;
  }
  function focusCam(f: Frame): Camera { return focusOnInsets(f.rect, vp(), insets(), 16, !!surfaces[f.id]); }
  async function focus(id: string): Promise<void> {
    let f = reg.get(id); if (!f) return;
    focusId = id; lastFocus = id; sync(); updateDock();
    f = fitBoardWidth(f);
    await flyTo(focusCam(f));
    window.dispatchEvent(new Event('resize')); // let the plan engine re-measure at 1:1
    say(`Editing ${f.title}. Say “show everything” to zoom out.`);
  }
  async function overview(): Promise<void> {
    focusId = null; sync(); clearDock();
    const list = reg.list();
    await flyTo(fitRects(list.map((f) => f.rect), vp(), Math.max(56, barH())));
    say(list.length ? `${list.length} boards. Pick one, or say “go to …”.` : `Let's build something fun. Say “show tools” to get started.`);
  }
  function newBoard(): void {
    pairFirst.abandon();
    const n = reg.list().length + 1;
    const f = reg.add('note', `Board ${n}`);
    sync(); void focus(f.id); persist();
    say(`New board. Say “connect everything in this room”.`);
  }
  function save(): void {
    // Saving an unpinned board also pins it. If it's a dockable room
    // dashboard, open a fresh board too so the dashboard actually appears
    // in the side dock and the main canvas is clear (the dock only shows a
    // pinned room that is not the focused board). "pin"/"unpin" stay their
    // own commands for anyone who wants that without saving.
    const f = focusId ? reg.get(focusId) : null;
    const surface = f ? surfaces[f.id] : undefined;
    const openNext = saveShouldOpenNextBoard(f, surface, !!surface?.tiles.some(isDockTile));
    const pinThisSave = saveShouldPin(f);
    if (pinThisSave) reg.setPinned(f!.id, true);
    const wrote = persist(true);
    if (!wrote) {
      // In-memory board (and a pin we just set) stay; do not invent a new
      // empty board or claim the write landed.
      sync();
      updateDock();
      say(saveSpokenLine(false, f?.title ?? null, ''));
      return;
    }
    savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const msg = saveSpokenLine(true, f ? f.title : null, savedAt);
    if (openNext) {
      const next = reg.add('note', `Board ${reg.list().length + 1}`);
      focusId = next.id;
      lastFocus = next.id;
      sync();
      updateDock();
      persist();
      void flyTo(focusCam(fitBoardWidth(next)));
      window.dispatchEvent(new Event('resize'));
      say(msg);
      return;
    }
    sync();
    updateDock();
    say(msg);
  }
  function step(dir: 1 | -1): void {
    const list = reg.list(); if (!list.length) return;
    const i = Math.max(0, list.findIndex((f) => f.id === (focusId ?? lastFocus)));
    void focus(list[(i + dir + list.length) % list.length].id);
  }

  // ---- AI turns: visible prompt, ghost preview, human in the loop ----
  const SCRIPTS: Record<string, string> = {
    nanoRoom: '{"kind":"room","title":"This room","tiles":[{"type":"lamp","deviceId":"wiz-desk","label":"Desk lamp"},{"type":"lamp","deviceId":"wiz-ceiling","label":"Ceiling light"}]}',
    geminiRoom: '{"kind":"room","title":"Living room","tiles":[{"type":"lamp","deviceId":"wiz-ceiling","label":"Main light"},{"type":"lamp","deviceId":"wiz-desk","label":"Reading lamp"},{"type":"music","deviceId":"speaker-1","label":"Speaker"},{"type":"plan","boardId":"room-plan","template":"oneRoom"},{"type":"connect","label":"Connect a device"}]}',
    nanoPlan: '{"kind":"plan","title":"Floor plan","tiles":[{"type":"plan","boardId":"BOARD-cad","template":"twoBedroom"}]}',
  };
  // Model streams in flight (any engine, fallbacks included): the replay's
  // "is a turn still running?" for turns that don't hold turnBusy.
  let streamsOut = 0;
  const counted = (e: SurfaceEngine): SurfaceEngine => ({
    ...e,
    stream: async (prompt, onText) => { streamsOut++; try { return await e.stream(prompt, onText); } finally { streamsOut--; } },
    fallback: e.fallback ? counted(e.fallback) : undefined,
  });
  const engineFor = (id: EngineId, json: string): SurfaceEngine => counted(opts.engines?.[id]?.(json) ?? scriptedEngine(id, json));
  const DEVICE_LABELS: Record<string, string> = { 'wiz-desk': 'Desk lamp', 'wiz-ceiling': 'Ceiling light', 'speaker-1': 'Speaker' };
  const DEVICE_KINDS: Record<string, DeviceKind> = { 'speaker-1': 'music' };
  const isDeviceTile = (t: SurfacePlan['tiles'][number]): t is Extract<SurfacePlan['tiles'][number], { deviceId: string }> =>
    t.type === 'lamp' || t.type === 'music' || t.type === 'switch';
  // The name she sees on a tile wins (a kept Gemini layout may rename "Desk lamp" to "Reading lamp").
  const deviceTileFor = (id: string) => {
    const order = [focusId, ...reg.list().filter((f) => f.pinned).map((f) => f.id), ...Object.keys(surfaces)];
    for (const fid of order) {
      const t = fid ? surfaces[fid]?.tiles.find((x) => isDeviceTile(x) && x.deviceId === id) : undefined;
      if (t && isDeviceTile(t)) return t;
    }
    return undefined;
  };
  const labelOf = (id: string): string => deviceTileFor(id)?.label ?? DEVICE_LABELS[id] ?? id;
  const kindOf = (id: string): DeviceKind => {
    const t = deviceTileFor(id);
    return t && t.type !== 'lamp' ? t.type : DEVICE_KINDS[id] ?? 'lamp';
  };
  const deviceHints = (): DeviceHint[] => Object.keys(store.all()).map((id) => ({ id, label: labelOf(id), kind: kindOf(id) }));
  const deviceRefs = (): DeviceRef[] => Object.entries(store.all()).map(([id, s]) => ({ id, label: labelOf(id), kind: kindOf(id), on: s.on, brightness: s.brightness, playing: s.playing, volume: s.volume }));
  let pending: { frameId: string; prop: SurfaceProposal; card: HTMLElement } | null = null;
  // Set synchronously the instant a build/connect turn starts — before any
  // await, so a second trigger during the swarm build (double-click, run while
  // building) can't start a parallel turn that overwrites `pending` and orphans
  // the first review's Promise. `pending` alone isn't enough: it's assigned
  // late, only once the plan is ready and the review opens.
  let turnBusy = false;
  // True whenever a review is in progress and a new build/connect/kannada/morph
  // turn must NOT start — it would call showReview() and overwrite the open
  // card, orphaning the first review's Promise (and leaving turnBusy stuck
  // true). Each signal alone is incomplete: `turnBusy` covers the streaming
  // window before the card opens, `pending` covers a build proposal still
  // waiting after Esc (dialog hidden), and `reviewDialog.isOpen()` covers the
  // morph / Kannada / self-check-fix / teach reviews that never set `pending`.
  const reviewBusy = (): boolean => turnBusy || !!pending || reviewDialog.isOpen();

  // The AI activity drawer opens by itself while a model works or a review
  // waits, overlaying the boards, and folds away ~3 s after the turn ends. A
  // panel the user opened (engine card, "show ai", Tools button) stays until
  // they close it and takes its width out of the board area like before.
  const AI_HIDE_MS = 3000;
  let aiHideTimer = 0;
  function autoHideAi(): void {
    clearTimeout(aiHideTimer);
    if (!aiAuto || aiPanel.hidden) return;
    aiHideTimer = window.setTimeout(() => {
      // Re-check at fire time: a new turn, a waiting review or a failure must keep it open.
      if (reviewBusy() || aiHold.size > 0 || !aiAuto) return;
      showAi(false);
    }, AI_HIDE_MS);
  }
  const aiScrim = root.querySelector<HTMLElement>('.mc-ai-scrim');
  const closeAi = (): void => { aiHold.clear(); showAi(false, true); };
  /** `pin` marks a user action (stays open, takes layout width); without it
   *  an open is an overlay that autoHideAi() may fold away again. */
  function showAi(on = true, pin = false): void {
    clearTimeout(aiHideTimer);
    if (AI_PANEL_ALWAYS_OPEN) { on = true; pin = true; }
    const insetBefore = !aiPanel.hidden && !aiAuto;
    aiAuto = on && !pin && (!!aiPanel.hidden || aiAuto);
    aiPanel.hidden = !on;
    // Only a user-pinned panel shifts the cluster/swarm; an auto-open is a pure overlay.
    root.classList.toggle('is-ai-pinned', on && !aiAuto);
    if (aiScrim) aiScrim.hidden = true;
    root.querySelector('[data-cmd=ai]')?.setAttribute('aria-expanded', String(on));
    // Only a layout-changing (user-pinned) toggle re-flies; an overlay never moves the camera.
    const insetAfter = on && !aiAuto;
    if (insetBefore !== insetAfter && focusId) { const f = reg.get(focusId); if (f) void flyTo(focusCam(fitBoardWidth(f))); }
  }
  aiPanel.querySelector('.mc-ai-close')?.addEventListener('click', closeAi);
  // Scrim stays inert (never used as a dismiss target).
  showAi(AI_PANEL_ALWAYS_OPEN, true);
  // sim's scripted engines can resolve near-instantly, which would settle
  // the swarm (and open the review) before a screenshot — or a person — ever
  // sees it mid-flight. Hold it visible for a minimum stretch in sim only;
  // real network latency already paces it for everyone else.
  const SWARM_MIN_HOLD_MS = 2600;
  let swarmStartedAt = 0;
  async function holdSwarmMinimum(): Promise<void> {
    if (!opts.sim) return;
    const remaining = SWARM_MIN_HOLD_MS - (Date.now() - swarmStartedAt);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  }
  /** One ledger line for a turn, remembered against that turn's SentInfo
   *  (summed if the same turn really sends twice). A SIM turn books 0 real
   *  bytes — only what it would send. `prebooked`: bytes of this turn already
   *  booked the moment they left (a point-to-connect crop whose clarifying
   *  question was pending) — the receipt counts them, the total not twice. */
  function recordSent(s: SentInfo, sentText: string, extraBytes = 0, prebooked = 0): void {
    const full = utf8ByteLength(sentText) + Math.max(0, extraBytes);
    const entry = ledger.record({ engine: s.engine, extraBytes: Math.max(0, full - prebooked), sim: s.sim });
    receipts.record(s, entry.bytes + (s.sim || s.engine === 'nano' ? 0 : Math.min(prebooked, full)), entry.simBytes ?? 0);
    renderBytes();
  }
  /** Every byte counter (AI panel line, footer, engine bar, feed, swarm pill)
   *  from the one ledger: real bytes, and SIM "would send" apart. */
  function renderBytes(): void {
    const t = ledger.totals();
    ledgerTotalRender();
    panels.setFooterBytes(t.aiBytes, t.simBytes);
    swarm.reportBytes(t.aiBytes, t.simBytes);
  }
  function aiSent(utterance: string, s: SentInfo, ctx: { task?: SwarmTask; tileCount?: number; swarmPlan?: SwarmPlanInput; extraBytes?: number; prebookedBytes?: number; swarm?: boolean } = {}): void {
    // No auto-open: the engine bar shows the turn (click it for the drawer)
    // and the AI monitor carries the full story; the canvas stays clean.
    aiPanel.querySelector<HTMLElement>('.mc-ai-empty')!.hidden = true;
    panels.show();
    aiPanel.dataset.engine = s.engine;
    activityLog.push({ kind: 'ai', text: `${s.engine === 'nano' ? 'Quick' : s.engine === 'gemini' ? 'Deep' : s.engine} · ${utterance.trim().slice(0, 80) || 'working'}` });
    // Byte ledger: every AI turn records what actually left the device. Scan
    // the spoken utterance too — not just the canned schema prompt — so a
    // name said aloud (e.g. "floor plan for Mrs Sharma's flat") still shows
    // up redacted even when 0 bytes were sent.
    const protect = protectTurn(utterance, s.prompt);
    // extraBytes: a photo crop that went with the prompt (point-to-connect).
    recordSent(s, s.sent ? protect.promptText : '', s.sent ? ctx.extraBytes : 0, s.sent ? ctx.prebookedBytes : 0);
    // The privacy order invariant: Nano logs `received` + any `redact` lines
    // before a byte of this turn reaches the Gemini terminal.
    logTurnReceipt(panels, {
      engine: s.engine, utterance, used: protect.used, people: activePeople(), cloudPayload: protect.promptText,
    });
    if (s.routeLine) panels.forEngine(s.engine).log('note', s.routeLine);
    if (phoneShell) {
      const line = s.routeLine || '';
      const badge = /apple/i.test(line) ? 'Apple · on device' : s.engine === 'gemini' ? 'Gemini · cloud' : line.replace(/^SIM · /, '') || 'On device';
      setRouteBadge(s.sim ? `SIM · ${badge}` : badge);
    }
    if (ctx.swarm === false) return;
    // Swarm cursors spin up for this real call — a mix of Gemini (planning,
    // layout, tile frames) and Nano (labels, device values, redaction/Kannada
    // swaps) sub-steps, honestly capped at REAL_CALL_CAP real calls. A call
    // that ran on Nano shows Nano cursors only.
    swarmStartedAt = Date.now();
    const plan = ctx.swarmPlan ?? buildMixedSwarmPlan(s.engine, ctx.task ?? 'generic', {
      tileCount: ctx.tileCount,
      redactedName: protect.used.length > 0,
    });
    swarm.start(plan, opts.sim ? 1 : Date.now());
    swarm.reportBytes(ledger.totals().aiBytes, ledger.totals().simBytes);
    swarmDock.start(buildSwarmAgents(plan), {
      reducedMotion: reduced,
      payloads: s.engine === 'gemini' ? { gemini: cloudReceivedDetail(protect.promptText, activePeople()) } : {},
    });
  }
  /** A real model call failed and a prepared (SIM) draft takes over: only the
   *  route label changes. No second ledger line, no second cloud `received`,
   *  no new swarm — only what really left is ever booked. */
  function aiFellBack(s: SentInfo): void {
    if (s.routeLine) panels.forEngine(s.engine).log('note', s.routeLine);
  }
  /** The full-screen review's `extra`: the live terminals + footer, so a
   *  review is never just the proposal summary with no trace of who worked
   *  on it or what left the device. Clones the live DOM nodes rather than
   *  re-deriving their state. */
  function buildReviewExtra(): HTMLElement | null {
    const extra = document.createElement('div');
    extra.className = 'mc-review-extra-content';
    const terminalsEl = aiPanel.querySelector<HTMLElement>('.mc-terminals');
    if (terminalsEl && !terminalsEl.hidden) extra.append(terminalsEl.cloneNode(true) as HTMLElement);
    const footerEl = aiPanel.querySelector<HTMLElement>('.mc-ai-footer');
    if (footerEl && !footerEl.hidden) extra.append(footerEl.cloneNode(true) as HTMLElement);
    return extra.childElementCount ? extra : null;
  }
  // Per-frame ghost reveal timers: a safety net so a tile never sits as an
  // empty dashed placeholder forever, even if its swarm cursor never lands
  // (e.g. the build settles early). flashGhostTarget's reveal, when it
  // fires first, simply makes these timers no-ops (classList checks).
  const ghostTimers = new Map<string, number[]>();
  function clearGhostTimers(frameId: string): void {
    (ghostTimers.get(frameId) ?? []).forEach((id) => window.clearTimeout(id));
    ghostTimers.delete(frameId);
  }
  const ghostKindWord = (t: PartialPlan['tiles'][number]): string =>
    t.type === 'lamp' ? 'Lamp' : t.type === 'music' ? 'Music' : t.type === 'switch' ? 'Switch'
    : t.type === 'scene' ? 'Scene' : t.type === 'connect' ? 'Connect' : 'Plan';
  const ghostFullLabel = (t: PartialPlan['tiles'][number]): string =>
    t.type === 'lamp' ? `Lamp · ${esc(t.label)}`
    : t.type === 'music' ? `Music · ${esc(t.label)}`
    : t.type === 'switch' ? `Switch · ${esc(t.label)}`
    : t.type === 'scene' ? `Scene · ${esc(t.label)}`
    : t.type === 'connect' ? 'Connect a device'
    : 'Floor plan';
  function revealGhostTile(tileEl: HTMLElement, stage: 'controls' | 'labels'): void {
    if (stage === 'controls') {
      tileEl.classList.remove('stage-frame');
      tileEl.classList.add('stage-controls');
      tileEl.querySelector<HTMLElement>('.mc-ghost-tile-kind')!.hidden = false;
    } else {
      tileEl.classList.add('stage-labels');
      tileEl.querySelector<HTMLElement>('.mc-ghost-tile-kind')!.hidden = true;
      tileEl.querySelector<HTMLElement>('.mc-ghost-tile-value')!.hidden = false;
    }
  }
  /** The swarm's own cursor landing on tile N — Gemini "frames" it first,
   *  Nano "labels" it after, matching the two visible fill stages. Also
   *  flashes a selection box + crosshair on the TARGET tile (not the
   *  cursor badge) for ~900ms. */
  function flashGhostTarget(tileIndex: number, kind: SwarmKind): void {
    const id = focusId ?? lastFocus;
    const tileEl = id ? world.querySelector<HTMLElement>(`[data-frame="${id}"] .mc-ghost-tile[data-tile-i="${tileIndex}"]`) : null;
    // A morph turn has no ghost — its cursors land on the real tile instead.
    if (!tileEl) { morphFlow?.pulseTarget(); return; }
    tileEl.classList.add('is-swarm-target');
    window.setTimeout(() => tileEl.classList.remove('is-swarm-target'), 900);
    // The first cursor on a tile frames it, the next labels it (a Nano-only
    // turn has no Gemini framer, so its first Nano cursor frames).
    revealGhostTile(tileEl, kind === 'gemini' || tileEl.classList.contains('stage-frame') ? 'controls' : 'labels');
  }
  function ghost(frameId: string, g: PartialPlan | null): void {
    const el = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-ghost`);
    if (!el) return;
    clearGhostTimers(frameId);
    if (!g) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<p class="mc-ghost-title">${esc(g.title ?? '…')}</p>` + g.tiles.map((t, i) =>
      `<div class="mc-ghost-tile ${t.type} stage-frame" data-tile-i="${i}">` +
      `<span class="mc-ghost-tile-kind" hidden>${esc(ghostKindWord(t))}</span>` +
      `<span class="mc-ghost-tile-value" hidden>${ghostFullLabel(t)}</span></div>`).join('')
      + '<div class="mc-ghost-tile next">…</div>';
    const timers: number[] = [];
    el.querySelectorAll<HTMLElement>('.mc-ghost-tile[data-tile-i]').forEach((tileEl, i) => {
      if (reduced) { revealGhostTile(tileEl, 'controls'); revealGhostTile(tileEl, 'labels'); return; }
      timers.push(window.setTimeout(() => revealGhostTile(tileEl, 'controls'), 160 + i * 110));
      timers.push(window.setTimeout(() => revealGhostTile(tileEl, 'labels'), 420 + i * 110));
    });
    ghostTimers.set(frameId, timers);
  }
  function openMonitor(): void {
    if (phoneShell) return;
    const w = window.open('/monitor.html', 'mendcraft-monitor');
    if (!w) say('Allow pop-ups to open the AI monitor.');
  }
  function ledgerTotalRender(): void {
    const lines = ledgerPanelLines(ledger);
    aiPanel.querySelector('.mc-ai-ledger-total')!.textContent = lines.ai;
    const sp = aiPanel.querySelector<HTMLElement>('.mc-ai-ledger-spotify');
    if (sp) { sp.textContent = lines.spotify; sp.hidden = !lines.spotify; }
  }
  function historyRender(): void {
    ledgerTotalRender();
    const entries = history.list();
    let lastActive = -1;
    for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].undone) { lastActive = i; break; }
    const emptyHint = aiPanel.querySelector<HTMLElement>('.mc-ai-history-empty');
    if (emptyHint) emptyHint.hidden = entries.length > 0;
    aiPanel.querySelector('.mc-ai-history')!.innerHTML = entries.map((h, i) => {
      const who = h.by === 'gemini' ? 'Deep' : h.by === 'nano' ? 'Quick' : 'You';
      const time = new Date(h.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const undoBtn = i === lastActive ? ` <button class="mc-btn mc-hist-undo" type="button" data-hist-undo>Undo</button>` : '';
      return `<li class="${h.undone ? 'undone' : ''}">${esc(h.summary)} · <span class="who">${who} · ${esc(time)}</span>${h.undone ? ' · undone' : ''}${undoBtn}</li>`;
    }).reverse().join('');
  }
  function openHistory(): void {
    showAi(true, true);
    historyRender();
    const list = aiPanel.querySelector<HTMLElement>('.mc-ai-history')!;
    list.scrollIntoView?.({ block: 'end' });
    list.focus?.();
    say('History: who changed what, and when. The latest change has an Undo.');
  }

  // Gimbal follows the user (native only — soft-fails to a no-op on the web)
  // for exactly as long as a board is being built, i.e. the model call, not
  // the Proposal card that waits on her keep/drop afterwards.
  const withBuildGimbal = <T>(run: () => Promise<T>): Promise<T> => followWhileBuilding(inputs.gimbal, run);

  // What the Nano→Deep handoff line promises, given to Deep in the prompt only.
  const DEEP_ROOM_GOAL = 'Improve the current board: group the lights and add a room plan tile.';
  /** Stream one model turn into the ghost; the plan and its ledger receipt,
   *  or null (failed / cancelled — the reason was already said). */
  async function streamTurn(frameId: string, engineId: EngineId, utterance: string, script: string, task: SwarmTask, goal: string | undefined,
    current: SurfacePlan | null, retry: () => void): Promise<{ plan: SurfacePlan; si: SentInfo } | null> {
    const f = reg.get(frameId); if (!f) return null;
    const engine = engineFor(engineId, script.replace('BOARD', frameId));
    let sentInfo: SentInfo | null = null;
    const plan = await withBuildGimbal(() => runSurfaceTurn({ utterance: goal ? `${utterance}. ${goal}` : utterance, frameTitle: f.title, devices: deviceHints(), current }, engine, {
      onSent: (s) => { sentInfo = s; aiSent(utterance, s, { task, tileCount: surfaces[frameId]?.tiles.length }); },
      onFallback: aiFellBack,
      onGhost: (g) => ghost(frameId, g),
      onNote: (note) => {
        const state = aiPanel.querySelector('.mc-ai-state');
        if (state) state.textContent = note;
      },
      onError: (why) => {
        settleSwarm();
        panels.forEngine(engineId).fail(why);
        aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why);
        offerRetry(retry);
      },
    }, { deviceIdSession, isCancelled: () => engineId === 'gemini' && !net.isOnline() }));
    const si = sentInfo as SentInfo | null;
    return plan && si ? { plan, si } : null;
  }

  interface TurnDraft { plan: SurfacePlan; si: SentInfo; summary: string; status: ProposalStatus }
  /** `improve`: this turn improves an unreviewed draft (its plan is the
   *  model's starting point). If the turn fails, the draft itself goes to
   *  review — one request, one review, whichever engine finished it. */
  async function aiTurn(frameId: string, engineId: EngineId, utterance: string, script: string, summary: string, status: ProposalStatus, task: SwarmTask = 'dashboard', goal?: string, improve?: TurnDraft): Promise<boolean> {
    if (turnBusy) return false; // a turn is already streaming/awaiting its review
    turnBusy = true;
    try {
      if (!reg.get(frameId)) return false;
      const out = await streamTurn(frameId, engineId, utterance, script, task, goal, improve ? improve.plan : surfaces[frameId] ?? null,
        () => { void aiTurn(frameId, engineId, utterance, script, summary, status, task, goal); });
      if (!out) {
        settleSwarm(); ghost(frameId, null);
        return improve ? await proposePlan(frameId, utterance, improve.plan, improve.si, improve.summary, improve.status) : false;
      }
      return await proposePlan(frameId, utterance, out.plan, out.si, summary, status);
    } finally { turnBusy = false; settleEngines(); autoHideAi(); }
  }

  /** A quick on-device draft that is NOT reviewed on its own: the next
   *  (Gemini) turn improves it and the person reviews the result once. */
  async function draftTurn(frameId: string, engineId: EngineId, utterance: string, script: string, summary: string, status: ProposalStatus): Promise<TurnDraft | null> {
    if (turnBusy) return null;
    turnBusy = true;
    try {
      if (!reg.get(frameId)) return null;
      const out = await streamTurn(frameId, engineId, utterance, script, 'dashboard', undefined, surfaces[frameId] ?? null,
        () => { void connectRoom(frameId, utterance); });
      await holdSwarmMinimum();
      settleSwarm();
      if (!out) { ghost(frameId, null); return null; }
      const check = gateMessages(expandPlan(out.plan, frameId, store.all()), CATALOG_SCHEMAS);
      if (!check.ok) { ghost(frameId, null); say('Blocked a plan that did not pass the check.'); return null; }
      panels.forEngine(out.si.engine).log('done', `draft: ${out.plan.tiles.length} tile${out.plan.tiles.length === 1 ? '' : 's'} for Gemini to improve`);
      return { ...out, summary, status };
    } finally { turnBusy = false; settleEngines(); }
  }

  /** Gate a plan, show the Proposal card, and apply only on keep (shared by
   *  the room/floor-plan turns and the connect turns). */
  async function proposePlan(frameId: string, utterance: string, plan: SurfacePlan, si: SentInfo, summary: string, status: ProposalStatus): Promise<boolean> {
    // The proposal/review is ready — the swarm settles now (after a minimum
    // hold in sim so it's never decoration flashing by unseen), not left
    // running past the real work it stood for.
    await holdSwarmMinimum();
    settleSwarm();
    panels.forEngine(si.engine).log(si.engine === 'gemini' ? 'replied' : 'done',
      `${plan.tiles.length} tile${plan.tiles.length === 1 ? '' : 's'} filled`);
    const check = gateMessages(expandPlan(plan, frameId, store.all()), CATALOG_SCHEMAS);
    if (!check.ok) { ghost(frameId, null); say('Blocked a plan that did not pass the check.'); return Promise.resolve(false); }
    aiPanel.querySelector('.mc-ai-state')!.textContent = 'Waiting for you. Nothing changes until you keep it.';
    // Where it actually ran (a phone's "Nano" step is really Deep in the cloud).
    const ranId: EngineId = si.engine;
    return new Promise((done) => {
      const before = surfaces[frameId] ?? null;
      const prop = createSurfaceProposal(`p-${Date.now()}`, ranId, summary, check.messages, () => {
        try {
          surfaces[frameId] = plan; reg.rename(frameId, plan.title); reg.setKind(frameId, plan.kind === 'plan' ? 'plan' : 'room');
          if (!renderSurface(frameId)) throw new Error('Could not render the board');
          history.push({ frameId, before, after: plan, by: ranId, summary });
          sync(); updateDock(); persist(); historyRender();
          // First build on an empty focused board: re-place it (no animation, before the
          // self-check measures) so a wide dashboard opens at its top-left on a phone.
          if (!before && focusId === frameId) { const ff = reg.get(frameId); if (phoneShell) fitPhone(); else if (ff) { camera = focusCam(ff); applyCamera(); } }
          selfCheckTiles(frameId);
        } catch (e) {
          if (before) { surfaces[frameId] = before; renderSurface(frameId); }
          else { delete surfaces[frameId]; const el = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-surface`); if (el) el.innerHTML = ''; }
          sync(); updateDock(); persist();
          const why = e instanceof Error ? e.message : 'The build failed after Approve';
          panels.forEngine(ranId).fail(why);
          say(why);
        }
      });
      const finish = (kept: boolean) => {
        reviewDialog.close(); ghost(frameId, null); pending = null;
        aiPanel.querySelector('.mc-ai-state')!.textContent = kept ? `Kept. Say “undo” to put it back.` : 'Dropped. Nothing changed.';
        autoHideAi();
        say(kept ? `Kept: ${summary}. Say “undo” to put it back.` : 'Dropped. Nothing changed.');
        done(kept);
      };
      const card = renderProposalCard(document, {
        id: `p-${frameId}`, title: summary, youAsked: utterance, status,
        catalog: { helper: ranId === 'nano' ? 'Quick' : 'Deep', byLine: ranId === 'nano' ? 'Quick · on this device' : 'Deep · online',
          routeLine: si.routeLine, lineId: 'custom', whyLabel: ranId === 'nano' ? 'Why here' : 'Why online', whatWasSent: si.sent, technicalLine: si.routeLine },
      }, { onKeep: () => { prop.accept(); finish(true); }, onDrop: () => { prop.reject(); finish(false); } });
      tagCardI18n(card);
      pending = { frameId, prop, card };
      // Every decision — desktop or phone — opens the same full-screen review,
      // so there's one place keep/drop (voice, pinch, Approve/Reject) acts on.
      showReview({
        title: summary, card, extra: buildReviewExtra(),
        // A blank board still has a name ("Board 3"): diff against it, so the
        // plan says "Board 3 → This room" — or nothing when the name stays.
        changes: diffPlans(before ?? { kind: plan.kind, title: reg.get(frameId)?.title ?? plan.title, tiles: [] }, plan, { devices: store.all() }),
        facts: reviewFacts(si, utterance),
      });
      say(`${summary}. Approve or say “keep”; Reject or say “drop”.`);
    });
  }

  /** Boards whose Deep (Gemini) pass was skipped offline; run on reconnect. */
  const deepLater: Array<{ frameId: string; utterance: string }> = [];
  async function runDeepLater(): Promise<void> {
    while (deepLater.length && net.isOnline()) {
      if (reviewBusy()) return; // retried after the waiting proposal is decided
      const next = deepLater.shift()!;
      if (!reg.get(next.frameId) || !surfaces[next.frameId]) continue; // board deleted meanwhile
      panels.forEngine('nano').setQueued(net.laterCount() + deepLater.length);
      panels.showHandoff('nano', 'group the lights and add a room plan');
      await aiTurn(next.frameId, 'gemini', next.utterance, SCRIPTS.geminiRoom, 'Better: grouped lights + a room plan', 'changed', 'dashboard', DEEP_ROOM_GOAL);
    }
  }

  async function connectRoom(frameId: string, utterance = 'connect everything in this room'): Promise<void> {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const DRAFT = 'Draft: 2 lamps found in this room';
    if (net.isOnline()) {
      // One request, one review: Nano drafts on this device (shown in the
      // ghost, not reviewed on its own), Gemini improves that draft, and the
      // person approves the result once. The review's footer names Gemini
      // and what it sent; the draft itself sent nothing.
      const draft = await draftTurn(frameId, 'nano', utterance, SCRIPTS.nanoRoom, DRAFT, 'guess');
      if (!draft) return;
      panels.showHandoff('nano', 'group the lights and add a room plan');
      // Tell Deep what the handoff line promises (only in the prompt; her card
      // still shows her own words) — without it the live model never added the
      // room plan: 0/3 → 7/7 boards with it (live-build study).
      await aiTurn(frameId, 'gemini', utterance, SCRIPTS.geminiRoom, 'Room dashboard: grouped lights + a room plan', 'changed', 'dashboard', DEEP_ROOM_GOAL, draft);
      return;
    }
    const kept = await aiTurn(frameId, 'nano', utterance, SCRIPTS.nanoRoom, DRAFT, 'guess');
    if (!kept) return;
    if (!net.isOnline()) { // offline: Deep can't improve it; keep the on-device draft
      panels.forEngine('nano').log('note', ROUTE_LINES.offline);
      aiPanel.querySelector('.mc-ai-state')!.textContent = OFFLINE_QUICK_ONLY;
      // A7-026: the status promises Deep will run on reconnect — actually
      // queue it (one per board), and count it with the other saved requests.
      if (!deepLater.some((d) => d.frameId === frameId)) deepLater.push({ frameId, utterance });
      panels.forEngine('nano').setQueued(net.laterCount() + deepLater.length);
      say(`${OFFLINE_QUICK_ONLY}. Deep will improve it when you're back online.`);
      return;
    }
    panels.showHandoff('nano', 'group the lights and add a room plan');
    // Tell Deep what the handoff line promises (only in the prompt; her card
    // still shows her own words) — without it the live model never added the
    // room plan: 0/3 → 7/7 boards with it (live-build study).
    await aiTurn(frameId, 'gemini', utterance, SCRIPTS.geminiRoom, 'Better: grouped lights + a room plan', 'changed', 'dashboard', DEEP_ROOM_GOAL);
  }
  function floorPlan(frameId: string, utterance = 'start a floor plan'): void {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    void aiTurn(frameId, 'nano', utterance, SCRIPTS.nanoPlan, 'Floor plan: two bedrooms', 'waiting', 'floorplan');
  }

  // ---- connect a device: sheet (point / name / phone) + merge-on-keep turns ----
  const simEnv = () => engineFor('gemini', '{}').sim;

  /** A connect AI turn (point / by-name / scan): visible receipt and ghost, then
   *  a Proposal whose keep MERGES the tiles into the board (no dupes, ≤ MAX_TILES). */
  async function connectTurn(frameId: string, utterance: string, turn: ConnectTurnResult, summary: string, status: ProposalStatus, o: { photoNote?: boolean; identified?: boolean; extraBytes?: number; prebookedBytes?: number; note?: string; swarm?: boolean } = {}): Promise<boolean> {
    if (turnBusy) return false; // a turn is already streaming/awaiting its review
    turnBusy = true;
    try {
      const f = reg.get(frameId); if (!f) return false;
      // identified: the model work already happened (identifyDevice) and its
      // honest route/sim label is on turn.sent; the tile is the deterministic
      // mapping of that identity, replayed into the ghost — no second call.
      const engine = o.identified ? turn.engine : engineFor(turn.sent.engine, turn.json);
      if (!o.identified) {
        if (engine.routeLine) turn.sent.routeLine = engine.sim ? (engine.routeLine.startsWith('SIM') ? engine.routeLine : `SIM · ${engine.routeLine}`) : engine.routeLine;
        turn.sent.sim = engine.sim;
      }
      aiSent(utterance, turn.sent, { task: 'dashboard', tileCount: surfaces[frameId]?.tiles.length, extraBytes: o.extraBytes, prebookedBytes: o.prebookedBytes, swarm: o.swarm });
      if (o.note) panels.forEngine(turn.sent.engine).log('note', o.note);
      if (o.photoNote) panels.forEngine(turn.sent.engine).log('note', 'no camera or gimbal here, so the photo is simulated.');
      const streamOne = (eng: typeof engine) => eng.stream(turn.sent.prompt, (chunk) => {
        ghost(frameId, parsePartialPlan(chunk));
      });
      let full = '';
      try {
        full = await withBuildGimbal(() => streamOne(engine));
      } catch (e) {
        const fallbackEngine = engine.fallback;
        if (!fallbackEngine) {
          const why = `${turn.sent.engine === 'nano' ? 'Nano' : 'Gemini'} didn’t answer: ${e instanceof Error ? e.message : String(e)}`;
          settleSwarm(); aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); ghost(frameId, null); return false;
        }
        turn.sent.sim = true;
        turn.sent.routeLine = `SIM · ${turn.sent.routeLine.replace(/^SIM · /, '')} — the model didn’t answer, so a prepared draft is waiting`;
        aiFellBack(turn.sent);
        try {
          full = await withBuildGimbal(() => streamOne(fallbackEngine));
        } catch (e2) {
          const why = `${turn.sent.engine === 'nano' ? 'Nano' : 'Gemini'} didn’t answer: ${e2 instanceof Error ? e2.message : String(e2)}`;
          settleSwarm(); aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); ghost(frameId, null); return false;
        }
      }
      const parsed = parseModelPlan(full);
      if (!parsed.ok) { settleSwarm(); ghost(frameId, null); say(parsed.error.startsWith('The reply') ? parsed.error : `Refused the plan: ${parsed.error}`); return false; }
      const plan = parsed;
      const before: SurfacePlan = surfaces[frameId] ?? { kind: 'room', title: f.title, tiles: [] };
      const merged = mergeTiles(before, plan.value.tiles);
      if (merged.tiles.length === before.tiles.length) {
        settleSwarm();
        ghost(frameId, null);
        aiPanel.querySelector('.mc-ai-state')!.textContent = 'Already on this board — nothing new to add.';
        say('That device is already on this board.');
        return false;
      }
      return await proposePlan(frameId, utterance, merged, turn.sent, summary, status);
    } finally { turnBusy = false; }
  }

  // ---- point-to-connect: hold a point (or click, hands off) → one frame →
  // crop along the finger → identifyDevice (Nano first, Gemini cloud second)
  // → the mapped tile through the normal review. Never a default device.
  // Intentionally NOT gated on the facing signal (handPointer.setFacing):
  // you look at the device you point at, not at this screen.
  const POINT_UTTERANCE = 'connect what I am pointing at';
  const POINT_WAIT_MS = 20_000;
  /** How long "Desk lamp or ceiling light?" waits for her answer. */
  const POINT_CHOICE_MS = 20_000;
  /** prebooked: bytes already in the ledger (booked when the crop left).
   *  viaIphone: the iPhone took and identified the photo (its own receipt). */
  type PointOpts = { cropBytes: number; sim: boolean; cloudSends?: number; cloudAnswered?: boolean; prompt?: string; chosenId?: string; prebooked?: number; viaIphone?: boolean };
  /** phone: the frames come from the iPhone's own sensing camera (bigger
   *  crop, out-of-frame check). remote: the laptop asked for this photo —
   *  send the identity back instead of proposing here. */
  let pointWait: { frameId: string; steady: SteadyHold; timer: ReturnType<typeof setTimeout>; cleanup: () => void; phone?: boolean; remote?: boolean } | null = null;
  /** Laptop: waiting for the iPhone's point photo result. */
  let iphonePoint: { frameId: string; timer: ReturnType<typeof setTimeout> } | null = null;
  /** "Desk lamp or ceiling light?" is waiting for her answer (one question). */
  let pointChoice: { frameId: string; r: PointIdentifyResult; o: PointOpts; choices: DeviceHint[]; timer: ReturnType<typeof setTimeout> } | null = null;
  /** Clear the pending question (and its expiry) and return it. */
  function takePointChoice(): NonNullable<typeof pointChoice> | null {
    const pc = pointChoice;
    pointChoice = null;
    if (pc) clearTimeout(pc.timer);
    return pc;
  }
  /** The bytes a point's cloud sends carried (crop × sends, plus the prompt
   *  each time) — booked the moment they left, once per point. */
  function bookPointSends(r: PointIdentifyResult | null, o: PointOpts): void {
    if (o.prebooked != null) return;
    const sends = Math.max(r?.source === 'cloud' ? 1 : 0, o.cloudSends ?? 0);
    const receipt = pointFailureReceipt({ cropBytes: o.cropBytes, cloudSends: sends, cloudAnswered: o.cloudAnswered || r?.source === 'cloud' });
    o.prebooked = 0;
    if (receipt.bytes <= 0) return;
    const prompt = o.prompt ?? '';
    const entry = ledger.record({ engine: 'gemini', sentText: prompt, extraBytes: receipt.bytes + utf8ByteLength(prompt) * (sends - 1), sim: o.sim });
    o.prebooked = entry.bytes;
    renderBytes();
  }
  /** Bytes beyond one copy of the prompt for a point turn that sent `sends`
   *  times: the crop each time AND the prompt again on every extra send — the
   *  same sum bookPointSends puts in the ledger, so the review footer
   *  ("What left this device") matches the ledger total. */
  function pointExtraBytes(cropTotal: number, prompt: string, r: PointIdentifyResult | null, o: PointOpts): number {
    if (cropTotal <= 0) return cropTotal;
    const sends = Math.max(r?.source === 'cloud' ? 1 : 0, o.cloudSends ?? 0);
    return cropTotal + utf8ByteLength(prompt) * Math.max(0, sends - 1);
  }
  function endPointWait(): void {
    if (!pointWait) return;
    clearTimeout(pointWait.timer);
    pointWait.cleanup();
    pointWait = null;
  }
  /** Fed from the hand frame loop (raw camera-space hands) while a point is
   *  armed. Only a hand that is actually pointing (index extended) counts. */
  function feedPointWait(cam: readonly (readonly CropPt[])[], now: number): void {
    if (!pointWait) return;
    const h = cam[0];
    const pointing = !!h && h.length > 17 && isIndexExtended(h);
    const palm = pointing ? palmCenter(h as Parameters<typeof palmCenter>[0]) : null;
    if (!pointWait.steady.update(palm, now)) return;
    const { frameId: fid, phone, remote } = pointWait;
    // The crop is taken synchronously inside capturePoint (live video), so
    // it happens before cleanup releases the gimbal hold / sensing camera.
    void capturePoint(fid, h.map((p) => ({ x: p.x, y: p.y })), null, { phone, remote });
    endPointWait();
  }
  /** Ledger + feed for a point that did not become a proposal. Goes through
   *  logTurnReceipt first, so Nano's "received" precedes any Gemini line. */
  function ledgerPointFailure(r: PointIdentifyResult | null, o: PointOpts, idNote: string | null): void {
    const sends = Math.max(r?.source === 'cloud' ? 1 : 0, o.cloudSends ?? 0);
    const receipt = pointFailureReceipt({ cropBytes: o.cropBytes, cloudSends: sends, cloudAnswered: o.cloudAnswered || r?.source === 'cloud' });
    const engine = receipt.bytes > 0 ? 'gemini' : 'nano';
    const prompt = o.prompt ?? '';
    showAi(true);
    aiPanel.querySelector<HTMLElement>('.mc-ai-empty')!.hidden = true;
    panels.show();
    logTurnReceipt(panels, { engine, utterance: POINT_UTTERANCE, used: [], people: activePeople(), cloudPayload: prompt });
    if (idNote) panels.forEngine(r?.source === 'cloud' ? 'gemini' : 'nano').log('note', idNote);
    // The prompt text went with every send, and the crop each time (booked
    // once: a point whose question was pending already booked them).
    bookPointSends(r, o);
    panels.forEngine(engine).log('note', `${o.sim ? 'SIM · ' : ''}${receipt.line}`);
  }
  /** Her answer to the clarifying question; anything else drops it (and
   *  books what already left) and routes normally. */
  function handlePointChoice(text: string): boolean {
    const pc = takePointChoice();
    if (!pc) return false;
    const pick = pickPointChoice(text, pc.choices);
    if (!pick) { ledgerPointFailure(pc.r, pc.o, null); return false; }
    void finishPoint(pc.frameId, pc.r, { ...pc.o, chosenId: pick.id });
    return true;
  }
  async function pointTurn(frameId: string, o: { skipIphone?: boolean } = {}): Promise<void> {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const f = reg.get(frameId); if (!f) return;
    endPointWait();
    { const pc = takePointChoice(); if (pc) ledgerPointFailure(pc.r, pc.o, null); }
    if (opts.sim) {
      // ?sim=1: no camera. A scripted identity (a WiZ desk lamp), labelled SIM.
      const simIphone = pairFirst.phones().some((p) => p.sim && isIphoneRow(p));
      say(simIphone ? 'SIM: the iPhone camera would take this photo. Point at it and hold still.' : 'Point at it and hold still.');
      await finishPoint(frameId, { identity: SIM_POINT_IDENTITY, source: 'on-device', ms: 0 }, { cropBytes: 0, sim: true });
      return;
    }
    // Laptop with a paired iPhone that can sense: the iPhone takes the photo
    // with its own camera (its gimbal holds), identifies it, and sends back
    // only the identity. Its monitor tab shows what stayed on device.
    const iphone = !phoneShell && hostSession ? phoneSense.get('ios') : undefined;
    if (!o.skipIphone && iphone?.canPoint && hostSession) {
      if (iphonePoint) clearTimeout(iphonePoint.timer);
      iphonePoint = {
        frameId,
        timer: setTimeout(() => { if (iphonePoint?.frameId === frameId) { iphonePoint = null; say('The iPhone didn’t send a photo — say it again, or name the device.'); } }, POINT_WAIT_MS + 8000),
      };
      say(PHONE_POINT_LINE);
      void hostSession.askSensePoint('ios').catch(() => { iphonePoint = null; say('Couldn’t reach the iPhone — say it again, or name the device.'); });
      return;
    }
    if (!phoneShell && pairFirst.phones().some((p) => isIphoneRow(p))) say(PHONE_POINT_FALLBACK);
    if (phoneSensor) { await phoneSensorPoint(frameId, false); return; }
    const timer = setTimeout(() => {
      if (pointWait?.frameId !== frameId) return;
      endPointWait();
      say('I didn’t catch a steady point — say it again, or name the device.');
    }, POINT_WAIT_MS);
    if (handsOn) {
      // A docked gimbal holds still during the steady point (no aiming), and
      // goes back to its mode once the one frame is grabbed (the crop is taken
      // synchronously right after cleanup). Web: a no-op.
      const prevGimbal = inputs.gimbal.mode();
      void inputs.gimbal.setMode('point').catch(() => {});
      pointWait = { frameId, steady: createSteadyHold(), timer, cleanup: () => { void inputs.gimbal.setMode(prevGimbal).catch(() => {}); } };
      say('Point at it and hold still.');
      return;
    }
    if (isIosShell()) {
      // No sensing layer on this iPhone build/camera: don't pretend.
      clearTimeout(timer);
      say(POINT_NEEDS_LAPTOP);
      return;
    }
    // Hands off: ONE click on the canvas picks the point (the screen is a
    // mirror of the camera, so x flips), then one frame is captured. Only
    // that click is swallowed; the listener goes on the click, Escape or the
    // timeout.
    const onClick = (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      const w = window.innerWidth || 1, h = window.innerHeight || 1;
      const pt = { x: 1 - e.clientX / w, y: e.clientY / h };
      endPointWait();
      void capturePoint(frameId, null, pt);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      endPointWait();
      say('Cancelled — nothing was captured.');
    };
    viewport.addEventListener('click', onClick, { capture: true });
    document.addEventListener('keydown', onKey);
    pointWait = {
      frameId, steady: createSteadyHold(), timer,
      cleanup: () => { viewport.removeEventListener('click', onClick, { capture: true }); document.removeEventListener('keydown', onKey); },
    };
    say('Hands are off — click where the device is (as in a mirror) and I’ll take one photo. Esc cancels.');
  }
  async function capturePoint(frameId: string, landmarks: CropPt[] | null, clickPt: CropPt | null, how: { phone?: boolean; remote?: boolean } = {}): Promise<void> {
    const sendBack = (res: PhonePointResult): void => { opts.sendPointResult?.(encodePointResult(res)); };
    if (!how.remote && reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    // Reuse the hand tracker's live camera; only hands-off opens it once.
    let video = findLiveVideo();
    let once: Awaited<ReturnType<typeof openCameraOnce>> = null;
    // iPhone sensing: the photo comes from the hub's own stream (the tracker's
    // tagged <video>) — never a second getUserMedia.
    if (!video && !how.phone) { once = await openCameraOnce(); video = once?.video ?? null; }
    let shot: ReturnType<typeof captureCrop> = null;
    let pointer: CropPt | undefined;
    try {
      if (video) {
        const W = video.videoWidth, H = video.videoHeight;
        // iPhone: lamp beside her face — a 42–45 %-of-width crop (pointCrop.ts).
        const ray = how.phone && landmarks ? { fraction: phoneCropFraction(landmarks, W, H) } : {};
        if (how.phone && landmarks && rayOutOfFrame(landmarks, W, H, ray)) {
          // The device is not in this camera's view: never guess.
          say(POINT_OUT_OF_FRAME);
          if (how.remote) sendBack({ ok: false, reason: 'out-of-frame', message: POINT_OUT_OF_FRAME });
          return;
        }
        const rect = landmarks ? cropAlongRay(landmarks, W, H, ray) : cropAroundPoint(clickPt, W, H);
        const aim = landmarks ? rayTarget(landmarks, W, H, ray) : clickPt;
        pointer = aim ? pointerInCrop(aim, rect, W, H) : undefined;
        shot = captureCrop(video, rect);
      }
    } finally { once?.stop(); }
    if (!shot) {
      say('I couldn’t get a camera frame — try naming the device instead.');
      if (how.remote) sendBack({ ok: false, reason: 'no-frame', message: 'The iPhone couldn’t get a camera frame.' });
      return;
    }
    say('Got it — looking at what you pointed at…');
    const hint = pointer ? { pointer } : undefined;
    const trace: VisionTrace = { cloudSends: 0 };
    const r = await identifyDevice(shot, hint, trace).catch(() => null);
    const o: PointOpts = { cropBytes: shot.bytes, sim: false, cloudSends: trace.cloudSends, cloudAnswered: trace.cloudAnswered, prompt: buildIdentifyPrompt(hint) };
    if (how.remote) {
      // The laptop proposes the tile. Here: book what left THIS phone and
      // show the identify in this phone's AI feed (→ the monitor's iPhone tab).
      const idNote = r ? `identify for the laptop: ${r.identity.label} (${r.identity.kind}) · ${Math.round(r.identity.confidence * 100)}% · ${r.source === 'cloud' ? 'Gemini · cloud' : 'on device'}` : 'identify for the laptop: nothing recognised';
      ledgerPointFailure(r, o, idNote);
      sendBack(r && r.identity.kind !== 'none'
        ? { ok: true, identity: r.identity, source: r.source, ms: r.ms, cropBytes: shot.bytes, cloudSends: Math.max(r.source === 'cloud' ? 1 : 0, trace.cloudSends ?? 0) }
        : { ok: false, reason: 'unidentified', message: 'The iPhone couldn’t tell what that was.' });
      return;
    }
    await finishPoint(frameId, r, o);
  }
  /** iPhone: the sensing layer arms a steady point (not facing-gated); the
   *  gimbal holds still; the photo comes from the SAME phone camera stream. */
  async function phoneSensorPoint(frameId: string, remote: boolean): Promise<void> {
    if (!phoneSensor) return;
    endPointWait();
    const prevGimbal = inputs.gimbal.mode();
    void inputs.gimbal.setMode('point').catch(() => {});
    await phoneSensor.request('point', true);
    const release = (): void => { void phoneSensor?.request('point', false); void inputs.gimbal.setMode(prevGimbal).catch(() => {}); };
    if (!phoneSensor.running()) {
      release();
      const why = phoneSensor.statusLine();
      say(`${why}. ${POINT_NEEDS_LAPTOP}`);
      if (remote) opts.sendPointResult?.(encodePointResult({ ok: false, reason: 'no-camera', message: why }));
      return;
    }
    const timer = setTimeout(() => {
      if (pointWait?.frameId !== frameId) return;
      endPointWait();
      say('I didn’t catch a steady point — say it again, or name the device.');
      if (remote) opts.sendPointResult?.(encodePointResult({ ok: false, reason: 'timeout', message: 'No steady point on the iPhone.' }));
    }, POINT_WAIT_MS);
    pointWait = { frameId, steady: createSteadyHold(), timer, cleanup: release, phone: true, remote };
    say(remote ? `${phoneSensor.statusLine()}. Point at it and hold still — this camera takes one photo for the laptop.` : PHONE_POINT_LINE);
  }
  /** Laptop: the iPhone's answer to askSensePoint. */
  function onIphonePointResult(text: string): void {
    // Only while a point is pending, and only once an iPhone with sensing has
    // announced itself (the relay cannot say which phone sent a message).
    const res = coercePointResult(text);
    const wait = iphonePoint;
    if (!res || !wait || !phoneSense.has('ios')) return;
    clearTimeout(wait.timer);
    iphonePoint = null;
    if (!res.ok && res.reason === 'no-camera') {
      // The iPhone camera is denied / gone: the laptop camera takes over.
      void pointTurn(wait.frameId, { skipIphone: true });
      return;
    }
    if (!res.ok) { say(res.message || 'The iPhone couldn’t identify that — name the device instead.'); return; }
    // Nothing crossed from THIS laptop: the photo stayed on the iPhone (its own
    // ledger + monitor tab books any crop it sent to Gemini).
    void finishPoint(wait.frameId, { identity: res.identity, source: res.source, ms: res.ms }, { cropBytes: 0, sim: false, cloudSends: 0, prompt: '', viaIphone: true });
  }
  async function finishPoint(frameId: string, r: PointIdentifyResult | null, o: PointOpts): Promise<void> {
    const f = reg.get(frameId); if (!f) return;
    const where = r ? (r.source === 'cloud' ? 'Gemini · cloud' : 'Nano · on device') : null;
    const out = pointConnectFromIdentity(r, {
      frameTitle: f.title, sim: o.sim, cropBytes: o.cropBytes, prompt: o.prompt, cloudSends: o.cloudSends, chosenId: o.chosenId, viaIphone: o.viaIphone,
      devices: deviceHints(),
      onBoard: (surfaces[frameId]?.tiles ?? []).flatMap((t) => (isDeviceTile(t) ? [t.deviceId] : [])),
    });
    const idNote = r
      ? `${o.sim ? 'SIM · ' : ''}${o.viaIphone ? 'iPhone camera · ' : ''}identify: ${r.identity.label} (${r.identity.kind}${r.identity.brand ? `, ${r.identity.brand}` : ''}) · ${Math.round(r.identity.confidence * 100)}% · ${where}${r.ms ? ` · ${r.ms} ms` : ''}`
      : null;
    if (!out.ok) {
      if (out.choices?.length && r && !o.chosenId) {
        // One clarifying question. The crop already left: book it now, not
        // when (or if) she answers. Unanswered, it expires with a plain line.
        bookPointSends(r, o);
        const timer = setTimeout(() => {
          if (pointChoice?.timer !== timer) return;
          const pc = takePointChoice();
          if (pc) ledgerPointFailure(pc.r, pc.o, null);
          say('I didn’t hear which one, so nothing was connected. Point again or name the device.');
        }, POINT_CHOICE_MS);
        pointChoice = { frameId, r, o, choices: out.choices, timer };
        say(out.message);
        return;
      }
      ledgerPointFailure(r, o, idNote);
      say(out.message);
      return;
    }
    await connectTurn(frameId, POINT_UTTERANCE, out.turn, `Connect: ${out.turn.request.devices[0]?.label ?? 'device'} (${out.identity.label})`, 'guess',
      { identified: true, extraBytes: pointExtraBytes(out.extraBytes, out.turn.sent.prompt, r, o), prebookedBytes: o.prebooked, photoNote: o.sim, note: idNote ?? undefined, swarm: o.viaIphone ? false : undefined });
    if (out.note) say(out.note);
  }
  async function nameTurn(frameId: string, name: string): Promise<void> {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const f = reg.get(frameId); if (!f) return;
    const turn = byName(name, { frameTitle: f.title, sim: simEnv(), devices: deviceHints() });
    if (!turn) { say(`Didn’t catch a device in “${name}” — try “lamp”, “speaker” or “fan”.`); return; }
    await connectTurn(frameId, name, turn, `Connect: ${turn.request.devices[0]?.label ?? 'device'}`, 'guess');
  }
  async function scanRoom(utterance: string): Promise<void> {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const id = focusId ?? lastFocus;
    if (!id || !reg.get(id)) { say('Open a room board first, then scan.'); return; }
    const f = reg.get(id)!;
    const sim = simEnv();
    // Live room scan isn't built (no real photos are taken or identified), so
    // live runs say so instead of proposing made-up devices.
    if (!sim) { say(SCAN_LIVE_WHY); return; }
    // SIM only: the scripted lamp + speaker, labelled SIM, photo simulated.
    const turn = roomScan(foundAfterScan(undefined, { sim: true }), { frameTitle: f.title, sim: true });
    const n = turn.plan.tiles.length;
    await connectTurn(id, utterance, turn, `SIM · Scan: ${n} device${n === 1 ? '' : 's'} seen`, 'guess', { photoNote: true });
  }

  let sheetOpen: { frameId: string; host: HTMLElement; sheet: ConnectSheet } | null = null;
  let pairingStop: (() => Promise<void>) | null = null;
  /** Explicit Disconnect: stop the relay and reset the pair-first flow. */
  function disconnectPhones(): void {
    if (pairingStop) { void pairingStop(); pairingStop = null; }
    if (pairingHost) pairingHost.hidden = true;
    pairFirst.cancel();
    phoneAi.clear();
  }
  /** The relay is kept while the pair-first flow still has phones (live/asking). */
  const relayKept = (): boolean => (pairFirst.phase() === 'live' || pairFirst.phase() === 'asking') && pairFirst.phones().length > 0;
  function closeConnectSheet(): void {
    if (pairingStop && !relayKept()) { void pairingStop(); pairingStop = null; pairFirst.cancel(); phoneAi.clear(); }
    if (!sheetOpen) return;
    sheetOpen.sheet.unmount();
    sheetOpen.host.hidden = true;
    sheetOpen = null;
  }
  function openConnectSheet(frameId?: string): void {
    const id = frameId ?? focusId ?? lastFocus;
    if (!id || !reg.get(id)) { say('Open a board first, then connect a device.'); return; }
    closeConnectSheet();
    if (focusId !== id) void focus(id);
    const host = world.querySelector<HTMLElement>(`[data-frame="${id}"] .mc-connect-host`);
    if (!host) return;
    host.hidden = false;
    flowOwnsHost = flowOpening;
    const sheet = mountConnectSheet(host, {
      onPoint: () => { closeConnectSheet(); void pointTurn(id); },
      onName: (name) => { closeConnectSheet(); void nameTurn(id, name); },
      onJoinPhone: () => { void joinPhone(id); },
      onClose: () => { host.hidden = true; sheetOpen = null; },
    });
    sheetOpen = { frameId: id, host, sheet };
    say('Connect a device: point at it, say its name, or join a phone.');
  }
  async function joinPhone(frameId: string): Promise<boolean> {
    const open = sheetOpen; if (!open || open.frameId !== frameId) return false;
    if (pairingStop && relayKept()) { open.sheet.setStatus(`${pairFirst.phones().length} phone(s) already connected. Use Disconnect in the Connected row to end it.`); return true; }
    if (simEnv() || !net.isOnline()) {
      open.sheet.setStatus('Joining a phone needs the network — this sim stays on this device.');
      return false;
    }
    open.sheet.setStatus('Opening a Relay room…');
    let pairing: PairingView | null = null;
    const res = await startPhoneJoin({
      // Resume the SAME room token across reloads so remembered phones stay
      // paired (minting a fresh token every time would strand them).
      token: loadHostToken(storage) ?? undefined,
      onState: (st) => {
        if (st === 'paired') { pairFirst.addGeneric(); pairing?.stopChime(); pairing?.setStatus('Phone connected. What it proposes still waits for your keep here.'); }
        else if (st === 'disconnected' || st === 'gone') {
          pairFirst.clearReal();
          // The relay can't say WHICH phone left, so forget every announce
          // — no stale device labels — then ask the phones still here to
          // re-announce (they also re-announce every 20 s on their own).
          phoneAi.clear();
          void hostSession?.askWhoIsThere().catch(() => undefined);
          // If the phone left a proposal waiting (pre-Approve, nothing applied
          // yet), drop it so the canvas doesn't keep a review the absent phone
          // can no longer act on.
          if (pending) drop();
          const line = phoneDropLine(false);
          pairing?.setStatus(line);
          say(line);
        }
      },
      // Phone utterances ride the same run() path as the say box / Talk, so a
      // build still opens review before anything is kept.
      onCommand: (cmd) => {
        // Intercept the cross-device kinds BEFORE dispatchRelayCommand so they
        // never run as utterances: 'announce' (a phone saying which side it is
        // on) and 'transfer' (a tile sent back from a phone). Both carry JSON in
        // cmd.text; the host applies the transfer and republishes via state so
        // the OTHER phone sees it too.
        if (cmd.kind === 'announce' || cmd.kind === 'transfer' || cmd.kind === 'aiEvent') {
          handlePhoneDeviceCommand(cmd.kind, cmd.text ?? '');
          return;
        }
        if (cmd.kind === 'pointResult') { onIphonePointResult(cmd.text ?? ''); return; }
        if (cmd.kind === 'sensePoint') return; // host → phone only
        dispatchRelayCommand(cmd, {
          run,
          undo,
          toggleMic: () => micFabRef?.toggle(),
          nudge: (dx, dy) => {
            camera = panBy(camera, -dx * 48, -dy * 48);
            applyCamera();
          },
        });
      },
    });
    if ('error' in res) {
      if (sheetOpen === open) open.sheet.setStatus('Needs network: the Relay room is not reachable right now.');
      return false;
    }
    if (sheetOpen !== open) { void res.stop(); return false; } // she closed it while we connected
    pairingStop = res.stop;
    hostSession = res.session;
    showArrangeStrip(); // a phone is here: Swap sides becomes available
    saveHostToken(storage, res.token); // persist so the next reload resumes it
    // Publish the current arrangement + focused board so a joining phone (or a
    // remembered one that just reconnected) populates its side immediately.
    republishCurrentBoard();
    if (opts.privacyGemini) attachPrivacyHub(res.session, () => activePeople(), opts.privacyGemini);
    sheetOpen = null; // the pairing card replaces the sheet in the same host
    pairing = showPairing(open.host, {
      code: res.code,
      note: 'Playing a chime — hold your phone near this laptop. No typing, no scanning. After the first pair the phone is remembered and rejoins when you pick it up and look at it, or just open the app. Its changes still arrive here as proposals you keep or drop.',
      onClose: () => { disconnectPhones(); open.host.hidden = true; },
    });
    pairingHost = open.host;
    return true;
  }
  // Keep / drop act on the waiting board Proposal, else the waiting language Proposal.
  const waitingBtn = (cls: string) => (pending?.card.querySelector(cls) ?? reviewDialog.currentCard()?.querySelector(cls)) as HTMLButtonElement | null;
  function keep(): void { const b = waitingBtn('.mc-proposal-keep'); if (b) b.click(); else say('Nothing is waiting.'); }
  function drop(): void { const b = waitingBtn('.mc-proposal-drop'); if (b) b.click(); else say('Nothing is waiting.'); }
  /** C186: Undo asked for (voice, typed, palette) while a review waits: the
   *  review is the single gate — same as teach — so nothing shifts under the
   *  draft it shows, and every input gets the same answer (the hand can't reach
   *  the palette behind the modal review at all). */
  function userUndo(): void {
    if (reviewDialog.isOpen()) { say('Finish the review first — keep or drop, then undo.'); return; }
    undo();
  }
  function undo(): void {
    pairFirst.abandon();
    const h = history.undo();
    if (!h) { say('Nothing to undo.'); return; }
    if (h.kind === 'lang') { applyPack(h.packBefore ?? null, { record: false }); historyRender(); say(`Undid: ${h.summary}.`); return; }
    if (h.kind === 'layout') { if (h.layoutBefore) editBoard.restoreLayout(h.frameId, h.layoutBefore); historyRender(); say(`Undid: ${h.summary}.`); return; }
    if (h.before) { surfaces[h.frameId] = h.before; reg.rename(h.frameId, h.before.title); } else { delete surfaces[h.frameId]; live.delete(h.frameId); deviceSurfaces.untrack(h.frameId); }
    const el = world.querySelector<HTMLElement>(`[data-frame="${h.frameId}"] .mc-surface`);
    if (el && !h.before) el.innerHTML = '';
    if (h.before) renderSurface(h.frameId);
    sync(); updateDock(); persist(); historyRender();
    say(`Undid: ${h.summary}.`);
  }

  // ---- language pack (human in the loop) ----
  function applyPack(next: LanguagePack | null, o: { record?: boolean } = {}): void {
    const before = pack;
    pack = next;
    applyStrings();
    nextChips?.refresh();
    if (pending) tagCardI18n(pending.card);
    opts.voice?.setLang?.(resolveLanguage(next?.lang ?? 'en').speechLang);
    if (o.record) {
      history.push({
        frameId: '', before: null, after: null, by: 'gemini',
        summary: next ? `Added ${next.lang === 'kn' ? 'Kannada' : next.lang}` : 'Reverted to English',
        kind: 'lang', packBefore: before, packAfter: next,
      });
    }
    persist();
  }
  function addKannada(): void {
    // A review on screen (build, floor plan, morph, self-check fix or teach)
    // owns the single full-screen slot; opening the Kannada review on top would
    // overwrite its card and orphan that turn. Make the user finish it first.
    if (reviewBusy()) { say('Finish the review first — keep or drop, then add Kannada.'); return; }
    if (pack?.lang === 'kn') { say('Kannada is already on. Say “undo” for English.'); return; }
    if (!net.isOnline()) {
      net.queueLater('add kannada');
      panels.show();
      panels.forEngine('nano').setQueued(net.laterCount());
      aiHold.add('gemini'); // the Kannada pack waits on Gemini; keep the reason on screen
      say(`${LATER_LIST_PROMISE}.`);
      return;
    }
    void languageTurn('add kannada');
  }
  // Like aiTurn: whatever way the turn ends, the cards stop saying Working
  // (the Nano card was left on Working after the Kannada handoff).
  async function languageTurn(utterance: string): Promise<void> {
    try { await languageTurnRun(utterance); } finally { settleEngines(); }
  }
  async function languageTurnRun(utterance: string): Promise<void> {
    const engine = engineFor('gemini', JSON.stringify(SCRIPTED_KN_PACK));
    const prompt = [
      'Translate the smart-canvas UI into Kannada. Reply with JSON only:',
      '{"lang":"kn","strings":{key:text},"phrases":{intent:[phrases]}}',
      `UI string keys: ${Object.keys(EN_PACK.strings).join(', ')}.`,
      'Kannada script only, each string ≤80 chars, no markup.',
    ].join('\n');
    const knSent: SentInfo = { engine: 'gemini', prompt, sent: 'the key list and your request. No board data, no device addresses.', routeLine: engine.sim ? `SIM · ${ROUTE_LINES.kannada}` : ROUTE_LINES.kannada, sim: engine.sim };
    aiSent(utterance, knSent, { task: 'kannada' });
    // The redact-before-handoff invariant: aiSent() above already logged any
    // Nano redaction, so it's safe to announce the handoff now.
    panels.showHandoff('nano', 'plan the Kannada pack — too complex for on-device');
    let full = '';
    try { full = await engine.stream(prompt, () => {}); }
    catch (e) {
      if (!engine.fallback) {
        settleSwarm();
        const why = `Kannada draft didn’t arrive: ${e instanceof Error ? e.message : String(e)}`;
        aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); return;
      }
      panels.forEngine('gemini').log('note', 'SIM · the model didn’t answer, so a prepared Kannada pack is waiting');
      try { full = await engine.fallback.stream(prompt, () => {}); }
      catch (e2) {
        settleSwarm();
        const why = `Kannada draft didn’t arrive: ${e2 instanceof Error ? e2.message : String(e2)}`;
        aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); return;
      }
    }
    let raw: unknown = null;
    try { raw = JSON.parse(full.slice(full.indexOf('{'), full.lastIndexOf('}') + 1)); } catch { /* not JSON */ }
    const coerced = coerceLanguagePack(raw);
    if (!coerced.ok) {
      settleSwarm();
      const why = coerced.error.startsWith('incomplete') ? INCOMPLETE_KN_LINE : `Refused the pack: ${coerced.error}`;
      panels.forEngine('gemini').fail(why);
      aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); return;
    }
    const next = coerced.value;
    settleSwarm();
    const swapCount = Object.keys(next.strings).length;
    panels.forEngine('gemini').log('replied', `Kannada pack ready · ${swapCount} swaps`);
    panels.showHandoff('gemini', `apply ${swapCount} label swaps locally`);
    aiPanel.querySelector('.mc-ai-state')!.textContent = 'Waiting for you. English until you keep it.';
    const card = renderProposalCard(document, {
      id: 'p-lang', title: 'Add Kannada', youAsked: utterance, status: 'changed',
      catalog: { helper: 'Deep', byLine: 'Deep · online', routeLine: ROUTE_LINES.kannada, lineId: 'custom', whyLabel: 'Why online', whatWasSent: 'the UI key list and your request', technicalLine: ROUTE_LINES.kannada },
    }, {
      onKeep: () => { reviewDialog.close(); aiPanel.querySelector('.mc-ai-state')!.textContent = 'Kept. Kannada is on — say “undo” for English.'; applyPack(next, { record: true }); historyRender(); autoHideAi(); say('Kannada is on. Say “undo” (or “ರದ್ದುಮಾಡು”) for English.'); },
      onDrop: () => { reviewDialog.close(); aiPanel.querySelector('.mc-ai-state')!.textContent = 'Dropped. Still English.'; say('Kept English.'); autoHideAi(); },
    });
    showReview({
      title: 'Add Kannada', card, extra: buildReviewExtra(),
      changes: languagePackChanges('Kannada', swapCount),
      facts: reviewFacts(knSent, utterance),
    });
  }
  /** A pack phrase (Kannada) routes to the same intents as the English parsers. */
  function runIntent(intent: IntentKey): boolean {
    switch (intent) {
      case 'showEverything': void overview(); return true;
      case 'newBoard': newBoard(); return true;
      case 'save': save(); return true;
      case 'keep': keep(); return true;
      case 'drop': drop(); return true;
      case 'undo': userUndo(); return true;
      default: {
        const refs = deviceRefs().filter((d) => d.kind !== 'music'); // lamp phrases never touch the speaker
        if (!refs.length) { say('No devices here yet.'); return true; }
        for (const d of refs) {
          const cur = d.brightness ?? 50;
          if (intent === 'lampOn') void store.act({ deviceId: d.id, on: true });
          else if (intent === 'lampOff') void store.act({ deviceId: d.id, on: false });
          else if (intent === 'brighter') void store.act({ deviceId: d.id, on: true, brightness: lampStep(cur + 20) });
          else void store.act({ deviceId: d.id, brightness: lampStep(cur - 20) });
        }
        const sk: StatusKey = intent === 'lampOn' ? 'lightsOn' : intent === 'lampOff' ? 'lightsOff' : intent === 'brighter' ? 'brighter' : intent === 'dimmer' ? 'dimmer' : 'done';
        say(statusText(sk, pack));
        return true;
      }
    }
  }

  // ---- inputs: hands (palm cursor, fist tap / grab, two-fist zoom) + gimbal modes in one composer.
  // The existing Hands button starts/stops it; gimbal voice goes via handleSpeech.
  let handsMountOk = false; let handsOn = false; let handsBusy = false;
  let lastHandsError: string | null = null;
  let handsHandle: CanvasHandsHandle | null = null;
  // Morph flow (assigned after the mic mounts below). The hand adapter and
  // the gesture recognizers reference it lazily — null until then is "off".
  let morphFlow: MorphFlow | null = null;
  // Every control on screen is reachable by hand (deep hit-test + snap radius).
  // onPinch is the morph hold's hand adapter: the debounced pinch edges feed
  // the same tap/hold/drag classifier mouse and touch use — 'down' aims from
  // the frozen pre-pinch point, a release before the fire stays a plain tap.
  // A hand user has no mouseover, so native `title` tooltips never fire.
  // Mirror the plan side (C046): a small bubble anchored above whatever the
  // hand cursor dwells on — any control, or a hint-only element like the swarm
  // pill (A1-047 / A5-017).
  // Hover-to-click (dwell) is an opt-in fallback, off unless
  // localStorage mc.dwellClick === '1' (Tools → "Hover to click").
  // Camera frame height ÷ width (for the pointer's 3D finger-bend test);
  // updated from presence frames, 16:9 until the first one.
  let handCameraAspect = 9 / 16;
  // Phone shell: the front camera's aspect (null until the first frame —
  // phoneReach then assumes portrait).
  let phoneCamAspect: number | null = null;
  const DWELL_KEY = 'mc.dwellClick';
  let dwellClickOn = false;
  try { dwellClickOn = storage.getItem(DWELL_KEY) === '1'; } catch { dwellClickOn = false; }
  function setDwellClick(on: boolean): void {
    dwellClickOn = on;
    try { if (on) storage.setItem(DWELL_KEY, '1'); else storage.removeItem(DWELL_KEY); } catch { /* private mode */ }
    root.querySelector<HTMLElement>('[data-cmd=dwell]')?.setAttribute('aria-pressed', String(on));
  }
  setDwellClick(dwellClickOn);
  const handTip = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (handTip) { handTip.className = 'mc-hand-tooltip'; handTip.hidden = true; handTip.setAttribute('aria-hidden', 'true'); document.body.appendChild(handTip); }
  // Open-palm highlight (palmHighlight.ts): the palm moves a sticky highlight
  // over the buttons; R thumbs-up (2 s) presses it, a fist tap clicks it.
  const palmHighlight = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
    ? createPalmHighlight({ root, ...(phoneShell ? { reach: () => phoneReach(phoneCamAspect) } : {}) })
    : null;
  const handPointer: HandPointer | null = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
    ? createHandPointer(document, {
        targetOverride: () => palmHighlight?.current() ?? null,
        onHandEvent: (ev) => {
          if (ev.type === 'click') activityLog.push({ kind: 'click', text: ev.target ? `Click · ${ev.target}` : 'Click', target: ev.target });
          else activityLog.push({ kind: 'grab', text: ev.target ? `Grab · ${ev.target}` : 'Grab', target: ev.target });
        },
        // One-fist board move: a fist held over a board drags it (screen px)
        // until the hand opens. Frame rects are world-space, so the screen
        // delta scales by 1/camera.z. Persisted on 'end'.
        // Held at a paired phone's edge, the board is sent there (boardEdge).
        onBoardMove: (ev) => {
          const at = { frameId: ev.frameId, clientX: ev.x ?? NaN, clientY: ev.y ?? NaN };
          if (ev.phase === 'start') { boardEdge.handleBoardDrag({ ...at, phase: 'start' }); return; }
          if (ev.phase === 'end') { boardEdge.handleBoardDrag({ ...at, phase: 'end' }); persist(); return; }
          if (ev.phase !== 'move') return;
          // The edge check runs even on a zero delta (a palm clamped at the edge);
          // a fist held perfectly still is covered by boardEdge's own hold timer.
          if (!boardEdge.handleBoardDrag({ ...at, phase: 'move' }) || (!ev.dx && !ev.dy)) return;
          const f = reg.get(ev.frameId);
          if (!f) return;
          reg.setRect(ev.frameId, { ...f.rect, x: f.rect.x + ev.dx / camera.z, y: f.rect.y + ev.dy / camera.z });
          sync();
        },
        // One fist on empty canvas pans; two fists zoom (see onHandWorldPan /
        // onHandWorldZoom). In focus mode a fist on the focused board pans.
        onWorldPan: (ev) => onHandWorldPan(ev),
        onWorldZoom: (ev) => onHandWorldZoom(ev),
        focusedFrameId: () => focusId,
        // A fist only grabs from the world layer: inside a board, or the bare
        // viewport/world background — never from a panel, dock or bar.
        isCanvasBackground: (el) => !el || el === viewport || el === world,
        // Hover-to-click is an opt-in fallback (Tools → "Hover to click");
        // the fist tap is the click.
        dwellClick: () => dwellClickOn,
        cameraAspect: () => handCameraAspect,
        // Phone shell: front camera, portrait reach box, a wider magnet for
        // small targets (PHONE_HAND_FEEL). Laptop: HAND_FEEL defaults.
        ...(phoneShell ? { reach: () => phoneReach(phoneCamAspect), snapPx: PHONE_HAND_FEEL.magnetCapturePx } : {}),
        onPinch: (ev) => {
          if (!morphFlow) return;
          if (ev.phase === 'down') { morphFlow.pointerDownAt(ev.p); morphFlow.beginHold(ev.p, 'hand'); }
          else if (ev.phase === 'move') morphFlow.moveHold(ev.p);
          else if (ev.phase === 'up') morphFlow.endHold();
          else morphFlow.cancelHold();
        },
        onTooltip: (text, el) => {
          if (!handTip) return;
          if (!text || !el) { handTip.hidden = true; return; }
          const r = el.getBoundingClientRect();
          handTip.textContent = text;
          handTip.hidden = false;
          // Clamp inside the screen; flip below a control at the top edge
          // (phone bar, dock) so the bubble never renders off-screen.
          const below = r.top < 40;
          handTip.classList.toggle('below', below);
          handTip.style.left = `${Math.min(innerWidth - 8, Math.max(8, r.left + r.width / 2))}px`;
          handTip.style.top = `${below ? r.bottom + 8 : r.top - 8}px`;
        },
      })
    : null;

  // Button gestures (gestureControl.ts): a fixed hand shape held still for
  // 2 s presses its bound button — a real click, the same path as the
  // mouse. Badges show only while Hands is on. Phones bind the short table.
  // Facing gate: the operator's hand gate from presence frames.
  let gestureFacing: boolean | null = null;
  let gestureFaceX: number | null = null;
  const gestures: GestureControl | null = typeof document !== 'undefined' && handPointer
    ? createGestureControl({
        root,
        bindings: phoneShell ? PHONE_GESTURES : LAPTOP_GESTURES,
        run: (text) => { run(text); },
        say,
        onFire: (ev) => activityLog.push({ kind: 'gesture', text: `${ev.name} → ${ev.label}`, target: ev.target }),
        highlight: palmHighlight,
      })
    : null;
  /** Gestures are paused while something else owns the hands: a fist grab,
   *  the not-facing lock, or the point-to-connect capture step. */
  const gesturesBlocked = (): boolean => !!handPointer?.isGrabActive() || !!handPointer?.handsLocked?.() || !!pointWait;

  // Phone shell: hand control from the shared front camera (phoneHands.ts) —
  // a Hands pill next to Join laptop, persisted, off on first run. Same
  // pointer as the laptop; touch is untouched. Hand clicks/grabs only reach
  // the local activity log, never the AI feed that goes to the monitor.
  const phoneHands = phoneShell && opts.phoneCamera && handPointer && typeof document !== 'undefined'
    ? mountPhoneHands(root, {
        camera: opts.phoneCamera,
        pointer: handPointer,
        reach: () => phoneReach(phoneCamAspect),
        storage,
        say,
        locked: () => phoneLocked(),
        onAspect: (a) => { phoneCamAspect = a; handCameraAspect = a; },
        gestures,
        gesturesBlocked,
        cameraAspect: () => handCameraAspect,
      })
    : null;

  // ---- owner registration: the amber Register button (empty canvas + the
  // top-right Edit/Tools/Talk cluster) opens a guided SCAN — face → left
  // palm → right palm (scanRegistration.ts state machine, scanPanel.ts UI).
  // Each step averages a geometry signature over a stable hold window; the
  // result is stored for the session and locks presence to that owner (face
  // signature + preferred hand proportions via handBinding). Nothing
  // auto-starts and Cancel leaves the canvas exactly as it was; ?sim=1 runs
  // a scripted replay of the same UI so the demo needs no camera.
  const regStorage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  const scanFlow = createScanFlow(opts.sim ? SCAN_SIM : SCAN_DEFAULTS);
  let replayTimer: ReturnType<typeof setInterval> | null = null;
  const regChip = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (regChip) {
    regChip.className = 'mc-reg-chip';
    regChip.hidden = true;
    root.append(regChip);
  }
  const registerChip = typeof document !== 'undefined' ? document.createElement('button') : null;
  if (registerChip) {
    registerChip.type = 'button';
    registerChip.className = 'mc-register-chip';
    registerChip.dataset.cmd = 'register';
    registerChip.textContent = 'Register';
    root.append(registerChip);
  }
  const scanPanel = typeof document !== 'undefined'
    ? mountScanPanel(root, { onCancel: () => closeScan('Cancelled. Nothing changed.') })
    : null;
  function setRegChip(text: string | null): void {
    if (!regChip) return;
    regChip.hidden = !text;
    if (text) regChip.textContent = text;
  }
  function refreshRegisterLabels(): void {
    const owner = loadOwner(regStorage);
    const label = registerButtonLabel(owner);
    // One Register on screen: the cluster chip (or the empty-state button)
    // until someone registers; after that only Tools > More > Hands offers
    // "Register again" (voice "register" works either way).
    if (registerChip) { registerChip.textContent = label; registerChip.hidden = !!owner; }
    const blankBtn = root.querySelector<HTMLElement>('.mc-blank-register');
    if (blankBtn) blankBtn.textContent = label;
    const toolbarBtn = root.querySelector<HTMLElement>('[data-cmd=reregister]');
    if (toolbarBtn) toolbarBtn.hidden = !owner;
  }
  function applyOwnerLock(owner: OwnerRecord): void {
    handsHandle?.presence?.registerSignature(owner.face);
    handsHandle?.presence?.setOwnerHands(ownerHandsOf(owner));
  }
  function stopReplay(): void {
    if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
  }
  function closeScan(message?: string): void {
    stopReplay();
    scanPanel?.close();
    if (message) say(message);
  }
  function completeScan(): void {
    const owner = scanFlow.result();
    if (!owner) return;
    storeOwner(regStorage, owner);
    // In ?sim=1 there is no real face to re-acquire — the stored owner and the
    // chip are the demo; locking presence would only flap to "paused".
    if (!opts.sim) applyOwnerLock(owner);
    setRegChip('Registered');
    refreshRegisterLabels();
    say('Registered. Tracking is locked to you.');
    setTimeout(() => closeScan(), 900); // leave the ✓ on screen for a beat
  }
  // Teach / custom-gestures share the same full-screen z-index tier as the
  // review dialog and mount after it, so opening one on top of an open review
  // would cover Approve/Reject. Keep the review the single gate (same guard the
  // morph flow uses) and tell the user to finish it first.
  function openTeach(): void {
    if (reviewDialog.isOpen()) { say('Finish the review first — keep or drop, then teach a gesture.'); return; }
    teachPanel.open();
  }
  function openTeachList(): void {
    if (reviewDialog.isOpen()) { say('Finish the review first — keep or drop.'); return; }
    teachPanel.openList();
  }
  function openScan(): void {
    if (!scanPanel || scanPanel.isOpen()) return;
    // The scan overlay is z-index 80 — above the review (50) AND above the bar
    // (51) that keeps "Re-register" clickable during a review. Opening it over
    // an open review would bury Approve/Reject (the human-in-the-loop gate),
    // same hole pass 1 closed for teach and the phone menu sheet.
    if (reviewDialog.isOpen()) { say('Finish the review first — keep or drop, then register.'); return; }
    scanFlow.reset();
    if (opts.sim) {
      // Scripted replay: feed the flow whatever its current step asks for.
      scanPanel.open();
      stopReplay();
      replayTimer = setInterval(() => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const st = scanFlow.update(replayInputFor(scanFlow.step, now));
        scanPanel.setState(st);
        if (st.step === 'done' && st.justAdvanced) { stopReplay(); completeScan(); }
      }, 60);
      return;
    }
    void (async () => {
      // The scan needs the camera; toggleHands already explains any failure.
      if (!handsOn) { await toggleHands(); if (!handsOn) return; }
      scanPanel.open();
    })();
  }
  function onPresenceFrame(f: PresenceFrame): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Hands only act while the user faces this screen: the operator's HAND
    // GATE, the same signal as the "Facing this device / Not facing" pill.
    // No face, an unsettled face, or a stranger's face (registered operator
    // lost) = unknown, which never locks the hands (handPointer adds the
    // 300 ms hysteresis). Point-to-connect is intentionally NOT gated on
    // facing: you look at the device you point at, not at this screen.
    const op = f.faces.find((x) => x.isOperator);
    handPointer?.setFacing?.(op ? (op.handGate ?? null) : null, now);
    gestureFacing = op ? (op.handGate ?? null) : null;
    gestureFaceX = op ? op.box.cx : null;
    if (f.aspect && f.aspect > 0) handCameraAspect = f.aspect;
    if (opts.sim) return; // replay drives the sim scan; no chip churn either
    if (scanPanel?.isOpen()) {
      const op = f.faces.find((x) => x.isOperator) ?? f.faces[0] ?? null;
      const st = scanFlow.update({
        faceSig: f.operatorFace ? computeSignature(f.operatorFace) : null,
        faceCenter: op ? { x: op.box.cx, y: op.box.cy } : null,
        hands: f.hands.map((h) => ({ label: h.label, points: h.points })),
        now,
      });
      scanPanel.setState(st);
      if (st.step === 'done' && st.justAdvanced) completeScan();
      return;
    }
    if (f.registered) setRegChip(f.paused ? 'Paused — face the camera to resume' : 'Registered');
  }
  function restoreOwnerLock(): void {
    if (opts.sim) return;
    const owner = loadOwner(regStorage);
    if (owner) { applyOwnerLock(owner); setRegChip('Registered'); }
  }

  // ---- hand grabs → camera. One fist on empty canvas pans the world 1:1
  // (translation only, focus kept — like a mouse drag on empty canvas); two
  // fists zoom about their midpoint through twoHandCamera (the same anchored
  // maths as the touch pinch), dropping focus first like the wheel does. The
  // fists' points arrive in client px; the camera works in viewport px.
  // Pinch-driven zoom/pan and the edit-mode two-hand resize are gone.
  let handZoom: { a0: Vec; b0: Vec; cam0: Camera } | null = null;
  function vpLocal(p: { x: number; y: number }): Vec {
    const r = viewport.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  }
  function onHandWorldPan(ev: { phase: 'start' | 'move' | 'end'; dx: number; dy: number }): void {
    if (ev.phase === 'end') { persist(); return; }
    if (ev.phase !== 'move' || (!ev.dx && !ev.dy) || phoneLocked()) return;
    camera = panBy(camera, ev.dx, ev.dy);
    applyCamera();
  }
  function onHandWorldZoom(ev: { phase: 'start' | 'move' | 'end'; a: { x: number; y: number }; b: { x: number; y: number } }): void {
    if (ev.phase === 'start') {
      if (phoneLocked()) return;
      if (focusId) { focusId = null; sync(); }
      handZoom = { a0: vpLocal(ev.a), b0: vpLocal(ev.b), cam0: camera };
      return;
    }
    if (!handZoom) return;
    if (ev.phase === 'move') {
      camera = twoHandCamera(handZoom.cam0, handZoom.a0, handZoom.b0, vpLocal(ev.a), vpLocal(ev.b));
      applyCamera();
      return;
    }
    handZoom = null;
    persist();
  }

  const inputs = createCanvasInputs({
    root,
    gimbalKeepAlive: opts.gimbalKeepAlive,
    sensing: () => !!phoneSensor?.running(),
    hands: async (r, onEvent) => {
      const s = await mountCanvasHands(r, onEvent, {
        onError: (reason) => { lastHandsError = reason; },
        onPresence: onPresenceFrame,
        // Draw each glass hand with its palm exactly on its own cursor
        // (one-to-one, ≤80 px), using this frame's cursors.
        handAnchors: (hands) => matchCursors(
          hands.map((points) => mapToScreen(palmCenter(points), innerWidth, innerHeight, false)),
          handPointer?.cursors?.() ?? [],
        ),
        onCameraLost: () => {
          if (scanPanel?.isOpen()) closeScan(CAMERA_LOST_REGISTER);
        },
        // A pinch the morph classifier armed on must not ALSO read as the
        // 1200 ms pinch-hold-still (the morph opens the mic itself).
        suppressMotion: (id) => (id === 'pinch-hold-still' && (!!morphFlow?.holdActive() || !!handPointer?.surfaceBusy()))
          // "Saving will use yours instead": a custom gesture taught over a
          // built-in (e.g. thumbs-up) silences the built-in.
          || teachPanel.gestures().some((g) => g.conflictsWith === id),
      });
      handsHandle = s;
      handsMountOk = !!s;
      if (s) lastHandsError = null;
      return s;
    },
    on: {
      // Camera frames no longer produce 'keep' (pinch / thumbs-up are
      // unwired in canvasHands); a sim/test 'keep' event still lands here,
      // and a morph hold in progress still wins over it.
      keep: () => { if (!morphFlow?.holdActive() && !handPointer?.consumedPinch()) keep(); },
      drop,
      // Tools open only on a pinch or a click (or a spoken "show tools") —
      // never on hover, dwell, or an open-palm hold. A hovering open palm
      // was the "it opens just when I hover" bug.
      palm: () => {},
      status: say,
      frame: (hands, now) => {
        // Presence hands are selfie-mirrored; the pointer + reach-box map expect camera space.
        // The pointer owns every live hand gesture: dwell-click, one-fist
        // grab (board move / pan) and two-fist zoom.
        const cam = cameraHandsFromSelfie(hands);
        handPointer?.update(cam, now);
        gestures?.frame(hands, now, { facing: gestureFacing, faceX: gestureFaceX, blocked: gesturesBlocked(), cameraAspect: handCameraAspect });
        // Taught gestures obey the same guards as built-ins: never while the
        // hands are locked (not facing the screen) or a fist grab is running.
        if (!handPointer?.handsLocked?.() && !handPointer?.isGrabActive()) teachPanel.matchFrame(hands, now);
        feedPointWait(cam, now);
      },
    },
  });
  // iPhone SENSING layer (phoneSensor.ts): same phone camera/tracker as the
  // Hands pill, but it never acts on the UI and is not facing-gated. Runs
  // only while the Track pill is on or a follow-hands / point request is
  // active — docking alone never opens the camera.
  const phoneSensor: PhoneSensor | null = phoneShell && opts.phoneSensing && opts.phoneCamera && typeof document !== 'undefined'
    ? createPhoneSensor({
        camera: opts.phoneCamera,
        root,
        storage,
        onHands: (cam, now) => {
          if (inputs.gimbal.mode() === 'hands') void inputs.gimbal.onHandsFrame(cam.map((points) => ({ points })), now).catch(() => {});
          feedPointWait(cam, now);
        },
        onChange: () => { senseChanged(); },
        say,
        onUserStop: () => {
          // Sensing off from the pill: a waiting point ends, and a hands follow
          // with no frames left says so and follows the face instead.
          if (pointWait?.phone) { endPointWait(); say('Hand tracking off — nothing was captured.'); }
          if (inputs.gimbal.mode() === 'hands' && !handsOn) void inputs.gimbal.setMode('face').then((r) => { const t = r.ok ? r.status : r.why; if (t) say(t); });
        },
      })
    : null;
  const senseSubs = new Set<() => void>();
  let senseLast = '';
  let gimbalDocked = false;
  function senseChanged(): void {
    const k = JSON.stringify(phoneSenseStatus());
    if (k === senseLast) return;
    senseLast = k;
    for (const cb of senseSubs) cb();
  }
  /** What this iPhone really has on (for its announce to the laptop). */
  function phoneSenseStatus(): PhoneSenseStatus | null {
    if (!phoneSensor) return null;
    // 'tracking' only when docked AND the plugin read back system tracking on
    // (gimbal mode 'face' is entered only on that confirmation).
    const mode = inputs.gimbal.mode();
    const gimbal = !gimbalDocked ? 'none' : mode === 'face' ? 'tracking' : mode === 'hands' && phoneSensor.running() ? 'hands' : 'ready';
    return { gimbal, sensor: phoneSensor.running(), hands: !!phoneHands?.isOn(), canPoint: opts.phoneCamera?.status() !== 'error' };
  }
  // Native app: watch the stand dock/undock (every 10 s while visible). A
  // false→true flip re-applies face follow (launch race / redock) unless she
  // chose hold or hands; docking alone never starts the camera.
  {
    const plugin = getGimbalPlugin();
    const checkDock = async (): Promise<void> => {
      let docked = false;
      try { docked = !!plugin && !!(await plugin.isAvailable()).available; } catch { docked = false; }
      gimbalDocked = docked;
      if (!opts.sim) {
        const r = await inputs.gimbal.noteDocked?.(docked).catch(() => null);
        if (r) { const t = r.ok ? r.status : r.why; if (t) say(t); }
      }
      senseChanged();
    };
    if (plugin && typeof document !== 'undefined') {
      setTimeout(() => { void checkDock(); }, 1500);
      const dockTimer = setInterval(() => { if (document.visibilityState !== 'hidden') void checkDock(); }, 10_000);
      addEventListener('pagehide', () => clearInterval(dockTimer), { once: true });
    }
  }
  async function toggleHands(): Promise<void> {
    const btn = root.querySelector<HTMLElement>('[data-cmd=hands]')!;
    if (handsOn) { inputs.stop(); handPointer?.lost(); gestures?.lost(); gestures?.setActive(false); handsHandle = null; handsOn = false; setRegChip(null); closeScan(); btn.setAttribute('aria-pressed', 'false'); say('Hands off.'); return; }
    if (handsBusy) return;
    handsBusy = true; handsMountOk = false;
    await inputs.start(root);
    handsBusy = false;
    // The honest reason, not a generic line: permission denied, busy webcam
    // and a blocked MediaPipe download each read differently (cameraError.ts).
    if (!handsMountOk) { say(lastHandsError ?? 'No camera here — hands stay off.'); return; }
    handsOn = true;
    btn.setAttribute('aria-pressed', 'true');
    gestures?.setActive(true);
    restoreOwnerLock();
    say('Hands on. Palm to point · fist to click · hold a fist to move.');
  }

  // ---- offline (simulate + real) ----
  function setOnline(on: boolean, announce = false): void {
    net.setOnline(on);
    nextChips?.refresh();
    const btn = root.querySelector<HTMLElement>('[data-cmd=offline]')!;
    btn.setAttribute('aria-pressed', String(!on));
    btn.dataset.i18n = on ? 'simulateOffline' : 'offlineOn'; // survives applyStrings
    btn.textContent = str(on ? 'simulateOffline' : 'offlineOn');
    if (on) {
      const later = net.drainLater();
      const n = later.length + deepLater.length;
      panels.forEngine('nano').setQueued(net.laterCount() + deepLater.length);
      if (n) { say(`Back online. Running ${n} saved request${n > 1 ? 's' : ''}.`); later.forEach((u) => { if (/kannada|ಕನ್ನಡ/i.test(u)) void languageTurn(u); }); void runDeepLater(); }
      else if (announce) say('Back online.');
    } else if (announce) say(`${OFFLINE_QUICK_ONLY}.`);
  }

  // Open-ended speech that isn't a known command ("hi", "what can you do") —
  // a short conversational reply, Nano-first, Gemini when Nano can't answer.
  // No board, no proposal: the question's badge/panel still names what answered.
  const OPEN_ENDED_SIM_REPLY = "I'm listening — tell me what to build, or ask me anything.";
  async function openEndedTurn(text: string): Promise<void> {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const nano = engineFor('nano', OPEN_ENDED_SIM_REPLY);
    const gemini = engineFor('gemini', OPEN_ENDED_SIM_REPLY);
    // Each engine really tried goes through the ledger like any AI turn. A
    // cloud one (Gemini — including the "Nano" step on a device without Nano)
    // only ever gets the redacted prompt, and its bytes are booked.
    const prepare = (eng: SurfaceEngine, prompt: string): string => {
      const cloud = eng.id === 'gemini';
      const base = cloud
        ? (eng.routeLine ?? 'Gemini · cloud — sent your words (names redacted) for a short reply')
        : 'Nano · on device — nothing left this device';
      aiSent(text, {
        engine: eng.id, prompt, sim: eng.sim,
        sent: cloud ? 'your words (names redacted). No board data, no device addresses.' : null,
        routeLine: eng.sim && !base.startsWith('SIM') ? `SIM · ${base}` : base,
      }, { swarm: false });
      return cloud ? protectTurn(text, prompt).promptText : prompt;
    };
    let r: Awaited<ReturnType<typeof openEndedAsk>>;
    try {
      r = await openEndedAsk(text, nano, gemini, (full) => {
        aiPanel.querySelector('.mc-ai-state')!.textContent = full;
      }, prepare);
    } catch (e) {
      const why = `No answer: ${e instanceof Error ? e.message : String(e)}`;
      panels.forEngine('gemini').fail(why);
      aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why);
      settleEngines(); autoHideAi();
      return;
    }
    // A cloud reply may carry the redaction tokens back: real names return on this device.
    const reply = r.engineId === 'gemini' ? fillVisible(r.reply).text : r.reply;
    // The cloud terminal keeps what the cloud actually said (tokens, not names).
    panels.forEngine(r.engineId).log(r.engineId === 'gemini' ? 'replied' : 'done', r.reply);
    aiPanel.querySelector('.mc-ai-state')!.textContent = reply;
    say(reply);
    settleEngines();
    autoHideAi();
  }

  /** An impossible request: Nano proposes (scripted + SIM in ?sim=1), real
   *  validation refuses, Nano's terminal fails red, and nothing is applied. */
  async function breakTurn(text: string, attempt: Attempt, frameId: string | null): Promise<void> {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    // Only a real on-device Nano (or the ?sim=1 script) is asked. On a device
    // without Nano the "Nano" engine is Gemini in the cloud: her words would
    // leave for a check the deterministic validator already decides — so no
    // model is called and the route says Rules, not Nano.
    const engine = breakEngine(engineFor('nano', scriptedReply(attempt)), !!opts.sim);
    if (engine) {
      aiSent(text, { engine: 'nano', prompt: breakPrompt(text), sent: null, routeLine: `${engine.sim ? 'SIM · ' : ''}Nano · on this device — checked here. Nothing sent.`, sim: engine.sim }, { task: 'generic' });
    }
    // No model ran: nothing is logged as Nano. The fixed-limit check reports
    // under 'rules' (the monitor's Rules lane); the verdict is said aloud.
    const rulesPanel = {
      log: (verb: string, detail: string) => { aiFeed.publish({ kind: 'log', engine: 'rules', verb, text: detail }); },
      fail: (detail: string) => { aiFeed.publish({ kind: 'log', engine: 'rules', verb: 'note', text: `refused: ${detail}` }); },
    };
    if (!engine) rulesPanel.log('received', text);
    try {
      const r = await runBreakTurn(text, attempt, { engine, devices: deviceRefs(), panel: engine ? panels.forEngine('nano') : rulesPanel, say: (t) => { const st = aiPanel.querySelector('.mc-ai-state'); if (st) st.textContent = t; say(t); } });
      if (r.refused && frameId) nextChips?.markDone(frameId, 'try-to-break');
    } finally { settleSwarm(); settleEngines(); autoHideAi(); }
  }

  // ---- commands ----
  /** Kannada heard line + English on the Talk caption. The English comes only
   *  from the active pack's own intent map (local); no translation → heard only. */
  function captionHeard(text: string): void {
    if (!micFab || !/[\u0C80-\u0CFF]/.test(text)) return;
    const intent = pack ? routePackPhrase(text, pack) : null;
    micFab.setHeard(text, intent ? `understood as: ${INTENT_ENGLISH[intent]}` : null, resolveLanguage('kn'));
  }
  type PB = HTMLElement & { runExtra?: (k: PlanExtra) => string };
  function routePlanBoard(): PB | null {
    const planId = focusId ?? lastFocus;
    return (planId ? world.querySelector<PB>(`[data-frame="${planId}"] mc-plan-board`) : null) ?? (focusId ? null : world.querySelector<PB>('mc-plan-board'));
  }
  function routeWorld(planBoard: PB | null): RouteWorld {
    return {
      hasPlanBoard: !!planBoard?.runExtra, devices: deviceRefs(), pointed: resolvePointedDevice(handPointer?.target ?? null, deviceRefs()),
      pack, sim: !!opts.sim, spotifyConnected: !!loadTokens(),
    };
  }
  function run(text: string): boolean {
    captionHeard(text);
    // Morph-first: while the morph card is open, speech (and the say box)
    // means "edit this tile"; "undo" / "cancel" are meta-commands handled
    // locally and never reach a model.
    if (morphFlow?.handleSpeech(text)) return true;
    // Pair-first flow: "next" / "build the dashboard" belong to it while it runs.
    if (pairFirst.handleSpeech(text)) return true;
    // "Desk lamp or ceiling light?" after a point: her answer picks the device.
    if (handlePointChoice(text)) return true;
    // CAD extras go to the focused plan board (else any plan board); with no
    // plan board the line falls through to the normal routes.
    const planBoard = routePlanBoard();
    const r = routeLine(text, routeWorld(planBoard));
    const ranOn = focusId;
    switch (r.name) {
      case 'paletteOpen': openTools(); return true;
      case 'paletteClose': closeTools(); return true;
      case 'teach': openTeach(); return true;
      case 'teachList': openTeachList(); return true;
      case 'showAi': showAi(true, true); return true;
      case 'monitor': openMonitor(); return true;
      case 'hideAi': aiHold.clear(); showAi(false, true); say('AI activity hidden. It opens on a failure, from the engine bar, or say “show ai”.'); return true;
      case 'tool': {
        const press = (cmd: string) => root.querySelector<HTMLElement>(`[data-cmd="${cmd}"]`)?.click();
        const handsOn = root.querySelector('[data-cmd=hands]')?.getAttribute('aria-pressed') === 'true';
        switch (r.tool) {
          case 'handsOn': if (handsOn) say('Hands are already on.'); else press('hands'); break;
          case 'handsOff': if (!handsOn) say('Hands are already off.'); else press('hands'); break;
          case 'dwell': press('dwell'); break;
          case 'register': openScan(); break;
          case 'offline': if (!net.isOnline()) say('Already offline (simulated).'); else press('offline'); break;
          case 'online': if (net.isOnline()) say('Already online.'); else press('offline'); break;
          case 'swap': if (phoneShell || !(opts.sim || hostSession)) say('No phones are paired, so there are no sides to swap.'); else swapPhoneSides(); break;
        }
        return true;
      }
      case 'packIntent': return runIntent(r.intent);
      // On the web there is no gimbal — handleSpeech answers with the honest why.
      case 'pointConnect': {
        const id = focusId ?? lastFocus;
        if (!id) { say('Open a board first, then point at the device.'); return true; }
        void pointTurn(id);
        return true;
      }
      case 'gimbalScan': void scanRoom(text); return true;
      case 'gimbal': {
        const g = parseGimbalSpeech(text);
        if (phoneSensor && g === 'hands') {
          void phoneSensor.request('follow', true).then(() => { inputs.handleSpeech(text); });
          return true;
        }
        if (phoneSensor && (g === 'face' || g === 'hold')) void phoneSensor.request('follow', false);
        return inputs.handleSpeech(text);
      }
      case 'kannada': addKannada(); return true;
      case 'history': openHistory(); return true;
      case 'planExtra': {
        const said = planBoard!.runExtra!(r.extra);
        say(said);
        if (ranOn && planExtraRan(said)) nextChips?.markDone(ranOn, r.extra);
        return true;
      }
      case 'canvas': {
        const c = r.cmd;
        switch (c.type) {
          case 'newFrame': newBoard(); break;
          case 'keep': keep(); break;
          case 'drop': drop(); break;
          case 'undo': userUndo(); break;
          case 'showEverything': void overview(); break;
          case 'zoom': zoomStep(c.dir); break;
          case 'zoomReset': zoomReset(); break;
          case 'save': save(); break;
          case 'back': if (focusId) void overview(); else if (lastFocus) void focus(lastFocus); break;
          case 'step': step(c.dir); break;
          case 'goTo': { const id = resolveFrame(reg.list(), c.target); if (id) void focus(id); else say(`No board called “${c.target}”.`); break; }
          case 'pin': { const id = focusId ?? lastFocus; if (id) { reg.setPinned(id, c.on); sync(); updateDock(); persist(); say(c.on ? 'Pinned. It docks beside the next board.' : 'Unpinned.'); } break; }
          case 'buildNext': {
            const cur = focusId ?? lastFocus;
            if (cur && surfaces[cur]) reg.setPinned(cur, true);
            save(); newBoard(); say('Saved. New board ready; your dashboard stays pinned.'); break;
          }
        }
        return true;
      }
      // Device speech (works in any board — controls the docked dashboard mid-build).
      // "play <something>" on a speaker: a search, handled by the speaker connector
      // (Spotify when connected, honest built-in fallback otherwise).
      case 'musicSearch':
        void store.act({ deviceId: r.deviceId, playing: true, query: r.query });
        say(`Looking for ${r.query}…`);
        if (ranOn) nextChips?.markDone(ranOn, 'play-music');
        return true;
      case 'device': {
        const dc = r.result;
        // An impossible level is refused by validation, never clamped.
        const attempt = impossibleAttempt(text, deviceRefs());
        if (attempt) { void breakTurn(text, attempt, ranOn); return true; }
        for (const i of dc.intents) void store.act(i);
        revealDeviceTiles(dc.intents.map((i) => i.deviceId));
        // With a Kannada pack on, the device-command status line is Kannada too.
        say(pack?.lang === 'kn' && dc.statusKey ? statusText(dc.statusKey, pack) : dc.say);
        if (ranOn && dc.intents.some((i) => i.playing === true)) nextChips?.markDone(ranOn, 'play-music');
        return true;
      }
      case 'connectDevices': {
        // Phones first; the dashboard review waits for "build the dashboard".
        const target = focusId ?? reg.add('note', `Board ${reg.list().length + 1}`).id;
        if (!focusId) { sync(); void focus(target); }
        pairFrame = target;
        void pairFirst.begin({ dashboard: r.dashboard }); return true;
      }
      case 'connectRoom': {
        const target = focusId ?? reg.add('note', `Board ${reg.list().length + 1}`).id;
        if (!focusId) { sync(); void focus(target); }
        void connectRoom(target, text); return true;
      }
      // "floor plan for Mrs Sharma's flat" / "a floor plan" / "floorplan" —
      // route to the Nano floor-plan turn with the full utterance so any name
      // in it (e.g. Sharma) gets redacted by the stayed-local strip.
      case 'floorPlan': {
        const cur = focusId;
        // If the current board already has a surface (e.g. the Living room
        // dashboard), pin it and draw the plan on a fresh board instead of
        // drawing the CAD swarm/ghost on top of the dashboard mid-build.
        let target = cur ?? reg.add('note', `Board ${reg.list().length + 1}`).id;
        if (cur && surfaces[cur]) { reg.setPinned(cur, true); target = reg.add('note', `Board ${reg.list().length + 1}`).id; }
        if (focusId !== target) { sync(); void focus(target); }
        floorPlan(target, text); return true;
      }
      // "connect a device" / "add device" opens the sheet; a named device
      // ("connect the speaker") becomes a Nano-only by-name turn.
      case 'connectSheet': openConnectSheet(); return true;
      case 'connectByName': {
        const id = focusId ?? lastFocus;
        if (!id) { say('Open a board first, then connect a device.'); return true; }
        void nameTurn(id, text);
        return true;
      }
      case 'openEnded': {
        // "add a control for the oven" with no oven connected: refused, not chatted about.
        const attempt = impossibleAttempt(text, deviceRefs());
        if (attempt) { void breakTurn(text, attempt, ranOn); return true; }
        break;
      }
    }
    void openEndedTurn(text);
    return true;
  }

  // ---- input ----
  // Delegated on root: on phones some tools live in the menu sheet (phoneMenu.ts).
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]'); if (!b) return;
    ({ everything: () => void overview(), new: newBoard, save, undo: userUndo, ai: () => { showAi(true, true); aiPanel.querySelector<HTMLElement>('.mc-ai-body')?.scrollTo?.({ top: 0 }); }, monitor: openMonitor, offline: () => setOnline(!net.isOnline(), true), hands: () => void toggleHands(), dwell: () => { setDwellClick(!dwellClickOn); say(dwellClickOn ? 'Hover to click on: rest your palm on a button to press it.' : 'Hover to click off: tap a fist to click.'); }, register: openScan, reregister: openScan, teach: openTeach, gestures: openTeachList, swap: swapPhoneSides } as Record<string, () => void>)[b.dataset.cmd!]?.();
  });
  const phoneMenu = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? mountPhoneMenu(root) : null;
  const toolPalette = mountToolPalette(root, window, { onChange: () => showArrangeStrip() });
  function openTools(): void { if (isPhone()) phoneMenu?.open(); else toolPalette.open(); }
  function closeTools(): void { if (isPhone()) phoneMenu?.close(); else toolPalette.close(); }
  dockEl.querySelector('.mc-dock-unpin')!.addEventListener('click', () => {
    const id = dockEl.dataset.frame; if (!id) return;
    reg.setPinned(id, false); sync(); updateDock(); persist(); say('Unpinned.');
  });
  aiPanel.querySelector('.mc-ai-history')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-hist-undo]')) undo();
  });
  root.querySelector<HTMLFormElement>('.mc-say')!.addEventListener('submit', (e) => {
    e.preventDefault(); const i = root.querySelector<HTMLInputElement>('#mc-say-in')!;
    if (i.value.trim()) run(i.value.trim()); i.value = '';
  });
  world.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]');
    const frame = t.closest<HTMLElement>('.mc-frame')?.dataset.frame;
    if (act && frame) {
      if (act.dataset.act === 'connect') void connectRoom(frame);
      else if (act.dataset.act === 'talk') micFab?.toggle();
      else if (act.dataset.act === 'floorplan') floorPlan(frame);
      return;
    }
    if (phoneLocked()) return;
    if (phoneShell && focusId && frame === focusId) {
      const tile = t.closest<HTMLElement>('[data-mc-tile], .mc-edit-item');
      if (tile) { selectPhoneTile(tile); return; }
    }
    if (frame && frame !== focusId && !dragged && !t.closest<HTMLElement>('.mc-frame-title')?.dataset.dragged) void focus(frame);
  });
  let drag: { x: number; y: number } | null = null; let dragged = false;
  // Touch two-finger pinch: same anchored transform as the two-hand gesture, so
  // a phone pinch zooms/pans the canvas exactly like a touch screen. Tracked by
  // pointerId in viewport-local px; while two fingers are down the single-finger
  // pan is suppressed. Overview only (drops focus first, like the wheel).
  const touchPts = new Map<number, Vec>();
  const touchPinch = createTwoHandGesture({ rotate: false, minScale: MIN_Z, maxScale: 12 });
  let touchGrab: { p0: Vec; q0: Vec; cam0: Camera } | null = null;
  const vpPoint = (e: PointerEvent): Vec => {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function driveTouchPinch(now: number): void {
    const two = [...touchPts.values()];
    const r = touchPinch.update({ p: two[0] ?? null, q: two[1] ?? null, now });
    if (r.started && two.length >= 2) {
      if (focusId) { focusId = null; sync(); }
      touchGrab = { p0: two[0], q0: two[1], cam0: camera };
      drag = null; dragged = true; // suppress the one-finger pan + tap-to-focus
      return;
    }
    if (r.active && touchGrab && two.length >= 2) {
      const p1 = applyTransform(r.transform, touchGrab.p0);
      const q1 = applyTransform(r.transform, touchGrab.q0);
      camera = twoHandCamera(touchGrab.cam0, touchGrab.p0, touchGrab.q0, p1, q1);
      applyCamera();
    }
    if (r.ended) { if (touchGrab) persist(); touchGrab = null; }
  }
  // Held Space: the next mouse drag pans even over boards. Capture phase so a
  // focused plan board never also draws a wall; we start the pan ourselves.
  let spaceHeld = false; let spaceSwallowClick = false;
  viewport.addEventListener('pointerdown', (e) => {
    if (!spaceHeld || phoneLocked() || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    spaceSwallowClick = true;
    drag = { x: e.clientX, y: e.clientY }; dragged = false;
  }, true);
  viewport.addEventListener('click', (e) => {
    if (!spaceSwallowClick) return;
    spaceSwallowClick = false; e.preventDefault(); e.stopPropagation();
  }, true);
  viewport.addEventListener('pointerdown', (e) => {
    if (phoneLocked()) return;
    if (focusId && (e.target as HTMLElement).closest('.mc-frame.focused')) return;
    if (e.pointerType === 'touch') {
      touchPts.set(e.pointerId, vpPoint(e));
      if (touchPts.size >= 2) { driveTouchPinch(e.timeStamp); return; }
    }
    drag = { x: e.clientX, y: e.clientY }; dragged = false;
  });
  // Window-level listeners outlive `root`'s own DOM (removing root's children
  // doesn't remove these), so a remount leaks them unless destroy() below
  // explicitly removes each one closing over this mount's stale state.
  const onWindowPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && touchPts.has(e.pointerId)) {
      touchPts.set(e.pointerId, vpPoint(e));
      if (touchPts.size >= 2) { driveTouchPinch(e.timeStamp); return; }
    }
    // `drag` is only set for a pointerdown on empty canvas (a down on the
    // focused frame returns early), so panning in FOCUS stays translation-only
    // at z=1 — a phone can reach every tile of a board wider than the screen.
    // elementFromPoint / native clicks hit-test in screen space, so the pan
    // never shifts what a pinch or tap lands on (P2-4).
    if (phoneLocked()) return;
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    dragged = true; camera = panBy(camera, dx, dy); drag = { x: e.clientX, y: e.clientY }; applyCamera();
  };
  const onWindowPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && touchPts.delete(e.pointerId) && touchPts.size < 2) {
      if (touchGrab) persist();
      touchPinch.reset(); touchGrab = null;
    }
    if (drag && dragged) persist(); drag = null; setTimeout(() => { dragged = false; spaceSwallowClick = false; }, 0);
  };
  const onWindowKeydown = (e: KeyboardEvent) => {
    // The teach dialog is aria-modal: Escape closes it (like its ×) even from
    // its own text box, and never also zooms the canvas out.
    if (e.key === 'Escape' && teachPanel.isOpen()) { e.preventDefault(); teachPanel.close(); return; }
    // The Register scan is aria-modal too: Escape = its Cancel button.
    if (e.key === 'Escape' && scanPanel?.isOpen()) { e.preventDefault(); document.querySelector<HTMLButtonElement>('.mc-scan-cancel')?.click(); return; }
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    // A board widget already used this key (the floor plan's Escape ends the
    // wall being drawn) — don't also zoom the canvas out from under it.
    if (e.defaultPrevented) return;
    // B-142 parity: Ctrl/Cmd+Z is the keyboard's Undo (same guard as the button and voice).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); userUndo(); return; }
    if (reviewDialog.isOpen()) return; // the dialog's own Esc handler (stopPropagation) owns this key
    if (!phoneLocked() && !teachPanel.isOpen() && !scanPanel?.isOpen() && !isTypingTarget(e.target)) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomStep(1); return; }
      if (mod && !e.altKey && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomStep(-1); return; }
      if (mod && !e.altKey && e.key === '0') { e.preventDefault(); zoomReset(); return; }
      if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit1') { e.preventDefault(); void overview(); return; }
      if (e.code === 'Space' && !mod && !e.altKey && !onActivatable(e.target)) {
        // Held Space = pan mode. preventDefault so Space neither scrolls nor clicks a focused button on keyup.
        e.preventDefault();
        if (!spaceHeld) { spaceHeld = true; root.classList.add('mc-space-pan'); }
        return;
      }
    }
    if (e.key !== 'Escape') return;
    if (focusId) { e.preventDefault(); void overview(); return; }
  };
  const onActivatable = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('button, a, summary, [role=button]');
  const onWindowKeyup = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    if (onActivatable(e.target)) return;
    if (spaceHeld) { spaceHeld = false; root.classList.remove('mc-space-pan'); e.preventDefault(); }
    else if (!isTypingTarget(e.target)) e.preventDefault();
  };
  const onWindowBlur = () => { spaceHeld = false; root.classList.remove('mc-space-pan'); };
  const onWindowResize = () => { if (phoneShell) { fitPhone(); return; } if (focusId) { const f = reg.get(focusId); if (f) { camera = focusCam(f); applyCamera(); } } else { root.style.setProperty('--mc-bar-h', `${barH()}px`); } };
  // Opening Tools, a status line, or a wrap at 1280px changes the bar's height
  // without a window resize — keep --mc-bar-h in sync so the dock, AI panel,
  // and review padding don't slide under the bar.
  const barEl = root.querySelector<HTMLElement>('.mc-bar');
  const barRo = typeof ResizeObserver !== 'undefined' && barEl
    ? new ResizeObserver(() => { root.style.setProperty('--mc-bar-h', `${barH()}px`); })
    : null;
  if (barEl && barRo) barRo.observe(barEl);
  const onWindowOnline = () => setOnline(true);
  const onWindowOffline = () => setOnline(false);
  addEventListener('pointermove', onWindowPointerMove);
  addEventListener('pointerup', onWindowPointerUp);
  addEventListener('pointercancel', onWindowPointerUp);
  addEventListener('keydown', onWindowKeydown);
  addEventListener('keyup', onWindowKeyup);
  addEventListener('blur', onWindowBlur);
  addEventListener('resize', onWindowResize);
  addEventListener('online', onWindowOnline);
  addEventListener('offline', onWindowOffline);
  function destroy(): void {
    // Pending writes and timers go first, so nothing fires into a torn-down
    // canvas — but a pending board write is flushed, not dropped (the last
    // edit must survive).
    if (persistTimer) persist(true);
    clearTimeout(wheelPersistTimer);
    if (statusTimer) clearTimeout(statusTimer);
    boardEdge.reset();
    if (pairingStop) { void pairingStop(); pairingStop = null; }
    hostSession = null;
    nextChips?.destroy();
    nextChips = null;
    takePointChoice(); // clears its 20 s expiry timer
    pairFirst.cancel();
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
    phoneMenu?.destroy();
    toolPalette.destroy();
    micFab?.destroy();
    detachMorphPointers();
    morphFlow?.destroy();
    morphCard.destroy();
    phoneHands?.destroy();
    phoneSensor?.destroy();
    handPointer?.destroy();
    endPointWait();
    stopReplay();
    reviewDialog.destroy();
    swarm.destroy();
    swarmDock.destroy();
    swarmPillObserver?.disconnect();
    scanPanel?.destroy();
    registerChip?.remove();
    regChip?.remove();
    handTip?.remove();
    removeEventListener('pointermove', onWindowPointerMove);
    removeEventListener('pointerup', onWindowPointerUp);
    removeEventListener('pointercancel', onWindowPointerUp);
    removeEventListener('keydown', onWindowKeydown);
    removeEventListener('keyup', onWindowKeyup);
    removeEventListener('blur', onWindowBlur);
    removeEventListener('resize', onWindowResize);
    removeEventListener('online', onWindowOnline);
    removeEventListener('offline', onWindowOffline);
    barRo?.disconnect();
  }
  // ---- zoom + pan (wheel, pinch, keys, HUD, voice) ----
  // Every zoom path drops focus first: a focused board is 1:1 only.
  const dropFocusForZoom = () => { if (focusId) { focusId = null; sync(); } };
  let zoomGoal: { z: number; at: number } | null = null;
  let wheelPersistTimer = 0;
  function zoomTo(z: number): void {
    dropFocusForZoom();
    zoomGoal = { z, at: performance.now() };
    void flyTo(zoomCameraTo(camera, vp(), z));
  }
  function zoomStep(dir: 1 | -1): void {
    // Repeated presses mid-flight build on the pending target, not the in-between zoom.
    const base = zoomGoal && performance.now() - zoomGoal.at < 450 ? zoomGoal.z : camera.z;
    zoomTo(stepZoom(base, dir));
  }
  function zoomReset(): void { if (Math.abs(camera.z - 1) > 1e-3) zoomTo(1); }
  /** True when `t` sits inside something that can itself scroll in this direction (AI panel, terminal, board content). */
  function canScrollInside(t: HTMLElement | null, dx: number, dy: number): boolean {
    for (let el = t; el && el !== viewport; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) continue;
      const cs = getComputedStyle(el);
      if (dy && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight
        && (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true;
      if (dx && /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth
        && (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1)) return true;
    }
    return false;
  }
  viewport.addEventListener('wheel', (e) => {
    if (phoneLocked() || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (focusId && target.closest('.mc-frame.focused')) return; // the plan renderer owns the wheel on a focused board
    const intent = wheelIntent(e);
    if (intent.kind === 'pan') {
      if (canScrollInside(target, intent.dx, intent.dy)) return;
      e.preventDefault();
      cancelAnimationFrame(flight); zoomGoal = null;
      camera = panBy(camera, -intent.dx, -intent.dy);
      applyCamera();
      clearTimeout(wheelPersistTimer); wheelPersistTimer = window.setTimeout(persist, 200);
      return;
    }
    e.preventDefault();
    cancelAnimationFrame(flight); zoomGoal = null;
    dropFocusForZoom();
    const r = viewport.getBoundingClientRect();
    camera = zoomAbout(camera, { x: e.clientX - r.left, y: e.clientY - r.top }, intent.factor);
    applyCamera(); persist();
  }, { passive: false });
  // Safari trackpad pinch arrives as gesture events, not ctrl+wheel.
  let gestureZ0 = 1;
  type GestureEv = Event & { scale: number; clientX: number; clientY: number };
  viewport.addEventListener('gesturestart', (e) => {
    if (phoneLocked()) return;
    e.preventDefault(); cancelAnimationFrame(flight); dropFocusForZoom(); gestureZ0 = camera.z;
  });
  viewport.addEventListener('gesturechange', (e) => {
    if (phoneLocked()) return;
    const g = e as GestureEv; e.preventDefault();
    const r = viewport.getBoundingClientRect();
    camera = zoomAbout(camera, { x: g.clientX - r.left, y: g.clientY - r.top }, (gestureZ0 * g.scale) / camera.z);
    applyCamera();
  });
  viewport.addEventListener('gestureend', (e) => { e.preventDefault(); persist(); });
  if (!phoneShell && typeof document !== 'undefined') {
    zoomHud = mountZoomHud(root, { zoomIn: () => zoomStep(1), zoomOut: () => zoomStep(-1), reset: zoomReset, fit: () => void overview() });
    zoomHud.setZoom(camera.z);
  }

  const voice = opts.voice ?? null;

  // Big floating mic: tap, keyboard or pinch toggles listening. The only talk control.
  const micFab = typeof document !== 'undefined' ? mountMicFab(root, voice, say, { getStatus: () => statusEl.textContent ?? '', holdToTalk: phoneShell }) : null;
  micFabRef = micFab;
  // Hand-reachable cluster at the TOP RIGHT: Register, Edit, Tools, Talk.
  // Kept clear of the edges and of the facing banner (top-left).
  // The phone-simple shell leaves the mic in the root so CSS can pin it
  // to the bottom centre — no Register/Edit/Tools cluster on phones.
  if (typeof document !== 'undefined' && !phoneShell) {
    let cluster = root.querySelector<HTMLElement>('.mc-hand-cluster');
    if (!cluster) {
      cluster = document.createElement('div');
      cluster.className = 'mc-hand-cluster';
      root.append(cluster);
    }
    const talk = root.querySelector('.mc-talk-control');
    const toolsChip = root.querySelector('.mc-tools-chip');
    const editBtn = root.querySelector('.mc-edit-toggle');
    const resetBtn = root.querySelector('.mc-edit-reset');
    const registerBtn = root.querySelector('.mc-register-chip');
    for (const node of [registerBtn, editBtn, toolsChip, talk, resetBtn]) {
      if (node) cluster.append(node);
    }
  }

  function applyEditLock(): void {
    if (!phoneShell) return;
    const r = nextPhoneEditLock({
      unlocked: editUnlocked, enabled: lookToEdit, facing: facingNow, faceSeen, now: nowFn(), awaySince,
      awayMs: opts.lookAwayMs,
    });
    editUnlocked = r.unlocked;
    awaySince = r.awaySince;
    faceSeen = r.faceSeen;
    root.classList.toggle('is-edit-locked', !editUnlocked);
    const hint = root.querySelector<HTMLElement>('.mc-look-hint');
    if (hint) {
      hint.hidden = !r.hint;
      if (r.hint) hint.textContent = r.hint;
    }
    if (editUnlocked) {
      editBoard.setEditing(true);
    } else {
      editBoard.setEditing(false);
      micFab?.stop();
      clearPhoneSelection();
    }
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
    if (editUnlocked && facingNow === false && awaySince != null) {
      const left = (opts.lookAwayMs ?? 3000) - (nowFn() - awaySince);
      if (left > 0) lockTimer = setTimeout(() => applyEditLock(), left);
    }
  }
  function setFacing(facing: boolean | null): void {
    facingNow = facing;
    applyEditLock();
  }
  function showRemoteBoard(plan: SurfacePlan): void {
    let id = focusId ?? lastFocus ?? reg.list()[0]?.id;
    if (!id) {
      const f = reg.add('note', plan.title || 'Board');
      id = f.id;
    } else if (plan.title) {
      reg.rename(id, plan.title);
    }
    surfaces[id] = plan;
    focusId = id;
    lastFocus = id;
    renderSurface(id);
    sync();
    persist();
    if (phoneShell) {
      applyEditLock();
      fitPhone();
    }
  }

  // Sim/test hook: the button gestures without a camera. show(true) turns
  // the badges on as if Hands were on; feed() runs one selfie-space frame
  // through the real classifier → hold engine → button path; hand() builds
  // synthetic landmarks for a shape (handShapeFixtures).
  /** Sim: the wrist (selfie space) of a synthetic right open hand whose palm
   *  centre maps to screen (x, y) through the laptop reach box. */
  const palmFor = (x: number, y: number): { x: number; y: number } => ({
    x: REACH.x0 + (x / innerWidth) * (REACH.x1 - REACH.x0) + 0.001,
    y: REACH.y0 + (y / innerHeight) * (REACH.y1 - REACH.y0) + 0.074,
  });
  if (opts.sim && typeof window !== 'undefined' && gestures) {
    (window as unknown as { __mcGestures?: unknown }).__mcGestures = {
      show: (on: boolean) => gestures.setActive(on),
      feed: (hands: readonly (readonly { x: number; y: number }[])[], now: number, facing: boolean | null = true) =>
        gestures.frame(hands, now, { facing, faceX: 0.5, blocked: gesturesBlocked() }),
      hand: syntheticHand,
      shapes: () => gestures.lastShapes(),
      highlighted: () => palmHighlight?.current() ?? null,
      /** Selfie-space wrist position that puts the PALM at screen (x, y). */
      palmFor: (x: number, y: number) => palmFor(x, y),
    };
  }
  // Sim/test hook: drive the hand pointer without a camera.
  if (opts.sim && typeof window !== 'undefined' && handPointer) (window as unknown as { __mcHand?: HandPointer }).__mcHand = handPointer;
  // Sim/test hook: feed a raw landmark frame (camera space, up to two hands)
  // straight into the live hand pointer — the same path the camera's
  // presence stream uses — so headless verification can drive dwell, the
  // one-fist grab/pan and the two-fist zoom without a camera.
  if (opts.sim && typeof window !== 'undefined') {
    (window as unknown as { __mcHand2?: { feedFrame(hands: readonly (readonly { x: number; y: number }[])[], now: number): void; event(ev: Parameters<typeof inputs.handEvent>[0]): void } }).__mcHand2 = {
      feedFrame: (hands, now) => { handPointer?.update(hands, now); },
      // A recognised hand event (palm hold, keep, drop) as canvasInputs
      // delivers it — camera frames themselves no longer emit keep/drop.
      event: (ev) => { inputs.handEvent(ev); },
    };
  }

  // ---- morph: pinch-hold (or mouse/touch long-press) a tile, speak a change,
  // Gemini patches that ONE tile in place. All orchestration is morphFlow.ts;
  // this block only provides the host seams: tile stamping + hit-testing,
  // the engine, the terminals/swarm receipt, apply/undo, and the adapters.
  //
  // Tile hosts are stamped lazily (at hold time, not render time): both render
  // paths emit one element per plan node in pre-order document order, so
  // zipping them against enumerateMorphTiles gives each host its stable
  // tileComponentId without touching the renderers.
  function stampMorphTiles(frameId: string): HTMLElement[] {
    const plan = surfaces[frameId];
    const surfaceEl = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-surface`);
    if (!plan || !surfaceEl) return [];
    const liveEls = Array.from(surfaceEl.querySelectorAll<HTMLElement>(LIVE_TILE_TAGS.join(',')));
    const els = liveEls.length ? liveEls : Array.from(surfaceEl.querySelectorAll<HTMLElement>(FALLBACK_TILE_SELECTOR));
    const entries = enumerateMorphTiles(plan);
    els.forEach((el) => { el.removeAttribute('data-mc-tile'); el.removeAttribute('data-mc-frame'); });
    entries.forEach((entry, i) => {
      const el = els[i];
      if (el) { el.setAttribute('data-mc-tile', entry.id); el.setAttribute('data-mc-frame', frameId); }
    });
    return els;
  }
  /** A spoken device command changed these devices: scroll the first of
   *  their tiles on the focused board into view, so "play music" visibly
   *  does something even when the Speaker sat below the board's fold. */
  function revealDeviceTiles(deviceIds: readonly string[]): void {
    const id = focusId;
    const plan = id ? surfaces[id] : undefined;
    if (!id || !plan || !deviceIds.length) return;
    const want = new Set(deviceIds);
    const els = stampMorphTiles(id);
    const i = enumerateMorphTiles(plan).findIndex((e) => want.has((e.spec as { deviceId?: string }).deviceId ?? ''));
    const el = i >= 0 ? els[i] : null;
    // Scroll only the board body (scrollIntoView would also scroll the
    // overflow-hidden viewport and knock the camera off).
    const body = el?.closest<HTMLElement>('.mc-frame-body');
    if (!el || !body || !body.clientHeight) return;
    const er = el.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const scale = br.height / body.clientHeight || 1;
    const pad = 16 * scale;
    let dy = 0;
    if (er.bottom > br.bottom - pad) dy = Math.min(er.bottom - br.bottom + pad, er.top - br.top - pad);
    else if (er.top < br.top) dy = er.top - br.top - pad;
    if (Math.abs(dy) > 1) body.scrollBy?.({ top: dy / scale, behavior: reduced ? 'auto' : 'smooth' });
  }
  function tileSelfCheckLog(engine: 'nano' | 'gemini', _verb: string, detail: string): void {
    panels.forEngine(engine).log('note', detail);
  }
  function waitForStampedHost(frameId: string, path: number[]): Promise<HTMLElement | null> {
    return new Promise((resolve) => waitForLayout(() => {
      const plan = surfaces[frameId];
      if (!plan) { resolve(null); return; }
      const els = stampMorphTiles(frameId);
      const idx = enumerateMorphTiles(plan).findIndex((e) => e.path.length === path.length && e.path.every((v, i) => v === path[i]));
      resolve(idx >= 0 ? (els[idx] ?? null) : null);
    }));
  }
  /** Trial-apply a self-check fix, commit it to undo history only after
   *  the re-check passes, and roll the canvas back to `before` otherwise.
   *  Waiting for layout before returning the host is what used to make
   *  "fix pass did not apply" fire even when the patch was already in
   *  `surfaces` — stampMorphTiles in the same tick as renderSurface found
   *  no Lit hosts yet. */
  function selfCheckFixSession(frameId: string, path: number[]): {
    applyFix: (rawReply: string) => Promise<HTMLElement | null>;
    rollbackFix: () => Promise<HTMLElement | null>;
    commitFix: () => void;
  } {
    let before: (typeof surfaces)[string] | null = null;
    let after: (typeof surfaces)[string] | null = null;
    let pending = false;
    return {
      applyFix: async (rawReply: string) => {
        const plan = surfaces[frameId];
        const original = plan ? tileAtPath(plan, path) : null;
        if (!plan || !original) return null;
        const parsed = parseMorphTile(rawReply, original, deviceIdSession);
        if (!parsed.ok) return null;
        const patched = applyMorphPatch(plan, path, parsed.value);
        if (!patched) return null;
        const check = gateMessages(expandPlan(patched, frameId, store.all()), CATALOG_SCHEMAS);
        if (!check.ok) return null;
        before = surfaces[frameId] ?? null;
        after = patched;
        pending = true;
        surfaces[frameId] = patched;
        renderSurface(frameId); sync(); updateDock(); persist();
        return waitForStampedHost(frameId, path);
      },
      rollbackFix: async () => {
        if (!pending) return null;
        if (before) surfaces[frameId] = before;
        else delete surfaces[frameId];
        pending = false;
        after = null;
        renderSurface(frameId); sync(); updateDock(); persist();
        return waitForStampedHost(frameId, path);
      },
      commitFix: () => {
        if (!pending || !after) return;
        history.push({ frameId, before, after, by: 'gemini', summary: 'self-check fix' });
        historyRender();
        pending = false;
      },
    };
  }
  /** Self-check tiles right after they land in the DOM — every top-level
   *  tile of a freshly kept proposal, or (with `wantPath`) just the one tile
   *  morphFlow just spliced or edit mode just dragged/resized. Shared by the
   *  build path, the morph splice path and the edit-commit path, per the
   *  host's own tile stamping (stampMorphTiles).
   *
   *  The A2UI surface (and every nested tile) is a Lit element, which always
   *  defers its first render by at least one microtask — so stamping hosts
   *  in the SAME tick as renderSurface/applyMorph/an edit commit finds
   *  nothing yet and silently skips every tile. afterTilesRendered waits
   *  past that render instead. */
  function selfCheckTiles(frameId: string, wantPath?: number[], onUnverified?: () => void): void {
    waitForLayout(() => {
      const plan = surfaces[frameId];
      if (!plan) return;
      const els = stampMorphTiles(frameId);
      const entries = enumerateMorphTiles(plan);
      for (const target of selectSelfCheckTargets(entries, els, wantPath)) {
        const session = selfCheckFixSession(frameId, target.path);
        let fixSent: SentInfo | null = null;
        void runSelfCheck({
          host: target.host,
          spec: target.spec,
          tileId: target.id,
          log: tileSelfCheckLog,
          requestFix: async (prompt) => {
            const eng = engineFor('gemini', scriptedFixJson(target.spec));
            const why = 'Gemini · cloud — a tile failed its own check, so Deep rewrote that one tile';
            const si: SentInfo = { engine: eng.id, prompt, sent: 'the tile dump and the problems', routeLine: eng.routeLine ?? (eng.sim ? `SIM · ${why}` : why), sim: eng.sim };
            recordSent(si, eng.id === 'nano' ? '' : prompt);
            fixSent = si;
            try { return await eng.stream(prompt, () => {}); } catch (e) {
              if (!eng.fallback) throw e;
              // The prepared draft answered instead: the footer says SIM.
              si.sim = true;
              return eng.fallback.stream(prompt, () => {});
            }
          },
          applyFix: session.applyFix,
          rollbackFix: session.rollbackFix,
          commitFix: session.commitFix,
          confirmFix: async (raw) => {
            const plan = surfaces[frameId];
            const original = plan ? tileAtPath(plan, target.path) : null;
            if (!plan || !original) return false;
            const parsed = parseMorphTile(raw, original, deviceIdSession);
            if (!parsed.ok) return false;
            if (JSON.stringify(parsed.value) === JSON.stringify(original)) return true;
            // Two top-level tiles can fail self-check in the same tick; their
            // fix passes run concurrently. The check→showReview below is
            // synchronous, so if a sibling's fix review already owns the single
            // full-screen slot, don't overwrite its card (which would orphan
            // its Promise). Decline this one — runSelfCheck rolls the fix back
            // and leaves the original tile with its warning mark, as designed.
            if (reviewDialog.isOpen()) return false;
            return new Promise((done) => {
              const card = renderProposalCard(document, {
                id: `p-fix-${target.id}`, title: `Fix ${target.label}`, youAsked: 'self-check fix', status: 'changed',
                catalog: { helper: 'Deep', byLine: 'Deep · online', routeLine: 'Gemini · self-check fix', lineId: 'custom', whyLabel: 'Why online', whatWasSent: 'the tile dump and the problems', technicalLine: 'Gemini · self-check fix' },
              }, {
                onKeep: () => { reviewDialog.close(); done(true); },
                onDrop: () => { reviewDialog.close(); done(false); },
              });
              showReview({
                title: `Fix ${target.label}`, card, extra: buildReviewExtra(),
                changes: diffTile(original, parsed.value, { devices: store.all() }),
                facts: reviewFacts(fixSent, 'self-check fix'),
              });
            });
          },
        }).then((stat) => { if (!stat.passed) onUnverified?.(); });
      }
    });
  }
  const morphDisabled = (): boolean =>
    !focusId || (!phoneShell && editBoard.editing) || reviewBusy() || (scanPanel?.isOpen() ?? false) || phoneLocked();
  const morphResolve = (pt: { x: number; y: number }): MorphTargetRef | null => {
    const fid = focusId;
    const plan = fid ? surfaces[fid] : null;
    if (!fid || !plan) return null;
    stampMorphTiles(fid);
    return resolveMorphTarget(document as unknown as MorphDoc, pt, plan, { frameId: fid });
  };
  const morphTargetByIndex = (index: number): MorphTargetRef | null => {
    const fid = focusId;
    const plan = fid ? surfaces[fid] : null;
    if (!fid || !plan) return null;
    const els = stampMorphTiles(fid);
    const host = els[index];
    const id = host?.getAttribute('data-mc-tile');
    if (!host || !id) return null;
    const entry = enumerateMorphTiles(plan).find((e) => e.id === id);
    if (!entry) return null;
    return { tileId: entry.id, path: entry.path, spec: entry.spec, label: entry.label, rect: host.getBoundingClientRect(), host };
  };
  // The morph swarm: one real Gemini call, every cursor pinned to the tile.
  const morphSwarmPlan = (tileIndex: number, redactedName: boolean): SwarmPlanInput => ({
    calls: [{ kind: 'gemini', label: 'Gemini · tile edit' }],
    subSteps: [
      { kind: 'gemini', label: 'Gemini · revise tile', tileIndex },
      { kind: 'gemini', label: 'Gemini · keep layout', tileIndex },
      ...(redactedName ? [{ kind: 'nano' as const, label: 'Nano · redaction', tileIndex }] : []),
      { kind: 'nano', label: 'Nano · labels', tileIndex },
      { kind: 'nano', label: 'Nano · device values', tileIndex },
    ],
  });
  function applyMorph(frameId: string, patched: SurfacePlan, summary: string, path?: number[]): boolean {
    const f = reg.get(frameId);
    if (!f) return false;
    const check = gateMessages(expandPlan(patched, frameId, store.all()), CATALOG_SCHEMAS);
    if (!check.ok) { say(`Blocked a tile that did not pass the check: ${check.errors[0]}`); return false; }
    const before = surfaces[frameId] ?? null;
    surfaces[frameId] = patched;
    const entry = history.push({ frameId, before, after: patched, by: 'gemini', summary });
    renderSurface(frameId); sync(); updateDock(); persist(); historyRender();
    if (path) {
      selfCheckTiles(frameId, path, () => {
        // Roll back THIS morph specifically, not whatever happens to be newest
        // on the history stack — an unrelated build could have been kept while
        // the async self-check (layout wait + fix pass) was in flight.
        if (!entry.undone) {
          entry.undone = true;
          if (before) { surfaces[frameId] = before; reg.rename(frameId, before.title); renderSurface(frameId); }
          else { delete surfaces[frameId]; }
          sync(); updateDock(); persist(); historyRender();
        }
        panels.forEngine('gemini').fail(MORPH_UNVERIFIED_LINE);
        say(MORPH_UNVERIFIED_LINE);
      });
    }
    return true;
  }
  const morphCard = mountMorphCard(root, {
    onCancel: () => morphFlow?.cancel(),
    onUndo: () => { undo(); morphFlow?.cancel(); },
    onAutoClose: () => morphFlow?.onCardAutoClosed(),
  });
  morphFlow = createMorphFlow({
    doc: document,
    root,
    card: morphCard,
    resolveTarget: morphResolve,
    targetByIndex: morphTargetByIndex,
    frameId: () => focusId,
    plan: (fid) => surfaces[fid] ?? null,
    disabled: morphDisabled,
    engine: (json) => engineFor('gemini', json),
    deviceIdSession,
    sim: opts.sim,
    mic: {
      start: () => { if (micFab && !micFab.listening) micFab.toggle(); },
      stop: () => micFab?.stop(),
      // ?sim=1 has no camera or mic: the card always asks the user to type.
      supported: () => !!voice?.supported && !opts.sim,
    },
    apply: applyMorph,
    propose: (fid, patched, summary, path, turn) => new Promise((done) => {
      const card = renderProposalCard(document, {
        id: `p-morph-${Date.now()}`, title: summary, youAsked: summary, status: 'changed',
        catalog: { helper: 'Deep', byLine: 'Deep · online', routeLine: 'Gemini · one tile', lineId: 'custom', whyLabel: 'Why online', whatWasSent: 'your redacted words and one tile', technicalLine: 'Gemini · one tile' },
      }, {
        onKeep: () => { reviewDialog.close(); done(applyMorph(fid, patched, summary, path)); },
        onDrop: () => { reviewDialog.close(); done(false); },
      });
      showReview({
        title: summary, card, extra: buildReviewExtra(),
        changes: diffPlans(surfaces[fid] ?? null, patched, { devices: store.all() }),
        facts: reviewFacts(turn?.sent ?? null, turn?.utterance ?? summary),
      });
    }),
    undo,
    ui: {
      sent: (s, o) => aiSent(o.utterance, s, { swarmPlan: morphSwarmPlan(o.tileIndex, protectTurn(o.utterance, s.prompt).used.length > 0) }),
      log: (engine, verb, detail) => panels.forEngine(engine).log(verb, detail),
      handoff: (reason) => panels.showHandoff('nano', reason),
      settle: async () => { await holdSwarmMinimum(); settleSwarm(); autoHideAi(); },
      state: (text) => { aiPanel.querySelector('.mc-ai-state')!.textContent = text; say(text); },
    },
    typing: (on) => toolPalette.peekSay(on),
    // The say box, its Go button, and Talk must stay clickable while the
    // card is open — only a press outside all of those cancels the morph.
    protectedPoint: (p) => {
      // The full-screen review (plan-first morph Approve / Reject / Ask else)
      // must not count as "a press outside the morph card", or a pinch on
      // Approve cancels the in-flight morph and the Undo chip never appears.
      const extra = [
        root.querySelector<HTMLElement>('.mc-say'),
        micFab?.el ?? null,
        document.querySelector<HTMLElement>('.mc-review-dialog:not([hidden])'),
      ];
      for (const el of extra) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return true;
      }
      return false;
    },
    // The hold fired mid-pinch: letting go must not also click the control
    // under the finger (the mouse/touch adapter swallows its own click).
    onFired: () => handPointer?.suppressNextRelease(),
  });
  const detachMorphPointers = phoneShell ? () => undefined : attachMorphPointers(root, morphFlow, document);
  if (phoneShell && micFab) {
    micFab.el.addEventListener('pointerdown', () => {
      if (phoneLocked() || !selectedTileHost || !focusId) return;
      stampMorphTiles(focusId);
      const id = selectedTileHost.getAttribute('data-mc-tile');
      const host = id ? root.querySelector<HTMLElement>(`[data-mc-tile="${CSS.escape(id)}"]`) : selectedTileHost;
      if (!host) return;
      const target = morphResolve({
        x: host.getBoundingClientRect().left + host.getBoundingClientRect().width / 2,
        y: host.getBoundingClientRect().top + host.getBoundingClientRect().height / 2,
      });
      if (target) morphFlow.ask(target, { startMic: false });
    });
  }
  // ?sim=1: the deterministic replay — same classifier on an injected clock,
  // scripted Gemini, injected utterance; no camera or mic anywhere.
  if (opts.sim && typeof window !== 'undefined') {
    (window as unknown as { __mcMorph?: unknown }).__mcMorph = {
      replay: async (index = 0, utterance = 'change the color to warm amber'): Promise<boolean> => {
        const id = focusId ?? lastFocus ?? reg.list().find((f) => surfaces[f.id])?.id ?? null;
        if (!id) return false;
        if (focusId !== id) await focus(id);
        if (!morphFlow?.simulateHold(index)) return false;
        setTimeout(() => { morphFlow?.handleSpeech(utterance); }, 1400);
        return true;
      },
    };
  }

  // Next-step chips: 2–3 journey steps at the foot of the focused board,
  // picked by Nano on this device (else the rule list, labelled "Suggested").
  // Each chip runs a phrase run() already routes. Desktop only.
  if (!phoneShell) nextChips = createNextStepChips({
    root: world,
    focused: () => {
      const f = focusId ? reg.get(focusId) : undefined;
      const el = f ? world.querySelector<HTMLElement>(`[data-frame="${f.id}"]`) : null;
      return f && el ? { id: f.id, el, board: boardForJourney(f, surfaces[f.id]) } : null;
    },
    ctx: () => ({
      lang: pack?.lang ?? 'en', online: net.isOnline(), phones: pairFirst.phones().length, sim: !!opts.sim,
      pairing: pairFirst.phase() === 'pairing' || pairFirst.phase() === 'asking',
      lampLabel: deviceRefs().find((d) => d.kind === 'lamp')?.label,
      savedRoom: reg.list().some((f) => f.pinned && f.id !== focusId && surfaces[f.id]?.kind === 'room'),
    }),
    nano: async (prompt) => { const r = await pickNextStepsOnDevice(prompt); if (r == null) throw new Error('Nano not available'); return r; },
    run: (say) => { run(say); },
    // A note line (feeds the AI monitor too); no turn running → no blinking cursor.
    onNano: (line) => { const p = panels.forEngine('nano'); p.log('note', line); if (!turnBusy) p.setWorking(false); },
  });

  // A persisted language pack localizes the UI (and voice) on load, offline-safe.
  applyStrings();
  if (pack) opts.voice?.setLang?.(resolveLanguage(pack.lang).speechLang);
  if (!net.isOnline()) { const btn = root.querySelector<HTMLElement>('[data-cmd=offline]')!; btn.setAttribute('aria-pressed', 'true'); btn.dataset.i18n = 'offlineOn'; btn.textContent = str('offlineOn'); }

  sync();
  updateDock();
  refreshRegisterLabels();
  showArrangeStrip();
  if (loadOwner(regStorage)) setRegChip('Registered'); // survives a reload within the session
  if (phoneShell) {
    if (focusId) stampMorphTiles(focusId);
    applyEditLock();
    fitPhone();
  } else if (focusId) {
    void focus(focusId);
  } else if (!stored) {
    void overview();
  }

  // Hands + face are ON BY DEFAULT: the camera prompt appears right away and
  // tracking starts with no click; the Hands button still toggles off/on.
  // Opt out with ?hands=0. Silent no-op where getUserMedia doesn't exist
  // (jsdom / unit tests), so a failure message never appears without a camera.
  // Phone-simple shells never start hand tracking (touch only; face-only
  // look-to-edit is started from canvasMain, not here).
  if (!phoneShell && shouldAutoStartHands(opts.autoHands, typeof navigator !== 'undefined' ? navigator : null)) {
    void toggleHands();
  }
  // iPhone app with the gimbal plugin: ask DockKit to follow her face and say
  // what is REALLY on (or the plugin's own error / "no stand docked").
  if (getGimbalPlugin() && !opts.sim) {
    void inputs.gimbal.setMode('face').then((r) => { const t = r.ok ? r.status : r.why; if (t) say(t); }).catch(() => {});
  }

  function setTalkCaption(text: string | null): void { micFab?.setCaption(text); }
  function setTalkError(text: string): void { micFab?.setError(text); }
  // ?replay=demo (journeyReplay.ts): read-only probes plus the same actions a
  // person takes — approve the open review, press Simulate offline, hold the
  // focused board at a paired phone's edge. Nothing here bypasses a review.
  const replay: ReplayHost = {
    run,
    // The same claim order as run(): an open morph card, then the pair-first
    // flow ("build the dashboard"), then a pending point-choice answer, and
    // only then routeLine.
    routeOf: (text) => {
      if (morphFlow?.claimsSpeech(text)) return 'morph';
      if ((pairFirst.phase() === 'pairing' || pairFirst.phase() === 'asking') && isBuildDashboard(text)) return 'pairFirst';
      if (pointChoice && pickPointChoice(text, pointChoice.choices)) return 'pointChoice';
      return routeLine(text, routeWorld(routePlanBoard())).name;
    },
    isReviewOpen: () => !!pending || reviewDialog.isOpen(),
    reviewTitle: () => root.querySelector('.mc-review-title')?.textContent ?? '',
    reviewApprove: keep,
    isIdle: () => !turnBusy && !pending && !reviewDialog.isOpen() && streamsOut === 0 && pairFirst.phase() !== 'pairing',
    statusMark: () => statusBase + statusLog.length,
    statusSince: (mark) => statusLog.slice(Math.max(0, mark - statusBase)),
    isOnline: () => net.isOnline(),
    toggleOffline: () => root.querySelector<HTMLElement>('[data-cmd=offline]')?.click(),
    async sendBoard(to) {
      const id = focusId ?? lastFocus;
      if (!id || !surfaces[id]) return false;
      const layout = pairedEdgeLayout(screenLayout, pairFirst.phones(), { live: !!hostSession });
      const side = layout.left === to ? 'left' : layout.right === to ? 'right' : null;
      if (!side) return false;
      const w = viewport.getBoundingClientRect().width || window.innerWidth;
      const at = { frameId: id, clientX: side === 'left' ? 1 : w - 1, clientY: window.innerHeight / 2 };
      const before = boardSends;
      boardEdge.handleBoardDrag({ ...at, phase: 'start' });
      for (let t = 0; t < 40 && boardSends === before; t++) {
        await new Promise((r) => setTimeout(r, 100));
        boardEdge.handleBoardDrag({ ...at, phase: 'move' });
      }
      boardEdge.handleBoardDrag({ ...at, phase: 'end' });
      return boardSends > before;
    },
  };
  return {
    run, focus, overview, save, keep, drop, undo, store, snapshot, history: () => history.list(), frames: () => reg.list(), setTalkCaption, setTalkError, setFacing, setRouteBadge, showRemoteBoard, sharedBoards: () => boardEdge.sharedBoards(), replay, destroy,
    /** iPhone: the laptop asked for the point photo (relay 'sensePoint'). */
    pointForLaptop: () => { if (phoneSensor) void phoneSensorPoint('', true); else opts.sendPointResult?.(encodePointResult({ ok: false, reason: 'no-camera', message: POINT_NEEDS_LAPTOP })); },
    phoneSenseStatus,
    onPhoneSenseChange: (cb: () => void) => { senseSubs.add(cb); return () => { senseSubs.delete(cb); }; },
  };
}
export type CanvasHandle = ReturnType<typeof mountCanvas>;
