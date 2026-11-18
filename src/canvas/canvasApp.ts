// Smart canvas shell (sim-main): an infinite canvas of boards. Overview is for
// viewing and flying; Focus fits one board at exactly 1:1 for editing.
// Board contents are A2UI surfaces built from surface plans, gated, and
// (for anything a model proposes) held in a Proposal until kept.
import '@a2ui/lit/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { cameraTransform, fitRects, focusOnInset, lerpCamera, panBy, zoomAbout, type Camera, type Viewport } from './camera';
import { CANVAS_DOC_VERSION, createFrameRegistry, parseCanvasDoc, type CanvasDoc, type Frame, type FrameRegistry } from './frames';
import { parseCanvasCommand, resolveFrame } from './canvasCommands';
import { expandPlan, type A2uiMessage, type DeviceState, type SurfacePlan } from './surfacePlan';
import { gateMessages } from './gate';
import { CATALOG_SCHEMAS } from './catalogApi';
import { createSurfaceProposal, type SurfaceProposal } from './proposalBuffer';
import { createCanvasHistory, runSurfaceTurn, scriptedEngine, type DeviceHint, type EngineId, type PartialPlan, type SentInfo, type SurfaceEngine } from './aiTurn';
import { renderProposalCard, type ProposalStatus } from '../ux/proposal';
import { createDeviceStore, type DeviceConnector } from './deviceActions';
import { LampTileElement, PlanBoardElement, smartCanvasCatalog } from './widgets';

export const STORAGE_KEY = 'mc.canvas.v1';

export interface CanvasOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  connector?: DeviceConnector;
  devices?: Record<string, DeviceState>;
  reducedMotion?: boolean;
  engines?: Partial<Record<EngineId, (json: string) => SurfaceEngine>>;
  voice?: { supported: boolean; pushToTalkStart(): void; pushToTalkStop(): void } | null;
}

