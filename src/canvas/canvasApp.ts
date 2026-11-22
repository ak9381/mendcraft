// Smart canvas shell (sim-main): an infinite canvas of boards. Overview is for
// viewing and flying; Focus fits one board at exactly 1:1 for editing.
// Board contents are A2UI surfaces built from surface plans, gated, and
// (for anything a model proposes) held in a Proposal until kept.
import '@a2ui/lit/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { cameraTransform, fitRects, focusOnInsets, lerpCamera, panBy, zoomAbout, type Camera, type Viewport } from './camera';
import { CANVAS_DOC_VERSION, createFrameRegistry, parseCanvasDoc, type CanvasDoc, type Frame, type FrameRegistry } from './frames';
import { parseCanvasCommand, resolveFrame, saveShouldOpenNextBoard, saveShouldPin } from './canvasCommands';
import { expandPlan, tileComponentId, type A2uiMessage, type DeviceState, type SurfacePlan, type TileSpec } from './surfacePlan';
import { gateMessages } from './gate';
import { CATALOG_SCHEMAS } from './catalogApi';
import { createSurfaceProposal, type SurfaceProposal } from './proposalBuffer';
import { createCanvasHistory, parseModelPlan, parsePartialPlan, runSurfaceTurn, scriptedEngine, type DeviceHint, type EngineId, type PartialPlan, type SentInfo, type SurfaceEngine } from './aiTurn';
import { byName, connectAsk, foundAfterScan, mergeTiles, pointConnect, roomScan, type ConnectTurnResult } from './connectTurns';
import { mountConnectSheet, showPairing, type ConnectSheet, type PairingView } from './connectSheet';
import { startPhoneJoin } from './phoneJoin';
import { dispatchRelayCommand } from './relayCommands';
import { createCanvasInputs } from './canvasInputs';
import { followWhileBuilding, parseGimbalSpeech } from './gimbalCanvas';
import { renderProposalCard, type ProposalStatus } from '../ux/proposal';
import { createDeviceStore, type DeviceConnector } from './deviceActions';
import { createDeviceSurfaceIndex } from './deviceSurfaceIndex';
import { createWizAwareConnector, isWizDevice, type BridgeStatus } from './wizDevices';
import { createWizClient, resolveWizToken, type WizClient } from '../devices/wizClient';
import { esc } from '../core/esc';
import {
  CardTileElement, ChartTileElement, ConnectTileElement, FormTileElement, GridTileElement,
  LampTileElement, MusicTileElement, PlanBoardElement, RowTileElement, SceneTileElement,
  SplitTileElement, StatTileElement, SwitchTileElement, TableTileElement, TabsTileElement,
  VisualTileElement, smartCanvasCatalog,
} from './widgets';
import { parseDeviceCommands, type DeviceKind, type DeviceRef } from './deviceCommands';
import { initialDoc } from './firstOpen';
import { buildEnergyShowcaseDoc } from './showcaseFixture';
import { createConnectivity } from './connectivity';
import { EN_PACK, SCRIPTED_KN_PACK, coerceLanguagePack, routePackPhrase, statusText, type IntentKey, type LangStringKey, type LanguagePack, type StatusKey } from './languagePack';
import { createCanvasLedger } from './ledger';
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
import { activePeople, protectTurn } from '../privacy/directory';
import { createDeviceIdSession } from '../privacy/deviceRedact';
import { attachPrivacyHub } from '../relay/privacyHub';
import { mountPhoneMenu } from './phoneMenu';
import { createHandPointer, type HandPointer } from './handPointer';
import { createToggleLatch } from './handFeel';
import { mountMicFab, type MicFab } from './micFab';
import { matchPaletteCommand, mountToolPalette } from './toolPalette';
import { cloudReceivedDetail, logTurnReceipt, MODEL_PANELS_HTML, mountModelPanels } from './modelPanels';
import { mountDraggablePanel } from './dragPanel';
import { mountEditBoard, topLevelOf, type EditEl, type EditItemRef } from './editBoard';
import { mountReviewDialog } from './reviewDialog';
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

  root.classList.add('mc-canvas');
  root.innerHTML = `
    <div class="mc-viewport" tabindex="-1"><div class="mc-world"></div><div class="mc-swarm" hidden></div></div>
    <div class="mc-blank" hidden>
      <p class="mc-blank-lead">Let's build something fun.</p>
      <p class="mc-blank-hint">Say &ldquo;show tools&rdquo;, or open your palm.</p>
      <button type="button" class="mc-btn mc-blank-register" data-cmd="register">Register</button>
    </div>
    <header class="mc-bar">
      <div class="mc-bar-tools">
      <div class="mc-bar-btns">
      <button data-cmd="everything" class="mc-btn" data-i18n="showEverything">Show everything</button>
      <button data-cmd="new" class="mc-btn" data-i18n="newBoard">New board</button>
      <button data-cmd="save" class="mc-btn" data-i18n="save">Save</button>
      <button data-cmd="undo" class="mc-btn" data-i18n="undo">Undo</button>
      <button data-cmd="hands" class="mc-btn" aria-pressed="false" data-i18n="hands">Hands</button>
      <button data-cmd="reregister" class="mc-btn">Re-register</button>
      <button data-cmd="teach" class="mc-btn">Teach a gesture</button>
      <button data-cmd="gestures" class="mc-btn">Custom gestures</button>
      <button data-cmd="ai" class="mc-btn" aria-expanded="false" data-i18n="ai">AI activity</button>
      <button data-cmd="offline" class="mc-btn" aria-pressed="false" data-i18n="simulateOffline">Simulate offline</button>
      </div>
      <form class="mc-say"><label class="mc-sr" for="mc-say-in">Say or type a command</label>
        <input id="mc-say-in" autocomplete="off" data-i18n="sayPlaceholder" placeholder="Say: new board · show everything · go to floor plan" />
        <button class="mc-btn primary" type="submit" data-i18n="go">Go</button></form>
      </div>
      <p class="mc-canvas-status" role="status" aria-live="polite"></p>
    </header>
    <aside class="mc-dock" aria-label="Pinned board" hidden>
      <div class="mc-dock-head"><span class="mc-dock-title"></span>
        <button class="mc-btn mc-dock-unpin" type="button">Unpin</button></div>
      <div class="mc-dock-surface"></div>
    </aside>
    <aside class="mc-ai" aria-label="AI activity" hidden>
      <div class="mc-ai-body">
        <h2 class="mc-ai-h">AI activity</h2>
        <p class="mc-ai-empty">When Nano or Gemini works on a board, you see the prompt going in, what left this device, and the reply as it streams.</p>
        ${MODEL_PANELS_HTML}
        <h3 class="mc-ai-h3">History</h3><p class="mc-ai-ledger-total"></p><ol class="mc-ai-history" tabindex="-1"></ol>
      </div>
      <div class="mc-ai-pending">
        <p class="mc-ai-state" aria-live="polite"></p>
      </div>
    </aside>`;
  // Every Proposal that needs a decision opens in the full-screen review
  // dialog (below) — desktop and phone alike, replacing any per-frame or
  // phone-sheet host this canvas used to need.
  const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 600px)').matches;
  const viewport = root.querySelector<HTMLElement>('.mc-viewport')!;
  const world = root.querySelector<HTMLElement>('.mc-world')!;
  const swarmEl = root.querySelector<HTMLElement>('.mc-swarm')!;
  const swarm: SwarmLayer = createSwarmLayer(swarmEl, {
    reducedMotion: reduced,
    onReachTarget: (tileIndex, kind) => flashGhostTarget(tileIndex, kind),
  });
  const blankEl = root.querySelector<HTMLElement>('.mc-blank')!;
  const statusEl = root.querySelector<HTMLElement>('.mc-canvas-status')!;
  const aiPanel = root.querySelector<HTMLElement>('.mc-ai')!;
  const panels = mountModelPanels(aiPanel);
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
  });
  // Nano/Gemini terminals: pinch-hold the title bar (or mouse/touch-drag it)
  // to float the terminal anywhere on screen; the reset button puts it back
  // in its column slot. Position persists in sessionStorage per engine.
  (['nano', 'gemini'] as const).forEach((engine) => {
    const panel = aiPanel.querySelector<HTMLElement>(`.mc-terminal-${engine}`)!;
    const handle = panel.querySelector<HTMLElement>('.mc-term-drag')!;
    const resetBtn = aiPanel.querySelector<HTMLElement>(`.mc-term-reset-pos[data-engine="${engine}"]`)!;
    const drag = mountDraggablePanel(panel, handle, { id: engine }, () => {
      const spacer = document.createElement('div');
      spacer.className = 'mc-terminal-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      return spacer;
    });
    resetBtn.addEventListener('click', () => drag.resetPosition());
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
  const say = (t: string) => { statusEl.textContent = t; };
  // The floating mic is mounted later; "ask for something else" starts it.
  let micFabRef: MicFab | null = null;
  const reviewDialog = mountReviewDialog(root, {
    onAskElse: () => {
      if (voice?.supported) micFabRef?.toggle();
      else root.querySelector<HTMLInputElement>('#mc-say-in')?.focus();
      say('What would you like instead?');
    },
  });

  const teachPanel = mountTeachPanel(root, {
    devices: () => deviceRefs(),
    sim: opts.sim,
    say,
    openReview: (title, card) => reviewDialog.open({ title, card }),
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
  const defaultConnector = wizClient
    ? createWizAwareConnector({ client: wizClient, fallback: simulatedConnector, status: bridgeStatus })
    : simulatedConnector;
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
    (s as { onAction: { subscribe(f: (a: WidgetAction) => void): void } }).onAction.subscribe((a) => {
      if (a.name === 'connect.start') { openConnectSheet(sid); return; }
      // New general-purpose widgets: wired through the same onAction bus as
      // every device tile, but their payload has no deviceId — the live
      // (Lit) path carries per-click specifics in `metadata` (the A2UI
      // controller's calling convention for dynamic action data), the
      // fallback (plain-DOM) path puts the same thing straight in `context`.
      if (a.name === 'table.rowAction') {
        const row = (a.context?.row ?? a.metadata?.row) as string[] | undefined;
        say(row ? `Opened ${row[0]}.` : 'Opened row.');
        return;
      }
      if (a.name === 'form.submit') {
        say('Form submitted.');
        return;
      }
      if (a.name === 'visual.action') {
        const label = (a.context?.label ?? a.metadata?.label) as string | undefined;
        const action = (a.context?.action ?? a.metadata?.action) as string | undefined;
        say(label ? `${label}.` : action ? `${action}.` : 'Activated.');
        return;
      }
      const id = a.context?.deviceId as string | undefined; const cur = id ? store.get(id) : undefined;
      if (!cur || !id) return;
      if (a.name === 'lamp.toggle' || a.name === 'switch.toggle') void store.act({ deviceId: id, on: !cur.on });
      if (a.name === 'lamp.brighter') void store.act({ deviceId: id, on: true, brightness: cur.brightness + 20 });
      if (a.name === 'lamp.dimmer') void store.act({ deviceId: id, brightness: cur.brightness - 20 });
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
      ...expandPlan(plan, id, store.all()),
    ];
    const g = gateMessages(msgs, CATALOG_SCHEMAS);
    if (!g.ok) { say(`Blocked a board that did not pass the check: ${g.errors[0]}`); return false; }
    live.delete(id);
    processor.processMessages(g.messages as never);
    deviceSurfaces.track(id, plan);
    return true;
  }

  // ---- pinned-board dock: a second A2UI surface fed by the same device store ----
  // Control tiles only (lamp / music / switch / scene) — never plan or connect.
  const isDockTile = (t: SurfacePlan['tiles'][number]) =>
    t.type === 'lamp' || t.type === 'music' || t.type === 'switch' || t.type === 'scene';
  const DOCK_GAP = 24;
  const dockInset = () => (dockEl.hidden ? 0 : (dockEl.offsetWidth || 300) + DOCK_GAP);
  const insets = () => ({ top: barH(), left: dockInset(), right: 0 });

  function clearDock(): void {
    for (const sid of [...live]) if (sid.endsWith('-dock')) { live.delete(sid); deviceSurfaces.untrack(sid); }
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
      ...expandPlan(dockPlan, sid, store.all()),
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
      Object.assign(el.style, { left: `${f.rect.x}px`, top: `${f.rect.y}px`, width: `${f.rect.w}px`, height: `${f.rect.h}px` });
      el.querySelector('.mc-frame-title')!.textContent = f.title;
      el.querySelector('.mc-chip')!.textContent = f.pinned ? `${labelFor(f)} · pinned` : labelFor(f);
      const focused = focusId === f.id;
      el.classList.toggle('focused', focused);
      el.classList.toggle('dim', focusId !== null && !focused);
      const body = el.querySelector<HTMLElement>('.mc-frame-body')!;
      body.inert = !focused; // overview is view-only: the plan engine hit-tests in unscaled pixels
      el.setAttribute('aria-label', `${f.title} board${focused ? ', editing' : ''}`);
      const empty = el.querySelector<HTMLElement>('.mc-empty')!;
      empty.hidden = !!surfaces[f.id];
      if (!surfaces[f.id] && !empty.childElementCount) {
        empty.innerHTML = `<p class="mc-empty-lead" data-i18n="emptyLead">Empty board.</p><p>Say “connect everything in this room”, or start with:</p>
          <div class="mc-row"><button class="mc-btn primary" data-act="connect" data-i18n="emptyConnect">Connect this room</button><button class="mc-btn" data-act="floorplan" data-i18n="emptyFloorplan">Floor plan</button></div>`;
      }
    }
    root.dataset.mode = focusId ? 'focus' : 'overview';
    applyStrings();
    applyCamera();
    editBoard.setFocus(focusId, !!focusId && !!surfaces[focusId]?.tiles.length);
  }

  const labelFor = (f: Frame) => (surfaces[f.id]?.kind === 'plan' || f.kind === 'plan' ? 'Floor plan' : surfaces[f.id] ? 'Room dashboard' : 'Empty');

  function applyCamera(): void {
    root.style.setProperty('--mc-bar-h', `${barH()}px`);
    world.style.transform = cameraTransform(camera);
    const g = 40 * camera.z;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${-camera.x * camera.z}px ${-camera.y * camera.z}px`;
    root.dataset.zoom = camera.z.toFixed(2);
  }

  const vp = (): Viewport => ({ w: (viewport.clientWidth || innerWidth) - (aiPanel.hidden ? 0 : aiPanel.offsetWidth + 24), h: viewport.clientHeight || innerHeight });
  const barH = () => (root.querySelector<HTMLElement>('.mc-bar')!.offsetHeight + 32);

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
  async function focus(id: string): Promise<void> {
    const f = reg.get(id); if (!f) return;
    focusId = id; lastFocus = id; sync(); updateDock();
    await flyTo(focusOnInsets(f.rect, vp(), insets()));
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
      void flyTo(focusOnInsets(next.rect, vp(), insets()));
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
  const engineFor = (id: EngineId, json: string): SurfaceEngine => opts.engines?.[id]?.(json) ?? scriptedEngine(id, json);
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

  // The panel opens for each AI turn and tucks itself away ~2 s after the
  // last keep / drop, so the board gets its full width back (unless she opened it).
  let aiManual = false; let aiHideTimer = 0;
  const autoHideAi = () => { clearTimeout(aiHideTimer); aiHideTimer = window.setTimeout(() => { if (!aiManual && !pending && !reviewDialog.isOpen()) showAi(false); }, 2000); };
  function showAi(on = true): void {
    clearTimeout(aiHideTimer);
    const changed = aiPanel.hidden === on;
    aiPanel.hidden = !on;
    root.querySelector('[data-cmd=ai]')!.setAttribute('aria-expanded', String(on));
    if (changed && focusId) { const f = reg.get(focusId); if (f) void flyTo(focusOnInsets(f.rect, vp(), insets())); }
  }
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
  function aiSent(utterance: string, s: SentInfo, ctx: { task?: SwarmTask; tileCount?: number; swarmPlan?: SwarmPlanInput } = {}): void {
    showAi(true);
    aiPanel.querySelector<HTMLElement>('.mc-ai-empty')!.hidden = true;
    panels.show();
    aiPanel.dataset.engine = s.engine;
    // Byte ledger: every AI turn records what actually left the device. Scan
    // the spoken utterance too — not just the canned schema prompt — so a
    // name said aloud (e.g. "floor plan for Mrs Sharma's flat") still shows
    // up redacted even when 0 bytes were sent.
    const protect = protectTurn(utterance, s.prompt);
    ledger.record({ engine: s.engine, sentText: s.sent ? protect.promptText : '' });
    ledgerTotalRender();
    panels.setFooterBytes(ledger.totals().totalBytes);
    // The privacy order invariant: Nano logs `received` + any `redact` lines
    // before a byte of this turn reaches the Gemini terminal.
    logTurnReceipt(panels, {
      engine: s.engine, utterance, used: protect.used, people: activePeople(), cloudPayload: protect.promptText,
    });
    if (s.routeLine) panels.forEngine(s.engine).log('note', s.routeLine);
    // Swarm cursors spin up for this real call — a mix of Gemini (planning,
    // layout, tile frames) and Nano (labels, device values, redaction/Kannada
    // swaps) sub-steps, honestly capped at REAL_CALL_CAP real calls.
    swarmStartedAt = Date.now();
    const plan = ctx.swarmPlan ?? buildMixedSwarmPlan(s.engine, ctx.task ?? 'generic', {
      tileCount: ctx.tileCount,
      redactedName: protect.used.length > 0,
    });
    swarm.start(plan, opts.sim ? 1 : Date.now());
    swarm.reportBytes(ledger.totals().totalBytes);
    swarmDock.start(buildSwarmAgents(plan), {
      reducedMotion: reduced,
      payloads: s.engine === 'gemini' ? { gemini: cloudReceivedDetail(protect.promptText, activePeople()) } : {},
    });
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
    revealGhostTile(tileEl, kind === 'gemini' ? 'controls' : 'labels');
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
  function ledgerTotalRender(): void {
    const t = ledger.totals();
    aiPanel.querySelector('.mc-ai-ledger-total')!.textContent =
      `This session: ${t.count} AI turn${t.count === 1 ? '' : 's'} · ${ledger.formatLine()}`;
  }
  function historyRender(): void {
    ledgerTotalRender();
    const entries = history.list();
    let lastActive = -1;
    for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].undone) { lastActive = i; break; }
    aiPanel.querySelector('.mc-ai-history')!.innerHTML = entries.map((h, i) => {
      const who = h.by === 'gemini' ? 'Deep' : h.by === 'nano' ? 'Quick' : 'You';
      const time = new Date(h.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const undoBtn = i === lastActive ? ` <button class="mc-btn mc-hist-undo" type="button" data-hist-undo>Undo</button>` : '';
      return `<li class="${h.undone ? 'undone' : ''}">${esc(h.summary)} · <span class="who">${who} · ${esc(time)}</span>${h.undone ? ' · undone' : ''}${undoBtn}</li>`;
    }).reverse().join('');
  }
  function openHistory(): void {
    showAi(true);
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

  async function aiTurn(frameId: string, engineId: EngineId, utterance: string, script: string, summary: string, status: ProposalStatus, task: SwarmTask = 'dashboard'): Promise<boolean> {
    const f = reg.get(frameId); if (!f) return false;
    const engine = engineFor(engineId, script.replace('BOARD', frameId));
    let sentInfo: SentInfo | null = null;
    const plan = await withBuildGimbal(() => runSurfaceTurn({ utterance, frameTitle: f.title, devices: deviceHints(), current: surfaces[frameId] ?? null }, engine, {
      onSent: (s) => { sentInfo = s; aiSent(utterance, s, { task, tileCount: surfaces[frameId]?.tiles.length }); },
      onGhost: (g) => ghost(frameId, g),
      onError: (why) => {
        settleSwarm();
        panels.forEngine(engineId).fail(why);
        aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why);
      },
    }, { deviceIdSession, isCancelled: () => engineId === 'gemini' && !net.isOnline() }));
    if (!plan || !sentInfo) { settleSwarm(); ghost(frameId, null); return false; }
    return proposePlan(frameId, utterance, plan, sentInfo, summary, status);
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
      reviewDialog.open({ title: summary, card, extra: buildReviewExtra() });
      say(`${summary}. Pinch or say “keep”; brush or say “drop”.`);
    });
  }

  async function connectRoom(frameId: string, utterance = 'connect everything in this room'): Promise<void> {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const kept = await aiTurn(frameId, 'nano', utterance, SCRIPTS.nanoRoom, 'Draft: 2 lamps found in this room', 'guess');
    if (!kept) return;
    if (!net.isOnline()) { // offline: Deep can't improve it; keep the on-device draft
      panels.forEngine('nano').log('note', ROUTE_LINES.offline);
      aiPanel.querySelector('.mc-ai-state')!.textContent = OFFLINE_QUICK_ONLY;
      say(`${OFFLINE_QUICK_ONLY}. Deep will improve it when you're back online.`);
      return;
    }
    panels.showHandoff('nano', 'group the lights and add a room plan');
    await aiTurn(frameId, 'gemini', utterance, SCRIPTS.geminiRoom, 'Better: grouped lights + a room plan', 'changed');
  }
  function floorPlan(frameId: string, utterance = 'start a floor plan'): void {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    void aiTurn(frameId, 'nano', utterance, SCRIPTS.nanoPlan, 'Floor plan: two bedrooms', 'waiting', 'floorplan');
  }

  // ---- connect a device: sheet (point / name / phone) + merge-on-keep turns ----
  const simEnv = () => engineFor('gemini', '{}').sim;

  /** A connect AI turn (point / by-name / scan): visible receipt and ghost, then
   *  a Proposal whose keep MERGES the tiles into the board (no dupes, ≤ MAX_TILES). */
  async function connectTurn(frameId: string, utterance: string, turn: ConnectTurnResult, summary: string, status: ProposalStatus, o: { photoNote?: boolean } = {}): Promise<boolean> {
    const f = reg.get(frameId); if (!f) return false;
    const engine = engineFor(turn.sent.engine, turn.json);
    if (engine.routeLine) turn.sent.routeLine = engine.sim ? (engine.routeLine.startsWith('SIM') ? engine.routeLine : `SIM · ${engine.routeLine}`) : engine.routeLine;
    turn.sent.sim = engine.sim;
    aiSent(utterance, turn.sent, { task: 'dashboard', tileCount: surfaces[frameId]?.tiles.length });
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
      aiSent(utterance, turn.sent, { task: 'dashboard', tileCount: surfaces[frameId]?.tiles.length });
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
    return proposePlan(frameId, utterance, merged, turn.sent, summary, status);
  }

  async function pointTurn(frameId: string): Promise<void> {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const f = reg.get(frameId); if (!f) return;
    const turn = pointConnect('speaker', { frameTitle: f.title, sim: simEnv() });
    await connectTurn(frameId, 'connect what I am pointing at', turn, `Connect: ${turn.request.devices[0]?.label ?? 'device'}`, 'guess', { photoNote: true });
  }
  async function nameTurn(frameId: string, name: string): Promise<void> {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const f = reg.get(frameId); if (!f) return;
    const turn = byName(name, { frameTitle: f.title, sim: simEnv(), devices: deviceHints() });
    if (!turn) { say(`Didn’t catch a device in “${name}” — try “lamp”, “speaker” or “fan”.`); return; }
    await connectTurn(frameId, name, turn, `Connect: ${turn.request.devices[0]?.label ?? 'device'}`, 'guess');
  }
  async function scanRoom(utterance: string): Promise<void> {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const id = focusId ?? lastFocus;
    if (!id || !reg.get(id)) { say('Open a room board first, then scan.'); return; }
    const f = reg.get(id)!;
    // Pan first when a gimbal is present (iPhone). On the web this fails fast
    // with the honest why. Either way, we then propose tiles and wait for keep.
    const r = await inputs.gimbal.scan().catch(() => ({ ok: false as const }));
    const sim = simEnv();
    // SIM: lamp + speaker. Live: Gemini/Nano photo IDs when the scan produced
    // any; otherwise the devices already known on this canvas.
    const found = foundAfterScan(sim ? undefined : deviceHints(), { sim });
    const turn = roomScan(found, { frameTitle: f.title, sim });
    const n = turn.plan.tiles.length;
    await connectTurn(id, utterance, turn, `Scan: ${n} device${n === 1 ? '' : 's'} seen`, 'guess', { photoNote: !r.ok });
  }

  let sheetOpen: { frameId: string; host: HTMLElement; sheet: ConnectSheet } | null = null;
  let pairingStop: (() => Promise<void>) | null = null;
  function closeConnectSheet(): void {
    if (pairingStop) { void pairingStop(); pairingStop = null; }
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
    const sheet = mountConnectSheet(host, {
      onPoint: () => { closeConnectSheet(); void pointTurn(id); },
      onName: (name) => { closeConnectSheet(); void nameTurn(id, name); },
      onJoinPhone: () => { void joinPhone(id); },
      onClose: () => { host.hidden = true; sheetOpen = null; },
    });
    sheetOpen = { frameId: id, host, sheet };
    say('Connect a device: point at it, say its name, or join a phone.');
  }
  async function joinPhone(frameId: string): Promise<void> {
    const open = sheetOpen; if (!open || open.frameId !== frameId) return;
    if (simEnv() || !net.isOnline()) {
      open.sheet.setStatus('Joining a phone needs the network — this sim stays on this device.');
      return;
    }
    open.sheet.setStatus('Opening a Relay room…');
    let pairing: PairingView | null = null;
    const res = await startPhoneJoin({
      onState: (st) => {
        if (st === 'paired') pairing?.setStatus('Phone connected. What it proposes still waits for your keep here.');
        else if (st === 'disconnected' || st === 'gone') {
          const line = phoneDropLine(false);
          pairing?.setStatus(line);
          say(line);
        }
      },
      // Phone utterances ride the same run() path as the say box / Talk, so a
      // build still opens review before anything is kept.
      onCommand: (cmd) => {
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
      return;
    }
    if (sheetOpen !== open) { void res.stop(); return; } // she closed it while we connected
    pairingStop = res.stop;
    if (opts.privacyGemini) attachPrivacyHub(res.session, () => activePeople(), opts.privacyGemini);
    sheetOpen = null; // the pairing card replaces the sheet in the same host
    pairing = showPairing(open.host, {
      code: res.code,
      note: 'A phone with this code joins this canvas. Its changes still arrive here as proposals you keep or drop.',
      onClose: () => { if (pairingStop) { void pairingStop(); pairingStop = null; } open.host.hidden = true; },
    });
  }
  // Keep / drop act on the waiting board Proposal, else the waiting language Proposal.
  const waitingBtn = (cls: string) => (pending?.card.querySelector(cls) ?? reviewDialog.currentCard()?.querySelector(cls)) as HTMLButtonElement | null;
  function keep(): void { const b = waitingBtn('.mc-proposal-keep'); if (b) b.click(); else say('Nothing is waiting.'); }
  function drop(): void { const b = waitingBtn('.mc-proposal-drop'); if (b) b.click(); else say('Nothing is waiting.'); }
  function undo(): void {
    const h = history.undo();
    if (!h) { say('Nothing to undo.'); return; }
    if (h.kind === 'lang') { applyPack(h.packBefore ?? null, { record: false }); historyRender(); say(`Undid: ${h.summary}.`); return; }
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
    if (pack?.lang === 'kn') { say('Kannada is already on. Say “undo” for English.'); return; }
    if (!net.isOnline()) {
      net.queueLater('add kannada');
      showAi(true); panels.show();
      panels.forEngine('nano').setQueued(net.laterCount());
      say(`${LATER_LIST_PROMISE}.`);
      return;
    }
    void languageTurn('add kannada');
  }
  async function languageTurn(utterance: string): Promise<void> {
    const engine = engineFor('gemini', JSON.stringify(SCRIPTED_KN_PACK));
    const prompt = [
      'Translate the smart-canvas UI into Kannada. Reply with JSON only:',
      '{"lang":"kn","strings":{key:text},"phrases":{intent:[phrases]}}',
      `UI string keys: ${Object.keys(EN_PACK.strings).join(', ')}.`,
      'Kannada script only, each string ≤80 chars, no markup.',
    ].join('\n');
    aiSent(utterance, { engine: 'gemini', prompt, sent: 'the key list and your request. No board data, no device addresses.', routeLine: engine.sim ? `SIM · ${ROUTE_LINES.kannada}` : ROUTE_LINES.kannada, sim: engine.sim }, { task: 'kannada' });
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
      onKeep: () => { reviewDialog.close(); applyPack(next, { record: true }); historyRender(); autoHideAi(); say('Kannada is on. Say “undo” (or “ರದ್ದುಮಾಡು”) for English.'); },
      onDrop: () => { reviewDialog.close(); say('Kept English.'); autoHideAi(); },
    });
    reviewDialog.open({ title: 'Add Kannada', card, extra: buildReviewExtra() });
  }
  /** A pack phrase (Kannada) routes to the same intents as the English parsers. */
  function runIntent(intent: IntentKey): boolean {
    switch (intent) {
      case 'showEverything': void overview(); return true;
      case 'newBoard': newBoard(); return true;
      case 'save': save(); return true;
      case 'keep': keep(); return true;
      case 'drop': drop(); return true;
      case 'undo': undo(); return true;
      default: {
        const refs = deviceRefs().filter((d) => d.kind !== 'music'); // lamp phrases never touch the speaker
        if (!refs.length) { say('No devices here yet.'); return true; }
        for (const d of refs) {
          const cur = d.brightness ?? 50;
          if (intent === 'lampOn') void store.act({ deviceId: d.id, on: true });
          else if (intent === 'lampOff') void store.act({ deviceId: d.id, on: false });
          else if (intent === 'brighter') void store.act({ deviceId: d.id, on: true, brightness: Math.min(100, cur + 20) });
          else void store.act({ deviceId: d.id, brightness: Math.max(0, cur - 20) });
        }
        const sk: StatusKey = intent === 'lampOn' ? 'lightsOn' : intent === 'lampOff' ? 'lightsOff' : intent === 'brighter' ? 'brighter' : intent === 'dimmer' ? 'dimmer' : 'done';
        say(statusText(sk, pack));
        return true;
      }
    }
  }

  // ---- inputs: hands (pinch keep / brush drop) + gimbal modes in one composer.
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
  const handPointer: HandPointer | null = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
    ? createHandPointer(document, {
        onPinch: (ev) => {
          if (!morphFlow) return;
          if (ev.phase === 'down') { morphFlow.pointerDownAt(ev.p); morphFlow.beginHold(ev.p, 'hand'); }
          else if (ev.phase === 'move') morphFlow.moveHold(ev.p);
          else if (ev.phase === 'up') morphFlow.endHold();
          else morphFlow.cancelHold();
        },
      })
    : null;

  // ---- owner registration: the amber Register button (empty canvas + the
  // bottom-right Edit/Tools/Talk stack) opens a guided SCAN — face → left
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
    const label = registerButtonLabel(loadOwner(regStorage));
    if (registerChip) registerChip.textContent = label;
    const blankBtn = root.querySelector<HTMLElement>('.mc-blank-register');
    if (blankBtn) blankBtn.textContent = label;
    const toolbarBtn = root.querySelector<HTMLElement>('[data-cmd=reregister]');
    if (toolbarBtn) toolbarBtn.textContent = label;
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
  function openScan(): void {
    if (!scanPanel || scanPanel.isOpen()) return;
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
    if (opts.sim) return; // replay drives the sim scan; no chip churn either
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
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

  const inputs = createCanvasInputs({
    root,
    hands: async (r, onEvent) => {
      const s = await mountCanvasHands(r, onEvent, {
        onError: (reason) => { lastHandsError = reason; },
        onPresence: onPresenceFrame,
        onCameraLost: () => {
          if (scanPanel?.isOpen()) closeScan(CAMERA_LOST_REGISTER);
        },
        // A pinch the morph classifier armed on must not ALSO read as the
        // 1200 ms pinch-hold-still (the morph opens the mic itself).
        suppressMotion: (id) => id === 'pinch-hold-still' && !!morphFlow?.holdActive(),
      });
      handsHandle = s;
      handsMountOk = !!s;
      if (s) lastHandsError = null;
      return s;
    },
    on: {
      // A pinch aimed at a control activates that control (handPointer);
      // only a pinch over empty canvas means "keep" — and a pinch the morph
      // hold armed on is the morph's, not a keep.
      keep: () => { if (!morphFlow?.holdActive() && !handPointer?.consumedPinch()) keep(); },
      drop,
      palm: () => toggleTools(),
      pointTarget: () => { const id = focusId ?? lastFocus; if (id) void pointTurn(id); },
      scanFrame: (i) => say(`Scanning the room — photo ${i + 1} of 5.`),
      status: say,
      frame: (hands, now) => { handPointer?.update(hands, now); teachPanel.matchFrame(hands, now); },
    },
  });
  async function toggleHands(): Promise<void> {
    const btn = root.querySelector<HTMLElement>('[data-cmd=hands]')!;
    if (handsOn) { inputs.stop(); handPointer?.lost(); handsHandle = null; handsOn = false; setRegChip(null); closeScan(); btn.setAttribute('aria-pressed', 'false'); say('Hands off.'); return; }
    if (handsBusy) return;
    handsBusy = true; handsMountOk = false;
    await inputs.start(root);
    handsBusy = false;
    // The honest reason, not a generic line: permission denied, busy webcam
    // and a blocked MediaPipe download each read differently (cameraError.ts).
    if (!handsMountOk) { say(lastHandsError ?? 'No camera here — hands stay off.'); return; }
    handsOn = true;
    btn.setAttribute('aria-pressed', 'true');
    restoreOwnerLock();
    say('Hands on: point at any button and pinch to press it. Pinch on empty canvas to keep, brush to drop.');
  }

  // ---- offline (simulate + real) ----
  function setOnline(on: boolean, announce = false): void {
    net.setOnline(on);
    const btn = root.querySelector<HTMLElement>('[data-cmd=offline]')!;
    btn.setAttribute('aria-pressed', String(!on));
    btn.dataset.i18n = on ? 'simulateOffline' : 'offlineOn'; // survives applyStrings
    btn.textContent = str(on ? 'simulateOffline' : 'offlineOn');
    if (on) {
      const later = net.drainLater();
      panels.forEngine('nano').setQueued(net.laterCount());
      if (later.length) { say(`Back online. Running ${later.length} saved request${later.length > 1 ? 's' : ''}.`); later.forEach((u) => { if (/kannada|ಕನ್ನಡ/i.test(u)) void languageTurn(u); }); }
      else if (announce) say('Back online.');
    } else if (announce) say(`${OFFLINE_QUICK_ONLY}.`);
  }

  // ---- commands ----
  function run(text: string): boolean {
    // Morph-first: while the morph card is open, speech (and the say box)
    // means "edit this tile"; "undo" / "cancel" are meta-commands handled
    // locally and never reach a model.
    if (morphFlow?.handleSpeech(text)) return true;
    const paletteCmd = matchPaletteCommand(text);
    if (paletteCmd === 'open') { openTools(); return true; }
    if (paletteCmd === 'close') { closeTools(); return true; }
    if (/^\s*teach a gesture\s*$/i.test(text)) { teachPanel.open(); return true; }
    if (/^\s*(custom gestures|my gestures)\s*$/i.test(text)) { teachPanel.openList(); return true; }
    if (/^\s*(show\s+models|ai activity|show\s+ai)\s*$/i.test(text)) { aiManual = true; showAi(true); return true; }
    if (/^\s*(hide\s+models|hide\s+ai)\s*$/i.test(text)) { aiManual = false; showAi(false); return true; }
    // Active language pack: a spoken phrase routes to the same intents first.
    if (pack) { const intent = routePackPhrase(text, pack); if (intent) return runIntent(intent); }
    // Gimbal phrases next: follow my hands / hold still / point / scan the room.
    // On the web there is no gimbal — handleSpeech answers with the honest why.
    const gimbalCmd = parseGimbalSpeech(text);
    if (gimbalCmd === 'scan') { void scanRoom(text); return true; }
    if (gimbalCmd) return inputs.handleSpeech(text);
    if (/\badd kannada\b/i.test(text) || /ಕನ್ನಡ/.test(text)) { addKannada(); return true; }
    if (/^\s*(show\s+)?history\s*$/i.test(text)) { openHistory(); return true; }

    const c = parseCanvasCommand(text);
    if (c) {
      switch (c.type) {
        case 'newFrame': newBoard(); break;
        case 'keep': keep(); break;
        case 'drop': drop(); break;
        case 'undo': undo(); break;
        case 'showEverything': void overview(); break;
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
    const dc = parseDeviceCommands(text, deviceRefs());
    if (dc) {
      for (const i of dc.intents) void store.act(i);
      // With a Kannada pack on, the device-command status line is Kannada too.
      say(pack?.lang === 'kn' && dc.statusKey ? statusText(dc.statusKey, pack) : dc.say);
      return true;
    }

    if (/\bconnect (everything|all|the room|this room|my room|devices?)\b/i.test(text)) {
      const target = focusId ?? reg.add('note', `Board ${reg.list().length + 1}`).id;
      if (!focusId) { sync(); void focus(target); }
      void connectRoom(target, text); return true;
    }

    // "floor plan for Mrs Sharma's flat" / "a floor plan" / "floorplan" —
    // route to the Nano floor-plan turn with the full utterance so any name
    // in it (e.g. Sharma) gets redacted by the stayed-local strip.
    if (/\bfloor\s*plans?\b/i.test(text)) {
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
    const ask = connectAsk(text);
    if (ask === 'sheet') { openConnectSheet(); return true; }
    if (ask === 'byName') {
      const id = focusId ?? lastFocus;
      if (!id) { say('Open a board first, then connect a device.'); return true; }
      void nameTurn(id, text);
      return true;
    }
    say(`“${text}” isn’t a canvas command yet.`); return false;
  }

  // ---- input ----
  // Delegated on root: on phones some tools live in the menu sheet (phoneMenu.ts).
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]'); if (!b) return;
    ({ everything: () => void overview(), new: newBoard, save, undo, ai: () => { aiManual = aiPanel.hidden === true; showAi(aiPanel.hidden === true); }, offline: () => setOnline(!net.isOnline(), true), hands: () => void toggleHands(), register: openScan, reregister: openScan, teach: () => teachPanel.open(), gestures: () => teachPanel.openList() } as Record<string, () => void>)[b.dataset.cmd!]?.();
  });
  const phoneMenu = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? mountPhoneMenu(root) : null;
  const toolPalette = mountToolPalette(root);
  const toolsLatch = createToggleLatch();
  function openTools(): void { if (isPhone()) phoneMenu?.open(); else toolPalette.open(); }
  function closeTools(): void { if (isPhone()) phoneMenu?.close(); else toolPalette.close(); }
  function toggleTools(): void {
    if (isPhone()) {
      if (!toolsLatch.allow()) return;
      if (phoneMenu?.isOpen()) phoneMenu.close(); else phoneMenu?.open();
      return;
    }
    toolPalette.toggle();
  }
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
    if (act && frame) { if (act.dataset.act === 'connect') void connectRoom(frame); else floorPlan(frame); return; }
    if (frame && frame !== focusId && !dragged) void focus(frame);
  });
  let drag: { x: number; y: number } | null = null; let dragged = false;
  viewport.addEventListener('pointerdown', (e) => {
    if (focusId && (e.target as HTMLElement).closest('.mc-frame.focused')) return;
    drag = { x: e.clientX, y: e.clientY }; dragged = false;
  });
  // Window-level listeners outlive `root`'s own DOM (removing root's children
  // doesn't remove these), so a remount leaks them unless destroy() below
  // explicitly removes each one closing over this mount's stale state.
  const onWindowPointerMove = (e: PointerEvent) => {
    if (!drag || focusId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    dragged = true; camera = panBy(camera, dx, dy); drag = { x: e.clientX, y: e.clientY }; applyCamera();
  };
  const onWindowPointerUp = () => { if (drag && dragged) persist(); drag = null; setTimeout(() => { dragged = false; }, 0); };
  const onWindowKeydown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    if (reviewDialog.isOpen()) return; // the dialog's own Esc handler (stopPropagation) owns this key
    if (e.key !== 'Escape') return;
    if (focusId) { e.preventDefault(); void overview(); return; }
    if (!aiPanel.hidden) { e.preventDefault(); aiManual = false; showAi(false); }
  };
  const onWindowResize = () => { if (focusId) { const f = reg.get(focusId); if (f) { camera = focusOnInsets(f.rect, vp(), insets()); applyCamera(); } } };
  const onWindowOnline = () => setOnline(true);
  const onWindowOffline = () => setOnline(false);
  addEventListener('pointermove', onWindowPointerMove);
  addEventListener('pointerup', onWindowPointerUp);
  addEventListener('keydown', onWindowKeydown);
  addEventListener('resize', onWindowResize);
  addEventListener('online', onWindowOnline);
  addEventListener('offline', onWindowOffline);
  function destroy(): void {
    phoneMenu?.destroy();
    toolPalette.destroy();
    micFab?.destroy();
    detachMorphPointers();
    morphFlow?.destroy();
    morphCard.destroy();
    handPointer?.destroy();
    stopReplay();
    scanPanel?.destroy();
    registerChip?.remove();
    regChip?.remove();
    removeEventListener('pointermove', onWindowPointerMove);
    removeEventListener('pointerup', onWindowPointerUp);
    removeEventListener('keydown', onWindowKeydown);
    removeEventListener('resize', onWindowResize);
    removeEventListener('online', onWindowOnline);
    removeEventListener('offline', onWindowOffline);
  }
  viewport.addEventListener('wheel', (e) => {
    if (focusId && (e.target as HTMLElement).closest('.mc-frame.focused')) return; // the board's own zoom
    e.preventDefault();
    if (focusId) { focusId = null; sync(); }
    const r = viewport.getBoundingClientRect();
    camera = zoomAbout(camera, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0015));
    applyCamera(); persist();
  }, { passive: false });

  const voice = opts.voice ?? null;

  // Big floating mic: tap, keyboard or pinch toggles listening. The only talk control.
  const micFab = typeof document !== 'undefined' ? mountMicFab(root, voice, say) : null;
  micFabRef = micFab;
  // Sim/test hook: drive the hand pointer without a camera.
  if (opts.sim && typeof window !== 'undefined' && handPointer) (window as unknown as { __mcHand?: HandPointer }).__mcHand = handPointer;

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
        void runSelfCheck({
          host: target.host,
          spec: target.spec,
          tileId: target.id,
          log: tileSelfCheckLog,
          requestFix: (prompt) => engineFor('gemini', scriptedFixJson(target.spec)).stream(prompt, () => {}),
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
            return new Promise((done) => {
              const card = renderProposalCard(document, {
                id: `p-fix-${target.id}`, title: `Fix ${target.label}`, youAsked: 'self-check fix', status: 'changed',
                catalog: { helper: 'Deep', byLine: 'Deep · online', routeLine: 'Gemini · self-check fix', lineId: 'custom', whyLabel: 'Why online', whatWasSent: 'the tile dump and the problems', technicalLine: 'Gemini · self-check fix' },
              }, {
                onKeep: () => { reviewDialog.close(); done(true); },
                onDrop: () => { reviewDialog.close(); done(false); },
              });
              reviewDialog.open({ title: `Fix ${target.label}`, card, extra: buildReviewExtra() });
            });
          },
        }).then((stat) => { if (!stat.passed) onUnverified?.(); });
      }
    });
  }
  const morphDisabled = (): boolean =>
    !focusId || editBoard.editing || reviewDialog.isOpen() || !!pending || (scanPanel?.isOpen() ?? false);
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
    history.push({ frameId, before, after: patched, by: 'gemini', summary });
    renderSurface(frameId); sync(); updateDock(); persist(); historyRender();
    if (path) {
      selfCheckTiles(frameId, path, () => {
        undo();
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
    propose: (fid, patched, summary, path) => new Promise((done) => {
      const card = renderProposalCard(document, {
        id: `p-morph-${Date.now()}`, title: summary, youAsked: summary, status: 'changed',
        catalog: { helper: 'Deep', byLine: 'Deep · online', routeLine: 'Gemini · one tile', lineId: 'custom', whyLabel: 'Why online', whatWasSent: 'your redacted words and one tile', technicalLine: 'Gemini · one tile' },
      }, {
        onKeep: () => { reviewDialog.close(); done(applyMorph(fid, patched, summary, path)); },
        onDrop: () => { reviewDialog.close(); done(false); },
      });
      reviewDialog.open({ title: summary, card, extra: buildReviewExtra() });
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
      for (const el of [root.querySelector<HTMLElement>('.mc-say'), micFab?.el ?? null]) {
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
  const detachMorphPointers = attachMorphPointers(root, morphFlow, document);
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

  // A persisted language pack localizes the UI (and voice) on load, offline-safe.
  applyStrings();
  if (pack) opts.voice?.setLang?.(resolveLanguage(pack.lang).speechLang);
  if (!net.isOnline()) { const btn = root.querySelector<HTMLElement>('[data-cmd=offline]')!; btn.setAttribute('aria-pressed', 'true'); btn.dataset.i18n = 'offlineOn'; btn.textContent = str('offlineOn'); }

  sync();
  updateDock();
  refreshRegisterLabels();
  if (loadOwner(regStorage)) setRegChip('Registered'); // survives a reload within the session
  if (focusId) void focus(focusId); else if (!stored) void overview();

  // Hands + face are ON BY DEFAULT: the camera prompt appears right away and
  // tracking starts with no click; the Hands button still toggles off/on.
  // Opt out with ?hands=0. Silent no-op where getUserMedia doesn't exist
  // (jsdom / unit tests), so a failure message never appears without a camera.
  if (shouldAutoStartHands(opts.autoHands, typeof navigator !== 'undefined' ? navigator : null)) {
    void toggleHands();
  }

  return { run, focus, overview, save, keep, drop, undo, store, snapshot, history: () => history.list(), frames: () => reg.list(), destroy };
}
export type CanvasHandle = ReturnType<typeof mountCanvas>;
