// @vitest-environment happy-dom
// The devices board is generated: a table tile with `source: 'devices'` whose
// rows the canvas fills from what each device really reports, at every
// render and whenever that changes. The model's rows are never kept.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { joinCanvasDoc } from '../../src/canvas/canvasPersistence';
import { coerceSurfacePlan, expandPlan, type SurfacePlan } from '../../src/canvas/surfacePlan';
import { coerceDeviceFields, LIVE_TABLE_EMPTY, liveRows, TICK, type DeviceRow } from '../../src/canvas/connectedDevices';
import { buildControlSnapshot, coerceDeviceRows, coerceSnapshot, DEVICE_ROWS_MAX } from '../../src/relay/controlSnapshot';
import { applyGuestSnapshot } from '../../src/canvas/phoneCanvasRuntime';
import { devicesPlanFromNano, NANO_DEVICES_CONSTRAINT, nanoDevicesPrompt } from '../../src/canvas/devicesTurn';
import { unsupportedConstraintKeywords } from '../../src/canvas/nanoPlan';
import { gateMessages } from '../../src/canvas/gate';
import { CATALOG_SCHEMAS } from '../../src/canvas/catalogApi';
import { isDevicesBoard } from '../../src/canvas/journey';
import { routeLine } from '../../src/canvas/routeLine';
import { buildSurfacePrompt, parseModelPlan } from '../../src/canvas/aiTurn';
import { board as sampleBoard } from '../artifacts/sample';
import type { CanvasDoc } from '../../src/canvas/frames';

const LIVE = { type: 'table', title: 'Devices', source: 'devices', fields: ['device', 'status'], rows: [['Fridge', 'Online'], ['Oven', 'Connected']], columns: ['Made', 'Up'] };
const ROWS: DeviceRow[] = [
  { device: 'iPhone', status: 'Paired · Gimbal: docked', ok: true, kind: 'Phone' },
  { device: 'Lamp', status: 'SIM lamp', ok: false, kind: 'Lamp' },
];
const tableOf = (msgs: ReturnType<typeof expandPlan>) => {
  const comps = (msgs.find((m) => 'updateComponents' in m) as { updateComponents: { components: Record<string, unknown>[] } }).updateComponents.components;
  return comps.find((c) => c.component === 'TableTile') as { rows: string[][]; columns: string[]; live: boolean };
};