const STUB_DEVICES: Record<string, DeviceState> = { 'wiz-desk': { on: false, brightness: 40 }, 'wiz-ceiling': { on: true, brightness: 70 } };

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
  for (const El of [LampTileElement, PlanBoardElement]) {
    if (!customElements.get(El.tagName)) customElements.define(El.tagName, El as unknown as CustomElementConstructor);
  }
  const storage = opts.storage ?? localStorage;
  const reduced = opts.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stored: CanvasDoc | null = null;
  try { stored = parseCanvasDoc(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')); } catch { stored = null; }
  const doc = stored ?? seedDoc();
  const reg: FrameRegistry = createFrameRegistry(doc.frames);
  const surfaces: Record<string, SurfacePlan> = { ...doc.surfaces };
  let camera: Camera = doc.camera;
  let focusId: string | null = doc.focusId;
  let lastFocus: string | null = focusId;
  let savedAt: string | null = null;

  root.classList.add('mc-canvas');
  root.innerHTML = `
    <div class="mc-viewport" tabindex="-1"><div class="mc-world"></div></div>
    <header class="mc-bar">
      <button data-cmd="everything" class="mc-btn">Show everything</button>
      <button data-cmd="new" class="mc-btn">New board</button>
      <button data-cmd="save" class="mc-btn">Save</button>
      <form class="mc-say"><label class="mc-sr" for="mc-say-in">Say or type a command</label>
        <input id="mc-say-in" autocomplete="off" placeholder="Say: new canvas · show everything · go to floor plan" />
        <button class="mc-btn primary" type="submit">Go</button>
        <button class="mc-btn mc-mic" type="button" aria-pressed="false" hidden>Hold to talk</button></form>
      <button data-cmd="undo" class="mc-btn">Undo</button>
      <button data-cmd="ai" class="mc-btn" aria-expanded="false">AI activity</button>
      <p class="mc-canvas-status" role="status" aria-live="polite"></p>
    </header>
    <aside class="mc-ai" aria-label="AI activity" hidden>
      <h2 class="mc-ai-h">AI activity</h2>
      <p class="mc-ai-empty">When Nano or Gemini works on a board, you see the prompt going in, what left this device, and the reply as it streams.</p>
      <div class="mc-ai-turn" hidden>
        <p class="mc-ai-said"></p>
        <p class="mc-ai-route"></p>
        <details class="mc-ai-prompt" open><summary>Prompt going in</summary><pre></pre></details>
        <p class="mc-ai-sent"></p>
        <details class="mc-ai-reply" open><summary>Reply, streaming</summary><pre aria-live="off"></pre></details>
        <p class="mc-ai-state" aria-live="polite"></p>
      </div>
      <h3 class="mc-ai-h3">History</h3><ol class="mc-ai-history"></ol>
    </aside>`;
  const viewport = root.querySelector<HTMLElement>('.mc-viewport')!;
  const world = root.querySelector<HTMLElement>('.mc-world')!;
  const statusEl = root.querySelector<HTMLElement>('.mc-canvas-status')!;
  const aiPanel = root.querySelector<HTMLElement>('.mc-ai')!;
  const history = createCanvasHistory();
  const say = (t: string) => { statusEl.textContent = t; };

  // ---- A2UI ----
  const processor = new MessageProcessor([smartCanvasCatalog]);
  const live = new Set<string>();
  const store = createDeviceStore(opts.devices ?? STUB_DEVICES, opts.connector ?? {
    run: (i) => new Promise((res) => setTimeout(() => res({ on: i.on ?? store.get(i.deviceId).on, brightness: i.brightness ?? store.get(i.deviceId).brightness }), 300)),
  }, (m) => {
    const u = (m as unknown as { updateDataModel: Record<string, unknown> }).updateDataModel;
    for (const sid of live) processor.processMessages([{ ...m, updateDataModel: { ...u, surfaceId: sid } }] as never);
  }, () => 'fanout');

  processor.onSurfaceCreated((s: unknown) => {
    const sid = (s as { id: string }).id;
    const host = world.querySelector<HTMLElement>(`[data-frame="${sid}"] .mc-surface`);
    if (!host) return;
    host.innerHTML = '';
    const el = document.createElement('a2ui-surface') as HTMLElement & { surface: unknown };
    el.surface = s;
    host.append(el);
    live.add(sid);
    (s as { onAction: { subscribe(f: (a: { name: string; context: { deviceId: string } }) => void): void } }).onAction.subscribe((a) => {
      const id = a.context?.deviceId; const cur = id ? store.get(id) : undefined;
      if (!cur) return;
      if (a.name === 'lamp.toggle') void store.act({ deviceId: id, on: !cur.on });
      if (a.name === 'lamp.brighter') void store.act({ deviceId: id, on: true, brightness: cur.brightness + 20 });
      if (a.name === 'lamp.dimmer') void store.act({ deviceId: id, brightness: cur.brightness - 20 });
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

  // ---- frames DOM ----
  function frameEl(f: Frame): HTMLElement {
    let el = world.querySelector<HTMLElement>(`[data-frame="${f.id}"]`);
    if (!el) {
      el = document.createElement('section');
      el.className = 'mc-frame';
      el.dataset.frame = f.id;
      el.innerHTML = `<div class="mc-frame-head"><button class="mc-frame-title" data-focus="${f.id}"></button><span class="mc-chip"></span></div>
        <div class="mc-frame-body"><div class="mc-prop-host" hidden></div><div class="mc-ghost" hidden aria-hidden="true"></div><div class="mc-surface"></div><div class="mc-empty" hidden></div></div>`;
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
        empty.innerHTML = `<p class="mc-empty-lead">Empty board.</p><p>Say “connect everything in this room”, or start with:</p>
          <div class="mc-row"><button class="mc-btn primary" data-act="connect">Connect this room</button><button class="mc-btn" data-act="floorplan">Floor plan</button></div>`;
      }
    }
    root.dataset.mode = focusId ? 'focus' : 'overview';
    applyCamera();
  }

  const labelFor = (f: Frame) => (surfaces[f.id]?.kind === 'plan' || f.kind === 'plan' ? 'Floor plan' : surfaces[f.id] ? 'Room dashboard' : 'Empty');

  function applyCamera(): void {
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
  function snapshot(): CanvasDoc { return { version: CANVAS_DOC_VERSION, camera, focusId, frames: reg.list(), surfaces: { ...surfaces } }; }
  function persist(now = false): void {
    clearTimeout(persistTimer);
    const write = () => { try { storage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch { /* quota: keep running */ } };
    if (now) write(); else persistTimer = window.setTimeout(write, 250);
  }

  // ---- navigation ----
  async function focus(id: string): Promise<void> {
    const f = reg.get(id); if (!f) return;
    focusId = id; lastFocus = id; sync();
    await flyTo(focusOnInset(f.rect, vp(), barH()));
    window.dispatchEvent(new Event('resize')); // let the plan engine re-measure at 1:1
    say(`Editing ${f.title}. Say “show everything” to zoom out.`);
  }
  async function overview(): Promise<void> {
    focusId = null; sync();
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
    geminiRoom: '{"kind":"room","title":"Living room","tiles":[{"type":"lamp","deviceId":"wiz-ceiling","label":"Main light"},{"type":"lamp","deviceId":"wiz-desk","label":"Reading lamp"},{"type":"plan","boardId":"room-plan","template":"oneRoom"}]}',
    nanoPlan: '{"kind":"plan","title":"Floor plan","tiles":[{"type":"plan","boardId":"BOARD-cad","template":"twoBedroom"}]}',
  };
  const engineFor = (id: EngineId, json: string): SurfaceEngine => opts.engines?.[id]?.(json) ?? scriptedEngine(id, json);
  const DEVICE_LABELS: Record<string, string> = { 'wiz-desk': 'Desk lamp', 'wiz-ceiling': 'Ceiling light' };
  const deviceHints = (): DeviceHint[] => Object.keys(store.all()).map((id) => ({ id, label: DEVICE_LABELS[id] ?? id, kind: 'lamp' }));
  let pending: { frameId: string; prop: SurfaceProposal; card: HTMLElement } | null = null;

  function showAi(on = true): void {
    const changed = aiPanel.hidden === on;
    aiPanel.hidden = !on;
    root.querySelector('[data-cmd=ai]')!.setAttribute('aria-expanded', String(on));
    if (changed && focusId) { const f = reg.get(focusId); if (f) void flyTo(focusOnInset(f.rect, vp(), barH())); }
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
    aiPanel.querySelector('.mc-ai-reply pre')!.textContent = '';
    aiPanel.querySelector('.mc-ai-state')!.textContent = s.engine === 'nano' ? 'Quick is drafting on this device…' : 'Deep is improving it online…';
  }
  function ghost(frameId: string, g: PartialPlan | null): void {
    const el = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-ghost`);
    if (!el) return;
    if (!g) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<p class="mc-ghost-title">${esc(g.title ?? '…')}</p>` + g.tiles.map((t) =>
      `<div class="mc-ghost-tile ${t.type}">${t.type === 'lamp' ? `Lamp · ${esc(t.label)}` : 'Floor plan'}</div>`).join('') + '<div class="mc-ghost-tile next">…</div>';
  }
  function historyRender(): void {
    aiPanel.querySelector('.mc-ai-history')!.innerHTML = history.list().slice().reverse().map((h) =>
      `<li class="${h.undone ? 'undone' : ''}">${esc(h.summary)} · ${h.by === 'gemini' ? 'Deep' : h.by === 'nano' ? 'Quick' : 'You'}${h.undone ? ' · undone' : ''}</li>`).join('');
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
    const check = gateMessages(expandPlan(plan, frameId, store.all()), CATALOG_SCHEMAS);
    if (!check.ok) { ghost(frameId, null); say('Blocked a plan that did not pass the check.'); return false; }
    const si = sentInfo as SentInfo;
    aiPanel.querySelector('.mc-ai-state')!.textContent = 'Waiting for you. Nothing changes until you keep it.';
    return new Promise((done) => {
      const before = surfaces[frameId] ?? null;
      const prop = createSurfaceProposal(`p-${Date.now()}`, engineId, summary, check.messages, () => {
        surfaces[frameId] = plan; reg.rename(frameId, plan.title); reg.setKind(frameId, plan.kind === 'plan' ? 'plan' : 'room');
        history.push({ frameId, before, after: plan, by: engineId, summary });
        renderSurface(frameId); sync(); persist(); historyRender();
      });
      const host = world.querySelector<HTMLElement>(`[data-frame="${frameId}"] .mc-prop-host`)!;
      const finish = (kept: boolean) => {
        host.hidden = true; host.innerHTML = ''; ghost(frameId, null); pending = null;
        aiPanel.querySelector('.mc-ai-state')!.textContent = kept ? `Kept. Say “undo” to put it back.` : 'Dropped. Nothing changed.';
        say(kept ? `Kept: ${summary}. Say “undo” to put it back.` : 'Dropped. Nothing changed.');
        done(kept);
      };
      const card = renderProposalCard(document, {
        id: `p-${frameId}`, title: summary, youAsked: utterance, status,
        catalog: { helper: engineId === 'nano' ? 'Quick' : 'Deep', byLine: engineId === 'nano' ? 'Quick · on this device' : 'Deep · online',
          routeLine: si.routeLine, lineId: 'custom', whyLabel: engineId === 'nano' ? 'Why here' : 'Why online', whatWasSent: si.sent, technicalLine: si.routeLine },
      }, { onKeep: () => { prop.accept(); finish(true); }, onDrop: () => { prop.reject(); finish(false); } });
      host.innerHTML = ''; host.append(card); host.hidden = false;
      pending = { frameId, prop, card };
      say(`${summary}. Pinch or say “keep”; brush or say “drop”.`);
    });
  }

  async function connectRoom(frameId: string, utterance = 'connect everything in this room'): Promise<void> {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    const kept = await aiTurn(frameId, 'nano', utterance, SCRIPTS.nanoRoom, 'Draft: 2 lamps found in this room', 'guess');
    if (!kept) return;
    await aiTurn(frameId, 'gemini', utterance, SCRIPTS.geminiRoom, 'Better: grouped lights + a room plan', 'changed');
  }
  function floorPlan(frameId: string): void {
    if (pending) { say('Finish the waiting proposal first: keep or drop.'); return; }
    void aiTurn(frameId, 'nano', 'start a floor plan', SCRIPTS.nanoPlan, 'Floor plan: two bedrooms', 'waiting');
  }
  function keep(): void { if (pending) (pending.card.querySelector('.mc-proposal-keep') as HTMLButtonElement)?.click(); else say('Nothing is waiting.'); }
  function drop(): void { if (pending) (pending.card.querySelector('.mc-proposal-drop') as HTMLButtonElement)?.click(); else say('Nothing is waiting.'); }
  function undo(): void {
    const h = history.undo();
    if (!h) { say('Nothing to undo.'); return; }
    if (h.before) { surfaces[h.frameId] = h.before; reg.rename(h.frameId, h.before.title); } else { delete surfaces[h.frameId]; live.delete(h.frameId); }
    const el = world.querySelector<HTMLElement>(`[data-frame="${h.frameId}"] .mc-surface`);
    if (el && !h.before) el.innerHTML = '';
    if (h.before) renderSurface(h.frameId);
    sync(); persist(); historyRender();
    say(`Undid: ${h.summary}.`);
  }

  // ---- commands ----
  function run(text: string): boolean {
    const c = parseCanvasCommand(text);
    if (!c) {
      if (/\bconnect (everything|all|the room|this room|my room)\b/i.test(text)) {
        const target = focusId ?? reg.add('note', `Board ${reg.list().length + 1}`).id;
        if (!focusId) { sync(); void focus(target); }
        void connectRoom(target, text); return true;
      }
      say(`“${text}” isn’t a canvas command yet.`); return false;
    }
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
      case 'pin': { const id = focusId ?? lastFocus; if (id) { reg.setPinned(id, c.on); sync(); persist(); say(c.on ? 'Pinned. It docks beside the next board.' : 'Unpinned.'); } break; }
      case 'buildNext': {
        const cur = focusId ?? lastFocus;
        if (cur && surfaces[cur]) reg.setPinned(cur, true);
        save(); newBoard(); say('Saved. New board ready; your dashboard stays pinned.'); break;
      }
    }
    return true;
  }

  // ---- input ----
  root.querySelector('.mc-bar')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]'); if (!b) return;
    ({ everything: () => void overview(), new: newBoard, save, undo, ai: () => { showAi(aiPanel.hidden === true); } } as Record<string, () => void>)[b.dataset.cmd!]?.();
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
  addEventListener('resize', () => { if (focusId) { const f = reg.get(focusId); if (f) { camera = focusOnInset(f.rect, vp(), barH()); applyCamera(); } } });

  // Push-to-talk where the browser has speech recognition (Chrome, Android).
  const mic = root.querySelector<HTMLButtonElement>('.mc-mic')!;
  const voice = opts.voice ?? null;
  if (voice?.supported) {
    mic.hidden = false;
    const start = () => { mic.setAttribute('aria-pressed', 'true'); voice.pushToTalkStart(); say('Listening…'); };
    const stop = () => { mic.setAttribute('aria-pressed', 'false'); voice.pushToTalkStop(); };
    mic.addEventListener('pointerdown', start); mic.addEventListener('pointerup', stop); mic.addEventListener('pointerleave', stop);
  }

  sync();
  if (focusId) void focus(focusId); else if (!stored) void overview();

  return { run, focus, overview, save, keep, drop, undo, store, snapshot, history: () => history.list(), frames: () => reg.list() };
}
export type CanvasHandle = ReturnType<typeof mountCanvas>;
