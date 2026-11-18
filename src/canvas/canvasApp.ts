// Smart canvas shell (sim-main): an infinite canvas of boards. Overview is for
// viewing and flying; Focus fits one board at exactly 1:1 for editing.
// Board contents are A2UI surfaces built from surface plans, gated, and
// (for anything a model proposes) held in a Proposal until kept.
import '@a2ui/lit/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { cameraTransform, fitRects, focusOnInsets, lerpCamera, panBy, zoomAbout, type Camera, type Viewport } from './camera';
import { CANVAS_DOC_VERSION, createFrameRegistry, parseCanvasDoc, type CanvasDoc, type Frame, type FrameRegistry } from './frames';
import { parseCanvasCommand, resolveFrame } from './canvasCommands';
import { coerceSurfacePlan, expandPlan, type A2uiMessage, type DeviceState, type SurfacePlan } from './surfacePlan';
import { gateMessages } from './gate';
import { CATALOG_SCHEMAS } from './catalogApi';
import { createSurfaceProposal, type SurfaceProposal } from './proposalBuffer';
import { createCanvasHistory, parsePartialPlan, runSurfaceTurn, scriptedEngine, type DeviceHint, type EngineId, type PartialPlan, type SentInfo, type SurfaceEngine } from './aiTurn';
import { byName, connectAsk, foundAfterScan, mergeTiles, pointConnect, roomScan, type ConnectTurnResult } from './connectTurns';
import { mountConnectSheet, showPairing, type ConnectSheet, type PairingView } from './connectSheet';
import { startPhoneJoin } from './phoneJoin';
import { createCanvasInputs } from './canvasInputs';
import { parseGimbalSpeech } from './gimbalCanvas';
import { renderProposalCard, type ProposalStatus } from '../ux/proposal';
import { createDeviceStore, type DeviceConnector } from './deviceActions';
import { ConnectTileElement, LampTileElement, MusicTileElement, PlanBoardElement, SceneTileElement, SwitchTileElement, smartCanvasCatalog } from './widgets';
import { parseDeviceCommands, type DeviceKind, type DeviceRef } from './deviceCommands';
import { initialDoc } from './firstOpen';
import { createConnectivity } from './connectivity';
import { EN_PACK, SCRIPTED_KN_PACK, coerceLanguagePack, routePackPhrase, statusText, type IntentKey, type LangStringKey, type LanguagePack, type StatusKey } from './languagePack';
import { createCanvasLedger, formatLedgerLine } from './ledger';
import { mountCanvasHands } from './canvasHands';
import { LATER_LIST_PROMISE, OFFLINE_QUICK_ONLY } from '../ux/wording';
import { ROUTE_LINES } from '../ux/routeCatalog';
import { resolveLanguage } from '../ai/language';

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
}