describe('a live devices table', () => {
  it('a table with source devices shows the live rows and ignores model-written rows', () => {
    const r = coerceSurfacePlan({ kind: 'room', title: 'My devices', tiles: [LIVE] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.value.tiles[0] as { rows: string[][]; columns: string[]; source?: string };
    expect(t.source).toBe('devices');
    expect(t.rows).toEqual([]); // nothing the model wrote is kept, so nothing is stored
    expect(t.columns).toEqual(['Device', 'Status']);
    expect(isDevicesBoard(r.value)).toBe(true);
    const msgs = expandPlan(r.value, 'f1', {}, { deviceRows: ROWS });
    expect(gateMessages(msgs, CATALOG_SCHEMAS).ok).toBe(true);
    const table = tableOf(msgs);
    expect(table.live).toBe(true);
    expect(table.rows).toEqual([[`${TICK} iPhone`, 'Paired · Gimbal: docked'], ['Lamp', 'SIM lamp']]);
    expect(JSON.stringify(msgs)).not.toMatch(/Fridge|Oven/);
    // No rows handed in: an empty live table, never the model's.
    expect(tableOf(expandPlan(r.value, 'f1', {})).rows).toEqual([]);
    // A source other than devices is refused.
    expect(coerceSurfacePlan({ kind: 'room', title: 'X', tiles: [{ ...LIVE, source: 'weather' }] }).ok).toBe(false);
  });

  it('fields outside device/status/kind are dropped; no fields means device and status', () => {
    expect(coerceDeviceFields(['kind', 'ip', 'device', 'kind', 'battery'])).toEqual({ fields: ['kind', 'device'], dropped: 3 });
    expect(coerceDeviceFields(undefined)).toEqual({ fields: ['device', 'status'], dropped: 0 });
    expect(coerceDeviceFields(['mac'])).toEqual({ fields: ['device', 'status'], dropped: 1 });
    const r = coerceSurfacePlan({ kind: 'room', title: 'Devices', tiles: [{ ...LIVE, fields: ['device', 'ip', 'kind'] }] });
    expect(r.ok && r.notes).toEqual(["Dropped 1 column a live devices table can't show."]);
    const noFields = coerceSurfacePlan({ kind: 'room', title: 'Devices', tiles: [{ type: 'table', title: 'Devices', source: 'devices' }] });
    expect(noFields.ok && noFields.value.tiles[0]).toMatchObject({ fields: ['device', 'status'], columns: ['Device', 'Status'] });
    expect(liveRows('devices', ['kind', 'device'], ROWS)).toEqual([['Phone', `${TICK} iPhone`], ['Lamp', 'Lamp']]);
  });

  it('offline, Nano names the board and picks the columns; the board is built in code around the live table', () => {
    expect(unsupportedConstraintKeywords(NANO_DEVICES_CONSTRAINT)).toEqual([]);
    const rec = JSON.parse(readFileSync('tests/fixtures/written/nano.devices.json', 'utf8')) as { reply: string };
    const r = devicesPlanFromNano(rec.reply);
    expect(r.ok && r.value).toEqual({ kind: 'room', title: 'My devices', tiles: [{ type: 'table', title: 'Devices', columns: ['Device', 'Kind', 'Status'], rows: [], sortable: false, source: 'devices', fields: ['device', 'kind', 'status'] }] });
    expect(r.ok && isDevicesBoard(r.value)).toBe(true);
    expect(devicesPlanFromNano('{"fields":["device"]}').ok).toBe(false);
    expect(devicesPlanFromNano('{"title":"A very long board title here","fields":[]}').ok).toBe(false);
    expect(devicesPlanFromNano('not json').ok).toBe(false);
    const p = nanoDevicesPrompt('show my devices', ROWS);
    expect(p).toContain('- iPhone (Phone): Paired · Gimbal: docked');
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toMatch(/const out = nano \? await nanoDevicesTurn\(utterance, nano\) :/);
    // Either way the reply goes through the same gate and the same review.
    expect(app).toMatch(/if \(!isDevicesBoard\(out\.plan\)\) \{[\s\S]{0,300}await proposePlan\(frameId, utterance, withConnectAnother\(out\.plan\), out\.si/);
  });

  it('the devices reply fixture parses to a live board; its made-up rows and its ip field never survive', () => {
    const rec = JSON.parse(readFileSync('tests/fixtures/written/gemini.devices.json', 'utf8')) as { reply: string };
    const r = parseModelPlan(rec.reply);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isDevicesBoard(r.value)).toBe(true);
    expect(JSON.stringify(r.value)).not.toMatch(/Fridge|Oven|"ip"/);
    expect(r.notes).toContain("Dropped 1 column a live devices table can't show.");
  });

  it('the devices prompt lists the rows as words: no ids, no addresses', () => {
    const sent = buildSurfacePrompt({ utterance: 'show my devices', frameTitle: 'Devices', devices: [], want: 'devices',
      deviceRows: [{ device: 'iPhone', status: 'SIM · paired', kind: 'Phone' }, { device: 'Lamp', status: 'SIM lamp', kind: 'Lamp' }] }, 'gemini');
    expect(sent.prompt).toContain('- iPhone (Phone): SIM · paired\n- Lamp (Lamp): SIM lamp');
    expect(sent.prompt).toContain('"source":"devices"');
    expect(sent.prompt).not.toMatch(/wiz-lamp|192\.168/);
    expect(sent.sent).toBe('your words, 2 device names with their status. No device ids, no addresses.');
  });

  it('"show my devices" is a generation turn of its own; "connect devices" only pairs', () => {
    const world = { hasPlanBoard: false, devices: [] };
    expect(routeLine('show my devices', world).name).toBe('showDevices');
    expect(routeLine("what's connected?", world).name).toBe('showDevices');
    expect(routeLine('connect devices', world).name).toBe('connectDevices');
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toContain("case 'showDevices': void devicesTurn(text); return true;");
    expect(app).toMatch(/streamTurn\(frameId, 'gemini', utterance, 'devices'/);
    expect(app).not.toMatch(/connectedDevicesPlan|ensureDevicesBoard|refreshDevicesBoard|storedDoc\(|presentDeviceRows/);
    // The live table shows every row connectedDeviceRows gives (laptop, "Not paired", "None found yet").
    expect(app).toContain('const liveDeviceRows = (): DeviceRow[] => connectedDeviceRows(connectedInput());');
  });
});

describe('the live table on the canvas', () => {
  let handle: CanvasHandle | null = null;
  afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });

  it('a device that joins later appears in the table without a new turn', async () => {
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const plan: SurfacePlan = { kind: 'room', title: 'My devices', tiles: [{ type: 'table', title: 'Devices', columns: ['Device', 'Status'], rows: [], source: 'devices', fields: ['device', 'status'] }] };
    const doc = joinCanvasDoc({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1', frames: [{ id: 'f1', kind: 'room', title: 'My devices', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }] },
      [sampleBoard('f1', { title: 'My devices' }, plan)]) as CanvasDoc;
    const saved: CanvasDoc[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, {
      autoHands: false, reducedMotion: true, sim: true, connector: { run: async () => ({}) }, doc, onPersist: (d) => saved.push(d),
      devices: { 'wiz-lamp-1': { cls: 'lamp', on: false, brightness: 50, sim: true } }, deviceLabels: { 'wiz-lamp-1': 'Lamp' },
    });
    const rows = (): string[] => [...root.querySelectorAll('mc-table-tile')].flatMap((t) => [...(t.shadowRoot?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()).join(' | ')));
    const before = [`${TICK} Laptop | This canvas`, 'iPhone | Not paired', 'Nothing phone | Not paired', 'Lamp | SIM lamp'];
    await vi.waitFor(() => expect(rows()).toEqual(before), { timeout: 4000 });
    // A speaker joins: no turn, no review — the table follows what the devices report.
    handle.store.add('speaker-sim', { cls: 'music', on: false, brightness: 0, playing: false, sim: true });
    await vi.waitFor(() => expect(rows()).toEqual([...before, 'Speaker | SIM · simulated speaker']), { timeout: 4000 });
    // The rows are never stored with the board.
    handle.save();
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const t = saved.at(-1)!.surfaces.f1.tiles[0] as { rows: string[][] };
    expect(t.rows).toEqual([]);
  }, 15000);
});

describe('a devices board on the phone shows the laptop\'s rows', () => {
  let handle: CanvasHandle | null = null;
  afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });
  const DEV: SurfacePlan = { kind: 'room', title: 'My devices', tiles: [{ type: 'table', title: 'Devices', columns: ['Device', 'Status'], rows: [], source: 'devices', fields: ['device', 'status'] }] };
  const LAPTOP_ROWS: DeviceRow[] = [
    { device: 'Laptop', status: 'This canvas', ok: true, kind: 'Laptop' },
    { device: 'Nothing phone', status: 'Paired', ok: true, kind: 'Phone' },
    { device: 'Desk lamp', status: 'Answering', ok: true, kind: 'Lamp' },
  ];
  function phone(): { h: CanvasHandle; root: HTMLElement } {
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, phoneShell: true, nativePhone: false });
    return { h: handle, root };
  }
  const tableText = (root: HTMLElement): string => [...root.querySelectorAll('mc-table-tile')].map((t) => t.shadowRoot?.textContent ?? '').join(' ');
  const rowsOf = (root: HTMLElement): string[] => [...root.querySelectorAll('mc-table-tile')].flatMap((t) => [...(t.shadowRoot?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()).join(' | ')));
  const send = (h: CanvasHandle, o: Record<string, unknown>): boolean => {
    const snap = coerceSnapshot(JSON.parse(JSON.stringify(buildControlSnapshot({ rev: 1, board: DEV, boardFor: 'android', boardBy: 'gemini', pins: { ios: null, android: 'f4' }, boardPin: 'f4', ...o }))));
    return !!snap && applyGuestSnapshot(snap, h.showRemoteBoard, 'android', undefined, undefined, () => { h.clearRemoteBoards(); });
  };

  it('the sent rows, never "Not paired"; changed rows re-render', async () => {
    const { h, root } = phone();
    expect(send(h, { deviceRows: LAPTOP_ROWS })).toBe(true);
    await vi.waitFor(() => expect(rowsOf(root)).toEqual([`${TICK} Laptop | This canvas`, `${TICK} Nothing phone | Paired`, `${TICK} Desk lamp | Answering`]), { timeout: 4000 });
    expect(tableText(root)).not.toContain('Not paired');
    expect(send(h, { rev: 2, deviceRows: [...LAPTOP_ROWS, { device: 'iPhone', status: 'Paired · Gimbal: docked', ok: true, kind: 'Phone' }] })).toBe(true);
    await vi.waitFor(() => expect(rowsOf(root)).toContain(`${TICK} iPhone | Paired · Gimbal: docked`), { timeout: 4000 });
    expect(h.frames()).toHaveLength(1);
  }, 15000);

  it('a devices board with no rows yet (an old laptop) says so, never guesses', async () => {
    const { root, h } = phone();
    expect(send(h, {})).toBe(true);
    await vi.waitFor(() => expect(tableText(root)).toContain(LIVE_TABLE_EMPTY), { timeout: 4000 });
    expect(tableText(root)).not.toContain('Not paired');
  }, 15000);

  it('rows on the wire are checked and capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ device: `D${i}`, status: 'x'.repeat(200), ok: i % 2 === 0 ? true : 'yes', kind: 'k'.repeat(50) }));
    const snap = coerceSnapshot(JSON.parse(JSON.stringify({ ...buildControlSnapshot({ rev: 1, board: DEV, boardBy: 'gemini' }), deviceRows: [...many, { status: 'no name' }] })))!;
    expect(snap.deviceRows).toHaveLength(DEVICE_ROWS_MAX);
    expect(snap.deviceRows![0].status).toHaveLength(80);
    expect(snap.deviceRows![0].kind).toHaveLength(24);
    expect(snap.deviceRows![1].ok).toBe(false);
    expect(coerceSnapshot({ v: 1, rev: 1, deviceRows: [{ device: 'x', status: 'y', ok: true }] })!.deviceRows).toBeUndefined(); // no board, no rows
    expect(coerceDeviceRows('nope')).toBeNull();
    expect(coerceDeviceRows([{ device: '<b>Lamp</b>', status: 'ok', ok: true }])).toEqual([{ device: 'b Lamp /b', status: 'ok', ok: true }]);
  });
});

