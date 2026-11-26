// Smart canvas shell (sim-main): an infinite canvas of boards. Overview is for
// viewing and flying; Focus fits one board at exactly 1:1 for editing.
// Board contents are A2UI surfaces built from surface plans, gated, and
// (for anything a model proposes) held in a Proposal until kept.
import '@a2ui/lit/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { cameraTransform, fitRects, focusOnInsets, focusWholeBoard, lerpCamera, MIN_Z, panBy, ROOM_MIN_Z, twoHandCamera, zoomAbout, type Camera, type Viewport } from './camera';
import { isTypingTarget, stepZoom, wheelIntent, zoomCameraTo } from './canvasNav';
import { mountZoomHud } from './zoomHud';
import { attachBoardDrag } from './boardDrag';
import { applyTransform, createTwoHandGesture, type Vec } from '../input/twoHandTransform';
import { CANVAS_DOC_VERSION, FRAME_SIZE, createFrameRegistry, type CanvasDoc, type Frame, type FrameRegistry } from './frames';
import { resolveFrame, saveShouldOpenNextBoard, saveShouldPin } from './canvasCommands';
import { expandPlan, gimbalUpdate, tileComponentId, type GimbalTileState, type A2uiMessage, type DeviceState, type SurfacePlan, type TileSpec } from './surfacePlan';
import { gateMessages } from './gate';
import { CATALOG_SCHEMAS } from './catalogApi';
import { createSurfaceProposal, type SurfaceProposal } from './proposalBuffer';
import { createCanvasHistory, geminiFailLine, NANO_LOADING_LINE, NANO_STILL_LOADING, nanoLoadView, type NanoLoadState, parseModelPlan, parsePartialPlan, runSurfaceTurn, scriptedEngine, type DeviceHint, type EngineId, type PartialPlan, type SentInfo, type SurfaceEngine } from './aiTurn';
import { POINT_MIN_CONFIDENCE, byName, foundAfterScan, mergeTiles, pickPointChoice, pointConnectFromIdentity, pointFailureReceipt, roomScan, SIM_POINT_IDENTITY, type ConnectTurnResult, type PointIdentifyResult } from './connectTurns';
import { createSteadyHold, cropAlongRay, cropAroundPoint, isIndexExtended, phoneCropFraction, pointerInCrop, rayOutOfFrame, rayTarget, type Pt as CropPt, type SteadyHold } from './pointCrop';
import { createPhoneSensor, type PhoneSensor } from './phoneSensor';
import { coercePointResult, coerceSenseStatus, encodePointResult, phoneSubState, PHONE_POINT_FALLBACK, PHONE_POINT_LINE, POINT_OUT_OF_FRAME, type PhonePointResult, type PhoneSenseStatus } from './phonePoint';
import { captureCrop, findLiveVideo, openCameraOnce } from './pointCapture';
import { palmCenter, PHONE_HAND_FEEL, phoneReach } from './handFeel';
import { buildIdentifyPrompt } from '../devices/identify';
import { lampStep } from './deviceGuard';
import { guardSafePrefix, openEndedAsk, promiseGuard } from './openEndedAsk';
import { PLAN_EDIT_FAIL, runPlanEditTurn, simPlanEdit, planRooms } from './planEdit';
import type { PlanDoc } from '../plan/doc';
import { cleanReply, createSentenceFeed } from './liveReply';
import { replyTrace } from '../ai/replyTrace';
import { breakEngine, breakPrompt, impossibleAttempt, runBreakTurn, scriptedReply, type Attempt } from './tryToBreak';
import { createPairFirst, DISCONNECT_ARM_MS, isBuildDashboard, pairedRowHtml } from './pairedRow';
import { createClickCooldown } from '../input/clickCooldown';
import { mountConnectSheet, showPairing, type ConnectSheet, type PairingView } from './connectSheet';
import { startPhoneJoin } from './phoneJoin';
import { dispatchRelayCommand } from './relayCommands';
import { boardSendLine, createBoardEdgeTransferController, createEdgeTransferController, createSentBoardMemo, pairedEdgeLayout } from './edgeTransfer';
import { applyTileToPlan, parseTransfer, removeTileFromPlan, type TileTransfer } from './tileTransfer';
import { assignSide, coerceLayout, defaultLayout, sideFor, type PhonePlatform, type ScreenLayout, type Side } from './screenLayout';
import { loadHostToken, saveHostToken, loadLayout, saveLayout } from '../relay/pairingStore';
import { buildControlSnapshot } from '../relay/controlSnapshot';
import type { HostSession } from '../relay/session';
import type { GimbalCueKind, GimbalModeKind } from '../relay/protocol';
import { GIMBAL_ADDED, GIMBAL_ALREADY, GIMBAL_MODE_BUTTONS, GIMBAL_NO_BOARD, GIMBAL_NO_PHONE, GIMBAL_NO_ROOM, GIMBAL_NO_STAND, gimbalPress, gimbalTileState, planHasGimbal, withGimbalTile } from './gimbalTile';
import { createCanvasInputs } from './canvasInputs';
import { followWhileBuilding, HANDS_PAUSED, NO_GIMBAL_WHY, parseGimbalSpeech, POINT_NEEDS_LAPTOP, SCAN_LIVE_WHY } from './gimbalCanvas';
import { renderProposalCard, type ProposalStatus } from '../ux/proposal';
import { createActQueue, createDeviceStore, simulatedAck, spokenStatus, tileIntent, type DeviceConnector } from './deviceActions';
import { createDeviceSurfaceIndex } from './deviceSurfaceIndex';
import { createLocalNetworkCheck, BULB_UNREACHABLE_LINE } from './localNetwork';
import { connectedDeviceRows, connectedDevicesPlan, isDevicesPlan, PHONE_FRESH_MS, DASHBOARD_TITLE, DEVICES_BOARD_TITLE, type ConnectedInput } from './connectedDevices';
import { CANVAS_STORAGE_KEY, LEGACY_DEVICES_BOARD_KEY, loadCanvasDoc, UNREADABLE_LINE } from './canvasStore';
import { createUnreachableLampConnector, createWizAwareConnector, isWizDevice, type BridgeStatus } from './wizDevices';
import { applyRealLamps, discoverRealLamps, fitLampTiles, isManagedLampId, rememberedLamps, type LampSlot } from './realLamps';
import { answeringDevices, createDismissals, isHerChange, keepRoomDevices, keptRoomLine } from './roomRebuild';
import { createSpotifyAwareConnector, playingLine, type MusicWhere } from './spotifyConnector';
import * as spotifyApi from '../music/spotifyApi';
import { getValidAccessToken, isNativeMusicShell, loadTokens } from '../music/spotifyAuth';
import { startWebPlayback, type SdkPlayer } from '../music/spotifySdk';
import { createWizClient, resolveWizToken, type WizClient } from '../devices/wizClient';
import { esc } from '../core/esc';
import {
  CardTileElement, ChartTileElement, ConnectTileElement, FormTileElement, GridTileElement,
  GimbalTileElement, LampTileElement, MusicTileElement, PlanBoardElement, RowTileElement, SceneTileElement,
  SplitTileElement, StatTileElement, SwitchTileElement, TableTileElement, TabsTileElement,
  VisualTileElement, smartCanvasCatalog,
} from './widgets';
import { resolvePointedDevice, type DeviceKind, type DeviceRef } from './deviceCommands';
import { initialDoc } from './firstOpen';
import { buildEnergyShowcaseDoc } from './showcaseFixture';
import { createConnectivity } from './connectivity';
import { EN_PACK, SCRIPTED_KN_PACK, coerceLanguagePack, routePackPhrase, statusText, INTENT_ENGLISH, type IntentKey, type LangStringKey, type LanguagePack, type StatusKey } from './languagePack';
import { createCanvasLedger, formatBytesShort, ledgerPanelLines, utf8ByteLength } from './ledger';
import { betterSummary, roomSummary, draftSummary, floorPlanSummary, floorPlanTarget, FLOOR_PLAN_TITLE, liftLegacyPlanTiles, roomWithoutPlanTiles, tilesFilledLine } from './planTruth';
import { createCanvasHandsAdapter, mountCanvasHands, shouldAutoStartHands, type CanvasHandsHandle } from './canvasHands';
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
import { armedSurfaceAt, collectControls, createHandPointer, deepElementFromPoint, mapToScreen, REACH, type HandPointer } from './handPointer';
import { PLAN_EDIT_EVENT, flushPlanEdits, refreshPlanHands, type PlanEditDetail, type PlanHandSurface } from './planHandSurface';
import { createPlanPeace, peaceHandsOf, type PeaceTarget } from './planPeace';
import { coerceBoardDrawings, feedDrawings, planBoardIds, sanitizePlanDoc, setSavedPlanDoc, storedDrawings, type Drawings } from './planDocs';
import { adjustLevel, LEVEL_STEP_PX } from './levelControl';
import { mountPhoneHands } from './phoneHands';
import { createGestureControl, type GestureControl } from './gestureControl';
import { createPalmHighlight, nearRects, placeBubble } from './palmHighlight';
import { LAPTOP_GESTURES, PHONE_GESTURES } from './gestureBindings';
import { syntheticHand } from './handShapeFixtures';
import type { PhoneCamera } from './phoneCamera';
import { matchCursors } from '../ui/handOverlay';
import { setLivePinchThresholds } from '../input/handLogic';
import { loadSetup } from '../setup/setupState';

import { createLaptopHandRouter, readHandsAlways, writeHandsAlways } from './handFacing';
import type { AttentionWho } from '../relay/protocol';
import type { PlanExtra } from './planExtras';
import { mountMicFab, MIC_ICON_SVG, LISTENING_STATUS, type MicFab } from './micFab';
import { phoneSayText } from './phoneSay';
import { mountToolPalette } from './toolPalette';
import { cloudReceivedDetail, logTurnReceipt, MODEL_PANELS_HTML, mountModelPanels } from './modelPanels';
import { mountDraggablePanel, mountResizablePanel } from './dragPanel';
import { mountEditBoard, topLevelOf, type EditEl, type EditItemRef } from './editBoard';
import { combineFacts, madeByFacts, createReviewReceipts, engineName, mountReviewDialog, type ReviewFacts } from './reviewDialog';
import { diffPlanDocs, diffPlans, diffTile, languagePackChanges } from './planDiff';
import { AI_PANEL_ALWAYS_OPEN, createActivityLog } from './activityLog';
import { createActivityBroadcast } from './activityFeed';
import { createSpeaker } from '../ai/speaker';
import { createReadAloud } from '../ai/readAloud';
import { clearSavedVoice, isCloudVoice, loadAllowCloud, loadReadAloud, loadSavedVoice, resolveChangeVoice, saveReadAloud, saveVoice, speechPlatform, type ChangeVoiceIntent } from '../ai/speechVoices';
import { mountVoiceSheet } from './voiceSheet';
import { mountEngineBar, type EngineBar } from './engineBar';
import { createWarmBar } from './warmBar';
import { createCanvasAiFeed, type AiFeed } from './aiFeed';
import { createAnnounceGate, createPhoneAiRepublisher, teeFeed } from './phoneAiFeed';
import { boardForJourney } from './journey';
import { createNextStepChips, NANO_PICK_IDLE_MS, planExtraRan, type NextChips } from './nextSteps';
import { nanoQueue } from '../ai/nanoQueue';
import { routeLine, type RouteWorld } from './routeLine';
import type { ReplayHost } from './journeyReplay';
import { identifyDevice, onNanoBusyHandoff, pickNextStepsOnDevice, type VisionTrace } from '../ai/hybrid';
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

export const STORAGE_KEY = CANVAS_STORAGE_KEY;

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
  'mc-lamp-tile', 'mc-music-tile', 'mc-switch-tile', 'mc-scene-tile', 'mc-connect-tile', 'mc-gimbal-tile', 'mc-plan-board',
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
  if (t.type === 'gimbal') return t.label ?? 'Gimbal';
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

/** Phone shell: clear space between a board's end and the bottom chrome. */
const PHONE_BOARD_GAP = 12;
const PHONE_CHROME_SEL = '.mc-talk-control, .mc-join-pill, .mc-phone-track-pill, .mc-phone-hands-pill, .mc-read-aloud, .mc-cam-on, .mc-phone-facing';

/** Widest a focused room dashboard is shown (three tile columns). */
export const ROOM_MAX_W = 1280;
/** A room board too tall for the screen at its fitted width may widen to
 *  this (shown at the ROOM_MIN_Z zoom the camera then uses anyway), so its
 *  tiles get wide enough to sit in one row instead of running off the bottom. */
export const ROOM_WIDE_MAX_W = 1680;
/** Re-opening the code for one more phone failed; the paired phones are fine. */
export const REPAIR_FAILED_LINE = 'Couldn’t reopen pairing — your phones are still connected.';

/** The wider width to try for a room board that does not fit `freeH` at
 *  `w` (null: no wider try). `free`/`freeH` are screen px; at `minZ` the
 *  board may be up to free/minZ wide and still fit across. Pure. */
export function roomWidenWidth(o: { w: number; h: number; free: number; freeH: number; minZ: number }): number | null {
  if (o.h <= o.freeH) return null;
  const wide = Math.floor(Math.min(ROOM_WIDE_MAX_W, o.free / o.minZ));
  return wide > o.w + 40 ? wide : null;
}

/** The size a focused board is SHOWN at so it clears the chrome: narrower
 *  than `free` only when it fits ≥480 px, shorter than `freeH` (not on a
 *  phone). null = its own size fits. Pure; never persisted. */
export function fitFocusedSize(rect: { w: number; h: number }, o: { free: number; freeH: number; phone: boolean; room?: boolean }): { w: number; h: number } | null {
  // A room dashboard also WIDENS into the free width (up to ROOM_MAX_W), so
  // its tiles reflow into more columns instead of running off the bottom.
  const w = o.room && !o.phone && o.free >= 480 ? Math.min(o.free, ROOM_MAX_W)
    : o.free >= 480 && rect.w > o.free ? o.free : rect.w;
  const h = !o.phone && rect.h > o.freeH ? o.freeH : rect.h;
  return w === rect.w && h === rect.h ? null : { w, h };
}