const STUB_DEVICES: Record<string, DeviceState> = {
  'wiz-desk': { on: false, brightness: 40 },
  'wiz-ceiling': { on: true, brightness: 70 },
  'speaker-1': { on: false, brightness: 0, playing: false, trackTitle: 'Morning light', volume: 40 },
};
const TRACKS = ['Morning light', 'Monsoon raga', 'Evening calm'];

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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function mountCanvas(root: HTMLElement, opts: CanvasOptions = {}) {
  for (const El of [LampTileElement, PlanBoardElement, MusicTileElement, SwitchTileElement, SceneTileElement, ConnectTileElement]) {
    if (!customElements.get(El.tagName)) customElements.define(El.tagName, El as unknown as CustomElementConstructor);
  }
  const storage = opts.storage ?? localStorage;
  const reduced = opts.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stored: CanvasDoc | null = null;
  try { stored = parseCanvasDoc(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')); } catch { stored = null; }
  const doc = initialDoc(stored, { seed: opts.seed }, seedDoc);
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
    <div class="mc-viewport" tabindex="-1"><div class="mc-world"></div></div>
    <header class="mc-bar">
      <div class="mc-bar-tools">
      <button data-cmd="everything" class="mc-btn" data-i18n="showEverything">Show everything</button>
      <button data-cmd="new" class="mc-btn" data-i18n="newBoard">New board</button>
      <button data-cmd="save" class="mc-btn" data-i18n="save">Save</button>
      <form class="mc-say"><label class="mc-sr" for="mc-say-in">Say or type a command</label>
        <input id="mc-say-in" autocomplete="off" data-i18n="sayPlaceholder" placeholder="Say: new board · show everything · go to floor plan" />
        <button class="mc-btn primary" type="submit" data-i18n="go">Go</button>
        <button class="mc-btn mc-mic" type="button" aria-pressed="false" data-i18n="holdToTalk" hidden>Hold to talk</button></form>
      <button data-cmd="undo" class="mc-btn" data-i18n="undo">Undo</button>
      <button data-cmd="hands" class="mc-btn" aria-pressed="false" data-i18n="hands">Hands</button>
      <button data-cmd="ai" class="mc-btn" aria-expanded="false" data-i18n="ai">AI activity</button>
      <button data-cmd="offline" class="mc-btn" aria-pressed="false" data-i18n="simulateOffline">Simulate offline</button>
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
        <div class="mc-ai-turn" hidden>
          <p class="mc-ai-said"></p>
          <p class="mc-ai-route"></p>
          <details class="mc-ai-prompt" open><summary>Prompt going in</summary><pre></pre></details>
          <p class="mc-ai-sent"></p>
          <p class="mc-ai-ledger"></p>
          <details class="mc-ai-reply" open><summary>Reply, streaming</summary><pre aria-live="off"></pre></details>
        </div>
        <h3 class="mc-ai-h3">History</h3><p class="mc-ai-ledger-total"></p><ol class="mc-ai-history" tabindex="-1"></ol>
      </div>
      <div class="mc-ai-pending">
        <p class="mc-ai-state" aria-live="polite"></p>
        <div class="mc-ai-lang"></div>
      </div>
    </aside>`;
  const viewport = root.querySelector<HTMLElement>('.mc-viewport')!;
  const world = root.querySelector<HTMLElement>('.mc-world')!;
  const statusEl = root.querySelector<HTMLElement>('.mc-canvas-status')!;
  const aiPanel = root.querySelector<HTMLElement>('.mc-ai')!;
  const dockEl = root.querySelector<HTMLElement>('.mc-dock')!;
  const dockSurfaceEl = dockEl.querySelector<HTMLElement>('.mc-dock-surface')!;
  const history = createCanvasHistory();
  const ledger = createCanvasLedger();
  const say = (t: string) => { statusEl.textContent = t; };

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
  const store = createDeviceStore(opts.devices ?? STUB_DEVICES, opts.connector ?? {
    run: (i) => new Promise((res) => setTimeout(() => {
      const cur = store.get(i.deviceId);
      const ack: Partial<DeviceState> = { on: i.on ?? cur.on, brightness: i.brightness ?? cur.brightness };
      if (i.playing !== undefined) ack.playing = i.playing;
      if (i.volume !== undefined) ack.volume = i.volume;
      if (i.next) { ack.trackTitle = TRACKS[(TRACKS.indexOf(cur.trackTitle ?? '') + 1 + TRACKS.length) % TRACKS.length]; ack.playing = true; }
      res(ack);
    }, 300)),
  }, (m) => {
    const u = (m as unknown as { updateDataModel: Record<string, unknown> }).updateDataModel;
    for (const sid of live) processor.processMessages([{ ...m, updateDataModel: { ...u, surfaceId: sid } }] as never);
  }, () => 'fanout');

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
    (s as { onAction: { subscribe(f: (a: { name: string; context: { deviceId: string } }) => void): void } }).onAction.subscribe((a) => {
      if (a.name === 'connect.start') { openConnectSheet(sid); return; }
      const id = a.context?.deviceId; const cur = id ? store.get(id) : undefined;
      if (!cur) return;
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
    for (const sid of [...live]) if (sid.endsWith('-dock')) live.delete(sid);
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
        <div class="mc-frame-body"><div class="mc-prop-host" hidden></div><div class="mc-connect-host" hidden></div><div class="mc-ghost" hidden aria-hidden="true"></div><div class="mc-surface"></div><div class="mc-empty" hidden></div></div>`;
      world.append(el);
      if (surfaces[f.id]) queueMicrotask(() => renderSurface(f.id));
    }
    return el;
  }

  function sync(): void {
    const frames = reg.list();
    const ids = new Set(frames.map((f) => f.id));
    world.querySelectorAll<HTMLElement>('.mc-frame').forEach((el) => { if (!ids.has(el.dataset.frame!)) { live.delete(el.dataset.frame!); el.remove(); } });
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
  function persist(now = false): void {
    clearTimeout(persistTimer);
    const write = () => { try { storage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch { /* quota: keep running */ } };
    if (now) write(); else persistTimer = window.setTimeout(write, 250);
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
    await flyTo(fitRects(reg.list().map((f) => f.rect), vp(), Math.max(56, barH())));
    say(`${reg.list().length} boards. Pick one, or say “go to …”.`);
  }
  function newBoard(): void {
    const n = reg.list().length + 1;
    const f = reg.add('note', `Board ${n}`);
    sync(); void focus(f.id); persist();
    say(`New board. Say “connect everything in this room”.`);
  }
  function save(): void {
    persist(true);
    savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const f = focusId ? reg.get(focusId) : null;
    say(f ? `Saved ${f.title} at ${savedAt}.` : `Saved the canvas at ${savedAt}.`);
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
  const autoHideAi = () => { clearTimeout(aiHideTimer); aiHideTimer = window.setTimeout(() => { if (!aiManual && !pending && !aiPanel.querySelector('.mc-ai-lang .mc-proposal')) showAi(false); }, 2000); };
  function showAi(on = true): void {
    clearTimeout(aiHideTimer);
    const changed = aiPanel.hidden === on;
    aiPanel.hidden = !on;
    root.querySelector('[data-cmd=ai]')!.setAttribute('aria-expanded', String(on));
    if (changed && focusId) { const f = reg.get(focusId); if (f) void flyTo(focusOnInsets(f.rect, vp(), insets())); }
  }
  function aiSent(utterance: string, s: SentInfo): void {
    showAi(true);
    aiPanel.querySelector<HTMLElement>('.mc-ai-empty')!.hidden = true;
    aiPanel.querySelector<HTMLElement>('.mc-ai-turn')!.hidden = false;
    aiPanel.dataset.engine = s.engine;
    aiPanel.querySelector('.mc-ai-said')!.textContent = `You said: “${utterance}”`;
    aiPanel.querySelector('.mc-ai-route')!.textContent = s.routeLine;
    aiPanel.querySelector('.mc-ai-prompt pre')!.textContent = s.prompt;
    aiPanel.querySelector('.mc-ai-sent')!.textContent = s.sent ? `What was sent: ${s.sent}` : 'What was sent: nothing. Stays on this device.';
    // Byte ledger: every AI turn records what actually left the device.
    const entry = ledger.record({ engine: s.engine, sentText: s.sent ? s.prompt : '' });
    aiPanel.querySelector('.mc-ai-ledger')!.textContent = formatLedgerLine({ bytes: entry.bytes, engine: s.engine });
    ledgerTotalRender();
    aiPanel.querySelector('.mc-ai-reply pre')!.textContent = '';
    aiPanel.querySelector('.mc-ai-state')!.textContent = s.engine === 'nano' ? 'Quick is drafting on this device…' : 'Deep is improving it online…';
  }
  function ghost(frameId: string, g: PartialPlan | null): void {
    const el = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-ghost`);
    if (!el) return;
    if (!g) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const ghostLabel = (t: PartialPlan['tiles'][number]): string =>
      t.type === 'lamp' ? `Lamp · ${esc(t.label)}`
      : t.type === 'music' ? `Music · ${esc(t.label)}`
      : t.type === 'switch' ? `Switch · ${esc(t.label)}`
      : t.type === 'scene' ? `Scene · ${esc(t.label)}`
      : t.type === 'connect' ? 'Connect a device'
      : 'Floor plan';
    el.innerHTML = `<p class="mc-ghost-title">${esc(g.title ?? '…')}</p>` + g.tiles.map((t) =>
      `<div class="mc-ghost-tile ${t.type}">${ghostLabel(t)}</div>`).join('') + '<div class="mc-ghost-tile next">…</div>';
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

  async function aiTurn(frameId: string, engineId: EngineId, utterance: string, script: string, summary: string, status: ProposalStatus): Promise<boolean> {
    const f = reg.get(frameId); if (!f) return false;
    const engine = engineFor(engineId, script.replace('BOARD', frameId));
    let sentInfo: SentInfo | null = null;
    const plan = await runSurfaceTurn({ utterance, frameTitle: f.title, devices: deviceHints(), current: surfaces[frameId] ?? null }, engine, {
      onSent: (s) => { sentInfo = s; aiSent(utterance, s); },
      onText: (t) => { aiPanel.querySelector('.mc-ai-reply pre')!.textContent = t; },
      onGhost: (g) => ghost(frameId, g),
      onError: (why) => { aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); },
    });
    if (!plan || !sentInfo) { ghost(frameId, null); return false; }
    return proposePlan(frameId, utterance, plan, sentInfo, summary, status);
  }

  /** Gate a plan, show the Proposal card, and apply only on keep (shared by
   *  the room/floor-plan turns and the connect turns). */
  function proposePlan(frameId: string, utterance: string, plan: SurfacePlan, si: SentInfo, summary: string, status: ProposalStatus): Promise<boolean> {
    const check = gateMessages(expandPlan(plan, frameId, store.all()), CATALOG_SCHEMAS);
    if (!check.ok) { ghost(frameId, null); say('Blocked a plan that did not pass the check.'); return Promise.resolve(false); }
    aiPanel.querySelector('.mc-ai-state')!.textContent = 'Waiting for you. Nothing changes until you keep it.';
    // Where it actually ran (a phone's "Nano" step is really Deep in the cloud).
    const ranId: EngineId = si.engine;
    return new Promise((done) => {
      const before = surfaces[frameId] ?? null;
      const prop = createSurfaceProposal(`p-${Date.now()}`, ranId, summary, check.messages, () => {
        surfaces[frameId] = plan; reg.rename(frameId, plan.title); reg.setKind(frameId, plan.kind === 'plan' ? 'plan' : 'room');
        history.push({ frameId, before, after: plan, by: ranId, summary });
        renderSurface(frameId); sync(); updateDock(); persist(); historyRender();
      });
      const host = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-prop-host`)!;
      const finish = (kept: boolean) => {
        host.hidden = true; host.innerHTML = ''; ghost(frameId, null); pending = null;
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
      host.innerHTML = ''; host.append(card); host.hidden = false;
      tagCardI18n(card);
      pending = { frameId, prop, card };
      say(`${summary}. Pinch or say “keep”; brush or say “drop”.`);
    });
  }

  async function connectRoom(frameId: string, utterance = 'connect everything in this room'): Promise<void> {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const kept = await aiTurn(frameId, 'nano', utterance, SCRIPTS.nanoRoom, 'Draft: 2 lamps found in this room', 'guess');
    if (!kept) return;
    if (!net.isOnline()) { // offline: Deep can't improve it; keep the on-device draft
      aiPanel.querySelector('.mc-ai-route')!.textContent = ROUTE_LINES.offline;
      aiPanel.querySelector('.mc-ai-state')!.textContent = OFFLINE_QUICK_ONLY;
      say(`${OFFLINE_QUICK_ONLY}. Deep will improve it when you're back online.`);
      return;
    }
    await aiTurn(frameId, 'gemini', utterance, SCRIPTS.geminiRoom, 'Better: grouped lights + a room plan', 'changed');
  }
  function floorPlan(frameId: string): void {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    void aiTurn(frameId, 'nano', 'start a floor plan', SCRIPTS.nanoPlan, 'Floor plan: two bedrooms', 'waiting');
  }

  // ---- connect a device: sheet (point / name / phone) + merge-on-keep turns ----
  const simEnv = () => engineFor('gemini', '{}').sim;

  /** A connect AI turn (point / by-name / scan): visible receipt and ghost, then
   *  a Proposal whose keep MERGES the tiles into the board (no dupes, ≤ MAX_TILES). */
  async function connectTurn(frameId: string, utterance: string, turn: ConnectTurnResult, summary: string, status: ProposalStatus, o: { photoNote?: boolean } = {}): Promise<boolean> {
    const f = reg.get(frameId); if (!f) return false;
    aiSent(utterance, turn.sent);
    if (o.photoNote) aiPanel.querySelector('.mc-ai-sent')!.textContent += ' — no camera or gimbal here, so the photo is simulated.';
    let full = '';
    try {
      full = await turn.engine.stream(turn.sent.prompt, (t) => {
        aiPanel.querySelector('.mc-ai-reply pre')!.textContent = t;
        ghost(frameId, parsePartialPlan(t));
      });
    } catch (e) {
      const why = `${turn.sent.engine === 'nano' ? 'Nano' : 'Gemini'} didn’t answer: ${e instanceof Error ? e.message : String(e)}`;
      aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); ghost(frameId, null); return false;
    }
    let raw: unknown;
    try { raw = JSON.parse(full.slice(full.indexOf('{'), full.lastIndexOf('}') + 1)); } catch { ghost(frameId, null); say('The reply was not a board plan.'); return false; }
    const plan = coerceSurfacePlan(raw);
    if (!plan.ok) { ghost(frameId, null); say(`Refused the plan: ${plan.error}`); return false; }
    const before: SurfacePlan = surfaces[frameId] ?? { kind: 'room', title: f.title, tiles: [] };
    const merged = mergeTiles(before, plan.value.tiles);
    if (merged.tiles.length === before.tiles.length) {
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
      onState: (st) => { if (st === 'paired') pairing?.setStatus('Phone connected. What it proposes still waits for your keep here.'); },
    });
    if ('error' in res) {
      if (sheetOpen === open) open.sheet.setStatus('Needs network: the Relay room is not reachable right now.');
      return;
    }
    if (sheetOpen !== open) { void res.stop(); return; } // she closed it while we connected
    pairingStop = res.stop;
    sheetOpen = null; // the pairing card replaces the sheet in the same host
    pairing = showPairing(open.host, {
      code: res.code,
      note: 'A phone with this code joins this canvas. Its changes still arrive here as proposals you keep or drop.',
      onClose: () => { if (pairingStop) { void pairingStop(); pairingStop = null; } open.host.hidden = true; },
    });
  }
  // Keep / drop act on the waiting board Proposal, else the waiting language Proposal.
  const waitingBtn = (cls: string) => (pending?.card.querySelector(cls) ?? aiPanel.querySelector(`.mc-ai-lang ${cls}`)) as HTMLButtonElement | null;
  function keep(): void { const b = waitingBtn('.mc-proposal-keep'); if (b) b.click(); else say('Nothing is waiting.'); }
  function drop(): void { const b = waitingBtn('.mc-proposal-drop'); if (b) b.click(); else say('Nothing is waiting.'); }
  function undo(): void {
    const h = history.undo();
    if (!h) { say('Nothing to undo.'); return; }
    if (h.kind === 'lang') { applyPack(h.packBefore ?? null, { record: false }); historyRender(); say(`Undid: ${h.summary}.`); return; }
    if (h.before) { surfaces[h.frameId] = h.before; reg.rename(h.frameId, h.before.title); } else { delete surfaces[h.frameId]; live.delete(h.frameId); }
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
    if (!net.isOnline()) { net.queueLater('add kannada'); say(`${LATER_LIST_PROMISE}.`); return; }
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
    aiSent(utterance, { engine: 'gemini', prompt, sent: 'the key list and your request. No board data, no device addresses.', routeLine: engine.sim ? `SIM · ${ROUTE_LINES.kannada}` : ROUTE_LINES.kannada, sim: engine.sim });
    let full = '';
    try { full = await engine.stream(prompt, (t) => { aiPanel.querySelector('.mc-ai-reply pre')!.textContent = t; }); }
    catch (e) { const why = `Kannada draft didn’t arrive: ${e instanceof Error ? e.message : String(e)}`; aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); return; }
    let raw: unknown = null;
    try { raw = JSON.parse(full.slice(full.indexOf('{'), full.lastIndexOf('}') + 1)); } catch { /* not JSON */ }
    const coerced = coerceLanguagePack(raw);
    if (!coerced.ok) { const why = `Refused the pack: ${coerced.error}`; aiPanel.querySelector('.mc-ai-state')!.textContent = why; say(why); return; }
    const next = coerced.value;
    aiPanel.querySelector('.mc-ai-state')!.textContent = 'Waiting for you. English until you keep it.';
    aiPanel.querySelectorAll('.mc-ai-prompt, .mc-ai-reply').forEach((d) => d.removeAttribute('open'));
    const host = aiPanel.querySelector<HTMLElement>('.mc-ai-lang')!;
    const card = renderProposalCard(document, {
      id: 'p-lang', title: 'Add Kannada', youAsked: utterance, status: 'changed',
      catalog: { helper: 'Deep', byLine: 'Deep · online', routeLine: ROUTE_LINES.kannada, lineId: 'custom', whyLabel: 'Why online', whatWasSent: 'the UI key list and your request', technicalLine: ROUTE_LINES.kannada },
    }, {
      onKeep: () => { host.innerHTML = ''; applyPack(next, { record: true }); historyRender(); autoHideAi(); say('Kannada is on. Say “undo” (or “ರದ್ದುಮಾಡು”) for English.'); },
      onDrop: () => { host.innerHTML = ''; say('Kept English.'); autoHideAi(); },
    });
    host.innerHTML = ''; host.append(card);
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
  const inputs = createCanvasInputs({
    root,
    hands: async (r, onEvent) => { const s = await mountCanvasHands(r, onEvent); handsMountOk = !!s; return s; },
    on: {
      keep, drop,
      pointTarget: () => { const id = focusId ?? lastFocus; if (id) void pointTurn(id); },
      scanFrame: (i) => say(`Scanning the room — photo ${i + 1} of 5.`),
      status: say,
    },
  });
  async function toggleHands(): Promise<void> {
    const btn = root.querySelector<HTMLElement>('[data-cmd=hands]')!;
    if (handsOn) { inputs.stop(); handsOn = false; btn.setAttribute('aria-pressed', 'false'); say('Hands off.'); return; }
    if (handsBusy) return;
    handsBusy = true; handsMountOk = false;
    await inputs.start(root);
    handsBusy = false;
    if (!handsMountOk) { say('No camera here — hands stay off.'); return; }
    handsOn = true;
    btn.setAttribute('aria-pressed', 'true');
    say('Hands on: pinch to keep, brush to drop.');
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
      if (later.length) { say(`Back online. Running ${later.length} saved request${later.length > 1 ? 's' : ''}.`); later.forEach((u) => { if (/kannada|ಕನ್ನಡ/i.test(u)) void languageTurn(u); }); }
      else if (announce) say('Back online.');
    } else if (announce) say(`${OFFLINE_QUICK_ONLY}.`);
  }

  // ---- commands ----
  function run(text: string): boolean {
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

    if (/\bconnect (everything|all|the room|this room|my room)\b/i.test(text)) {
      const target = focusId ?? reg.add('note', `Board ${reg.list().length + 1}`).id;
      if (!focusId) { sync(); void focus(target); }
      void connectRoom(target, text); return true;
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
  root.querySelector('.mc-bar')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]'); if (!b) return;
    ({ everything: () => void overview(), new: newBoard, save, undo, ai: () => { aiManual = aiPanel.hidden === true; showAi(aiPanel.hidden === true); }, offline: () => setOnline(!net.isOnline(), true), hands: () => void toggleHands() } as Record<string, () => void>)[b.dataset.cmd!]?.();
  });
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
  addEventListener('pointermove', (e) => {
    if (!drag || focusId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    dragged = true; camera = panBy(camera, dx, dy); drag = { x: e.clientX, y: e.clientY }; applyCamera();
  });
  addEventListener('pointerup', () => { if (drag && dragged) persist(); drag = null; setTimeout(() => { dragged = false; }, 0); });
  viewport.addEventListener('wheel', (e) => {
    if (focusId && (e.target as HTMLElement).closest('.mc-frame.focused')) return; // the board's own zoom
    e.preventDefault();
    if (focusId) { focusId = null; sync(); }
    const r = viewport.getBoundingClientRect();
    camera = zoomAbout(camera, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * 0.0015));
    applyCamera(); persist();
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    if (e.key === 'Escape' && focusId) { e.preventDefault(); void overview(); }
  });
  addEventListener('resize', () => { if (focusId) { const f = reg.get(focusId); if (f) { camera = focusOnInsets(f.rect, vp(), insets()); applyCamera(); } } });

  // Push-to-talk where the browser has speech recognition (Chrome, Android).
  const mic = root.querySelector<HTMLButtonElement>('.mc-mic')!;
  const voice = opts.voice ?? null;
  if (voice?.supported) {
    mic.hidden = false;
    const start = () => { mic.setAttribute('aria-pressed', 'true'); voice.pushToTalkStart(); say('Listening…'); };
    const stop = () => { mic.setAttribute('aria-pressed', 'false'); voice.pushToTalkStop(); };
    mic.addEventListener('pointerdown', start); mic.addEventListener('pointerup', stop); mic.addEventListener('pointerleave', stop);
  }

  // Real connectivity events mirror the simulate toggle.
  addEventListener('online', () => setOnline(true));
  addEventListener('offline', () => setOnline(false));

  // A persisted language pack localizes the UI (and voice) on load, offline-safe.
  applyStrings();
  if (pack) opts.voice?.setLang?.(resolveLanguage(pack.lang).speechLang);
  if (!net.isOnline()) { const btn = root.querySelector<HTMLElement>('[data-cmd=offline]')!; btn.setAttribute('aria-pressed', 'true'); btn.dataset.i18n = 'offlineOn'; btn.textContent = str('offlineOn'); }

  sync();
  updateDock();
  if (focusId) void focus(focusId); else if (!stored) void overview();

  return { run, focus, overview, save, keep, drop, undo, store, snapshot, history: () => history.list(), frames: () => reg.list() };
}
export type CanvasHandle = ReturnType<typeof mountCanvas>;