describe('the laptop puts its live rows beside a devices board it sends', () => {
  let handle: CanvasHandle | null = null;
  afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; try { localStorage.clear(); } catch { /* none */ } });
  type Win = { __mcLastBoardSnapshot?: { deviceRows?: DeviceRow[]; boardSend?: unknown; board?: unknown } };
  it('at the send, and again (no arrival stamp) when the rows change', async () => {
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const plan: SurfacePlan = { kind: 'room', title: 'My devices', tiles: [{ type: 'table', title: 'Devices', columns: ['Device', 'Status'], rows: [], source: 'devices', fields: ['device', 'status'] }] };
    const doc = joinCanvasDoc({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1', frames: [{ id: 'f1', kind: 'room', title: 'My devices', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }] },
      [sampleBoard('f1', { title: 'My devices' }, plan)]) as CanvasDoc;
    delete (window as Win).__mcLastBoardSnapshot;
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, {
      autoHands: false, reducedMotion: true, sim: true, connector: { run: async () => ({}) }, doc, artifactBy: () => 'gemini',
      devices: { 'wiz-lamp-1': { cls: 'lamp', on: false, brightness: 50, sim: true } }, deviceLabels: { 'wiz-lamp-1': 'Lamp' },
    });
    const h = handle;
    h.run('connect devices');
    await vi.waitFor(() => expect(h.edgeLayout().right).toBeTruthy(), { timeout: 18000 });
    await h.focus('f1');
    expect(await h.sendBoard('right')).toBe(true);
    const sent = (window as Win).__mcLastBoardSnapshot!;
    expect(sent.deviceRows?.map((r) => r.device)).toContain('Lamp');
    expect(sent.deviceRows?.map((r) => r.device)).not.toContain('Speaker');
    h.store.add('speaker-sim', { cls: 'music', on: false, brightness: 0, playing: false, sim: true });
    await vi.waitFor(() => expect((window as Win).__mcLastBoardSnapshot!.deviceRows?.map((r) => r.device)).toContain('Speaker'), { timeout: 6000 });
    const again = (window as Win).__mcLastBoardSnapshot!;
    expect(again.board).toBeTruthy();
    expect(again.boardSend).toBeUndefined();
  }, 45000);
});