export function mountCanvas(root: HTMLElement, opts: CanvasOptions = {}) {
  for (const El of [
    LampTileElement, PlanBoardElement, MusicTileElement, SwitchTileElement, SceneTileElement, ConnectTileElement, GimbalTileElement,
    RowTileElement, GridTileElement, CardTileElement, TabsTileElement, SplitTileElement,
    StatTileElement, ChartTileElement, TableTileElement, FormTileElement, VisualTileElement,
  ]) {
    if (!customElements.get(El.tagName)) customElements.define(El.tagName, El as unknown as CustomElementConstructor);
  }
  const storage = opts.storage ?? localStorage;
  const reduced = opts.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A saved doc this build can't read is copied aside before anything can
  // write (canvasStore.ts); if even that fails, nothing saves over it.
  const loaded = loadCanvasDoc(storage, STORAGE_KEY);
  const stored: CanvasDoc | null = loaded.doc;
  const saveBlocked = !loaded.safe;
  // The Connected devices board is marked by its frame id, never by its
  // title: a board she renames stays what it is, and one she names
  // "Connected devices" never becomes it. The id lives IN the doc; the old
  // key kept beside it is only trusted when that frame really holds the
  // devices list (a stale key once turned her dashboard into the list).
  let devicesFrame: string | null = null;
  if (stored && !opts.showcase) {
    let legacy: string | null = null;
    try { legacy = storage.getItem(LEGACY_DEVICES_BOARD_KEY); } catch { legacy = null; }
    devicesFrame = stored.devicesBoard ?? (legacy && isDevicesPlan(stored.surfaces[legacy]) ? legacy : null);
  }
  // Showcase is a deliberate opt-in detour: it never consults storage/seed/
  // fresh, and nothing in the default boot paths (?fresh=1&sim=1 included)
  // can reach it.
  const doc = opts.showcase === 'energy' ? buildEnergyShowcaseDoc() : initialDoc(stored, { seed: opts.seed, fresh: opts.fresh }, seedDoc);
  const reg: FrameRegistry = createFrameRegistry(doc.frames);
  const surfaces: Record<string, SurfacePlan> = { ...doc.surfaces };
  // What was drawn on floor-plan boards (frame id → plan board id → plan doc).
  const drawings: Drawings = JSON.parse(JSON.stringify(doc.drawings ?? {})) as Drawings;
  // Boards saved before the floor plan had its own board: lift a dashboard's
  // plan tile (and its drawing) onto a "Floor plan" board, once, on load.
  liftLegacyPlanTiles(reg.list(), surfaces, drawings, () => {
    try { return reg.add('plan', FLOOR_PLAN_TITLE).id; } catch { return null; }
  });
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
            <button data-cmd="handsalways" class="mc-btn" aria-pressed="false">Hands always on</button>
            <button data-cmd="teach" class="mc-btn">Teach a gesture</button>
            <button data-cmd="gestures" class="mc-btn">Custom gestures</button>
            <button data-cmd="reregister" class="mc-btn" hidden>Register again</button></section>
          <section class="mc-more-group" aria-label="Screens"><h3 class="mc-more-title">Screens</h3>
            <button data-cmd="monitor" class="mc-btn">AI monitor</button>
            <button data-cmd="activity" class="mc-btn">Open AI activity in a new tab</button>
            <button data-cmd="swap" class="mc-btn" hidden>Swap phone sides</button></section>
          <section class="mc-more-group" aria-label="Sound"><h3 class="mc-more-title">Sound</h3>
            <button data-cmd="voice" class="mc-btn">Voice</button></section>
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
    root.querySelector('[data-cmd=activity]')?.remove();
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
  // The call's cursor parks on the focused board, each tile cursor on the tile
  // it fills (never floating loose over the canvas; off the board = hidden).
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
    anchor: swarmAnchor,
    onReachTarget: (tileIndex, kind) => flashGhostTarget(tileIndex, kind),
  });
  const blankEl = root.querySelector<HTMLElement>('.mc-blank')!;
  const statusEl = root.querySelector<HTMLElement>('.mc-canvas-status')!;
  // The phone shell hides the whole tools bar, and the status line with it:
  // every say() line (a confirmation, a chat reply, a failure) also shows in
  // a readable toast there, for as long as the status line holds it.
  const phoneSayEl = phoneShell && typeof document !== 'undefined' ? document.createElement('p') : null;
  if (phoneSayEl) {
    phoneSayEl.className = 'mc-phone-say';
    phoneSayEl.setAttribute('role', 'status');
    phoneSayEl.setAttribute('aria-live', 'polite');
    phoneSayEl.hidden = true;
    root.append(phoneSayEl);
  }
  const showPhoneSay = (t: string): void => {
    if (!phoneSayEl) return;
    const text = phoneSayText(t);
    phoneSayEl.textContent = text;
    phoneSayEl.hidden = !text;
  };
  const aiPanel = root.querySelector<HTMLElement>('.mc-ai')!;
  // The same log on its own tab (activity.html), over the AI feed channel.
  // A phone shell never broadcasts locally (see createCanvasAiFeed).
  const activityCast = phoneShell ? null : createActivityBroadcast({ sim: !!opts.sim });
  const activityLog = createActivityLog(aiPanel.querySelector<HTMLElement>('.mc-ai-live-log'), undefined, (e) => activityCast?.entry(e));
  // Engine bar: Nano + Gemini always visible (desktop only; CSS also hides it
  // in the phone shell). The terminals mirror their state into it; a failed
  // engine also pins the AI panel open so the reason stays readable.
  // Engines whose failure/queued state must keep the AI panel open (with the reason).
  const aiHold = new Set<EngineId>();
  // The laptop's AI feed (monitor.html). A phone shell also tees its terminals
  // into opts.phoneAiFeed, which forwards compact aiEvents to the laptop.
  const canvasFeed = createCanvasAiFeed(phoneShell, { sim: !!opts.sim });
  const aiFeed = activityCast ? teeFeed(canvasFeed, activityCast.feed) : canvasFeed;
  const engineBar: EngineBar | null = phoneShell ? null : mountEngineBar(root, { onOpen: () => showAi(true, true), sim: !!opts.sim });
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
    publishBoardTransfer(cur.frameId ?? focusId ?? '', cur.board, null, cur.boardFor);
  }
  /** The board whose plan the phones hold now (last publish with a board). */
  let publishedFrame: string | null = null;
  let planRepublishTimer: ReturnType<typeof setTimeout> | null = null;
  let planRepublishAt = -Infinity;
  const planEditedFrames = new Set<string>();
  /** Plan resends: at most one per second, trailing (the timer is never
   *  pushed back, so a long run of hand edits still sends within ~1 s). */
  const PLAN_RESEND_MIN_MS = 1000;
  /** A plan drawing changed on `frameId` (an edit, an approved voice edit, an
   *  Undo): the phone holding that board gets the new drawing — the same
   *  republish (and the same target) as any other board update. */
  function planDrawingChanged(frameId: string): void {
    if (!(hostSession || simWire) || frameId !== publishedFrame) return;
    planEditedFrames.add(frameId);
    if (planRepublishTimer) return;
    const now = Date.now();
    planRepublishTimer = setTimeout(() => {
      planRepublishTimer = null;
      planRepublishAt = Date.now();
      const edited = new Set(planEditedFrames);
      planEditedFrames.clear();
      // Only the board the phones hold now, with ITS target: never another
      // board (B) to both phones because A's drawing changed.
      const cur = sentBoard.current(focusId, focusId ? surfaces[focusId] ?? null : null);
      if (!cur.board || !cur.frameId || !edited.has(cur.frameId)) return;
      publishBoardTransfer(cur.frameId, cur.board, null, cur.boardFor);
    }, Math.max(250, planRepublishAt + PLAN_RESEND_MIN_MS - now));
  }
  /** "Couldn't send" is said once per failure run, not for every retry. */
  let publishFailSaid = false;
  /** What is drawn on `frameId`'s plan tiles right now: the live boards first
   *  (the drawing as it is on screen), else what was saved with the board. */
  function boardDrawingsOf(frameId: string, board: SurfacePlan): Record<string, unknown> {
    const out: Record<string, unknown> = { ...(drawings[frameId] ?? {}) };
    if (frameId) {
      for (const pb of world.querySelectorAll<HTMLElement & { planState?: () => { boardId: string; doc: unknown } | null }>(`[data-frame="${frameId}"] mc-plan-board`)) {
        const st = pb.planState?.();
        if (st) out[st.boardId] = st.doc;
      }
    }
    const ids = new Set(planBoardIds(board));
    for (const k of Object.keys(out)) if (!ids.has(k)) delete out[k];
    return out;
  }
  // Sim + dev/e2e build only: no relay, so the snapshot a send WOULD publish
  // is kept for the e2e (window.__mcLastBoardSnapshot, JSON as on the wire).
  const simWire = !!opts.sim && (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') && typeof window !== 'undefined';

  function setEdgeGlow(side: 'left' | 'right' | null, glow: number): void {
    viewport.classList.toggle('mc-edge-glow-left', side === 'left' && glow > 0.05);
    viewport.classList.toggle('mc-edge-glow-right', side === 'right' && glow > 0.05);
    // The phones strip shows which phone sits on that side while a board nears an edge.
    const near = !!side && glow > 0.05;
    if (near !== edgeNear) { edgeNear = near; showArrangeStrip(); }
  }

  function publishBoardTransfer(frameId: string, board: SurfacePlan | null, t: TileTransfer | null, boardFor?: PhonePlatform): void {
    if (!hostSession && !simWire) return;
    try {
      // The board's CURRENT drawing rides beside it (never inside the surface
      // plan), so the phone shows the plan as edited, not its template.
      const boardDrawings = board ? boardDrawingsOf(frameId, board) : null;
      const snap = buildControlSnapshot({
        rev: ++snapshotRev,
        layout: screenLayout,
        ...(board ? { board } : {}),
        ...(board && boardFor ? { boardFor } : {}),
        ...(boardDrawings && Object.keys(boardDrawings).length ? { boardDrawings } : {}),
        ...(t ? { transfer: { componentId: t.componentId, to: t.to, enterEdge: t.enterEdge, rev: snapshotRev } } : {}),
      });
      publishedFrame = board ? frameId || null : publishedFrame;
      if (simWire) (window as unknown as { __mcLastBoardSnapshot?: unknown }).__mcLastBoardSnapshot = JSON.parse(JSON.stringify(snap));
      if (hostSession) {
        void hostSession.publishState(snap).then(
          () => { publishFailSaid = false; },
          () => { if (board && !publishFailSaid) { publishFailSaid = true; say('Couldn’t send the board to the phone.'); } },
        );
      }
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
  // A monitor that opens after the phone paired still shows it as connected.
  aiFeed.onHello(() => phoneAi.replay());
  // Only announces that name THIS laptop session are live (the room replays
  // its whole history on a reload — old announces must not show a phone).
  const announceGate = createAnnounceGate();
  /** The pairing card on screen (chime + code), while there is one. */
  let livePairing: { stopChime(): void; setStatus(text: string): void } | null = null;
  const askWhoIsThere = (): void => { if (hostSession && announceGate.shouldAsk()) void hostSession.askWhoIsThere().catch(() => undefined); };
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
      let sid: unknown;
      let sense: PhoneSenseStatus | null = null;
      try {
        const o = JSON.parse(text) as { platform?: unknown; side?: unknown; deviceId?: unknown; native?: unknown; refresh?: unknown; sid?: unknown };
        sid = o.sid;
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
      // Replayed from the room's history, or sent before the phone knew this
      // session: not shown. Ask who is really here; a live phone answers.
      const live = announceGate.check(sid, hostSession?.sid, typeof deviceId === 'string' ? deviceId : platform);
      if (live === 'stale') { askWhoIsThere(); return; }
      // This phone's first live announce of the session is a full one, even
      // when it is the answer to whoIsThere (which arrives marked refresh).
      if (live === 'first') {
        refresh = false;
        livePairing?.stopChime(); livePairing?.setStatus('Phone connected. What it proposes still waits for your keep here.');
        // The docked iPhone wakes up — for a phone that is really here, once.
        bodyLanguage('wakeup');
      }
      phoneSeenAt.set(platform, Date.now()); // a live announce: this phone answers right now
      const prevSense = phoneSense.get(platform);
      if (sense) phoneSense.set(platform, sense); else phoneSense.delete(platform);
      if (JSON.stringify(prevSense) !== JSON.stringify(sense ?? undefined)) {
        pairFirst.refresh();
        pushAttention();
        if (platform === 'ios') gimbalReported(prevSense?.gimbal !== undefined && prevSense.gimbal !== 'none', !!sense && sense.gimbal !== 'none');
      }
      // A keep-alive re-announce only re-learns who the phone is for the AI
      // monitor — no re-placing, no board republish every 20 s.
      // A phone missing from the row (its first announce came while the row
      // was idle) is listed on its next keep-alive (a no-op once listed).
      if (refresh) { pairFirst.addPhone({ id: platform, label: phoneAi.announce(platform, deviceId, native) }); return; }
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
        if (side) say(`${platform === 'android' ? 'The Nothing phone' : 'The iPhone'} is on the ${side}.`, { speak: true });
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
  /** The edges a board may go to: the strip's layout, limited to phones that
   *  are listed OR have live-announced this session (phoneSeenAt; cleared when
   *  a phone drops). The row alone missed a phone that announced while it was
   *  idle, leaving that phone's edge dark though the strip showed it. */
  const edgeLayout = (): ScreenLayout => pairedEdgeLayout(screenLayout, pairFirst.phones(), {
    live: !!hostSession, announced: [...phoneSeenAt.keys()].filter((p) => phoneAnswering(p)) as PhonePlatform[],
  });
  const boardEdge = createBoardEdgeTransferController({
    getViewportWidth: () => viewport.getBoundingClientRect().width || (typeof window !== 'undefined' ? window.innerWidth : 0),
    getLayout: () => edgeLayout(),
    getRect: (id) => { const f = reg.get(id); return f ? { ...f.rect } : null; },
    restoreRect: (id, rect) => { reg.setRect(id, rect); sync(); persist(); },
    getBoard: (id) => surfaces[id] ?? null,
    onGlow: (g) => setEdgeGlow(g.side, g.glow),
    onCommit: (s) => {
      if (hostSession) {
        // Only the phone on that side shows it (boardFor); the other ignores it.
        sentBoard.remember({ boardFor: s.target, board: s.board, frameId: s.frameId }, focusId, focusId ? surfaces[focusId] ?? null : null);
        publishBoardTransfer(s.frameId, s.board, null, s.target);
      } else if (simWire) {
        sentBoard.remember({ boardFor: s.target, board: s.board, frameId: s.frameId }, focusId, focusId ? surfaces[focusId] ?? null : null);
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
  /** `refly`: re-fit the focused board if the strip's visibility changed —
   *  only for a lasting change (a phone joined/left), never for Tools
   *  opening or a drag nearing an edge (the board must not jump). */
  function showArrangeStrip(refly = false): void {
    const toolsOpen = !!root.querySelector('.mc-bar-tools:not([hidden]):not(.mc-bar-tools-peek)');
    const was = arrangeStrip.hidden;
    arrangeStrip.hidden = !(phonesPaired() && (toolsOpen || edgeNear));
    const swap = root.querySelector<HTMLElement>('[data-cmd=swap]');
    if (swap) swap.hidden = phoneShell || !(opts.sim || hostSession);
    if (refly && was !== arrangeStrip.hidden && focusId) queueMicrotask(() => { const f = focusId ? reg.get(focusId) : undefined; if (f) void flyTo(focusCam(fitBoardWidth(f))); });
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
  /** Past the pairing step the "N phones connected · Disconnect" row lives
   *  INSIDE the engine bar (the bottom chrome row), so it takes no height of
   *  its own and never floats over a board. While pairing (the pairing card
   *  is up) and wherever the bar is not shown, it floats above the bar. */
  const barShown = (): boolean => !!engineBar && (typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 601px)').matches);
  function dockPairedRow(): void {
    const dock = barShown() && pairFirst.phase() !== 'pairing';
    const host = dock && engineBar ? engineBar.el : root;
    if (pairedRow.parentElement !== host) host.appendChild(pairedRow);
    pairedRow.classList.toggle('is-docked', dock);
  }
  /** Disconnect ignores presses for DISCONNECT_ARM_MS after it appears. */
  const disconnectArm = createClickCooldown(DISCONNECT_ARM_MS);
  let hadDisconnect = false;
  let pairFrame: string | null = null;
  let pairingHost: HTMLElement | null = null;
  /** The host session's short code was re-opened for more phones (pair-first). */
  let admissionOpen = false;
  let flowOpening = false;
  let flowOwnsHost = false; // only the pair-first flow may auto-hide the pairing host
  /** iPhone sensing status per announced phone (phonePoint.ts), from its
   *  announce — only what the phone reports is really on. */
  const phoneSense = new Map<string, PhoneSenseStatus>();
  /** When each phone last really answered (a live announce; they re-announce
   *  every 20 s). The devices board ticks a phone only while this is fresh. */
  const phoneSeenAt = new Map<string, number>();
  const isIphoneRow = (p: { id: string; label: string; sim: boolean }): boolean => p.id === 'ios' || (p.sim && /iphone/i.test(p.label));
  // Gimbal tile state (the logic lives with the dock watch, further down).
  /** A press the tile could not carry out (shown on the tile, said once). */
  let gimbalError = '';
  /** ?sim=1 with a SIM iPhone row: the mode the simulated stand is in. */
  let simGimbalMode: 'face' | 'hands' | 'hold' = 'hold';
  /** The stand is auto-added to the dashboard once a session (not again
   *  after she removed it). */
  let gimbalAutoAdded = false;
  let gimbalWired = false;
  function simIphone(): boolean { return !!opts.sim && pairFirst.phones().some((p) => p.sim && isIphoneRow(p)); }
  function iphonePaired(): boolean { return !!hostSession && pairFirst.phones().some((p) => !p.sim && isIphoneRow(p)); }
  const pairFirst = createPairFirst({
    say: (t, o) => say(t, o),
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
      // Phones stay paired (the pairing card's session stays open); the
      // dashboard is built on its own board, never on Connected devices.
      const id = dashboardTarget(focusId ?? lastFocus);
      if (focusId !== id) { sync(); void focus(id); }
      void connectRoom(id);
    },
    onChange: () => {
      const html = pairedRowHtml(pairFirst.phones(), pairFirst.phase(), (p) => phoneSubState(phoneSense.get(p.id), { sim: p.sim, ios: isIphoneRow(p) }));
      const rowWasHidden = pairedRow.hidden;
      pairedRow.hidden = !html || phoneShell;
      dockPairedRow();
      // The row changes the bottom inset: re-fit the focused board above it.
      if (rowWasHidden !== pairedRow.hidden && focusId) queueMicrotask(() => { const f = focusId ? reg.get(focusId) : undefined; if (f) void flyTo(focusCam(fitBoardWidth(f))); });
      pairedRow.innerHTML = html;
      // Docked, a phone's sub-state may be cut short: the full row is its title.
      pairedRow.title = pairedRow.classList.contains('is-docked') ? (pairedRow.querySelector('.mc-paired-phone') ? [...pairedRow.querySelectorAll('.mc-paired-phone')].map((e) => e.textContent?.trim()).join(' · ') : '') : '';
      showArrangeStrip(true);
      pairedRow.querySelector<HTMLButtonElement>('.mc-paired-continue')?.addEventListener('click', () => { pairFirst.continueNext(); });
      // Just appeared (Continue was pressed a moment ago): not armed yet.
      const disconnectBtn = pairedRow.querySelector<HTMLButtonElement>('.mc-paired-disconnect');
      if (disconnectBtn && !hadDisconnect) disconnectArm.arm(performance.now());
      hadDisconnect = !!disconnectBtn && !pairedRow.hidden;
      disconnectBtn?.addEventListener('click', () => {
        if (!disconnectArm.ready(performance.now())) return;
        disconnectPhones(); say('Phones disconnected.');
      });
      // Past the pairing step the card collapses into the row's "N phones connected"
      // chip (relay stays alive) so it never covers the review.
      if (pairingHost && flowOwnsHost && pairFirst.phase() !== 'pairing') { pairingHost.hidden = true; flowOwnsHost = false; }
      // Pairing is over: the short code goes (it only admits phones while pairing).
      if (admissionOpen && pairFirst.phase() !== 'pairing') { admissionOpen = false; void hostSession?.endAdmission().catch(() => undefined); }
      nextChips?.refresh();
      if (gimbalWired) pushGimbal();
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
    // Phone shell: one column in the board's own flow, always.
    flowOnly: () => phoneShell,
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
  const settleSwarm = (): void => { swarmFollowsTiles = false; swarm.settle(); swarmDock.settle(); };
  // The one on-device model was busy, so an on-device job (a voice intent,
  // a pick) went to its cloud twin instead: say so, never silently.
  const offNanoBusy = onNanoBusyHandoff((label) => { panels.show(); panels.showHandoff('nano', `Nano busy → Gemini (${label})`); });
  const dockEl = root.querySelector<HTMLElement>('.mc-dock')!;
  const dockSurfaceEl = dockEl.querySelector<HTMLElement>('.mc-dock-surface')!;
  // What she took off a board stays off it (roomRebuild.createDismissals):
  // only HER changes count — her own edits (by 'her') here, and the reviews
  // she keeps (proposePlan) — never a Gemini self-check fix or morph patch.
  // Kept beside the saved doc (per frame id), so it survives a reload.
  const DISMISSED_KEY = 'mendcraft.dismissedTiles';
  let storedDismissals: Record<string, string[]> = {};
  try { storedDismissals = stored && !opts.showcase && !opts.fresh ? JSON.parse(storage.getItem(DISMISSED_KEY) ?? '{}') ?? {} : {}; } catch { storedDismissals = {}; }
  const dismissals = createDismissals(storedDismissals && typeof storedDismissals === 'object' ? storedDismissals : {});
  function noteDismissal(frameId: string, before: SurfacePlan | null, after: SurfacePlan | null): void {
    // (try: a change recorded while the canvas is still mounting has no device list yet)
    try { dismissals.note(frameId, before, after, (k) => (k === 'gimbal' ? standReported() : roomDeviceHints().some((d) => d.id === k))); } catch { /* nothing to remember yet */ }
  }
  const history = (() => {
    const h = createCanvasHistory();
    return { ...h, push: (e: Parameters<typeof h.push>[0]) => {
      if (isHerChange(e)) noteDismissal(e.frameId, e.before, e.after);
      return h.push(e);
    } };
  })();
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
  // The status line is a toast, not permanent chrome: it fades 6-12 s after
  // the last line (longer lines stay longer), except while a review waits, a
  // Retry is offered or the mic listens (those stay until replaced). A
  // failure or refusal is also copied into the AI drawer's live log, so it
  // can be read again after the toast is gone.
  const statusFadeMs = (t: string): number => Math.min(12000, Math.max(6000, 2500 + t.length * 60));
  const FAILURE_LINE = /^(Blocked|Refused|Nothing changed|Needs network|No answer|Could ?n[o’']t|Couldn[’']t)\b|didn[’']t answer|\bfailed\b|Nothing changed\.?$/i;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  const fadeStatus = (t: string): void => {
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
    if (!t || typeof window === 'undefined') return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      if (statusEl.textContent !== t) return;
      // The phone toast never waits on a review (the sheet covers it anyway).
      if (reviewBusy()) showPhoneSay('');
      if (reviewBusy() || !retryBtn.hidden || t === LISTENING_STATUS) { fadeStatus(t); return; }
      statusEl.textContent = '';
      showPhoneSay('');
    }, statusFadeMs(t));
  };
  // Speaking aloud (ai/speaker.ts): the nicest on-device voice, a little
  // slower for clarity, never over itself. Replies are read aloud only when
  // she turned that on in More → Voice; the status line is always written.
  // The voice choice lives in the same store as the canvas (memory in a replay).
  const voiceStore = storage as Storage;
  const speaker = createSpeaker({ storage: voiceStore });
  let readAloud = loadReadAloud(voiceStore);
  // Only lines a caller opts in are spoken (ai/readAloud.ts): AI replies,
  // a review's title, a command's result or refusal, a pairing outcome.
  // Hints, HUDs and "Listening…" are written, never read.
  const readAloudLines = createReadAloud({ speaker, enabled: () => readAloud, packLang: () => pack?.lang });
  /** `speak`: true reads this line aloud; a string reads that instead. */
  type SayOptions = { speak?: boolean | string };
  const say = (t: string, o: SayOptions = {}) => {
    statusEl.textContent = t; hideRetry();
    showPhoneSay(t === LISTENING_STATUS ? '' : t);
    // The mic opening is new input from her: stop talking.
    if (t === LISTENING_STATUS) readAloudLines.stop();
    else if (o.speak) readAloudLines.line(typeof o.speak === 'string' ? o.speak : t);
    statusLog.push(t);
    if (statusLog.length > 400) { statusLog.splice(0, 200); statusBase += 200; }
    fadeStatus(t);
    if (t && FAILURE_LINE.test(t) && !/^Dropped\./.test(t)) activityLog.push({ kind: 'note', text: t });
  };

  /** A reply shown and spoken AS IT ARRIVES: each chunk goes straight to the
   *  status line (and the phone toast), and each sentence is handed to the
   *  speaker the moment it is complete — she reads and hears the start of the
   *  answer while the rest is still being written. `end` books the final
   *  line exactly like say() does, without saying anything twice. */
  function liveSay(): { update(full: string): void; end(final: string): void; started(): boolean } {
    const feed = createSentenceFeed({ firstAtClause: true });
    let shown = false;
    let spokeAny = false;
    const speakNext = (sentence: string): void => {
      if (!sentence) return;
      // The first sentence replaces whatever was being said; the rest queue.
      const ok = readAloudLines.sentence(sentence, !spokeAny, { onStart: () => replyTrace.spoken() });
      spokeAny = spokeAny || ok;
    };
    return {
      started: () => shown,
      update(full) {
        const t = cleanReply(full);
        if (!t) return;
        if (!shown) { shown = true; hideRetry(); replyTrace.firstChunk(); }
        statusEl.textContent = t;
        showPhoneSay(t);
        for (const sentence of feed.push(t)) speakNext(sentence);
      },
      end(final) {
        const t = cleanReply(final);
        if (!shown) replyTrace.firstChunk();
        statusEl.textContent = t; hideRetry();
        showPhoneSay(t);
        // Sentences that completed only now, then whatever is left.
        for (const sentence of feed.push(`${t} `)) speakNext(sentence);
        const rest = feed.flush(t);
        if (rest) speakNext(rest);
        statusLog.push(t);
        if (statusLog.length > 400) { statusLog.splice(0, 200); statusBase += 200; }
        fadeStatus(t);
        replyTrace.done();
      },
    };
  }

  /** Gimbal body language: nod 'yes' on an Approve, shake 'no' on a refusal,
   *  'wakeup' when a phone pairs. In the iPhone app (gimbal plugin present) it
   *  animates the docked stand here; on the laptop it relays an allow-listed
   *  cue to the paired phone(s). No stand / not paired / rate-limited → a
   *  silent no-op. The status line claims a move only after DockKit reported
   *  success (never on the laptop, which can't see whether it moved). */
  function bodyLanguage(kind: GimbalCueKind): void {
    if (getGimbalPlugin()) {
      void inputs.gimbal.gimbalCue(kind).then((r) => { if (r.ok && r.status) say(r.status); }).catch(() => {});
      return;
    }
    void hostSession?.sendGimbalCue(kind).catch(() => false);
  }

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
  /** The turn(s) whose receipt the open review shows, and how to rebuild its
   *  facts: when one of them sends again while the review is open (the
   *  hedge's second leg, a retry), the footer is redrawn from the ledger. */
  let reviewLive: { tokens: SentInfo[]; facts: () => ReviewFacts } | null = null;
  function showReview(model: Parameters<typeof reviewDialog.open>[0], live?: { tokens: Array<SentInfo | null | undefined>; facts: () => ReviewFacts }): void {
    phoneMenu?.close();
    reviewLive = live ? { tokens: live.tokens.filter((t): t is SentInfo => !!t), facts: live.facts } : null;
    reviewDialog.open(model);
    readAloudLines.line(model.title);
  }
  /** A turn's booked bytes changed: if its review is the one open, match it. */
  function refreshReviewFor(s: SentInfo): void {
    if (reviewLive && reviewDialog.isOpen() && reviewLive.tokens.includes(s)) reviewDialog.setFacts(reviewLive.facts());
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
      res(simulatedAck(store.get(i.deviceId), i, TRACKS));
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
  // Which bulb each real lamp id is (filled when the bridge answers).
  const lampIps = new Map<string, string>();
  const DEVICE_LABELS: Record<string, string> = { 'wiz-desk': 'Desk lamp', 'wiz-ceiling': 'Ceiling light', 'speaker-1': 'Speaker' };
  // Live mode (no ?sim=1): the lamps are the REAL lamps. A seeded placeholder
  // ("Desk lamp" / "Ceiling light") is never shown, and a real lamp the bridge
  // can't reach is shown "Not reachable" and refused — never simulated.
  const liveLamps = !opts.sim && !opts.devices && !opts.connector;
  const lampConnector = wizClient
    ? createWizAwareConnector({
      client: wizClient, fallback: simulatedConnector, status: bridgeStatus, bulbIp: (id) => lampIps.get(id) ?? '', honest: liveLamps,
      // Bridge dropped mid-session: every WiZ lamp shows "Not reachable" now (not a working tile).
      onDown: () => { bridgeWentDown(); },
      // A refused press is a good moment to look again (throttled).
      onRefusedUnreachable: () => { void rediscoverLamps(); },
    })
    : liveLamps ? createUnreachableLampConnector(simulatedConnector) : simulatedConnector;
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
  // Where the speaker's music is really coming from (the connector keeps it).
  const musicWhere: MusicWhere = { spotify: false, target: '' };
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
    previous: async () => { await spotifyApi.previous(spOpts()); const pb = await spotifyApi.getPlayback(spOpts()); return pb?.title ? { title: pb.title } : null; },
    nowPlaying: async () => { const pb = await spotifyApi.getPlayback(spOpts()); return pb?.title ? { title: pb.title, artist: pb.artist } : null; },
    speakerName: (id) => deviceRefs().find((d) => d.id === id)?.label ?? '',
    setVolume: (pct) => spotifyApi.setVolumePercent(pct, spOpts()),
    say,
    status: musicWhere,
  });
  const store = createDeviceStore(opts.devices ?? STUB_DEVICES, opts.connector ?? defaultConnector, (m) => {
    const u = (m as unknown as { updateDataModel: Record<string, unknown> }).updateDataModel;
    const path = typeof u.path === 'string' ? u.path : '';
    const deviceId = path.startsWith('/devices/') ? path.slice('/devices/'.length) : '';
    const targets = deviceId ? deviceSurfaces.targetsFor(deviceId) : undefined;
    const sids = targets && targets.size ? targets : live;
    for (const sid of sids) processor.processMessages([{ ...m, updateDataModel: { ...u, surfaceId: sid } }] as never);
  }, () => 'fanout');
  // Every device command — tile press, gesture or voice — goes through this
  // one per-device lane, so they can never overtake each other.
  const actQueue = createActQueue(store);
  // Speaker tiles say which player is behind them from the first paint:
  // Spotify when she is connected, else the built-in player (labelled).
  if (!opts.connector) {
    const source = !opts.sim && loadTokens() ? 'spotify' as const : 'builtin' as const;
    for (const [id, d] of Object.entries(store.all())) if (d.playing !== undefined) store.patch(id, { source });
  }
  /** The lamps a board may show right now (managed ids in the device list). */
  const lampSlots = (): LampSlot[] => Object.keys(store.all()).filter(isManagedLampId).map((id) => ({ id, label: DEVICE_LABELS[id] ?? id }));
  /** Any plan about to be shown or applied names only lamps that exist: a
   *  seeded lamp after the swap, a bulb that has gone, or a plan written from
   *  a prompt built before discovery is fitted to the current lamps. */
  const fitPlan = (plan: SurfacePlan): SurfacePlan => roomWithoutPlanTiles(fitLampTiles(plan, lampSlots()));
  /** A turn on the floor-plan board is a floor plan, whatever kind the model
   *  wrote (a 'room' reply there would otherwise lose its plan tile). */
  const planForBoard = (frameId: string, plan: SurfacePlan): SurfacePlan =>
    reg.get(frameId)?.kind === 'plan' && plan.kind !== 'plan' ? { ...plan, kind: 'plan' } : plan;
  // Before the bridge has answered (or when it never does): a machine that
  // has seen real bulbs starts with THOSE lamps, marked SIM, so boards saved
  // with them open with working tiles. The seeded lamps are for a machine
  // that never found one.
  const lampSwap = { store, surfaces, labels: DEVICE_LABELS, ips: lampIps };
  /** Chrome's Local Network Access answer (asked once, logged once). */
  const lna = createLocalNetworkCheck();
  let lnaSaid = false;
  /** The "Chrome is blocking…" line once known ('' = not blocked / not asked). */
  let lnaLine = '';
  /** Says the "Chrome is blocking…" line the first time it applies; resolves
   *  with the line ('' when Chrome isn't blocking). */
  async function sayLocalNetworkBlocked(): Promise<string> {
    const line = await lna.line();
    if (line && !lnaSaid) { lnaSaid = true; say(line, { speak: true }); }
    if (line !== lnaLine) { lnaLine = line; if (devicesWired) refreshDevicesBoard(); }
    return line;
  }
  if (liveLamps) {
    // Remembered real lamps (marked "Not reachable" until the bridge answers),
    // or none at all: the boards then offer "Connect a device" instead.
    applyRealLamps(lampSwap, rememberedLamps(storage) ?? []);
  }
  /** The bridge stopped answering: mark every WiZ lamp so (live: "Not
   *  reachable"; otherwise SIM, as at boot), and start looking for it again. */
  function bridgeWentDown(): void {
    bridgeStatus.up = false;
    for (const id of Object.keys(store.all())) {
      if (!isWizDevice(id)) continue;
      if (liveLamps) store.patch(id, { sim: true, unreachable: true });
      else store.setSim(id, true);
    }
    if (devicesWired) refreshDevicesBoard();
  }
  /** Re-discovery while the bridge is away: at most once per 30 s (a timer
   *  while any lamp is unreachable, and on a refused press). */
  const REDISCOVER_MS = 30_000;
  let lastDiscoverAt = 0;
  let discovering = false;
  async function rediscoverLamps(): Promise<void> {
    if (!wizClient || opts.connector || discovering || Date.now() - lastDiscoverAt < REDISCOVER_MS) return;
    await discoverLamps(true);
  }
  const anyLampUnreachable = (): boolean => Object.entries(store.all()).some(([id, d]) => isWizDevice(id) && (d.unreachable || (!bridgeStatus.up && d.sim)));
  if (wizClient && !opts.connector && liveLamps && typeof window !== 'undefined') {
    const t = setInterval(() => { if (!bridgeStatus.up || anyLampUnreachable()) void rediscoverLamps(); }, REDISCOVER_MS);
    addEventListener('pagehide', () => clearInterval(t), { once: true });
  }
  /** Ask the bridge which bulbs answer. Up: the lamps are the bulbs it really
   *  finds (one per bulb, with their real on/brightness). Down: the lamps
   *  already here stay, marked (live: "Not reachable"; otherwise SIM). */
  async function discoverLamps(again = false): Promise<void> {
    if (!wizClient) return;
    discovering = true;
    lastDiscoverAt = Date.now();
    try {
      const lamps = await discoverRealLamps(wizClient, storage);
      const wasUp = bridgeStatus.up;
      bridgeStatus.up = lamps !== null;
      if (lamps === null || opts.devices) {
        for (const id of Object.keys(store.all())) {
          if (!isWizDevice(id)) continue;
          if (liveLamps) store.patch(id, { sim: lamps === null, unreachable: lamps === null });
          else store.setSim(id, lamps === null);
        }
        // Chrome blocking local network access is the reason: say so, once.
        if (lamps === null && liveLamps) void sayLocalNetworkBlocked();
        if (devicesWired) refreshDevicesBoard();
        return;
      }
      const changed = applyRealLamps(lampSwap, lamps);
      for (const fid of changed) renderSurface(fid);
      if (changed.length) { sync(); updateDock(); persist(); }
      if (devicesWired) refreshDevicesBoard();
      // A quiet re-check that changed nothing says nothing.
      if (!again || !wasUp) say(lamps.length ? `${again ? 'The lamp bridge is back — found' : 'Found'} ${lamps.length === 1 ? '1 lamp' : `${lamps.length} lamps`} on this network.` : 'The lamp bridge is running, but no lamp answered.', { speak: true });
    } catch { /* a broken bridge reply leaves the lamps as they are */ } finally { discovering = false; }
  }
  if (wizClient && !opts.connector) void discoverLamps();

  processor.onSurfaceCreated((s: unknown) => {
    const sid = (s as { id: string }).id;
    const host = sid.endsWith('-dock')
      ? dockSurfaceEl
      : world.querySelector<HTMLElement>(`[data-frame="${sid}"] .mc-surface`);
    // The surface exists in the processor even with nowhere to mount yet:
    // recorded, so the next render deletes it first ("already exists").
    live.add(sid);
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
      // Gimbal tile: one press -> the same path as the spoken phrase.
      if (a.name === 'gimbal.mode' || a.name === 'gimbal.cue') {
        const press = gimbalPress(a.name, a.context?.value ?? ext(a)?.value);
        if (press) gimbalTilePress(press);
        return;
      }
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
      // The pressed chip's own value (a preset key or a number).
      const value = (a.context?.value ?? ext(a)?.value) as string | number | undefined;
      const intent = tileIntent(a.name, id, cur, value);
      // Level sets are calmed per device (one in flight, latest value wins).
      if (intent) actQueue.act(intent);
    });
  });

  /** Every floor-plan tile on a board (they may sit inside rows / cards). */
  function planTilesOf(plan: SurfacePlan): Extract<SurfacePlan['tiles'][number], { type: 'plan' }>[] {
    const out: Extract<SurfacePlan['tiles'][number], { type: 'plan' }>[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.type === 'plan' && typeof o.boardId === 'string') { out.push(o as never); return; }
      for (const k of Object.keys(o)) walk(o[k]);
    };
    walk(plan.tiles);
    return out;
  }
  /** What was drawn on a plan board is kept with the board in the canvas
   *  document, BESIDE its surface plan (`drawings`), never inside it: the
   *  surface plan is what model prompts, morph edits and board transfers
   *  serialize. See planDocs.ts. */
  function savePlanDrawing(frameId: string, pb: (HTMLElement & { planState?: () => { boardId: string; doc: unknown } | null }) | null | undefined): void {
    const st = pb?.planState?.();
    const plan = surfaces[frameId];
    if (!st || !plan || !planTilesOf(plan).some((t) => t.boardId === st.boardId)) return;
    const doc = sanitizePlanDoc(st.doc);
    if (!doc) return;
    (drawings[frameId] ??= {})[st.boardId] = doc;
    setSavedPlanDoc(frameId, st.boardId, doc);
    persist();
    planDrawingChanged(frameId);
  }
  function renderSurface(id: string): boolean {
    if (!surfaces[id]) return false;
    // Backstop: whatever reached this board (a saved board from another
    // session, a script, a shared board) shows only lamps that exist.
    const plan = surfaces[id] = fitPlan(surfaces[id]);
    const msgs: A2uiMessage[] = [
      ...(live.has(id) ? [{ version: 'v0.9', deleteSurface: { surfaceId: id } } as A2uiMessage] : []),
      // The frame head already shows the title: no second heading inside.
      ...expandPlan(plan, id, store.all(), { heading: false, gimbal: gimbalState() }),
    ];
    const g = gateMessages(msgs, CATALOG_SCHEMAS);
    if (!g.ok) { say(`Blocked a board that did not pass the check: ${g.errors[0]}`, { speak: true }); return false; }
    // Saved drawings reach the plan boards before they mount.
    // A drawing belongs to its plan board id. Rendering never deletes one: an
    // edit that drops the plan tile can still be undone or rolled back, and
    // the drawing must be there when the tile returns (see planDocs.ts).
    feedDrawings(drawings, id, planTilesOf(plan).map((t) => t.boardId));
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
    const h = viewport.getBoundingClientRect().bottom || vp().h;
    // 8 px clear of the engine bar's real top (it sits lower and slimmer on
    // a short window, see canvas.css).
    const barTop = engineBar?.el.offsetHeight ? engineBar.el.getBoundingClientRect().top : 0;
    let b = engineBar ? (barTop ? Math.round(h - barTop) + 8 : 68 + 24) : 92;
    for (const el of [arrangeStrip, pairedRow]) {
      if (el.classList.contains('is-docked')) continue; // inside the engine bar: no height of its own
      if (!el.hidden && el.offsetHeight) b = Math.max(b, Math.round(h - el.getBoundingClientRect().top) + DOCK_GAP);
    }
    return b;
  };
  /** How high a room board's head may go when lifting it clears its chip
   *  row of the bottom chrome: under the open Tools bar, else to the bar's
   *  own top edge (a passing status line may sit over the head for a moment;
   *  never chips under the bottom chrome). */
  const topFloor = () => (root.querySelector('.mc-bar-tools:not([hidden]):not(.mc-bar-tools-peek)') ? barH() : 16);
  const insets = () => phoneShell ? { top: 0, left: 0, right: 0 } : ({ top: barH(), left: dockInset(), right: clusterInset(), bottom: bottomInset(), topFloor: topFloor() });

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
  /** The bottom fade only while there is more board below the fold. */
  function markMoreBelow(body: HTMLElement): void {
    body.classList.toggle('is-more-below', body.scrollHeight - body.scrollTop - body.clientHeight > 2);
  }
  function frameEl(f: Frame): HTMLElement {
    let el = world.querySelector<HTMLElement>(`[data-frame="${f.id}"]`);
    if (!el) {
      el = document.createElement('section');
      el.className = 'mc-frame';
      el.dataset.frame = f.id;
      el.innerHTML = `<div class="mc-frame-head"><button class="mc-frame-title" data-focus="${f.id}"></button><span class="mc-chip"></span>
          <span class="mc-frame-hand-acts"><button type="button" class="mc-btn mc-frame-smaller" data-frame-act="smaller" aria-label="Make this board smaller">Smaller</button><button type="button" class="mc-btn mc-frame-bigger" data-frame-act="bigger" aria-label="Make this board bigger">Bigger</button><button type="button" class="mc-btn mc-frame-close" data-frame-act="close" aria-label="Close this board">Close board</button></span></div>
        <div class="mc-frame-body"><div class="mc-connect-host" hidden></div><div class="mc-ghost" hidden aria-hidden="true"></div><div class="mc-surface"></div><div class="mc-empty" hidden></div></div>`;
      world.append(el);
      const fb = el.querySelector<HTMLElement>('.mc-frame-body')!;
      fb.addEventListener('scroll', () => markMoreBelow(fb), { passive: true });
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => markMoreBelow(fb)).observe(fb);
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
      // A room dashboard never scrolls inside itself: the board is as tall as
      // its tiles (its stored height is only the floor), so every tile shows.
      const room = isRoomBoard(f.id);
      if (room) el.dataset.kind = 'room'; else delete el.dataset.kind;
      const floor = room ? Math.min(h, FRAME_SIZE.h) : 0;
      Object.assign(el.style, { left: `${f.rect.x}px`, top: `${f.rect.y}px`, width: `${w}px`, height: room ? 'auto' : `${h}px`, minHeight: room ? `${phoneShell ? h : floor}px` : '' });
      if (room) watchRoomHeight(el, f.id);
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
      if (focused && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => markMoreBelow(body));
      body.inert = !focused; // overview is view-only: the plan engine hit-tests in unscaled pixels
      el.setAttribute('aria-label', `${f.title} board${focused ? ', editing' : ''}`);
      const empty = el.querySelector<HTMLElement>('.mc-empty')!;
      empty.hidden = !!surfaces[f.id];
      if (!surfaces[f.id] && !empty.querySelector(".mc-empty-talk")) {
        empty.innerHTML = `<p class="mc-empty-lead" data-i18n="emptyLead">What would you like to build on this board?</p>
          <button type="button" class="mc-btn primary mc-empty-talk" data-act="talk" aria-label="Talk: start listening">${MIC_ICON_SVG}<span>Talk</span></button>
          <p class="mc-empty-talk-caption" hidden></p>`;
      }
    }
    root.dataset.mode = focusId ? 'focus' : 'overview';
    applyStrings();
    applyCamera();
    editBoard.setFocus(focusId, !!focusId && !!surfaces[focusId]?.tiles.length);
    if (phoneShell && focusId) stampMorphTiles(focusId);
    nextChips?.refresh();
  }

  const labelFor = (f: Frame) => (isDevicesFrame(f.id) ? 'Devices' : surfaces[f.id]?.kind === 'plan' || f.kind === 'plan' ? 'Floor plan' : surfaces[f.id] ? 'Room dashboard' : 'Empty');

  let zoomHud: ReturnType<typeof mountZoomHud> | null = null;
  /** The focused board's next-step chips stay visible: when the board runs
   *  under the engine bar, its chip row is lifted to sit just above the bar
   *  (never above the board's own head). */
  // A row or its board that changes height (Hands on adds the board's hand
  // buttons and gesture badges, a chip is added) re-pins the row.
  const chipRowRo = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => keepChipsVisible()) : null;
  const chipRowsSeen = new WeakSet<HTMLElement>();
  function keepChipsVisible(): void {
    if (phoneShell) return;
    for (const row of world.querySelectorAll<HTMLElement>('.mc-next')) {
      if (chipRowRo && !chipRowsSeen.has(row)) { chipRowsSeen.add(row); chipRowRo.observe(row); if (row.parentElement) chipRowRo.observe(row.parentElement); }
      row.style.transform = '';
      row.classList.remove('is-lifted');
      delete row.dataset.pinned;
      const frameEl = row.parentElement;
      if (!frameEl) continue;
      const z = camera.z || 1;
      const view = viewport.getBoundingClientRect();
      const limit = (view.bottom || vp().h) - bottomInset();
      const box = row.getBoundingClientRect();
      const over = box.bottom - limit;
      if (over <= 0) continue;
      // No higher than just under the board's title bar. The focused room
      // board that runs under the bottom chrome (taller than the screen even
      // at its lowest zoom) keeps its chip row PINNED just above that chrome:
      // sticky, the tiles scroll under it, so the next steps never need a
      // scroll. Any other board only uses the empty space under its content
      // (never onto a tile).
      const room = box.top - (frameEl.getBoundingClientRect().top + 64 * z);
      const content = frameEl.querySelector<HTMLElement>('.mc-surface')?.getBoundingClientRect();
      const free = tallRoomEl() === frameEl ? room : content && content.height > 0 ? box.top - content.bottom - 4 : room;
      const lift = Math.min(over, Math.max(0, room), Math.max(0, free));
      if (lift <= 0) continue;
      row.style.transform = `translateY(${-(lift / z).toFixed(1)}px)`;
      row.classList.add('is-lifted');
      row.dataset.pinned = 'bottom';
    }
  }
  /** The focused room board's element, when it is taller than the space
   *  between the top inset and the bottom chrome (so the canvas scrolls). */
  function tallRoomEl(): HTMLElement | null {
    if (phoneShell || !focusId || !isRoomBoard(focusId)) return null;
    const el = world.querySelector<HTMLElement>(`[data-frame="${focusId}"]`);
    if (!el) return null;
    const h = el.getBoundingClientRect().height;
    return h > vp().h - barH() - bottomInset() + 1 ? el : null;
  }
  /** A vertical canvas pan (hand scroll, voice, wheel) on a tall focused room
   *  board scrolls THROUGH the board and stops at its ends: its head no lower
   *  than its framed top, its foot no higher than the bottom chrome. */
  function clampRoomPan(next: Camera): Camera {
    const el = tallRoomEl();
    if (!el || next.z !== camera.z) return next;
    const view = viewport.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top0 = r.top - view.top;
    const hi = barH() + 16; // its framed top (focusWholeBoard's margin)
    // At the end the chip row's own (unlifted) foot sits exactly where the
    // pinned row does, so the row never moves while the board scrolls.
    const row = el.querySelector<HTMLElement>('.mc-next');
    const rowFoot = row && row.offsetParent === el ? (row.offsetTop + row.offsetHeight) * camera.z : r.height;
    const lo = vp().h - bottomInset() - rowFoot; // chip row's foot on the bottom chrome
    const top = top0 - (next.y - camera.y) * camera.z;
    // Never pulled back from where it already is (a zoom or a drag left it there).
    const want = Math.min(Math.max(top, Math.min(lo, top0)), Math.max(hi, top0));
    return want === top ? next : { ...next, y: camera.y + (top0 - want) / camera.z };
  }
  /** The top bar stops short of the hand cluster (--mc-cluster-in), so an
   *  open Tools bar or a wrapped status line never covers Register / Tools. */
  let clusterIn = -1;
  function syncClusterInset(): void {
    if (phoneShell) return;
    const v = Math.round(clusterInset());
    if (v === clusterIn) return;
    clusterIn = v;
    root.style.setProperty('--mc-cluster-in', `${v}px`);
  }
  function applyCamera(): void {
    syncClusterInset();
    root.style.setProperty('--mc-bar-h', `${barH()}px`);
    world.style.transform = cameraTransform(camera);
    root.style.setProperty('--mc-z', camera.z.toFixed(3)); // hand targets keep their on-screen size in overview
    const g = 40 * camera.z;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${-camera.x * camera.z}px ${-camera.y * camera.z}px`;
    root.dataset.zoom = camera.z.toFixed(2);
    zoomHud?.setZoom(camera.z);
    keepChipsVisible();
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
  /** "Show everything" on a phone: keep the whole-canvas view (a resize or
   *  a remote board must not snap back to one board) until a board is
   *  focused again. */
  let phoneOverview = false;
  function fitPhone(): void {
    const list = reg.list();
    if (!list.length) return;
    if (phoneOverview && !focusId) { camera = fitRects(list.map((r) => r.rect), vp(), 28); applyCamera(); return; }
    const f = (focusId ? reg.get(focusId) : undefined) ?? (lastFocus ? reg.get(lastFocus) : undefined) ?? list[0];
    if (focusId !== f.id) { focusId = f.id; lastFocus = f.id; }
    const v = vp();
    const { top: TOP, chrome } = phoneBands();
    const GUTTER = 16;
    const fit = { w: Math.max(240, Math.floor(v.w - 2 * GUTTER)), h: Math.max(240, Math.floor(chrome - PHONE_BOARD_GAP - TOP)) };
    focusFit.set(f.id, fit);
    sync();
    camera = { x: f.rect.x - GUTTER, y: f.rect.y - TOP, z: 1 };
    applyCamera();
  }
  /** Phone shell, viewport px: where the focused board's head rests (below
   *  the status bar and the route badge) and where the bottom chrome (mic,
   *  Join laptop, Track, Hands, Read aloud, the camera dot) starts. The
   *  viewport itself ends above the chrome rows (canvas.css); the board is
   *  sized and scrolled to end above whatever else rises over it. */
  function phoneBands(): { top: number; chrome: number } {
    const v = vp();
    const vr = viewport.getBoundingClientRect();
    let chrome = Infinity;
    for (const el of root.querySelectorAll<HTMLElement>(PHONE_CHROME_SEL)) {
      if (el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.top - vr.top < v.h / 2) continue; // bottom chrome only
      chrome = Math.min(chrome, r.top - vr.top);
    }
    // canvas.css already ends the viewport above the chrome rows and below
    // the route badge; a caption or camera dot can still reach above that.
    return { top: PHONE_BOARD_GAP, chrome: Math.min(chrome, v.h) };
  }
  /** Phone shell: the focused board scrolls (the canvas moves) only between
   *  its head at rest and its last tile just above the bottom chrome. */
  function clampPhoneScroll(): void {
    if (!phoneShell || !focusId) return;
    const f = reg.get(focusId);
    const el = world.querySelector<HTMLElement>(`[data-frame="${focusId}"]`);
    if (!f || !el) return;
    const { top, chrome } = phoneBands();
    const minY = f.rect.y - top;
    const maxY = Math.max(minY, f.rect.y + el.offsetHeight - (chrome - PHONE_BOARD_GAP));
    camera = { ...camera, y: Math.min(maxY, Math.max(minY, camera.y)) };
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
    // Stored: only drawings whose plan tile is on a board now.
    const livePlans: Record<string, string[]> = {};
    for (const f of reg.list()) if (surfaces[f.id]) livePlans[f.id] = planTilesOf(surfaces[f.id]).map((t) => t.boardId);
    const kept = storedDrawings(drawings, livePlans);
    // Only plans of boards that exist (the loader would leave the rest out).
    const boardPlans: Record<string, SurfacePlan> = {};
    for (const f of reg.list()) if (surfaces[f.id]) boardPlans[f.id] = surfaces[f.id];
    const devices = isDevicesFrame(devicesFrame) ? devicesFrame : null;
    return {
      version: CANVAS_DOC_VERSION, camera, focusId: focusId && reg.get(focusId) ? focusId : null, frames: reg.list(), surfaces: boardPlans,
      lang: pack?.lang, pack: pack ?? undefined,
      ...(Object.keys(kept).length ? { drawings: kept } : {}),
      ...(devices ? { devicesBoard: devices } : {}),
    };
  }
  function persist(now = false): boolean {
    clearTimeout(persistTimer);
    const write = (): boolean => {
      // Saved boards this build couldn't read AND couldn't copy aside: never
      // write over them (this session's changes just aren't saved).
      const ok = !saveBlocked && tryWriteStorage(storage, STORAGE_KEY, JSON.stringify(snapshot()));
      // The doc now carries the devices-board id itself: the old key goes.
      if (ok) { try { storage.removeItem(LEGACY_DEVICES_BOARD_KEY); } catch { /* nothing to clear */ } }
      tryWriteStorage(storage, DISMISSED_KEY, JSON.stringify(dismissals.toJSON((id) => !!reg.get(id))));
      return ok;
    };
    if (now) return write();
    persistTimer = window.setTimeout(write, 250);
    return true;
  }

  // ---- navigation ----
  /** 1:1 focus camera. A board with content that is wider/taller than the screen
   *  (a dashboard on a phone) opens at its top-left; an empty board stays centred
   *  so its Talk call-to-action is on screen. */
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
    const room = isRoomBoard(f.id);
    const fit = handsPlanBoard(f.id) && free >= 480
      ? { w: free, h: freeH }
      : fitFocusedSize(f.rect, { free, freeH, phone: phoneShell, room });
    const had = focusFit.get(f.id);
    if (fit) focusFit.set(f.id, fit); else focusFit.delete(f.id);
    if (had?.w !== fit?.w || had?.h !== fit?.h) sync();
    if (room) {
      // The board is as tall as its tiles at this width: measure, don't assume.
      const el = world.querySelector<HTMLElement>(`[data-frame="${f.id}"]`);
      let real = el?.offsetHeight || 0;
      let w = fit?.w ?? f.rect.w;
      // Too tall to show whole? Wider (zoomed out to the floor it would hit
      // anyway) lets the tiles sit side by side: try it, keep it if shorter.
      const wide = !phoneShell && real ? roomWidenWidth({ w, h: real, free, freeH, minZ: ROOM_MIN_Z }) : null;
      if (wide && el) {
        const prev = focusFit.get(f.id);
        focusFit.set(f.id, { w: wide, h: fit?.h ?? f.rect.h });
        sync();
        const tall = el.offsetHeight || 0;
        if (tall && tall < real) { real = tall; w = wide; }
        else { if (prev) focusFit.set(f.id, prev); else focusFit.delete(f.id); sync(); }
      }
      return { ...f, rect: { ...f.rect, w, h: real || fit?.h || f.rect.h } };
    }
    return fit ? { ...f, rect: { ...f.rect, ...fit } } : f;
  }
  const isRoomBoard = (id: string): boolean => surfaces[id]?.kind === 'room';
  function focusCam(f: Frame): Camera {
    // A room dashboard shows whole (zooming out a little if it must); anything
    // else keeps the 1:1 focus.
    if (isRoomBoard(f.id) && !phoneShell) return focusWholeBoard(f.rect, vp(), insets());
    return focusOnInsets(f.rect, vp(), insets(), 16, !!surfaces[f.id]);
  }
  // A room board's height follows its tiles. Seen at its own width (overview)
  // that height is stored, so "show everything" frames the real board; seen
  // at a fitted focus width it is display-only and the camera re-frames it.
  const roomWatched = new WeakSet<HTMLElement>();
  let roomRefly = 0;
  function watchRoomHeight(el: HTMLElement, id: string): void {
    if (roomWatched.has(el) || typeof ResizeObserver === 'undefined') return;
    roomWatched.add(el);
    let lastH = el.offsetHeight;
    new ResizeObserver(() => {
      const f = reg.get(id);
      const h = el.offsetHeight;
      if (!f || !h || !isRoomBoard(id)) return;
      const delta = Math.abs(h - lastH);
      lastH = h;
      if (focusId === id) {
        // Re-frame only for a real change in size (a tile added or reflowed),
        // not for a tile's error line appearing.
        if (delta < 48 || phoneShell) return;
        clearTimeout(roomRefly);
        roomRefly = window.setTimeout(() => { const cur = focusId === id ? reg.get(id) : undefined; if (cur) void flyTo(focusCam(fitBoardWidth(cur))); }, 140);
      } else if (!focusFit.has(id) && Math.abs(h - f.rect.h) > 1) {
        reg.setRect(id, { ...f.rect, h });
        persist();
      }
    }).observe(el);
  }
  // ---- board buttons for hands (the focused board's header, Hands on):
  // Smaller / Bigger and Close board. Close is undoable.
  const BOARD_SIZE = { minW: 480, maxW: 2400, minH: 360, maxH: 1600, step: 1.2 };
  /** The space a focused board can use (the same as fitBoardWidth). */
  function freeBoardSpace(): { w: number; h: number } {
    const ins = insets();
    return { w: Math.floor(vp().w - ins.left - ins.right - 32), h: Math.max(360, Math.floor(vp().h - ins.top - (ins.bottom ?? 0) - 32)) };
  }
  function refit(id: string): void {
    sync(); persist();
    const f = reg.get(id);
    if (!f || focusId !== id) return;
    void flyTo(focusCam(fitBoardWidth(f))).then(() => window.dispatchEvent(new Event('resize')));
  }
  function resizeBoard(id: string, dir: 1 | -1): void {
    const f = reg.get(id); if (!f) return;
    const k = dir > 0 ? BOARD_SIZE.step : 1 / BOARD_SIZE.step;
    const free = freeBoardSpace();
    // "Bigger" on a focused board that already fills the screen has nothing to show.
    if (dir > 0 && focusId === id && (handsPlanBoard(id) || (f.rect.w >= free.w && f.rect.h >= free.h))) { say(`${f.title} already fills the screen.`); return; }
    const w = Math.round(Math.min(BOARD_SIZE.maxW, Math.max(BOARD_SIZE.minW, f.rect.w * k)));
    const h = Math.round(Math.min(BOARD_SIZE.maxH, Math.max(BOARD_SIZE.minH, f.rect.h * k)));
    if (w === f.rect.w && h === f.rect.h) { say(dir > 0 ? `${f.title} is as big as it gets.` : `${f.title} is as small as it gets.`); return; }
    reg.setRect(id, { ...f.rect, w, h });
    history.push({ frameId: id, before: null, after: null, by: 'her', summary: `Made ${f.title} ${dir > 0 ? 'bigger' : 'smaller'}`, kind: 'resize', rectBefore: { ...f.rect } });
    historyRender();
    refit(id);
    say(focusId === id && handsPlanBoard(id) ? `${f.title} is smaller. It fills the screen while Hands is on.` : `${f.title} is ${dir > 0 ? 'bigger' : 'smaller'}.`);
  }
  function closeBoard(id: string): void {
    const f = reg.get(id); if (!f) return;
    if (reviewBusy()) { say('Finish the review first — keep or drop, then close the board.'); return; }
    const surface = surfaces[id] ?? null;
    // Tear the A2UI surface down too, so Undo can build it again under the same id.
    if (live.has(id)) { try { processor.processMessages([{ version: 'v0.9', deleteSurface: { surfaceId: id } }] as never); } catch { /* already gone */ } }
    live.delete(id); deviceSurfaces.untrack(id);
    reg.remove(id);
    delete surfaces[id];
    const closedDrawings = drawings[id];
    delete drawings[id];
    history.push({ frameId: id, before: surface, after: null, by: 'her', summary: `Closed ${f.title}`, kind: 'close', closedFrame: f, ...(closedDrawings ? { closedDrawings } : {}) });
    if (focusId === id) { focusId = null; void overview(); } else sync();
    updateDock(); persist(); historyRender();
    say(`Closed ${f.title}. Say “undo” to bring it back.`);
  }
  /** Hands on and this floor-plan board in focus: it is SHOWN at the whole
   *  free space so the plan can be drawn at 60–80 px per metre. Display-only
   *  (fitBoardWidth / focusFit): the board's own size is never changed, so it
   *  goes back when Hands goes off, in overview, and across reloads. */
  function handsPlanBoard(id: string): boolean {
    return !phoneShell && !!gestures?.isActive() && !!world.querySelector(`[data-frame="${id}"] mc-plan-board`);
  }
  async function focus(id: string): Promise<void> {
    let f = reg.get(id); if (!f) return;
    focusId = id; lastFocus = id; phoneOverview = false;
    sync(); updateDock();
    f = fitBoardWidth(f);
    await flyTo(focusCam(f));
    window.dispatchEvent(new Event('resize')); // let the plan engine re-measure at 1:1
    say(`Editing ${f.title}. Say “show everything” to zoom out.`);
  }
  async function overview(): Promise<void> {
    focusId = null; phoneOverview = phoneShell; sync(); clearDock();
    const list = reg.list();
    // Leave the hand cluster's lane on the right free (it sits on the edge).
    const v = vp();
    await flyTo(fitRects(list.map((f) => f.rect), { w: Math.max(320, v.w - clusterInset()), h: v.h }, Math.max(56, barH())));
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
      say(saveSpokenLine(false, f?.title ?? null, ''), { speak: true });
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
      say(msg, { speak: true });
      return;
    }
    sync();
    updateDock();
    say(msg, { speak: true });
  }
  function step(dir: 1 | -1): void {
    const list = reg.list(); if (!list.length) return;
    const i = Math.max(0, list.findIndex((f) => f.id === (focusId ?? lastFocus)));
    void focus(list[(i + dir + list.length) % list.length].id);
  }

  // ---- AI turns: visible prompt, ghost preview, human in the loop ----
  const SCRIPTS: Record<string, string> = {
    nanoRoom: '{"kind":"room","title":"This room","tiles":[{"type":"lamp","deviceId":"wiz-desk","label":"Desk lamp"},{"type":"lamp","deviceId":"wiz-ceiling","label":"Ceiling light"}]}',
    geminiRoom: '{"kind":"room","title":"Living room","tiles":[{"type":"lamp","deviceId":"wiz-ceiling","label":"Main light"},{"type":"lamp","deviceId":"wiz-desk","label":"Reading lamp"},{"type":"music","deviceId":"speaker-1","label":"Speaker"},{"type":"connect","label":"Connect a device"}]}',
    nanoPlan: '{"kind":"plan","title":"Floor plan","tiles":[{"type":"plan","boardId":"BOARD-cad","template":"twoBedroom"}]}',
  };
  // Dev server (or a VITE_E2E=1 build) + ?sim=1 only: the e2e can make the
  // scripted model write a given reply (e2e-room-rebuild: only a Connect
  // tile). Anywhere else — a production build — the scripts are frozen and
  // not exposed.
  const e2eHooks = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
  if (e2eHooks && opts.sim && typeof window !== 'undefined') (window as unknown as { __mcScripts?: Record<string, string> }).__mcScripts = SCRIPTS;
  else Object.freeze(SCRIPTS);
  // Model streams in flight (any engine, fallbacks included): the replay's
  // "is a turn still running?" for turns that don't hold turnBusy.
  let streamsOut = 0;
  const counted = (e: SurfaceEngine): SurfaceEngine => ({
    ...e,
    stream: async (prompt, onText, so) => { streamsOut++; try { return await e.stream(prompt, onText, so); } finally { streamsOut--; } },
    handoff: e.handoff ? counted(e.handoff) : undefined,
    fallback: e.fallback ? counted(e.fallback) : undefined,
  });
  const engineFor = (id: EngineId, json: string): SurfaceEngine => counted(opts.engines?.[id]?.(json) ?? scriptedEngine(id, json));
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
  /** A room turn's device list: what answers right now, read from the store
   *  at the moment of the turn (a lamp found after the bridge was allowed
   *  mid-session is in it; a remembered "Not reachable" bulb is not). */
  const roomDeviceHints = (): DeviceHint[] => answeringDevices(store.all(), { label: labelOf, kind: kindOf, live: liveLamps });
  const deviceRefs = (): DeviceRef[] => Object.entries(store.all()).map(([id, s]) => ({ id, label: labelOf(id), kind: kindOf(id), on: s.on, brightness: s.brightness, playing: s.playing, volume: s.volume, temp: s.temp }));
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
  // A fast reply (sim's scripted engines, a cached or on-device answer) would
  // settle the swarm and open the review before anyone could read a cursor.
  // Same rule in sim and live: the review waits until every cursor has landed
  // on its tile plus a short linger (swarmAgents.LINGER_MS) — never longer, and
  // never for work that did not happen.
  // Only the call that STARTED this swarm may settle it: if a newer turn took
  // the layer over (or an error already ended it), finish() says false and we
  // leave the new turn's cursors alone.
  async function finishSwarm(): Promise<void> { if (await swarm.finish()) settleSwarm(); }
  /** One ledger line for a turn, remembered against that turn's SentInfo
   *  (summed if the same turn really sends twice). A SIM turn books 0 real
   *  bytes — only what it would send. `prebooked`: bytes of this turn already
   *  booked the moment they left (a point-to-connect crop whose clarifying
   *  question was pending) — the receipt counts them, the total not twice. */
  function recordSent(s: SentInfo, sentText: string, extraBytes = 0, prebooked = 0): number {
    const full = utf8ByteLength(sentText) + Math.max(0, extraBytes);
    const entry = ledger.record({ engine: s.engine, extraBytes: Math.max(0, full - prebooked), sim: s.sim });
    receipts.record(s, entry.bytes + (s.sim || s.engine === 'nano' ? 0 : Math.min(prebooked, full)), entry.simBytes ?? 0);
    renderBytes();
    return entry.bytes;
  }
  /** Every byte counter (AI panel line, footer, engine bar, feed, swarm pill)
   *  from the one ledger: real bytes, and SIM "would send" apart. */
  function renderBytes(): void {
    const t = ledger.totals();
    ledgerTotalRender();
    panels.setFooterBytes(t.aiBytes, t.simBytes);
    swarm.reportBytes(t.aiBytes, t.simBytes);
  }
  /** Live cloud turns that are open but have not (yet) sent: bytes are booked
   *  when a model call really leaves (cloudSent), never when the turn starts —
   *  a call refused before it left books nothing. */
  const pendingCloud = new WeakMap<SentInfo, { entry: ReturnType<typeof ledger.record>; perSend: number; sends: number }>();
  function openCloudTurn(s: SentInfo, payload: string, extraBytes = 0): void {
    const entry = ledger.record({ engine: s.engine }); // the turn counts; 0 bytes so far
    receipts.record(s, 0, 0);
    pendingCloud.set(s, { entry, perSend: utf8ByteLength(payload) + Math.max(0, extraBytes), sends: 0 });
    renderBytes();
  }
  /** One model call of turn `s` left this device (a hedge or retry is another). */
  function cloudSent(s: SentInfo): void {
    const p = pendingCloud.get(s);
    if (!p) return;
    p.sends++;
    ledger.addBytes(p.entry, p.perSend);
    receipts.record(s, p.perSend, 0);
    renderBytes();
    refreshReviewFor(s);
    const total = p.perSend * p.sends;
    panels.forEngine('gemini').log('note', p.sends === 1 ? `sent ${formatBytesShort(p.perSend)}` : `sent again: ${p.sends} calls, ${formatBytesShort(total)} in all`);
    // A handoff says so where she decides: who made it, why, and what left.
    if (s.handoffWhy) s.routeLine = `${s.routeLine.replace(/ · [\d.]+ (?:B|KB|MB) sent$/, '')} · ${formatBytesShort(total)} sent`;
  }
  /** A call booked as sent turned out to have failed before its request was
   *  issued (its App Check token came back refused, late): take it back. */
  function cloudRetract(s: SentInfo): void {
    const p = pendingCloud.get(s);
    if (!p || p.sends <= 0) return;
    p.sends--;
    ledger.addBytes(p.entry, -p.perSend);
    receipts.record(s, -p.perSend, 0);
    renderBytes();
    refreshReviewFor(s);
    panels.forEngine('gemini').log('note', 'that call never left: nothing was sent');
    if (s.handoffWhy) s.routeLine = s.routeLine.replace(/ · [\d.]+ (?:B|KB|MB) sent$/, '') + (p.sends ? ` · ${formatBytesShort(p.perSend * p.sends)} sent` : '');
  }
  /** Swarm cursors follow the reply: one per tile it has really produced. */
  let swarmFollowsTiles = false;
  function growSwarm(names: readonly string[]): void { if (swarmFollowsTiles) swarm.setTiles(names.length, names); }
  function aiSent(utterance: string, s: SentInfo, ctx: { task?: SwarmTask; swarmPlan?: SwarmPlanInput; extraBytes?: number; prebookedBytes?: number; swarm?: boolean; /** live cloud turn: book bytes when a call really leaves */ defer?: boolean } = {}): void {
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
    if (ctx.defer && !s.sim && s.engine === 'gemini' && s.sent) openCloudTurn(s, protect.promptText, ctx.extraBytes);
    else recordSent(s, s.sent ? protect.promptText : '', s.sent ? ctx.extraBytes : 0, s.sent ? ctx.prebookedBytes : 0);
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
    // One cursor for this real call, in its engine's colour; a tile cursor
    // joins for each tile the reply really produces (growSwarm, from the
    // ghost) — never more cursors than tiles, never the other engine's.
    const plan = ctx.swarmPlan ?? buildMixedSwarmPlan(s.engine, ctx.task ?? 'generic');
    swarmFollowsTiles = !ctx.swarmPlan;
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
      // Already labelled (a later cursor of the same engine landed again):
      // never bring the kind word back next to the label ("LampLamp · …").
      if (tileEl.classList.contains('stage-labels')) return;
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
    growSwarm(g.tiles.map(ghostKindWord));
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
  /** The same activity log as the drawer, on its own tab (activity.html), newest first. */
  function openActivity(): void {
    if (phoneShell) return;
    const w = window.open('/activity.html', 'mendcraft-activity');
    if (!w) say('Allow pop-ups to open AI activity in a new tab.');
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
  // A room dashboard never holds a floor plan: that is its own board.
  const DEEP_ROOM_GOAL = 'Improve the current board: group the lights. No floor-plan tile: the floor plan has its own board.';
  /** The same goal for a board Gemini makes in ONE call (no draft to improve). */
  const ONE_CALL_ROOM_GOAL = 'Group the lights. No floor-plan tile: the floor plan has its own board.';
  /** When the last AI turn (stream + its review) let go of the board. The
   *  next-step pick stays away from the model for a while after that: a
   *  timed-out Nano call can still be finishing inside Chrome. */
  let lastTurnEndedAt = 0;
  const NEXT_PICK_COOLDOWN_MS = 10_000;
  /** The on-device model is loading back (it was evicted, or this is its
   *  first use): say so on the Nano card and in its terminal instead of
   *  looking stuck. Loading is not counted against Nano's reply budget. */
  function nanoLoading(load: NanoLoadState): void {
    const view = nanoLoadView(load);
    const state = aiPanel.querySelector('.mc-ai-state');
    engineBar?.set('nano', 'working', view.bar);
    if (view.note) {
      panels.forEngine('nano').log('note', view.note);
      if (state) state.textContent = view.note;
    } else if (state?.textContent === NANO_LOADING_LINE) state.textContent = '';
  }
  /** The background warm-up (canvasMain → hybrid.warmBoardOnDevice) is
   *  loading the model: the engine bar says "Nano is loading the model…"
   *  until it has (or gave up). A turn that starts meanwhile owns the card. */
  const nanoWarming = createWarmBar({ bar: engineBar, busy: () => turnBusy, lastTurnEndedAt: () => lastTurnEndedAt });
  /** The last streamed turn's draft came from Gemini after an on-device failure. */
  let lastTurnHandedOff = false;
  /** A review title is computed from the plan the model really returned. */
  type PlanSummary = string | ((plan: SurfacePlan) => string);
  // Titles come from what she will see: the fitted plan (real lamps, no plan tile on a room).
  const summaryOf = (summary: PlanSummary, plan: SurfacePlan): string => (typeof summary === 'function' ? summary(fitPlan(plan)) : summary);
  /** A room turn's reply as she will review it: fitted to the lamps that
   *  exist, with every device tile that is still real kept (the board's own,
   *  put back when the reply left them out), a tile for each device that
   *  answers, and the gimbal tile while the iPhone reports a stand — the same
   *  whichever engine wrote it (Nano, Gemini improving, Gemini after a
   *  handoff). What was put back is said in that engine's terminal. */
  function roomPlan(frameId: string, proposed: SurfacePlan, si: SentInfo, utterance: string): SurfacePlan {
    const fitted = fitPlan(planForBoard(frameId, proposed));
    if (fitted.kind !== 'room' || reg.get(frameId)?.kind === 'plan') return fitted;
    const before = surfaces[frameId] ?? null;
    const kept = keepRoomDevices(fitted, {
      before,
      answering: roomDeviceHints(),
      stand: !phoneShell && standReported(),
      utterance,
      dismissed: dismissals.of(frameId, before),
      fit: fitPlan,
    });
    const line = keptRoomLine(kept);
    if (line) panels.forEngine(si.engine).log('note', line);
    return kept.plan;
  }

  /** Stream one model turn into the ghost; the plan and its ledger receipt
   *  (the SentInfo token live bookings — cloudSent / cloudRetract — are
   *  recorded against), or null (failed / cancelled; the reason was said).
   *  `onSi` sees every receipt the turn opens, including a handoff's. */
  async function streamTurn(frameId: string, engineId: EngineId, utterance: string, script: string, task: SwarmTask, goal: string | undefined,
    current: SurfacePlan | null, retry: () => void, onSi?: (si: SentInfo) => void): Promise<{ plan: SurfacePlan; si: SentInfo } | null> {
    const f = reg.get(frameId); if (!f) return null;
    const engine = engineFor(engineId, script.replace('BOARD', frameId));
    let sentInfo: SentInfo | null = null;
    lastTurnHandedOff = false;
    const want = task === 'floorplan' ? 'plan' as const : 'room' as const;
    const plan = await withBuildGimbal(() => runSurfaceTurn({ utterance: goal ? `${utterance}. ${goal}` : utterance, frameTitle: f.title, devices: want === 'room' ? roomDeviceHints() : deviceHints(), current, frameId, want }, engine, {
      onSent: (s) => { sentInfo = s; onSi?.(s); aiSent(utterance, s, { task, defer: true }); },
      onFallback: aiFellBack,
      onCloudSend: cloudSent,
      onCloudRetract: cloudRetract,
      onNanoLoading: nanoLoading,
      // Nano couldn't finish: Gemini takes over as a NEW send — the Nano
      // terminal says why, the Gemini terminal shows what left (if it did).
      onHandoff: (s, why) => {
        panels.forEngine('nano').fail(why === NANO_STILL_LOADING ? 'was still loading the model' : `couldn’t finish: ${why}`);
        panels.showHandoff('nano', why === NANO_STILL_LOADING ? 'Nano was still loading, so Gemini makes this board' : 'Nano couldn’t finish, so Gemini makes this board');
        ghost(frameId, null);
        sentInfo = s;
        onSi?.(s);
        lastTurnHandedOff = true;
        aiSent(utterance, s, { task, defer: true });
      },
      onGhost: (g) => ghost(frameId, g),
      onNote: (note) => {
        const state = aiPanel.querySelector('.mc-ai-state');
        if (state) state.textContent = note;
      },
      onError: (why, failed) => {
        settleSwarm();
        panels.forEngine(failed ?? engineId).fail(why);
        aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why, { speak: true });
        offerRetry(retry);
      },
    }, { deviceIdSession, isCancelled: () => (sentInfo?.engine ?? engineId) === 'gemini' && !net.isOnline(), canHandoff: () => net.isOnline() }));
    const si = sentInfo as SentInfo | null;
    return plan && si ? { plan, si } : null;
  }

  interface TurnDraft { plan: SurfacePlan; si: SentInfo; summary: string; status: ProposalStatus; fellBack?: boolean; handedOff?: boolean }
  /** How a review's facts combine two engine steps (see combineFacts); both
   *  receipts are the ledger tokens the live bookings were recorded on. */
  type FactsLink = { si: SentInfo; kind: 'improved' | 'fallback'; retry?: () => void };
  /** `improve`: this turn improves an unreviewed draft (its plan is the
   *  model's starting point). If the turn fails, the draft itself goes to
   *  review — one request, one review, whichever engine finished it. */
  async function aiTurn(frameId: string, engineId: EngineId, utterance: string, script: string, summary: PlanSummary, status: ProposalStatus, task: SwarmTask = 'dashboard', goal?: string, improve?: TurnDraft): Promise<boolean> {
    if (turnBusy) return false; // a turn is already streaming/awaiting its review
    turnBusy = true;
    try {
      if (!reg.get(frameId)) return false;
      let attempt: SentInfo | null = null;
      const out = await streamTurn(frameId, engineId, utterance, script, task, goal, improve ? improve.plan : surfaces[frameId] ?? null,
        () => { void aiTurn(frameId, engineId, utterance, script, summary, status, task, goal); }, (si) => { attempt = si; });
      if (!out) {
        settleSwarm(); ghost(frameId, null);
        if (!improve) return false;
        // The improvement failed: review the draft, counting whatever the
        // failed attempt already booked, and keep a Retry for the whole request.
        improve.fellBack = true;
        const tried = attempt as SentInfo | null;
        return await proposePlan(frameId, utterance, improve.plan, improve.si, improve.summary, improve.status,
          tried ? { si: tried, kind: 'fallback', retry: () => { drop(); setTimeout(() => { void connectRoom(frameId, utterance); }, 0); } } : undefined);
      }
      const kept = roomPlan(frameId, out.plan, out.si, utterance);
      return await proposePlan(frameId, utterance, kept, out.si, summaryOf(summary, kept), status, improve ? { si: improve.si, kind: 'improved' } : undefined);
    } finally { turnBusy = false; lastTurnEndedAt = Date.now(); settleEngines(); autoHideAi(); }
  }

  /** A quick on-device draft that is NOT reviewed on its own: the next
   *  (Gemini) turn improves it and the person reviews the result once. */
  async function draftTurn(frameId: string, engineId: EngineId, utterance: string, script: string, summary: PlanSummary, status: ProposalStatus): Promise<TurnDraft | null> {
    if (turnBusy) return null;
    turnBusy = true;
    try {
      if (!reg.get(frameId)) return null;
      // No on-device model: this "draft" runs on Gemini and is the only call,
      // so it carries what the improve pass would have asked for.
      const onlyCall = engineFor(engineId, '{}').id === 'gemini';
      const out = await streamTurn(frameId, engineId, utterance, script, 'dashboard', onlyCall ? ONE_CALL_ROOM_GOAL : undefined, surfaces[frameId] ?? null,
        () => { void connectRoom(frameId, utterance); });
      await finishSwarm();
      if (!out) { ghost(frameId, null); return null; }
      // Nano's draft or Gemini's handoff alike: the real tiles are kept.
      const plan = roomPlan(frameId, out.plan, out.si, utterance);
      const check = gateMessages(expandPlan(plan, frameId, store.all()), CATALOG_SCHEMAS);
      if (!check.ok) { ghost(frameId, null); say('Blocked a plan that did not pass the check.', { speak: true }); return null; }
      const handedOff = lastTurnHandedOff;
      if (!handedOff && out.si.engine !== 'gemini') panels.forEngine(out.si.engine).log('done', `draft: ${tilesFilledLine(plan)}, for Gemini to improve`);
      return { plan, si: out.si, summary: summaryOf(summary, plan), status, handedOff };
    } finally { turnBusy = false; lastTurnEndedAt = Date.now(); settleEngines(); }
  }
  /** Review a draft as it is (Gemini already made it after a Nano handoff). */
  async function proposeDraft(frameId: string, utterance: string, d: TurnDraft, madeBy = false): Promise<boolean> {
    if (turnBusy) return false;
    turnBusy = true;
    try { return await proposePlan(frameId, utterance, d.plan, d.si, d.summary, d.status, undefined, madeBy); }
    finally { turnBusy = false; lastTurnEndedAt = Date.now(); settleEngines(); autoHideAi(); }
  }

  /** Gate a plan, show the Proposal card, and apply only on keep (shared by
   *  the room/floor-plan turns and the connect turns). */
  async function proposePlan(frameId: string, utterance: string, proposed: SurfacePlan, si: SentInfo, summary: string, status: ProposalStatus, link?: FactsLink, madeBy = false): Promise<boolean> {
    // What she reviews is what will be applied: fitted to the lamps that
    // exist now (the swap may have happened while the model was writing).
    const plan = fitPlan(planForBoard(frameId, proposed));
    // The proposal/review is ready — the swarm settles now (after a minimum
    // hold in sim so it's never decoration flashing by unseen), not left
    // running past the real work it stood for.
    await finishSwarm();
    panels.forEngine(si.engine).log(si.engine === 'gemini' ? 'replied' : 'done',
      tilesFilledLine(plan));
    const check = gateMessages(expandPlan(plan, frameId, store.all()), CATALOG_SCHEMAS);
    if (!check.ok) { ghost(frameId, null); say('Blocked a plan that did not pass the check.', { speak: true }); bodyLanguage('no'); return Promise.resolve(false); }
    aiPanel.querySelector('.mc-ai-state')!.textContent = 'Waiting for you. Nothing changes until you keep it.';
    // Where it actually ran (a phone's "Nano" step is really Deep in the cloud).
    const ranId: EngineId = si.engine;
    return new Promise((done) => {
      const before = surfaces[frameId] ?? null;
      let built = false;
      const prop = createSurfaceProposal(`p-${Date.now()}`, ranId, summary, check.messages, () => {
        try {
          surfaces[frameId] = plan; reg.rename(frameId, plan.title); reg.setKind(frameId, plan.kind === 'plan' ? 'plan' : 'room');
          if (!renderSurface(frameId)) throw new Error('Could not render the board');
          history.push({ frameId, before, after: plan, by: ranId, summary });
          // She kept this review: what it took off the board is her choice.
          if (isHerChange({ by: ranId }, { kept: true })) noteDismissal(frameId, before, plan);
          // A dashboard built while the iPhone reports a docked stand gets
          // the gimbal controls too (local tile, no model involved).
          if (plan.kind === 'room') queueMicrotask(() => gimbalOnNewDashboard(frameId));
          sync(); updateDock(); persist(); historyRender();
          // First build on an empty focused board: re-place it (no animation, before the
          // self-check measures) so a wide dashboard opens at its top-left on a phone.
          if (!before && focusId === frameId) { const ff = reg.get(frameId); if (phoneShell) fitPhone(); else if (ff) { camera = focusCam(ff); applyCamera(); } }
          selfCheckTiles(frameId);
          built = true;
        } catch (e) {
          if (before) { surfaces[frameId] = before; renderSurface(frameId); }
          else { delete surfaces[frameId]; const el = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-surface`); if (el) el.innerHTML = ''; }
          sync(); updateDock(); persist();
          const why = e instanceof Error ? e.message : 'The build failed after Approve';
          panels.forEngine(ranId).fail(why);
          say(why, { speak: true });
        }
      });
      const finish = (kept: boolean) => {
        reviewDialog.close(); ghost(frameId, null); pending = null;
        aiPanel.querySelector('.mc-ai-state')!.textContent = kept ? `Kept. Say “undo” to put it back.` : 'Dropped. Nothing changed.';
        autoHideAi();
        say(kept ? `Kept: ${summary}. Say “undo” to put it back.` : 'Dropped. Nothing changed.', { speak: kept ? `Kept: ${summary}.` : 'Dropped. Nothing changed.' });
        done(kept);
      };
      const card = renderProposalCard(document, {
        id: `p-${frameId}`, title: summary, youAsked: utterance, status,
        catalog: { helper: ranId === 'nano' ? 'Quick' : 'Deep', byLine: ranId === 'nano' ? 'Quick · on this device' : 'Deep · online',
          routeLine: si.routeLine, lineId: 'custom', whyLabel: ranId === 'nano' ? 'Why here' : 'Why online', whatWasSent: si.sent, technicalLine: si.routeLine },
      }, { onKeep: () => { prop.accept(); finish(true); if (built) bodyLanguage('yes'); }, onDrop: () => { prop.reject(); finish(false); } });
      tagCardI18n(card);
      pending = { frameId, prop, card };
      // Every decision — desktop or phone — opens the same full-screen review,
      // so there's one place keep/drop (voice, pinch, Approve/Reject) acts on.
      // One cloud call made it all (no on-device model): "Made by Gemini · N KB".
      const planFacts = (): ReviewFacts => (link ? combineFacts(reviewFacts(si, utterance), reviewFacts(link.si), link.kind)
        : madeBy ? madeByFacts(reviewFacts(si, utterance)) : reviewFacts(si, utterance));
      showReview({
        title: summary, card, extra: buildReviewExtra(),
        // A blank board still has a name ("Board 3"): diff against it, so the
        // plan says "Board 3 → This room" — or nothing when the name stays.
        changes: diffPlans(before ?? { kind: plan.kind, title: reg.get(frameId)?.title ?? plan.title, tiles: [] }, plan, { devices: store.all() }),
        // A two-step change (draft + improvement, or a draft after a failed
        // improvement) names both steps and counts both steps' bytes.
        facts: planFacts(),
      }, { tokens: [si, link?.si], facts: planFacts });
      if (link?.kind === 'fallback') {
        say(`${typeof navigator !== 'undefined' && navigator.onLine === false ? 'You’re offline' : `${engineName(link.si.engine)} didn’t answer`} — this is ${engineName(si.engine)}’s draft. Approve or say “keep”; Reject or say “drop”.`);
        if (link.retry) offerRetry(link.retry);
      } else say(`${summary}. Approve or say “keep”; Reject or say “drop”.`);
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
      panels.showHandoff('nano', 'group the lights');
      await aiTurn(next.frameId, 'gemini', next.utterance, SCRIPTS.geminiRoom, betterSummary, 'changed', 'dashboard', DEEP_ROOM_GOAL);
    }
  }

  async function connectRoom(frameId: string, utterance = 'connect everything in this room'): Promise<void> {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    if (net.isOnline()) {
      // One request, one review: Nano drafts (shown in the ghost, not
      // reviewed on its own), Gemini improves that draft, and the person
      // approves the result once. The review's footer names both steps and
      // counts both steps' booked bytes (a phone's "Nano" draft step may
      // itself run in the cloud).
      const draft = await draftTurn(frameId, 'nano', utterance, SCRIPTS.nanoRoom, draftSummary, 'guess');
      if (!draft) return;
      // No on-device model here (the Nothing phone): the "draft" step itself
      // ran on Gemini in the cloud. One call made the board.
      const cloudDraft = !draft.handedOff && draft.si.engine === 'gemini';
      if (draft.handedOff || cloudDraft) {
        // Gemini already made this draft (Nano couldn't finish, or there is no
        // Nano here): asking it to improve its own board would be a second
        // cloud send for nothing.
        const line = 'Gemini made this draft, so there is no second pass.';
        panels.forEngine('gemini').log('note', line);
        aiPanel.querySelector('.mc-ai-state')!.textContent = line;
        await proposeDraft(frameId, utterance, draft, cloudDraft);
        return;
      }
      panels.showHandoff('nano', 'group the lights');
      // Tell Deep what the handoff line promises (only in the prompt; her card
      // still shows her own words) — without it the live model never added the
      // room plan: 0/3 → 7/7 boards with it (live-build study).
      const kept = await aiTurn(frameId, 'gemini', utterance, SCRIPTS.geminiRoom, roomSummary, 'changed', 'dashboard', DEEP_ROOM_GOAL, draft);
      // The network dropped between the draft and Gemini: the kept draft gets
      // its Deep pass on reconnect, as on the offline path.
      if (kept && draft.fellBack && !net.isOnline() && !deepLater.some((d) => d.frameId === frameId)) {
        deepLater.push({ frameId, utterance });
        panels.forEngine('nano').setQueued(net.laterCount() + deepLater.length);
        say(`${OFFLINE_QUICK_ONLY}. Deep will improve it when you're back online.`);
      }
      return;
    }
    const kept = await aiTurn(frameId, 'nano', utterance, SCRIPTS.nanoRoom, draftSummary, 'guess');
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
    if (lastTurnHandedOff) {
      // Gemini already made this draft (Nano couldn't finish): asking it to
      // improve its own board would be a second cloud send for nothing.
      const line = 'Gemini made this draft, so there is no second pass.';
      panels.forEngine('gemini').log('note', line);
      aiPanel.querySelector('.mc-ai-state')!.textContent = line;
      return;
    }
    panels.showHandoff('nano', 'group the lights');
    // Tell Deep what the handoff line promises (only in the prompt; her card
    // still shows her own words) — without it the live model never added the
    // room plan: 0/3 → 7/7 boards with it (live-build study).
    await aiTurn(frameId, 'gemini', utterance, SCRIPTS.geminiRoom, betterSummary, 'changed', 'dashboard', DEEP_ROOM_GOAL);
  }
  /** "draw the floor plan" (voice, chip, gesture, the empty-board button):
   *  the plan lives on its OWN board titled "Floor plan" — the existing one is
   *  focused, else a new one is made (an empty board she is on is used as
   *  that new board). Never written into a dashboard or any board with tiles. */
  function openFloorPlan(from: string | null, utterance = 'start a floor plan'): void {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const target = floorPlanTarget({ frames: reg.list(), surfaces, from });
    let id = target.id;
    if (target.make) {
      // A board with tiles (the dashboard) stays as it is, pinned beside.
      if (from && surfaces[from]?.tiles.length) reg.setPinned(from, true);
      id = reg.add('plan', FLOOR_PLAN_TITLE).id;
    } else if (target.reuseEmpty) { reg.rename(id!, FLOOR_PLAN_TITLE); reg.setKind(id!, 'plan'); }
    if (focusId !== id) { sync(); void focus(id!); }
    if (target.existing && surfaces[id!]?.tiles.length) { say('Here is your floor plan board.'); return; }
    reg.setKind(id!, 'plan'); // the turn on this board is a floor plan (planForBoard)
    floorPlan(id!, utterance);
  }
  function floorPlan(frameId: string, utterance = 'start a floor plan'): void {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    void aiTurn(frameId, 'nano', utterance, SCRIPTS.nanoPlan, floorPlanSummary, 'waiting', 'floorplan');
  }

  // ---- voice / typed edits to the floor plan already on a board ----
  type PlanBoardEl = HTMLElement & { planState?: () => { boardId: string; doc: unknown } | null; applyPlanDoc?: (doc: unknown, summary: string) => boolean };
  /** Who made the plan edit being applied right now (the history line). */
  let planEditBy: EngineId | null = null;
  /** The plan board an edit goes to: the focused one, else the Floor plan board. */
  function planEditTarget(): { frameId: string; el: PlanBoardEl } | null {
    const on = (id: string | null | undefined) => (id ? world.querySelector<PlanBoardEl>(`[data-frame="${id}"] mc-plan-board`) : null);
    const focused = on(focusId);
    if (focused && focusId) return { frameId: focusId, el: focused };
    const frames = reg.list();
    const f = frames.find((x) => x.kind === 'plan' && on(x.id)) ?? frames.find((x) => on(x.id));
    return f ? { frameId: f.id, el: on(f.id)! } : null;
  }
  /** "add a study next to bedroom 2": Nano decides the edit on this device
   *  (Gemini only if Nano can't and we are online), code makes it on a copy
   *  of the drawing, and she reviews the change — nothing is applied before
   *  Approve, and Undo takes it back. No valid edit: one plain line, no change. */
  async function planEditTurn(text: string): Promise<void> {
    if (reviewBusy()) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const target = planEditTarget();
    const before = target?.el.planState?.()?.doc as PlanDoc | undefined;
    if (!target || !before || !target.el.applyPlanDoc) { say(PLAN_EDIT_FAIL, { speak: true }); return; }
    const { frameId, el } = target;
    if (focusId !== frameId) { sync(); void focus(frameId); }
    const rooms = planRooms(before);
    if (!rooms.length) { say(PLAN_EDIT_FAIL, { speak: true }); return; }
    turnBusy = true;
    let out: Awaited<ReturnType<typeof runPlanEditTurn>>;
    try {
      const engine = engineFor('nano', simPlanEdit(text, rooms));
      out = await runPlanEditTurn(text, structuredClone(before), engine, {
        onSent: (si) => aiSent(text, si, { task: 'generic', defer: true, swarm: false }),
        onHandoff: (si, why) => {
          panels.forEngine('nano').fail(`couldn’t make the edit: ${why}`);
          panels.showHandoff('nano', 'Nano couldn’t make the edit, so Gemini makes it');
          aiSent(text, si, { task: 'generic', defer: true, swarm: false });
        },
        onCloudSend: cloudSent,
        onCloudRetract: cloudRetract,
        onNanoLoading: nanoLoading,
        onNote: (eng, note) => panels.forEngine(eng).log('note', note),
      }, {
        canHandoff: () => net.isOnline(),
        // What leaves is redacted on this device, like every cloud turn.
        cloudPrompt: (p) => protectTurn(text, p).promptText,
        // …and a cloud reply's redaction tokens become the real names again
        // on this device before the edit is read.
        restoreReply: (r) => fillVisible(r).text,
      });
    } finally { turnBusy = false; lastTurnEndedAt = Date.now(); settleEngines(); }
    if (!out.ok) {
      if (out.si) panels.forEngine(out.si.engine).fail(out.offline ? `couldn’t make the edit (${out.why}); offline, so Gemini can’t take over` : `couldn’t make the edit: ${out.why}`);
      const line = out.ask ?? PLAN_EDIT_FAIL;
      aiPanel.querySelector('.mc-ai-state')!.textContent = line;
      say(line, { speak: true });
      bodyLanguage('no');
      autoHideAi();
      return;
    }
    const { si, value } = out;
    const ranId: EngineId = si.engine;
    panels.forEngine(ranId).log(ranId === 'gemini' ? 'replied' : 'done', value.summary);
    const offlineDraft = ranId === 'nano' && !net.isOnline();
    aiPanel.querySelector('.mc-ai-state')!.textContent = 'Waiting for you. Nothing changes until you keep it.';
    const summary = value.summary;
    const changes = diffPlanDocs(before, value.doc);
    await new Promise<void>((done) => {
      let decided = false;
      const prop: SurfaceProposal = {
        id: `pe-${Date.now()}`, by: ranId, summary,
        status: () => (decided ? 'accepted' : 'pending'),
        accept: () => { if (decided) return false; decided = true; return true; },
        reject: () => { if (decided) return false; decided = true; return true; },
      };
      const finish = (kept: boolean, applied: boolean) => {
        reviewDialog.close(); pending = null;
        const line = !kept ? 'Dropped. Nothing changed.' : applied ? `Kept: ${summary}. Say “undo” to put it back.` : `${PLAN_EDIT_FAIL}`;
        aiPanel.querySelector('.mc-ai-state')!.textContent = kept && applied ? 'Kept. Say “undo” to put it back.' : line;
        autoHideAi();
        say(line, { speak: kept && applied ? `Kept: ${summary}.` : line });
        done();
      };
      const keepIt = () => {
        prop.accept();
        // Applied only now, as one undoable plan edit on the board.
        const live = world.querySelector<PlanBoardEl>(`[data-frame="${frameId}"] mc-plan-board`) ?? el;
        planEditBy = ranId;
        let ok = false;
        try { ok = !!live.applyPlanDoc?.(value.doc, summary); } finally { planEditBy = null; }
        if (!ok) panels.forEngine(ranId).fail('the plan board refused the edit after Approve');
        finish(true, ok);
        if (ok) { nextChips?.refresh(); bodyLanguage('yes'); }
      };
      const card = renderProposalCard(document, {
        id: `p-${frameId}`, title: summary, youAsked: text, status: 'changed',
        catalog: { helper: ranId === 'nano' ? 'Quick' : 'Deep', byLine: ranId === 'nano' ? 'Quick · on this device' : 'Deep · online',
          routeLine: si.routeLine, lineId: 'custom', whyLabel: ranId === 'nano' ? 'Why here' : 'Why online', whatWasSent: si.sent, technicalLine: si.routeLine },
      }, { onKeep: keepIt, onDrop: () => { prop.reject(); finish(false, false); } });
      tagCardI18n(card);
      pending = { frameId, prop, card };
      const facts = (): ReviewFacts => {
        const f = reviewFacts(si, text);
        return offlineDraft ? { ...f, chain: 'You’re offline — this is Nano’s draft' } : f;
      };
      showReview({ title: summary, card, extra: buildReviewExtra(), changes, facts: facts() }, { tokens: [si, out.ok ? out.nanoSi : undefined], facts });
      say(offlineDraft
        ? 'You’re offline — this is Nano’s draft. Approve or say “keep”; Reject or say “drop”.'
        : `${summary}. Approve or say “keep”; Reject or say “drop”.`);
    });
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
      let made: SurfacePlan | null = null;
      // The receipt the review shows: Gemini's, when it took over from Nano.
      let reviewSent: SentInfo = turn.sent;
      if (o.identified) {
        // The identity is already known: replay its tile into the ghost. No
        // model is called here, so there is nothing to hand off or retry.
        aiSent(utterance, turn.sent, { task: 'dashboard', extraBytes: o.extraBytes, prebookedBytes: o.prebookedBytes, swarm: o.swarm });
        if (o.note) panels.forEngine(turn.sent.engine).log('note', o.note);
        if (o.photoNote) panels.forEngine(turn.sent.engine).log('note', 'no camera or gimbal here, so the photo is simulated.');
        let full = '';
        try {
          full = await withBuildGimbal(() => engine.stream(turn.sent.prompt, (chunk) => { ghost(frameId, parsePartialPlan(chunk)); }));
        } catch (e) {
          const why = `Couldn’t add that device: ${e instanceof Error ? e.message : String(e)}`;
          settleSwarm(); aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why, { speak: true }); ghost(frameId, null); return false;
        }
        const parsed = parseModelPlan(full);
        if (!parsed.ok) { settleSwarm(); ghost(frameId, null); say(parsed.error.startsWith('The reply') ? parsed.error : `Refused the plan: ${parsed.error}`, { speak: true }); return false; }
        made = parsed.value;
      } else {
        // By name / scan: the same turn as a board build — a live on-device
        // engine gets the short constrained prompt, a failed one hands off to
        // Gemini, a live plan is stripped of made-up claims, and a failure
        // says why and offers Retry. Never a prepared draft in a live run.
        let current: SentInfo = turn.sent;
        made = await withBuildGimbal(() => runSurfaceTurn({ ...turn.request, frameId }, engine, {
          onSent: (s) => {
            current = s;
            aiSent(utterance, s, { task: 'dashboard', extraBytes: o.extraBytes, prebookedBytes: o.prebookedBytes, swarm: o.swarm, defer: true });
            if (o.note) panels.forEngine(s.engine).log('note', o.note);
            if (o.photoNote) panels.forEngine(s.engine).log('note', 'no camera or gimbal here, so the photo is simulated.');
          },
          onFallback: aiFellBack,
          onCloudSend: cloudSent,
          onCloudRetract: cloudRetract,
          onNanoLoading: nanoLoading,
          onHandoff: (s, why) => {
            panels.forEngine('nano').fail(why === NANO_STILL_LOADING ? 'was still loading the model' : `couldn’t finish: ${why}`);
            panels.showHandoff('nano', why === NANO_STILL_LOADING ? 'Nano was still loading, so Gemini makes this tile' : 'Nano couldn’t finish, so Gemini makes this tile');
            ghost(frameId, null);
            current = s;
            aiSent(utterance, s, { task: 'dashboard', swarm: o.swarm, defer: true });
          },
          onGhost: (g) => ghost(frameId, g),
          onNote: (note) => { const state = aiPanel.querySelector('.mc-ai-state'); if (state) state.textContent = note; },
          onError: (why, failed) => {
            settleSwarm();
            panels.forEngine(failed ?? turn.sent.engine).fail(why);
            aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why, { speak: true });
            // Retry runs after this turn has let go of the board.
            offerRetry(() => { void connectTurn(frameId, utterance, turn, summary, status, o); });
          },
        }, { sent: turn.sent, deviceIdSession, isCancelled: () => current.engine === 'gemini' && !net.isOnline(), canHandoff: () => net.isOnline() }));
        reviewSent = current;
        if (!made) { settleSwarm(); ghost(frameId, null); return false; }
      }
      const plan = { value: made };
      const before: SurfacePlan = surfaces[frameId] ?? { kind: 'room', title: f.title, tiles: [] };
      const merged = mergeTiles(before, plan.value.tiles);
      if (merged.tiles.length === before.tiles.length) {
        settleSwarm();
        ghost(frameId, null);
        aiPanel.querySelector('.mc-ai-state')!.textContent = 'Already on this board — nothing new to add.';
        say('That device is already on this board.');
        return false;
      }
      return await proposePlan(frameId, utterance, merged, reviewSent, summary, status);
    } finally { turnBusy = false; lastTurnEndedAt = Date.now(); }
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
  /** When the last point-to-connect capture ended (finger-count gestures
   *  stay off for POINT_COUNT_QUIET_MS after it: the pointing hand lingers). */
  let pointWaitEndedAt = -Infinity;
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
    pointWaitEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
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
    // Live: a smart bulb is one of HER real lamps — when one is reachable it is
    // proposed (normal review); when none is, say why (Chrome, or not yet).
    const realLamps = liveLamps ? Object.entries(store.all()).filter(([id, d]) => isManagedLampId(id) && !d.unreachable && !d.sim).map(([id]) => id) : undefined;
    if (realLamps && r?.identity.kind === 'smart-bulb' && r.identity.confidence >= POINT_MIN_CONFIDENCE && !o.chosenId && !realLamps.length) {
      ledgerPointFailure(r, o, null);
      say((await lna.line()) || BULB_UNREACHABLE_LINE, { speak: true });
      return;
    }
    const out = pointConnectFromIdentity(r, {
      realLamps,
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
        say(out.message, { speak: true });
        return;
      }
      ledgerPointFailure(r, o, idNote);
      say(out.message, { speak: true });
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
    announceGate.clear();
    forgetPhoneSense();
  }
  /** Phones gone: their sensing / stand reports go with them (no stale gimbal status). */
  function forgetPhoneSense(): void {
    phoneSense.clear();
    phoneSeenAt.clear();
    if (gimbalWired) pushGimbal();
  }
  /** The relay is kept while the pair-first flow still has phones (pairing
   *  again for one more, asking, or live). */
  const relayKept = (): boolean => pairFirst.phase() !== 'idle' && pairFirst.phones().length > 0;
  function closeConnectSheet(): void {
    if (pairingStop && !relayKept()) { void pairingStop(); pairingStop = null; pairFirst.cancel(); phoneAi.clear(); announceGate.clear(); }
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
  /** Close the card that was admitting one more phone, keeping the relay. */
  function endExtraPairing(session: HostSession): void {
    livePairing?.stopChime();
    livePairing = null;
    admissionOpen = false;
    void session.endAdmission().catch(() => undefined);
    pairFirst.abandon(); // pairing → live: the phones stay listed and connected
  }
  async function joinPhone(frameId: string): Promise<boolean> {
    const open = sheetOpen; if (!open || open.frameId !== frameId) return false;
    if (pairingStop && hostSession && relayKept()) {
      // Phones are already paired: keep THIS host session (same room, same
      // session id, so their pings keep being answered) and just open the
      // code again so the chime admits one more phone.
      const session = hostSession;
      livePairing?.stopChime();
      admissionOpen = true;
      try { await session.admitMore(); } catch {
        admissionOpen = false;
        if (sheetOpen === open) open.sheet.setStatus(REPAIR_FAILED_LINE);
        return false;
      }
      if (sheetOpen !== open || hostSession !== session) return false;
      void session.askWhoIsThere().catch(() => undefined);
      republishCurrentBoard();
      sheetOpen = null;
      const n = pairFirst.phones().length;
      livePairing = showPairing(open.host, {
        code: session.code,
        note: `${n} phone${n === 1 ? ' stays' : 's stay'} connected. Hold the next phone near the laptop.`,
        // X ends only this extra pairing: the code closes, the chime stops,
        // and the phones already here stay connected (Disconnect is the chip).
        onClose: () => { endExtraPairing(session); open.host.hidden = true; },
      });
      pairingHost = open.host;
      return true;
    }
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
        if (st === 'paired') {
          // A hello proves little (the room replays old ones on a reload):
          // the phone is shown once its announce names this session.
          askWhoIsThere();
        }
        else if (st === 'disconnected' || st === 'gone') {
          pairFirst.clearReal();
          forgetPhoneSense();
          // The relay can't say WHICH phone left, so forget every announce
          // — no stale device labels — then ask the phones still here to
          // re-announce (they also re-announce every 20 s on their own).
          phoneAi.clear();
          announceGate.clear();
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
        if (cmd.kind === 'sensePoint' || cmd.kind === 'gimbalCue' || cmd.kind === 'gimbalMode') return; // host → phone only
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
    res.session.setAttention?.(() => attentionWho());
    // Phones already in the room (remembered pairs) learn this session's id.
    void res.session.askWhoIsThere().catch(() => undefined);
    // Pair-first pairs phones one after another: the first phone's proof must
    // not retire the code the next phone is about to hear.
    if (pairFirst.phase() === 'pairing') { admissionOpen = true; void res.session.admitMore().catch(() => undefined); }
    showArrangeStrip(); // a phone is here: Swap sides becomes available
    saveHostToken(storage, res.token); // persist so the next reload resumes it
    // Publish the current arrangement + focused board so a joining phone (or a
    // remembered one that just reconnected) populates its side immediately.
    republishCurrentBoard();
    if (opts.privacyGemini) attachPrivacyHub(res.session, () => activePeople(), opts.privacyGemini);
    sheetOpen = null;
    // The pairing card floats over the screen at a readable size (title and
    // Close always visible) instead of squeezing inside the zoomed board.
    open.host.hidden = true;
    let float = root.querySelector<HTMLElement>('.mc-pair-float');
    if (!float) { float = document.createElement('div'); float.className = 'mc-pair-float'; root.append(float); }
    const floatHost = float;
    floatHost.hidden = false;
    pairing = livePairing = showPairing(floatHost, {
      code: res.code,
      note: 'After the first pair the phone is remembered and rejoins when you pick it up and look at it, or just open the app. Its changes still arrive here as proposals you keep or drop.',
      // A phone already joined: X only ends pairing (the card has just said
      // it is connected). Nobody joined: X gives up the relay as before.
      // Disconnecting phones is the Disconnect chip's job alone.
      onClose: () => {
        if (relayKept()) endExtraPairing(res.session); else disconnectPhones();
        floatHost.hidden = true;
      },
    });
    pairingHost = floatHost;
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
    // A plan edit made a moment ago (mouse / keyboard, still inside its
    // 350 ms grouping window) becomes its own history entry first, so this
    // Undo takes back exactly one edit.
    flushPlanEdits();
    const h = history.undo();
    if (!h) { say('Nothing to undo.'); return; }
    if (h.kind === 'lang') { applyPack(h.packBefore ?? null, { record: false }); historyRender(); say(`Undid: ${h.summary}.`, { speak: true }); return; }
    if (h.kind === 'layout') { if (h.layoutBefore) editBoard.restoreLayout(h.frameId, h.layoutBefore); historyRender(); say(`Undid: ${h.summary}.`, { speak: true }); return; }
    if (h.kind === 'resize' && h.rectBefore) {
      const cur = reg.get(h.frameId);
      // Its size goes back; where it was moved to since stays.
      if (cur) { reg.setRect(h.frameId, { ...cur.rect, w: h.rectBefore.w, h: h.rectBefore.h }); refit(h.frameId); }
      historyRender();
      say(`Undid: ${h.summary}.`, { speak: true });
      return;
    }
    if (h.kind === 'close' && h.closedFrame) {
      if (!reg.restore(h.closedFrame)) { historyRender(); say(`Could not bring “${h.closedFrame.title}” back.`); return; }
      if (h.before) surfaces[h.frameId] = h.before;
      if (h.closedDrawings) drawings[h.frameId] = h.closedDrawings;
      sync();
      if (h.before) renderSurface(h.frameId);
      updateDock(); persist(); historyRender();
      say(`Undid: ${h.summary}.`, { speak: true });
      return;
    }
    if (h.kind === 'plan') {
      // A floor-plan drawing edit (hand or mouse): the plan engine takes it
      // back with its own undo steps — no copy of the plan lives here.
      const pb = world.querySelector<HTMLElement & { undoPlanEdit?: (steps: number, epoch: number) => number }>(`[data-frame="${h.frameId}"] mc-plan-board`);
      const n = pb?.undoPlanEdit?.(h.planSteps ?? 0, h.planEpoch ?? -1) ?? 0;
      if (n) savePlanDrawing(h.frameId, pb);
      historyRender();
      say(n ? `Undid: ${h.summary}.` : `Could not undo “${h.summary}” — that plan was redrawn since.`);
      return;
    }
    if (h.before) { surfaces[h.frameId] = h.before; reg.rename(h.frameId, h.before.title); } else { delete surfaces[h.frameId]; live.delete(h.frameId); deviceSurfaces.untrack(h.frameId); }
    const el = world.querySelector<HTMLElement>(`[data-frame="${h.frameId}"] .mc-surface`);
    if (el && !h.before) el.innerHTML = '';
    if (h.before) renderSurface(h.frameId);
    sync(); updateDock(); persist(); historyRender();
    say(`Undid: ${h.summary}.`, { speak: true });
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
    aiSent(utterance, knSent, { task: 'kannada', defer: true });
    // The redact-before-handoff invariant: aiSent() above already logged any
    // Nano redaction, so it's safe to announce the handoff now.
    panels.showHandoff('nano', 'plan the Kannada pack — too complex for on-device');
    let full = '';
    try { full = await engine.stream(prompt, () => {}, { shape: 'json', onCloudSend: () => cloudSent(knSent), onCloudRetract: () => cloudRetract(knSent) }); }
    catch (e) {
      if (!engine.fallback) {
        settleSwarm();
        const why = `Kannada draft didn’t arrive. ${geminiFailLine(e)}`;
        panels.forEngine('gemini').fail(why);
        aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why, { speak: true }); return;
      }
      panels.forEngine('gemini').log('note', 'SIM · the model didn’t answer, so a prepared Kannada pack is waiting');
      try { full = await engine.fallback.stream(prompt, () => {}); }
      catch (e2) {
        settleSwarm();
        const why = `Kannada draft didn’t arrive: ${e2 instanceof Error ? e2.message : String(e2)}`;
        aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why, { speak: true }); return;
      }
    }
    let raw: unknown = null;
    try { raw = JSON.parse(full.slice(full.indexOf('{'), full.lastIndexOf('}') + 1)); } catch { /* not JSON */ }
    const coerced = coerceLanguagePack(raw);
    if (!coerced.ok) {
      settleSwarm();
      const why = coerced.error.startsWith('incomplete') ? INCOMPLETE_KN_LINE : `Refused the pack: ${coerced.error}`;
      panels.forEngine('gemini').fail(why);
      aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why, { speak: true }); return;
    }
    const next = coerced.value;
    await finishSwarm();
    const swapCount = Object.keys(next.strings).length;
    panels.forEngine('gemini').log('replied', `Kannada pack ready · ${swapCount} swaps`);
    panels.showHandoff('gemini', `apply ${swapCount} label swaps locally`);
    aiPanel.querySelector('.mc-ai-state')!.textContent = 'Waiting for you. English until you keep it.';
    const card = renderProposalCard(document, {
      id: 'p-lang', title: 'Add Kannada', youAsked: utterance, status: 'changed',
      catalog: { helper: 'Deep', byLine: 'Deep · online', routeLine: ROUTE_LINES.kannada, lineId: 'custom', whyLabel: 'Why online', whatWasSent: 'the UI key list and your request', technicalLine: ROUTE_LINES.kannada },
    }, {
      onKeep: () => { reviewDialog.close(); aiPanel.querySelector('.mc-ai-state')!.textContent = 'Kept. Kannada is on — say “undo” for English.'; applyPack(next, { record: true }); historyRender(); autoHideAi(); say('Kannada is on. Say “undo” (or “ರದ್ದುಮಾಡು”) for English.'); bodyLanguage('yes'); },
      onDrop: () => { reviewDialog.close(); aiPanel.querySelector('.mc-ai-state')!.textContent = 'Dropped. Still English.'; say('Kept English.'); autoHideAi(); },
    });
    showReview({
      title: 'Add Kannada', card, extra: buildReviewExtra(),
      changes: languagePackChanges('Kannada', swapCount),
      facts: reviewFacts(knSent, utterance),
    }, { tokens: [knSent], facts: () => reviewFacts(knSent, utterance) });
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
          if (intent === 'lampOn') void actQueue.act({ deviceId: d.id, on: true });
          else if (intent === 'lampOff') void actQueue.act({ deviceId: d.id, on: false });
          else if (intent === 'brighter') void actQueue.act({ deviceId: d.id, on: true, brightness: lampStep(cur + 20) });
          else void actQueue.act({ deviceId: d.id, brightness: lampStep(cur - 20) });
        }
        const sk: StatusKey = intent === 'lampOn' ? 'lightsOn' : intent === 'lampOff' ? 'lightsOff' : intent === 'brighter' ? 'brighter' : intent === 'dimmer' ? 'dimmer' : 'done';
        say(statusText(sk, pack), { speak: true });
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
  // "Hands always on" (Tools > More > Hands, or say "hands always on"; "hands
  // follow my face" restores the facing gate). Per device; the pill says so.
  let handsAlways = readHandsAlways(storage);
  function setHandsAlways(on: boolean, speak = true): void {
    handsAlways = on;
    writeHandsAlways(on, storage);
    root.querySelector<HTMLElement>('[data-cmd=handsalways]')?.setAttribute('aria-pressed', String(on));
    if (speak) say(on ? 'Hands always on: your hands act here even when you look away.' : 'Hands follow your face: they act only while you face this screen.');
  }
  setHandsAlways(handsAlways, false);
  const handTip = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (handTip) { handTip.className = 'mc-hand-tooltip'; handTip.hidden = true; handTip.setAttribute('aria-hidden', 'true'); document.body.appendChild(handTip); }
  // Open-palm highlight (palmHighlight.ts): the palm moves a sticky highlight
  // over the buttons; R thumbs-up (2 s) presses it, a fist tap clicks it.
  const palmHighlight = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
    ? createPalmHighlight({
        root,
        // The control under the hand that DRIVES the highlight (nearest pointer slot).
        directAt: (p) => handPointer?.directHit?.(p) ?? null,
        // Over a floor plan in hand edit with a drawing / placing tool, a fist
        // tap belongs to the plan: only a button next to the palm is picked.
        captureLimit: (p) => (planEditAt(p)?.drawing() ? PLAN_DRAW_CAPTURE_PX : null),
        ...(phoneShell ? { reach: () => phoneReach(phoneCamAspect) } : {}),
      })
    : null;
  /** Where the board under a running hand drag started (a cancel puts it back). */
  let handBoardFrom: { frameId: string; x: number; y: number } | null = null;
  const handPointer: HandPointer | null = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
    ? createHandPointer(document, {
        targetOverride: (now) => palmHighlight?.forced(now) ?? null,
        // Thumbs up / down veto fist starts and taps only while button
        // gestures are on — with Hands' gestures off a thumb-up grip still pans.
        fixedShapeVeto: () => !!gestures?.isActive(),
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
          if (ev.phase === 'start') {
            const f0 = reg.get(ev.frameId);
            handBoardFrom = f0 ? { frameId: ev.frameId, x: f0.rect.x, y: f0.rect.y } : null;
            boardEdge.handleBoardDrag({ ...at, phase: 'start' }); return;
          }
          if (ev.phase === 'end') { handBoardFrom = null; boardEdge.handleBoardDrag({ ...at, phase: 'end' }); persist(); return; }
          if (ev.phase === 'cancel') {
            // Looked away mid-drag: nothing is handed off and the board goes
            // back to where the drag began.
            boardEdge.handleBoardDrag({ ...at, phase: 'cancel' });
            const from = handBoardFrom; handBoardFrom = null;
            const f = reg.get(ev.frameId);
            if (from && f && from.frameId === ev.frameId) { reg.setRect(ev.frameId, { ...f.rect, x: from.x, y: from.y }); sync(); }
            return;
          }
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
          const b = el.getBoundingClientRect();
          handTip.textContent = text;
          handTip.hidden = false;
          // Beside the control, on screen, never over it or its neighbours.
          const r = { left: b.left, top: b.top, width: b.width, height: b.height };
          const near = nearRects(r, collectControls(document).filter((c) => c !== el).map((c) => { const q = c.getBoundingClientRect(); return { left: q.left, top: q.top, width: q.width, height: q.height }; }));
          const at = placeBubble(r, { w: handTip.offsetWidth || 160, h: handTip.offsetHeight || 32 }, near, { w: innerWidth, h: innerHeight });
          handTip.classList.add('is-placed');
          handTip.style.left = `${Math.round(at.left)}px`;
          handTip.style.top = `${Math.round(at.top)}px`;
        },
      })
    : null;

  // Button gestures (gestureControl.ts): a fixed hand shape held still for
  // 2 s presses its bound button — a real click, the same path as the
  // mouse. Badges show only while Hands is on. Phones bind the short table.
  // Facing gate: handRouter (handFacing.ts) — one gate, read by every path.
  const gestures: GestureControl | null = typeof document !== 'undefined' && handPointer
    ? createGestureControl({
        root,
        bindings: phoneShell ? PHONE_GESTURES : LAPTOP_GESTURES,
        run: (text) => { run(text); },
        say,
        onFire: (ev) => activityLog.push({ kind: 'gesture', text: `${ev.name} → ${ev.label}`, target: ev.target }),
        highlight: palmHighlight,
        // Hands on / off: the plan boards show or hide their hand-edit UI,
        // and a focused plan board takes the whole free space for drawing.
        onActive: () => {
          // Shown bigger with Hands on, back to its own size with Hands off.
          if (focusId && world.querySelector(`[data-frame="${focusId}"] mc-plan-board`)) refit(focusId);
          refreshPlanHands(true);
        },
        ...(phoneShell ? { reach: () => phoneReach(phoneCamAspect) } : {}),
        // Peace-and-move over nothing scrollable pans the canvas (dx/dy are
        // content motion; scroll-wheel style: hand down = see what is below);
        // persisted when it ends.
        onCanvasScroll: (dx, dy) => { if (phoneLocked()) return; camera = clampRoomPan(panBy(camera, dx, dy)); applyCamera(); },
        onCanvasScrollEnd: () => persist(),
        // The hint sits at the right end of the board's pinned chip row: on
        // the board, never over its head buttons (Smaller / Bigger / Close).
        canvasScrollAreas: () => { const el = tallRoomEl(); const row = el?.querySelector<HTMLElement>('.mc-next'); return row ? [row] : el ? [el] : []; },
        onLevel: (_el, _dir, readout) => activityLog.push({ kind: 'gesture', text: `Peace and move → ${readout}`, target: null }),
        levelTick: () => { try { return storage.getItem('mc.levelTick') === '1'; } catch { return false; } },
      })
    : null;
  // Floor-plan hand edit (docs/plan/2026-11-26-plan-hands-design.md). The
  // fist strokes and taps reach the plan through the hand pointer's surface
  // grab; here: the peace-and-move resize, and plan edits in the history.
  const PLAN_DRAW_CAPTURE_PX = 24;
  /** The armed plan hand-edit surface under a screen point (null: none). */
  function planEditAt(p: { x: number; y: number }): PlanHandSurface | null {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
    return armedSurfaceAt(document, p.x, p.y) as PlanHandSurface | null;
  }
  const planPeace = createPlanPeace();
  let planRefreshAt = -Infinity;
  /** Peace-and-move on a plan size stepper: one levelControl.adjustLevel step
   *  (a click on its own − / + button) per 30 px of travel, up = longer. */
  function levelPeaceTarget(el: HTMLElement): PeaceTarget {
    let done = 0;
    return {
      resizeBegin: () => true,
      resizeTravel(_dx, dy) {
        const want = Math.trunc(-dy / LEVEL_STEP_PX); // screen y grows downward: up = more
        while (done !== want) {
          const dir = want > done ? 1 : -1;
          if (!adjustLevel(el, dir)) { done = want; break; }
          done += dir;
        }
      },
      resizeEnd() {},
      resizeCancel() {},
    };
  }
  /** One hand frame's plan work (laptop and phone): peace-and-move over a
   *  plan with a wall / room / dimension selected resizes it — that hand's
   *  peace is then no button gesture — and the boards' hand UI is refreshed. */
  function planHandFrame(hands: readonly (readonly CropPt[])[], now: number, facing: boolean | null): { claimedPeace: (side: 'L' | 'R') => boolean; noScrollPeace: (side: 'L' | 'R') => boolean } {
    if (gestures?.isActive()) {
      planPeace.update(peaceHandsOf(hands, phoneShell ? phoneReach(phoneCamAspect) : undefined, handCameraAspect), now, {
        blocked: gesturesBlocked() || facing === false,
        targetAt: (p) => {
          // On a size stepper (a `data-level` control): the shared level step,
          // taken where the peace APPEARED, so drifting off the 56 px row
          // while moving up does not turn it into a scroll.
          const hit = deepElementFromPoint(document, p.x, p.y) as HTMLElement | null;
          const size = hit?.closest?.<HTMLElement>('.mc-plan-hand-on .mc-plan-size[data-level]');
          if (size) return levelPeaceTarget(size);
          const e = planEditAt(p);
          return e?.resizable() ? e : null;
        },
      });
    }
    // The boards' hand UI follows at ~10 Hz (a live stroke repaints itself).
    if (now - planRefreshAt >= 100 || now < planRefreshAt) { planRefreshAt = now; refreshPlanHands(); }
    return { claimedPeace: (side) => planPeace.claimed(side), noScrollPeace: (side) => planPeace.taken(side) };
  }
  if (typeof root.addEventListener === 'function') {
    root.addEventListener(PLAN_EDIT_EVENT, (e) => {
      const d = (e as CustomEvent<PlanEditDetail>).detail;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const frameEl = path.find((n) => (n as HTMLElement).dataset?.frame) as HTMLElement | undefined;
      const frameId = frameEl?.dataset.frame ?? (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-frame]')?.dataset.frame;
      if (!d || !frameId) return;
      history.push({ frameId, before: null, after: null, by: planEditBy ?? 'her', summary: d.summary, kind: 'plan', planSteps: d.steps, planEpoch: d.epoch });
      historyRender();
      savePlanDrawing(frameId, path.find((n) => (n as HTMLElement).tagName === 'MC-PLAN-BOARD') as HTMLElement | undefined);
    });
  }
  /** Gestures are paused while something else owns the hands: a fist grab,
   *  the not-facing lock, or the point-to-connect capture step. */
  const gesturesBlocked = (): boolean => handRouter.blocked();
  /** Finger counts (1/2/3) are off while a point capture is armed and for a
   *  second after it: a natural pointing hand must never press a chip. */
  const POINT_COUNT_QUIET_MS = 1000;
  const countsSuppressed = (): boolean => !!pointWait
    || (typeof performance !== 'undefined' ? performance.now() : Date.now()) - pointWaitEndedAt < POINT_COUNT_QUIET_MS;
  /** One laptop hand frame (selfie-space hands; may be EMPTY — an empty frame
   *  cancels a hold and lets the overlays clear): the ONE shape read, then
   *  the pointer (which reuses it: a thumbs-up is never a fist), then the
   *  button gestures, then the taught-gesture matcher and point capture. */
  // The pointer owns every live hand gesture (dwell-click, one-fist grab,
  // two-fist zoom); the router feeds it, the plan peace, the button gestures
  // and the taught gestures in that order, all behind the ONE facing gate.
  const handRouter = createLaptopHandRouter({
    pointer: handPointer,
    gestures,
    cameraAspect: () => handCameraAspect,
    extraBlocked: () => !!pointWait,
    suppressCounts: countsSuppressed,
    planFrame: (hands, now, facing) => planHandFrame(hands as readonly (readonly CropPt[])[], now, facing),
    teach: (hands, now) => teachPanel.matchFrame(hands as readonly (readonly CropPt[])[], now),
    pointWait: (cam, now) => feedPointWait(cam as readonly (readonly CropPt[])[], now),
    alwaysOn: () => handsAlways,
    say: (text) => say(text),
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  });
  /** Which device she is facing, for the phones (rides the host's pong). */
  function attentionWho(): AttentionWho {
    if (handRouter.faceSeenFacing()) return 'laptop';
    for (const [p, s] of phoneSense) if (s.facing === true && (p === 'ios' || p === 'android')) return p;
    return 'none';
  }
  /** Push who she faces to the phones when it changes (the session
   *  rate-limits; the pong carries it too, as the fallback). */
  function pushAttention(): void {
    if (phoneShell || !hostSession?.sendAttention) return;
    hostSession.sendAttention(attentionWho());
  }
  function onHandFrame(hands: readonly (readonly CropPt[])[], now: number): void {
    handRouter.frame(hands, now);
  }

  // Phone shell: hand control from the shared front camera (phoneHands.ts) —
  // a Hands pill next to Join laptop, persisted, off on first run. Same
  // pointer as the laptop; touch is untouched. Hand clicks/grabs only reach
  // the local activity log, never the AI feed that goes to the monitor.
  let facingPillShown = false;
  /** The phone's relay link: who she faces per the laptop, and a way to ask. */
  let relayAttention: { get(): { who: string; at: number } | null; probe(): void } | null = null;
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
        countsSuppressed,
        cameraAspect: () => handCameraAspect,
        planFrame: (selfie, t, facing) => planHandFrame(selfie as readonly (readonly CropPt[])[], t, facing),
        alwaysOn: () => handsAlways,
        // Another device has her attention (the laptop's pong says who, ≤ 20 s old).
        othersFacing: () => {
          const a = relayAttention?.get();
          const me = opts.phoneSensing ? 'ios' : 'android';
          return !!a && Date.now() - a.at < 20_000 && a.who !== 'none' && a.who !== me;
        },
        probeOthers: () => relayAttention?.probe(),
        // Which device has her attention: the re-announce carries it.
        onFacing: (v) => {
          senseChanged();
          // The pill showing / hiding resizes the board area (canvas.css).
          const shown = v !== null;
          if (shown !== facingPillShown) { facingPillShown = shown; requestAnimationFrame(() => fitPhone()); }
        },
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
    say('Registered. Tracking is locked to you.', { speak: true });
    setTimeout(() => closeScan(), 900); // leave the ✓ on screen for a beat
  }
  // Teach / custom-gestures share the same full-screen z-index tier as the
  // review dialog and mount after it, so opening one on top of an open review
  // would cover Approve/Reject. Keep the review the single gate (same guard the
  // morph flow uses) and tell the user to finish it first.
  // ---- Voice: pick the voice replies are spoken with (More → Voice, "change voice") ----
  const voiceLang = (): string => (pack?.lang === 'kn' ? 'kn-IN' : 'en-US');
  const voiceSheet = mountVoiceSheet(root, {
    speaker, lang: voiceLang, storage: voiceStore, say,
    platform: speechPlatform(typeof navigator !== 'undefined' ? navigator.userAgent : '', typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0),
    onReadAloud: (on) => { readAloud = on; if (!on) speaker.stop(); paintReadAloud(); },
  });
  // "Read aloud: On / Off": a big button below Talk (laptop cluster; on the
  // phone, above the Join pill) — the same setting as the Voice sheet's
  // switch (one stored value). Off stops speech mid-sentence.
  const readAloudBtn = typeof document !== 'undefined' ? document.createElement('button') : null;
  if (readAloudBtn) {
    readAloudBtn.type = 'button';
    readAloudBtn.className = 'mc-btn mc-read-aloud';
    readAloudBtn.dataset.cmd = 'readAloud';
    root.append(readAloudBtn);
  }
  function paintReadAloud(): void {
    if (!readAloudBtn) return;
    readAloudBtn.textContent = readAloud ? 'Read aloud: On' : 'Read aloud: Off';
    readAloudBtn.setAttribute('aria-pressed', String(readAloud));
  }
  function setReadAloud(on: boolean): void {
    readAloud = on;
    saveReadAloud(on, voiceStore);
    if (!on) speaker.stop(); // stop mid-sentence, at once
    paintReadAloud();
    voiceSheet.refresh();
    say(on ? 'Read aloud on: replies are read aloud.' : 'Read aloud off: replies stay as text.', { speak: true });
  }
  paintReadAloud();
  // Browsers fill their voice list late: repaint an open sheet when it lands.
  try { (globalThis as { speechSynthesis?: { addEventListener?(t: string, f: () => void): void } }).speechSynthesis?.addEventListener?.('voiceschanged', () => voiceSheet.refresh()); } catch { /* no speech here */ }
  /** "change voice" / "use the Ava voice" / "preview voice" / "default voice". */
  function changeVoice(intent: ChangeVoiceIntent): void {
    const out = resolveChangeVoice(intent, speaker.voices().filter((v) => loadAllowCloud(voiceStore) || !isCloudVoice(v)), loadSavedVoice(voiceStore), voiceLang());
    if (out.action === 'set' && out.voice) saveVoice(out.voice, voiceStore);
    if (out.action === 'reset') clearSavedVoice(voiceStore);
    if (out.action === 'open' || out.action === 'not-found') voiceSheet.open(); else voiceSheet.refresh();
    const wasReading = readAloud;
    readAloud = false; // the line below is spoken once, with the voice it is about
    say(out.say);
    readAloud = wasReading;
    speaker.speak(out.say, { voice: out.voice });
  }
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
    // Strict: no face, an unsettled face, or a stranger's face (registered
    // operator lost) all count as NOT facing (handFacing.presenceHandFacing).
    // Point-to-connect is intentionally NOT gated on facing: you look at the
    // device you point at, not at this screen.
    handRouter.presence(f, now);
    pushAttention();
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
        facingView: () => handRouter.view(),
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
      frame: (hands, now) => onHandFrame(hands, now),
    },
  });
  // iPhone SENSING layer (phoneSensor.ts): same phone camera/tracker as the
  // Hands pill, but it never acts on the UI and is not facing-gated. Runs
  // only while the Track pill is on or a follow-hands / point request is
  // active — docking alone never opens the camera.
  /** The sensing camera was live at the last change (re-assert on a restart). */
  let sensorWasLive = false;
  const phoneSensor: PhoneSensor | null = phoneShell && opts.phoneSensing && opts.phoneCamera && typeof document !== 'undefined'
    ? createPhoneSensor({
        camera: opts.phoneCamera,
        root,
        storage,
        onHands: (cam, now) => {
          if (inputs.gimbal.mode() === 'hands') void inputs.gimbal.onHandsFrame(cam.map((points) => ({ points })), now).then(() => senseChanged()).catch(() => {});
          feedPointWait(cam, now);
        },
        onChange: () => {
          // The camera session just (re)started: DockKit can start tracking
          // again on a new capture session — re-assert "off" in hands / hold.
          const live = !!phoneSensor?.running();
          if (live && !sensorWasLive) void inputs.gimbal.reassertOff?.().finally(() => senseChanged());
          sensorWasLive = live;
          senseChanged();
        },
        say,
        onUserStop: () => {
          // Sensing off from the pill: a waiting point ends, and a hands follow
          // with no frames left says so and holds still (never the face).
          if (pointWait?.phone) { endPointWait(); say('Hand tracking off — nothing was captured.'); }
          if (inputs.gimbal.mode() === 'hands' && !handsOn) say(HANDS_PAUSED);
        },
      })
    : null;
  const senseSubs = new Set<() => void>();
  let senseLast = '';
  let gimbalDocked = false;
  // "aiming at hands" goes false on its own once no hand is seen: re-check.
  if (phoneSensor && getGimbalPlugin() && typeof window !== 'undefined') {
    // Also re-reads the plugin (isAvailable, 5 s TTL) so systemTracking and
    // the 'hands' / 'tracking' claims never go stale.
    const diagTimer = setInterval(() => {
      if (!gimbalDocked) return;
      void (inputs.gimbal.refresh?.() ?? Promise.resolve()).catch(() => {}).finally(() => senseChanged());
    }, 1000);
    addEventListener('pagehide', () => clearInterval(diagTimer), { once: true });
  }
  function senseChanged(): void {
    const k = JSON.stringify(phoneSenseStatus());
    if (k === senseLast) return;
    senseLast = k;
    for (const cb of senseSubs) cb();
  }
  /** What this iPhone really has on (for its announce to the laptop). The
   *  Android phone has no sensing layer: it announces only while its Hands
   *  pill is on, so the laptop row can say whether she faces it. */
  function phoneSenseStatus(): PhoneSenseStatus | null {
    const facing = phoneHands?.facing() ?? null;
    if (!phoneSensor) return phoneHands?.isOn() ? { gimbal: 'none', sensor: false, hands: true, canPoint: false, ...(facing !== null ? { facing } : {}) } : null;
    // 'tracking' only when docked AND the plugin read back system tracking on
    // (gimbal mode 'face' is entered only on that confirmation).
    const mode = inputs.gimbal.mode();
    const diag = gimbalDocked ? inputs.gimbal.diag?.() : undefined;
    // 'tracking' also needs the read-back: a face mode whose tracking DockKit
    // dropped is not claimed. 'hands' needs the read-back OFF too: hands with
    // DockKit still tracking would really be following the face.
    const trackingOn = diag?.systemTracking;
    const gimbal = !gimbalDocked ? 'none'
      : mode === 'face' ? (trackingOn === false ? 'ready' : 'tracking')
      : mode === 'hands' && phoneSensor.running() && trackingOn !== true ? 'hands' : 'ready';
    const s: PhoneSenseStatus = { gimbal, sensor: phoneSensor.running(), hands: !!phoneHands?.isOn(), canPoint: opts.phoneCamera?.status() !== 'error' };
    if (diag && typeof diag.systemTracking === 'boolean') s.systemTracking = diag.systemTracking;
    if (diag) s.aimingAtHands = diag.aimingAtHands;
    if (diag?.signSuspect) s.aimSign = diag.signSuspect;
    if (facing !== null) s.facing = facing;
    return s;
  }
  // ---- the gimbal tile (gimbalTile.ts) ----
  /** What the tile shows: ONLY what the docked iPhone reported. */
  function gimbalState(): GimbalTileState {
    // A board rendered at boot, before the gimbal wiring below exists.
    if (!gimbalWired) return { ...gimbalTileState(null), error: '' };
    let g: GimbalTileState;
    if (getGimbalPlugin()) g = gimbalTileState(phoneSenseStatus() ?? { gimbal: gimbalDocked ? (inputs.gimbal.mode() === 'face' ? 'tracking' : 'ready') : 'none', sensor: false, hands: false, canPoint: false });
    // Only a CURRENTLY paired iPhone's report counts (a stale announce never shows).
    else if (iphonePaired() && phoneSense.has('ios')) g = gimbalTileState(phoneSense.get('ios'));
    else if (simIphone()) {
      const s = gimbalTileState({ gimbal: simGimbalMode === 'face' ? 'tracking' : simGimbalMode === 'hands' ? 'hands' : 'ready', sensor: simGimbalMode === 'hands', hands: false, canPoint: true });
      g = { ...s, status: `SIM · ${s.status}` };
    } else g = gimbalTileState(null, { paired: phoneShell ? undefined : iphonePaired() });
    return { ...g, error: gimbalError };
  }
  /** Push the current gimbal state to every board that shows the tile. */
  function pushGimbal(): void {
    if (devicesWired) refreshDevicesBoard();
    const g = gimbalState();
    for (const sid of live) {
      if (sid.endsWith('-dock') || !surfaces[sid] || !planHasGimbal(surfaces[sid])) continue;
      processor.processMessages([gimbalUpdate(sid, g)] as never);
    }
  }
  /** The room dashboard: the focused room board, else the last one, else a
   *  pinned one, else the first room board. */
  function dashboardId(): string | null {
    const dash = (id: string | null | undefined): id is string => !!id && surfaces[id]?.kind === 'room' && !isDevicesFrame(id);
    for (const id of [focusId, lastFocus]) if (dash(id)) return id;
    const room = reg.list().find((f) => f.pinned && dash(f.id)) ?? reg.list().find((f) => dash(f.id));
    return room?.id ?? null;
  }
  /** "add the gimbal" / a stand docking: the tile joins the dashboard. */
  function addGimbalTile(o: { voice?: boolean } = {}): boolean {
    const id = o.voice ? (focusId ?? dashboardId()) : dashboardId();
    if (!id || !surfaces[id]) { if (o.voice) say(GIMBAL_NO_BOARD); return false; }
    const next = withGimbalTile(surfaces[id]);
    if (!next) { if (o.voice) say(GIMBAL_NO_ROOM); return false; }
    if (next === surfaces[id]) { if (o.voice) say(GIMBAL_ALREADY); return false; }
    surfaces[id] = next;
    renderSurface(id); sync(); persist();
    const who = phoneSense.get('ios') ? 'The iPhone is on its stand' : 'SIM · the iPhone is on its stand';
    say(o.voice ? GIMBAL_ADDED : `${who} — ${GIMBAL_ADDED.charAt(0).toLowerCase()}${GIMBAL_ADDED.slice(1)}`);
    return true;
  }
  /** The iPhone's reported stand changed (laptop: its announce; iPhone: the
   *  dock watch). A stand appearing puts the tile on the dashboard (once). */
  function gimbalReported(wasDocked: boolean, docked: boolean): void {
    if (docked) gimbalError = '';
    if (docked && !wasDocked && !gimbalAutoAdded && !phoneShell && addGimbalTile()) { gimbalAutoAdded = true; return; }
    pushGimbal();
  }
  /** The iPhone (real, or the SIM one under ?sim=1) reports a stand. */
  function standReported(): boolean {
    const s = iphonePaired() ? phoneSense.get('ios') : undefined;
    return (!!s && s.gimbal !== 'none') || simIphone();
  }
  function gimbalOnNewDashboard(frameId: string): void {
    if (gimbalAutoAdded || phoneShell || !standReported() || dashboardId() !== frameId) return;
    // She took the gimbal tile off this board (e.g. kept "only the lamps"): it stays off.
    if (dismissals.of(frameId, surfaces[frameId] ?? null).has('gimbal')) return;
    if (addGimbalTile()) gimbalAutoAdded = true;
  }
  function gimbalFail(why: string): void { gimbalError = why; say(why); pushGimbal(); }
  /** Follow me / follow my hands / hold still — voice and tile alike. */
  function gimbalMode(mode: 'face' | 'hands' | 'hold'): void {
    gimbalError = '';
    if (getGimbalPlugin()) {
      // On the iPhone: the local plugin, through the same controller the
      // phrase always used (canvasInputs / gimbalCanvas).
      const run = (): void => {
        void inputs.gimbal.setMode(mode, { explicit: true }).then((r) => {
          const t = r.ok ? r.status : r.why;
          if (!r.ok && r.why) gimbalError = r.why;
          if (t) say(t);
        }).catch(() => {}).finally(() => { senseChanged(); pushGimbal(); });
      };
      if (phoneSensor && mode === 'hands') { void phoneSensor.request('follow', true).then(run); return; }
      if (phoneSensor) void phoneSensor.request('follow', false);
      run();
      return;
    }
    if (simIphone() && !hostSession) { simGimbalMode = mode; pushGimbal(); return; }
    if (!iphonePaired()) { gimbalFail(phoneShell ? NO_GIMBAL_WHY : GIMBAL_NO_PHONE); return; }
    // Laptop: ask the docked iPhone; the tile changes only when it reports back.
    void hostSession!.sendGimbalMode(mode).then((sent) => {
      // Not sent while still paired = rate-limited or a repeat of the same mode: quietly dropped.
      if (!sent) { if (!iphonePaired()) gimbalFail(GIMBAL_NO_PHONE); }
      else say(`Asked the iPhone: ${GIMBAL_MODE_BUTTONS.find((b) => b.value === mode)?.label.toLowerCase() ?? mode}.`);
    }).catch(() => gimbalFail('Couldn’t reach the iPhone — check the pairing.'));
  }
  function gimbalTilePress(press: NonNullable<ReturnType<typeof gimbalPress>>): void {
    if ('mode' in press) { gimbalMode(press.mode); return; }
    if (!getGimbalPlugin() && !iphonePaired() && !simIphone()) { gimbalFail(GIMBAL_NO_PHONE); return; }
    if (!getGimbalPlugin() && phoneSense.has('ios') && phoneSense.get('ios')!.gimbal === 'none') { gimbalFail(GIMBAL_NO_STAND); return; }
    gimbalError = '';
    bodyLanguage(press.cue);
    pushGimbal();
  }
  senseSubs.add(() => { pushGimbal(); });
  gimbalWired = true;

  // ---- the Connected devices board (connectedDevices.ts): local, no AI ----
  /** What each device really reports right now. */
  function connectedInput(): ConnectedInput {
    const phones = pairFirst.phones();
    const ios = phones.find((p) => isIphoneRow(p));
    const android = phones.find((p) => p.id === 'android' || (p.sim && /nothing|android/i.test(p.label)));
    const sense = iphonePaired() ? phoneSense.get('ios') : undefined;
    const simG = simGimbalMode === 'face' ? 'tracking' as const : simGimbalMode === 'hands' ? 'hands' as const : 'ready' as const;
    const lamps = Object.entries(store.all()).filter(([id]) => isManagedLampId(id)).map(([id, d]) => ({
      label: DEVICE_LABELS[id] ?? id,
      state: opts.sim ? 'sim' as const : !bridgeStatus.up || d.unreachable || d.sim ? 'unreachable' as const : 'answering' as const,
    }));
    const music = Object.values(store.all()).some((d) => d.playing !== undefined);
    return {
      laptop: true,
      iphone: ios ? { sim: ios.sim, answering: ios.sim || phoneAnswering('ios'), gimbal: ios.sim ? simG : sense?.gimbal ?? null, sensor: ios.sim ? simGimbalMode === 'hands' : sense?.sensor } : null,
      android: android ? { sim: android.sim, answering: android.sim || phoneAnswering('android') } : null,
      lamps,
      lampWhy: lnaLine,
      speaker: music ? { sim: !!opts.sim, spotifyTokens: !opts.sim && !!loadTokens(), playingOn: musicWhere.spotify ? musicWhere.target : '' } : null,
    };
  }
  const phoneAnswering = (platform: string): boolean => Date.now() - (phoneSeenAt.get(platform) ?? -Infinity) <= PHONE_FRESH_MS;
  function isDevicesFrame(id: string | null | undefined): boolean { return !!id && id === devicesFrame && !!reg.get(id); }
  const devicesBoardId = (): string | null => (isDevicesFrame(devicesFrame) ? devicesFrame : null);
  /** Rows changed (a phone joined/left, a lamp answered): redraw the board. */
  function refreshDevicesBoard(): void {
    const id = devicesBoardId();
    if (!id || phoneShell) return;
    const plan = connectedDevicesPlan(connectedDeviceRows(connectedInput()));
    if (JSON.stringify(plan) === JSON.stringify(surfaces[id])) return;
    surfaces[id] = plan;
    renderSurface(id); persist();
  }
  /** "connect devices": the Connected devices board, made or brought up. */
  function ensureDevicesBoard(): string {
    let id = devicesBoardId();
    if (!id) {
      id = reg.add('note', DEVICES_BOARD_TITLE).id; sync(); // its frame (and surface host) first
      devicesFrame = id; // saved in the doc (snapshot), never beside it
    }
    surfaces[id] = connectedDevicesPlan(connectedDeviceRows(connectedInput()));
    renderSurface(id); sync(); persist();
    if (focusId !== id) void focus(id);
    return id;
  }
  /** Where "build the dashboard" / a room turn goes: the board she is on when
   *  it can be a dashboard (not the devices board, not a floor plan), else the
   *  existing dashboard, else an empty board she is on, else a new "Dashboard". */
  function dashboardTarget(from: string | null): string {
    const planBoard = (id: string) => surfaces[id]?.kind === 'plan' || reg.get(id)?.kind === 'plan' || reg.get(id)?.title === FLOOR_PLAN_TITLE;
    const ok = (id: string | null | undefined): id is string => !!id && !!reg.get(id) && !isDevicesFrame(id) && !planBoard(id);
    if (ok(from) && surfaces[from]?.tiles.length) return from;
    const existing = reg.list().find((f) => ok(f.id) && surfaces[f.id]?.kind === 'room' && surfaces[f.id]!.tiles.length);
    if (existing) return existing.id;
    if (ok(from)) return from;
    return reg.add('room', DASHBOARD_TITLE).id;
  }
  let devicesWired = true;
  if (typeof window !== 'undefined' && !phoneShell) {
    const devTimer = setInterval(() => { if (devicesBoardId()) refreshDevicesBoard(); }, 4000);
    addEventListener('pagehide', () => clearInterval(devTimer), { once: true });
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
    engineBar?.setOffline(!on);
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
    const prepare = (eng: SurfaceEngine, prompt: string): { prompt: string; onCloudSend: () => void } => {
      const cloud = eng.id === 'gemini';
      const base = cloud
        ? (eng.routeLine ?? 'Gemini · cloud — sent your words (names redacted) for a short reply')
        : 'Nano · on device — nothing left this device';
      const si: SentInfo = {
        engine: eng.id, prompt, sim: eng.sim,
        sent: cloud ? 'your words (names redacted). No board data, no device addresses.' : null,
        routeLine: eng.sim && !base.startsWith('SIM') ? `SIM · ${base}` : base,
      };
      aiSent(text, si, { swarm: false, defer: true });
      return { prompt: cloud ? protectTurn(text, prompt).promptText : prompt, onCloudSend: () => cloudSent(si) };
    };
    let r: Awaited<ReturnType<typeof openEndedAsk>>;
    // The reply is shown and read aloud as it is written, not when it is done.
    replyTrace.asked();
    const live = liveSay();
    // Chat can't act: the moment the reply promises an action ("I'll add a
    // study…"), nothing more of it is shown or spoken — the honest line
    // replaces it at the end (promiseGuard).
    let promised = false;
    try {
      r = await openEndedAsk(text, nano, gemini, (full) => {
        if (promised) return;
        // Only whole clauses the guard has cleared are shown and spoken; a
        // clause that could still become a promise waits for its sentence.
        const safe = guardSafePrefix(full);
        if (safe === null) { promised = true; return; }
        if (!safe) return;
        aiPanel.querySelector('.mc-ai-state')!.textContent = safe;
        live.update(safe);
      }, prepare);
    } catch (e) {
      const why = `No answer. ${geminiFailLine(e)}`;
      panels.forEngine('gemini').fail(why);
      aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why, { speak: true });
      settleEngines(); autoHideAi();
      return;
    }
    // A cloud reply may carry the redaction tokens back: real names return on this device.
    const guarded = promiseGuard(r.engineId === 'gemini' ? fillVisible(r.reply).text : r.reply, text);
    const reply = guarded.reply;
    // The cloud terminal keeps what the cloud actually said (tokens, not names).
    panels.forEngine(r.engineId).log(r.engineId === 'gemini' ? 'replied' : 'done', r.reply);
    if (guarded.replaced) panels.forEngine(r.engineId).log('note', 'the reply promised an action chat can’t take, so an honest line was shown instead');
    aiPanel.querySelector('.mc-ai-state')!.textContent = cleanReply(reply);
    // A safe start of the reply may already be on screen / being said: the
    // honest line then starts afresh and cuts it off.
    if (guarded.replaced && live.started()) liveSay().end(reply);
    else live.end(reply);
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
      const r = await runBreakTurn(text, attempt, { engine, devices: deviceRefs(), panel: engine ? panels.forEngine('nano') : rulesPanel, say: (t) => { const st = aiPanel.querySelector('.mc-ai-state'); if (st) st.textContent = t; say(t, { speak: true }); } });
      if (r.refused) bodyLanguage('no');
      if (r.refused && frameId) nextChips?.markDone(frameId, 'try-to-break');
    } finally {
      settleSwarm(); settleEngines(); autoHideAi();
      // A refusal is the check doing its job, not Nano being broken: the card
      // shows it for a few seconds and goes back to Ready (the terminal in
      // the drawer keeps the refusal line).
      engineBar?.calm('nano');
    }
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
    const focusedPlanEl = focusId ? world.querySelector<HTMLElement & { planState?: () => { doc: unknown } | null }>(`[data-frame="${focusId}"] mc-plan-board`) : null;
    return {
      hasPlanBoard: !!planBoard?.runExtra,
      planFocused: !!focusedPlanEl,
      planRooms: focusedPlanEl ? planRooms((focusedPlanEl.planState?.()?.doc ?? { rooms: [], walls: [] }) as PlanDoc).map((r) => r.name) : [],
      planBoardExists: !!world.querySelector('mc-plan-board'),
      devices: deviceRefs(), pointed: resolvePointedDevice(handPointer?.target ?? null, deviceRefs()),
      pack, sim: !!opts.sim, spotifyConnected: !!loadTokens(),
    };
  }
  /** "scroll / page up / down": the open review's plan, else an open sheet or
   *  drawer, else the focused board's own scroller, else the canvas. */
  function scrollByVoice(dir: 'up' | 'down', page: boolean): void {
    const sign = dir === 'down' ? 1 : -1;
    const overflows = (el: Element | null): el is HTMLElement => {
      if (!el || (el as HTMLElement).closest('[hidden]')) return false;
      const h = el as HTMLElement;
      const cs = getComputedStyle(h);
      return h.scrollHeight - h.clientHeight > 4 && /auto|scroll|overlay/.test(cs.overflowY) && h.getBoundingClientRect().height > 0;
    };
    const firstScroller = (scope: Element | null): HTMLElement | null => {
      if (!scope || (scope as HTMLElement).closest('[hidden]')) return null;
      if (overflows(scope)) return scope as HTMLElement;
      return Array.from(scope.querySelectorAll('*')).find(overflows) as HTMLElement | undefined ?? null;
    };
    const scopes = [
      root.querySelector('.mc-review-dialog:not([hidden])'),
      root.querySelector('.mc-menu-sheet:not([hidden])'),
      root.querySelector('.mc-ai:not([hidden])'),
      focusId ? world.querySelector(`[data-frame="${focusId}"]`) : null,
    ];
    for (const scope of scopes) {
      const el = firstScroller(scope);
      if (!el) continue;
      const amount = page ? el.clientHeight * 0.85 : 120;
      if (typeof el.scrollBy === 'function') el.scrollBy({ top: sign * amount, behavior: reduced ? 'auto' : 'smooth' });
      else el.scrollTop += sign * amount;
      return;
    }
    // Nothing scrolls: move the canvas (scroll down = see what is below).
    const amount = page ? vp().h * 0.85 : 120;
    const was = camera.y;
    camera = clampRoomPan(panBy(camera, 0, -sign * amount));
    // A tall room board already at that end: say so (nothing moved).
    if (Math.abs(camera.y - was) < 0.5 && tallRoomEl()) { say(dir === 'down' ? "That's the end of the board." : "That's the top of the board."); return; }
    applyCamera(); persist();
  }
  function run(text: string): boolean {
    // New input: whatever was still being read aloud stops now.
    speaker.stop();
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
      case 'voice': changeVoice(r.intent); return true;
      case 'showAi': showAi(true, true); return true;
      case 'monitor': openMonitor(); return true;
      case 'activityTab': openActivity(); return true;
      case 'hideAi': aiHold.clear(); showAi(false, true); say('AI activity hidden. It opens on a failure, from the engine bar, or say “show ai”.'); return true;
      case 'tool': {
        const press = (cmd: string) => root.querySelector<HTMLElement>(`[data-cmd="${cmd}"]`)?.click();
        const handsOn = root.querySelector('[data-cmd=hands]')?.getAttribute('aria-pressed') === 'true';
        switch (r.tool) {
          case 'handsOn': if (handsOn) say('Hands are already on.'); else press('hands'); break;
          case 'handsOff': if (!handsOn) say('Hands are already off.'); else press('hands'); break;
          case 'dwell': press('dwell'); break;
          case 'handsAlways': if (handsAlways) say('Hands are already always on.'); else setHandsAlways(true); break;
          case 'handsFollowFace': if (!handsAlways) say('Hands already follow your face.'); else setHandsAlways(false); break;
          case 'register': openScan(); break;
          case 'offline': if (!net.isOnline()) say('Already offline (simulated).'); else press('offline'); break;
          case 'online': if (net.isOnline()) say('Already online.'); else press('offline'); break;
          case 'swap': if (phoneShell || !(opts.sim || hostSession)) say('No phones are paired, so there are no sides to swap.'); else swapPhoneSides(); break;
        }
        return true;
      }
      case 'packIntent': return runIntent(r.intent);
      case 'scroll': scrollByVoice(r.dir, r.page); return true;
      // On the web there is no gimbal — handleSpeech answers with the honest why.
      case 'pointConnect': {
        const id = focusId ?? lastFocus;
        if (!id) { say('Open a board first, then point at the device.'); return true; }
        void pointTurn(id);
        return true;
      }
      case 'gimbalScan': void scanRoom(text); return true;
      case 'addGimbal': addGimbalTile({ voice: true }); return true;
      case 'gimbal': {
        const g = parseGimbalSpeech(text);
        // Follow me / follow my hands / hold still: one path for voice and
        // the gimbal tile (local plugin on the iPhone, relay from the laptop).
        // Nothing to drive (web, no iPhone paired): the controller's honest why.
        if ((g === 'face' || g === 'hands' || g === 'hold') && (getGimbalPlugin() || iphonePaired())) { gimbalMode(g); return true; }
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
        say(said, { speak: true });
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
            save(); newBoard(); say('Saved. New board ready; your dashboard stays pinned.', { speak: true }); break;
          }
        }
        return true;
      }
      // Device speech (works in any board — controls the docked dashboard mid-build).
      // "play <something>" on a speaker: a search, handled by the speaker connector
      // (Spotify when connected, honest built-in fallback otherwise).
      case 'musicSearch':
        void actQueue.act({ deviceId: r.deviceId, playing: true, query: r.query });
        say(`Looking for ${r.query}…`);
        if (ranOn) nextChips?.markDone(ranOn, 'play-music');
        return true;
      case 'device': {
        const dc = r.result;
        // An impossible level is refused by validation, never clamped.
        const attempt = impossibleAttempt(text, deviceRefs());
        if (attempt) { void breakTurn(text, attempt, ranOn); return true; }
        const acts: Promise<DeviceState>[] = [];
        for (const i of dc.intents) {
          // Same per-device lane as a tile press: a spoken "off" drops a chip
          // still waiting and runs in order behind what is already out.
          const acted = actQueue.act(i);
          acts.push(acted);
          // "play music": once the player has really started, say what is
          // playing and where — not just "Playing."
          if (i.playing === true && pack?.lang !== 'kn') {
            void acted.then((s) => { if (s.playing && !s.error) say(`${opts.sim ? 'SIM · ' : ''}${playingLine(musicWhere, s.trackTitle)}`, { speak: true }); }).catch(() => undefined);
          }
        }
        revealDeviceTiles(dc.intents.map((i) => i.deviceId));
        // The status line waits for the lane: it is said only once the
        // commands were really answered, and a refusal is said in its place
        // ("The lamp is off — turn it on first." — never "Dimmed …").
        // With a Kannada pack on, the device-command status line is Kannada too.
        const okLine = pack?.lang === 'kn' && dc.statusKey ? statusText(dc.statusKey, pack) : dc.say;
        const saysWhere = pack?.lang !== 'kn' && dc.intents.some((i) => i.playing === true);
        void Promise.allSettled(acts).then((results) => {
          const line = spokenStatus(results, okLine);
          // "play music" that worked already said what plays and where (above).
          if (line === okLine && saysWhere) return;
          say(line, { speak: true });
        });
        if (ranOn && dc.intents.some((i) => i.playing === true)) nextChips?.markDone(ranOn, 'play-music');
        return true;
      }
      case 'connectDevices': {
        // Phones first, on the Connected devices board; the dashboard review
        // waits for "build the dashboard" (its own board).
        const target = ensureDevicesBoard();
        pairFrame = target;
        void pairFirst.begin({ dashboard: r.dashboard }); return true;
      }
      case 'connectRoom': {
        // The dashboard is its own board: never the devices list or the floor plan.
        const target = dashboardTarget(focusId);
        if (focusId !== target) { sync(); void focus(target); }
        void connectRoom(target, text); return true;
      }
      // "floor plan for Mrs Sharma's flat" / "a floor plan" / "floorplan" —
      // route to the Nano floor-plan turn with the full utterance so any name
      // in it (e.g. Sharma) gets redacted by the stayed-local strip.
      case 'floorPlan': openFloorPlan(focusId, text); return true;
      // "add a study next to bedroom 2": a reviewed edit to the plan on the board.
      case 'planEdit': void planEditTurn(text); return true;
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
    ({ everything: () => void overview(), new: newBoard, save, undo: userUndo, ai: () => { showAi(true, true); aiPanel.querySelector<HTMLElement>('.mc-ai-body')?.scrollTo?.({ top: 0 }); }, monitor: openMonitor, activity: openActivity, offline: () => setOnline(!net.isOnline(), true), hands: () => void toggleHands(), handsalways: () => setHandsAlways(!handsAlways), dwell: () => { setDwellClick(!dwellClickOn); say(dwellClickOn ? 'Hover to click on: rest your palm on a button to press it.' : 'Hover to click off: tap a fist to click.'); }, register: openScan, reregister: openScan, teach: openTeach, gestures: openTeachList, voice: () => voiceSheet.open(), swap: swapPhoneSides, readAloud: () => setReadAloud(!readAloud) } as Record<string, () => void>)[b.dataset.cmd!]?.();
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
    const boardAct = t.closest<HTMLElement>('[data-frame-act]')?.dataset.frameAct;
    if (boardAct && frame) {
      if (boardAct === 'close') closeBoard(frame);
      else resizeBoard(frame, boardAct === 'bigger' ? 1 : -1);
      return;
    }
    if (act && frame) {
      if (act.dataset.act === 'connect') void connectRoom(frame);
      else if (act.dataset.act === 'talk') micFab?.toggle();
      else if (act.dataset.act === 'floorplan') openFloorPlan(frame);
      return;
    }
    if (phoneLocked()) return;
    if (phoneShell && focusId && frame === focusId) {
      const tile = t.closest<HTMLElement>('[data-mc-tile], .mc-edit-item');
      if (tile) { selectPhoneTile(tile); return; }
    }
    if (frame && frame !== focusId && !dragged && !t.closest<HTMLElement>('.mc-frame-title')?.dataset.dragged) void focus(frame);
  });
  let drag: { x: number; y: number } | null = null; let dragged = false; let dragYOnly = false;
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
    if (focusId && (e.target as HTMLElement).closest('.mc-frame.focused')) {
      // A room dashboard taller than the screen is reached by moving the
      // canvas: a touch drag anywhere on it, or a mouse drag on its
      // background (never on a control), pans. Other boards keep the drag.
      const onRoom = !!(e.target as HTMLElement).closest('.mc-frame[data-kind="room"]') && !editBoard.editing;
      const first = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
      const onControl = !!first?.closest?.('button, a, input, select, textarea, summary, [role=button], [role=tab], [data-mc-drag-handle], [data-mc-resize-handle]');
      if (!onRoom || (e.pointerType !== 'touch' && onControl)) return;
      // On a phone the dashboard is one column: the canvas only moves up and down.
      dragYOnly = phoneShell;
    } else dragYOnly = false;
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
    dragged = true; camera = panBy(camera, dragYOnly ? 0 : dx, dy); drag = { x: e.clientX, y: e.clientY };
    if (dragYOnly) clampPhoneScroll();
    applyCamera();
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
  // A focused board is re-fitted at its SHOWN size (a room board is widened
  // or narrowed for the window), not its stored one.
  const onWindowResize = () => { if (phoneShell) { fitPhone(); return; } syncClusterInset(); if (!pairedRow.hidden) dockPairedRow(); if (focusId) { const f = reg.get(focusId); if (f) { camera = focusCam(fitBoardWidth(f)); applyCamera(); } } else { root.style.setProperty('--mc-bar-h', `${barH()}px`); } };
  // Opening Tools, a status line, or a wrap at 1280px changes the bar's height
  // without a window resize — keep --mc-bar-h in sync so the dock, AI panel,
  // and review padding don't slide under the bar.
  const barEl = root.querySelector<HTMLElement>('.mc-bar');
  const barRo = typeof ResizeObserver !== 'undefined' && barEl
    ? new ResizeObserver(() => { root.style.setProperty('--mc-bar-h', `${barH()}px`); })
    : null;
  if (barEl && barRo) barRo.observe(barEl);
  // The engine bar settling (its states, a docked phones row) moves the
  // bottom limit: re-pin the focused board's chip row above it.
  const engineRo = typeof ResizeObserver !== 'undefined' && engineBar ? new ResizeObserver(() => keepChipsVisible()) : null;
  if (engineRo && engineBar) engineRo.observe(engineBar.el);
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
  // Leaving the page: the short code must not outlive the pairing (best effort).
  const onPageHide = (): void => { if (admissionOpen) { admissionOpen = false; void hostSession?.endAdmission().catch(() => undefined); } };
  addEventListener('pagehide', onPageHide);
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
    offNanoBusy();
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
    removeEventListener('pagehide', onPageHide);
    barRo?.disconnect();
    engineRo?.disconnect();
    chipRowRo?.disconnect();
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
    // The plan renderer owns the wheel on a focused plan board. A room
    // dashboard has no scroll of its own: the wheel moves the canvas.
    if (focusId && target.closest('.mc-frame.focused') && !target.closest('.mc-frame[data-kind="room"]')) return;
    const intent = wheelIntent(e);
    if (intent.kind === 'pan') {
      if (canScrollInside(target, intent.dx, intent.dy)) return;
      e.preventDefault();
      cancelAnimationFrame(flight); zoomGoal = null;
      camera = clampRoomPan(panBy(camera, -intent.dx, -intent.dy));
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
  // Hand-reachable cluster on the right edge: Register, Tools, Talk, Read
  // aloud, Undo, Edit.
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
    // A small, always-visible Undo beside Tools / Talk (its left thumbs-down
    // badge is always on screen); same data-cmd as the bar's Undo.
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'mc-cluster-undo';
    undoBtn.dataset.cmd = 'undo';
    undoBtn.textContent = 'Undo';
    undoBtn.dataset.i18n = 'undo';
    const readBtn = root.querySelector('.mc-read-aloud');
    // One column, in this order (Reset joins Edit while editing).
    for (const node of [registerBtn, toolsChip, talk, readBtn, undoBtn, editBtn, resetBtn]) {
      if (node) cluster.append(node);
    }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => syncClusterInset()).observe(cluster);
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
  const PLAN_TOO_BIG = 'This plan is too big to show on the phone — it shows the starting layout.';
  function showRemoteBoard(plan: SurfacePlan, boardDrawings?: unknown, info: { drawingsOmitted?: number } = {}): void {
    let id = focusId ?? lastFocus ?? reg.list()[0]?.id;
    if (!id) {
      const f = reg.add('note', plan.title || 'Board');
      id = f.id;
    } else if (plan.title) {
      reg.rename(id, plan.title);
    }
    surfaces[id] = plan;
    // The drawing the laptop has now replaces whatever this phone had for
    // these plan tiles (re-checked here: never trust the snapshot). A board
    // sent without one shows its template, not a stale copy.
    if (boardDrawings !== undefined || planBoardIds(plan).length) {
      const { drawings: incoming } = coerceBoardDrawings(boardDrawings ?? {}, plan);
      if (Object.keys(incoming).length) drawings[id] = incoming;
      else delete drawings[id];
      for (const bid of planBoardIds(plan)) setSavedPlanDoc(id, bid, incoming[bid] ?? null);
    }
    focusId = id;
    lastFocus = id;
    // A phone with no board yet: the new frame's DOM must exist before the
    // surface mounts into it (else the board stays blank and the next send
    // throws "surface already exists").
    if (!world.querySelector(`[data-frame="${id}"] .mc-surface`)) sync();
    renderSurface(id);
    // The laptop's drawing did not fit the relay: say so — the board shows
    // its starting layout, never passed off as her plan.
    if ((info.drawingsOmitted ?? 0) > 0 && planBoardIds(plan).length) {
      const frameId = id;
      waitForLayout(() => {
        for (const st of world.querySelectorAll<HTMLElement>(`[data-frame="${frameId}"] mc-plan-board .mc-plan-extra-status`)) st.textContent = PLAN_TOO_BIG;
      });
      say(PLAN_TOO_BIG);
    }
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
    const simAdapter = createCanvasHandsAdapter((ev) => inputs.handEvent(ev));
    (window as unknown as { __mcGestures?: unknown }).__mcGestures = {
      show: (on: boolean) => gestures.setActive(on),
      feed: (hands: readonly (readonly { x: number; y: number }[])[], now: number, facing: boolean | null = true) =>
        gestures.frame(hands, now, { facing, faceX: 0.5, blocked: gesturesBlocked() }),
      hand: syntheticHand,
      shapes: () => gestures.lastShapes(),
      highlighted: () => palmHighlight?.current() ?? null,
      /** A presence frame through the REAL camera path: the canvasHands
       *  adapter → canvasInputs → onHandFrame (shape read, pointer, gestures).
       *  `hands` may be empty — exactly what the camera sends when hands leave. */
      presence: (hands: readonly (readonly { x: number; y: number }[])[], now: number) => {
        simAdapter.update({ hands: hands.map((h) => ({ points: h, label: (h as { label?: string }).label })) as never, now });
      },
      /** The operator hand gate as presence would set it (false = not facing). */
      facing: (v: boolean | null, now?: number) => { handRouter.setFacing(v, now); },
      /** A presence frame's face part through the REAL facing gate (what the
       *  camera sends, on the replay's clock): `faces: []` = no face seen =
       *  not facing. */
      presenceFaces: (faces: PresenceFrame['faces'], now: number) => { handRouter.presence({ faces }, now); },
      /** The one gate's view: locked (not facing or still settling). */
      handsLocked: () => handRouter.locked(),
      /** For assertions: camera, any grab running, debug state. */
      state: () => ({ camera: { ...camera }, grab: !!handPointer?.isGrabActive(), ...gestures.debug() }),
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
            if (!eng.sim && eng.id === 'gemini') openCloudTurn(si, prompt);
            else recordSent(si, eng.id === 'nano' ? '' : prompt);
            fixSent = si;
            try { return await eng.stream(prompt, () => {}, { shape: 'json', onCloudSend: () => cloudSent(si), onCloudRetract: () => cloudRetract(si) }); } catch (e) {
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
                onKeep: () => { reviewDialog.close(); done(true); bodyLanguage('yes'); },
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
  const morphSwarmPlan = (tileIndex: number): SwarmPlanInput => ({
    calls: [{ kind: 'gemini', label: 'Gemini · tile edit' }],
    subSteps: [{ kind: 'gemini', label: 'Gemini · revise tile', tileIndex }],
  });
  function applyMorph(frameId: string, patched: SurfacePlan, summary: string, path?: number[]): boolean {
    const f = reg.get(frameId);
    if (!f) return false;
    const check = gateMessages(expandPlan(patched, frameId, store.all()), CATALOG_SCHEMAS);
    if (!check.ok) { say(`Blocked a tile that did not pass the check: ${check.errors[0]}`, { speak: true }); return false; }
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
        onKeep: () => { reviewDialog.close(); const ok = applyMorph(fid, patched, summary, path); done(ok); if (ok) bodyLanguage('yes'); },
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
      sent: (s, o) => aiSent(o.utterance, s, { swarmPlan: morphSwarmPlan(o.tileIndex), defer: true }),
      cloudSent,
      cloudRetract,
      log: (engine, verb, detail) => panels.forEngine(engine).log(verb, detail),
      handoff: (reason) => panels.showHandoff('nano', reason),
      settle: async () => { await finishSwarm(); autoHideAi(); },
      settleNow: () => { settleSwarm(); autoHideAi(); },
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
      devicesBoard: isDevicesFrame(focusId),
      lampLabel: deviceRefs().find((d) => d.kind === 'lamp')?.label,
      savedRoom: reg.list().some((f) => f.pinned && f.id !== focusId && surfaces[f.id]?.kind === 'room'),
    }),
    nano: async (prompt) => { const r = await pickNextStepsOnDevice(prompt); if (r == null) throw new Error('Nano not available'); return r; },
    onRender: keepChipsVisible,
    // Rules first: Nano reorders the chips only when she has been idle and no
    // turn (or any other on-device prompt) is using the model.
    // Never during a turn or its review, never while any model stream is
    // out, and not for 10 s after a turn ended.
    idle: { delayMs: NANO_PICK_IDLE_MS, ready: () => !turnBusy && !reviewBusy() && streamsOut === 0 && Date.now() - lastTurnEndedAt >= NEXT_PICK_COOLDOWN_MS && nanoQueue.idle() && document.visibilityState !== 'hidden' },
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
      const layout = edgeLayout();
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
  // Saved boards this build couldn't read: said once, plainly (they were
  // copied aside — canvasStore.ts — and are never written over).
  if (loaded.unreadable) setTimeout(() => say(UNREADABLE_LINE, { speak: true }), 0);
  return {
    /** How the saved doc loaded (e2e / support): unreadable → kept aside. */
    loadState: () => ({ unreadable: loaded.unreadable, safe: loaded.safe }),
    run, focus, overview, save, keep, drop, undo, store, snapshot, history: () => history.list(), frames: () => reg.list(), setTalkCaption, setTalkError, setFacing, setRouteBadge, showRemoteBoard, sharedBoards: () => boardEdge.sharedBoards(), replay, destroy,
    /** iPhone: the laptop asked for the point photo (relay 'sensePoint'). */
    pointForLaptop: () => { if (phoneSensor) void phoneSensorPoint('', true); else opts.sendPointResult?.(encodePointResult({ ok: false, reason: 'no-camera', message: POINT_NEEDS_LAPTOP })); },
    phoneSenseStatus,
    /** The background Nano warm-up started loading the model / finished. */
    nanoWarming,
    /** iPhone: the laptop relayed a gimbal cue ('gimbalCue'). Local only — never re-relayed. */
    gimbalCue: (kind: GimbalCueKind): void => { if (getGimbalPlugin()) bodyLanguage(kind); },
    /** iPhone: the laptop's gimbal tile asked for a mode ('gimbalMode'). The
     *  same handler as the spoken phrase; the re-announce reports the result. */
    gimbalMode: (mode: GimbalModeKind): void => { if (getGimbalPlugin()) gimbalMode(mode); },
    /** Phone shell: the guest session's attention (from the host's pong). */
    setRelayAttention: (src: { get(): { who: string; at: number } | null; probe(): void } | null) => { relayAttention = src; },
    onPhoneSenseChange: (cb: () => void) => { senseSubs.add(cb); return () => { senseSubs.delete(cb); }; },
  };
}
export type CanvasHandle = ReturnType<typeof mountCanvas>;
