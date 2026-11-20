// A2UI spike page (sim-main only, /spike.html). Throwaway harness: Nano-style
// draft -> gate -> Proposal -> render; Gemini-style upgrade -> Proposal; a
// forged message rejected by the gate; lamp tiles through a stub connector.
import '@a2ui/lit/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { coerceSurfacePlan, expandPlan, PROTOCOL, type A2uiMessage, type DeviceState } from './surfacePlan';
import { gateMessages } from './gate';
import { CATALOG_SCHEMAS } from './catalogApi';
import { createSurfaceProposal, type SurfaceProposal } from './proposalBuffer';
import { createDeviceStore } from './deviceActions';
import { LampTileElement, PlanBoardElement, smartCanvasCatalog } from './widgets';

for (const El of [LampTileElement, PlanBoardElement]) {
  if (!customElements.get(El.tagName)) customElements.define(El.tagName, El as unknown as CustomElementConstructor);
}

const SURFACE = 'room-1';
const root = document.getElementById('spike')!;
root.innerHTML = `
  <h1 style="font-size:28px;margin:0 0 4px">Smart canvas · A2UI spike</h1>
  <p id="log" role="status" style="margin:0 0 16px;color:var(--text-dim)">Empty canvas. Nothing rendered yet.</p>
  <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">
    <button id="b-draft" class="primary">1 · Nano draft</button>
    <button id="b-upgrade">2 · Gemini upgrade</button>
    <button id="b-evil">3 · Forged widget</button>
  </div>
  <section id="proposal" hidden style="border:2px solid var(--accent);border-radius:16px;padding:16px;margin-bottom:16px;background:var(--panel-2, #F1EEE6)"></section>
  <section id="surface-host"></section>`;
const log = (t: string) => { root.querySelector('#log')!.textContent = t; };

const processor = new MessageProcessor([smartCanvasCatalog]);
let surfaceLive = false;
processor.onSurfaceCreated((s: unknown) => {
  const host = root.querySelector('#surface-host')!;
  host.innerHTML = '';
  const el = document.createElement('a2ui-surface') as HTMLElement & { surface: unknown };
  el.surface = s;
  host.append(el);
  surfaceLive = true;
  (s as { onAction: { subscribe(f: (a: { name: string; context: { deviceId: string } }) => void): void } }).onAction.subscribe((a) => {
    const id = a.context.deviceId;
    const cur = store.get(id);
    if (!cur) return;
    if (a.name === 'lamp.toggle') void store.act({ deviceId: id, on: !cur.on });
    if (a.name === 'lamp.brighter') void store.act({ deviceId: id, on: true, brightness: cur.brightness + 20 });
    if (a.name === 'lamp.dimmer') void store.act({ deviceId: id, brightness: cur.brightness - 20 });
    log(`Tile action ${a.name} → lamp connector (stub, on this device)`);
  });
});

const apply = (msgs: A2uiMessage[]) => processor.processMessages(msgs as never);

// Fake WiZ lamp: answers in 300 ms, like the LAN bridge.
const devices: Record<string, DeviceState> = { 'wiz-desk': { on: false, brightness: 40 }, 'wiz-ceiling': { on: true, brightness: 70 } };
const store = createDeviceStore(devices, {
  run: (i) => new Promise((res) => setTimeout(() => res({ on: i.on ?? store.get(i.deviceId).on, brightness: i.brightness ?? store.get(i.deviceId).brightness }), 300)),
}, (m) => { if (surfaceLive) apply([m]); }, () => (surfaceLive ? SURFACE : null));

function propose(by: SurfaceProposal['by'], summary: string, raw: unknown, replace: boolean): void {
  const plan = coerceSurfacePlan(raw);
  if (!plan.ok) { log(`Refused plan: ${plan.error}`); return; }
  const msgs: A2uiMessage[] = [
    ...(replace && surfaceLive ? [{ version: PROTOCOL, deleteSurface: { surfaceId: SURFACE } } as A2uiMessage] : []),
    ...expandPlan(plan.value, SURFACE, store.all()),
  ];
  showProposal(by, summary, msgs);
}

function showProposal(by: SurfaceProposal['by'], summary: string, msgs: unknown): void {
  const gate = gateMessages(msgs, CATALOG_SCHEMAS);
  const card = root.querySelector<HTMLElement>('#proposal')!;
  if (!gate.ok) {
    card.hidden = false;
    card.innerHTML = `<b>Blocked before rendering</b><p>${gate.errors.map((e) => e.replace(/</g, '&lt;')).join('<br>')}</p>`;
    log('Gate refused the forged message. The renderer never saw it.');
    return;
  }
  const prop = createSurfaceProposal(`p-${Date.now()}`, by, summary, gate.messages, (m) => {
    if ((m[0] as Record<string, unknown>).deleteSurface) surfaceLive = false;
    apply(m);
  });
  const where = by === 'gemini' ? 'Gemini · cloud' : 'Nano · on device';
  card.hidden = false;
  card.innerHTML = `<div style="font-size:14px;color:var(--text-dim)">WAITING FOR YOU · ${where}</div>
    <div style="font-size:22px;font-weight:600;margin:4px 0 12px">${summary}</div>
    <div style="display:flex;gap:10px"><button id="p-keep" class="primary">Keep (pinch)</button><button id="p-drop">Drop (brush)</button></div>`;
  card.querySelector('#p-keep')!.addEventListener('click', () => { prop.accept(); card.hidden = true; log(`Kept: ${summary} (${where})`); });
  card.querySelector('#p-drop')!.addEventListener('click', () => { prop.reject(); card.hidden = true; log('Dropped. Nothing changed.'); });
  log(`Proposal waiting: ${summary}. Nothing rendered until you keep it.`);
}

root.querySelector('#b-draft')!.addEventListener('click', () => propose('nano', 'Room dashboard: 1 lamp', {
  kind: 'room', title: 'This room', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }],
}, true));
root.querySelector('#b-upgrade')!.addEventListener('click', () => propose('gemini', 'Grouped: 2 lamps + the floor plan', {
  kind: 'room', title: 'Studio', tiles: [
    { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' },
    { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling light' },
    { type: 'plan', boardId: 'plan-1', template: 'twoBedroom' },
  ],
}, true));
root.querySelector('#b-evil')!.addEventListener('click', () => showProposal('gemini', 'forged', [
  { version: PROTOCOL, updateComponents: { surfaceId: SURFACE, components: [{ id: 'x', component: 'EvilScript', src: 'alert(1)' }] } },
]));
(window as unknown as { __spike: unknown }).__spike = { store, processor };
