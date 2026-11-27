// "build the dashboard" on an existing dashboard: the live run reviewed a
// plan that was only "Connect a device" (the speaker and gimbal tiles gone,
// the answering WiZ lamp ignored). These pin the deterministic floor under
// every room turn, whichever engine wrote it — and that it never overrides
// her: a board she narrowed, or a tile she took off, stays that way.
import { describe, expect, it } from 'vitest';
import { runSurfaceTurn, NANO_STILL_LOADING, type SurfaceEngine, type SurfaceRequest } from '../../src/canvas/aiTurn';
import { answeringDevices, createDismissals, isHerChange, keepRoomDevices, keptRoomLine, leafTiles, narrowingOf, ROW_MAX_CHILDREN, type KeepRoomDevicesInput } from '../../src/canvas/roomRebuild';
import { fitLampTiles } from '../../src/canvas/realLamps';
import { draftSummary, roomSummary } from '../../src/canvas/planTruth';
import { diffPlans } from '../../src/canvas/planDiff';
import { createDeviceIdSession } from '../../src/privacy/deviceRedact';
import type { DeviceState, SurfacePlan, TileSpec } from '../../src/canvas/surfacePlan';
import { MAX_TILES } from '../../src/canvas/surfacePlan';

const CONNECT_ONLY = '{"kind":"room","title":"Smart Home Dashboard","tiles":[{"type":"connect","label":"Connect a device"}]}';
const connectOnly = (): SurfacePlan => JSON.parse(CONNECT_ONLY);
const dashboard: SurfacePlan = {
  kind: 'room', title: 'Smart Home Dashboard',
  tiles: [{ type: 'music', deviceId: 'speaker-a', label: 'Speaker' }, { type: 'gimbal', label: 'Gimbal' }],
};
const lampOn = (unreachable = false): DeviceState => ({ on: true, brightness: 80, sim: unreachable, unreachable });
const store: Record<string, DeviceState> = {
  'wiz-lamp-1': lampOn(),
  'speaker-a': { on: false, playing: false, volume: 40 } as DeviceState,
};
const labels: Record<string, string> = { 'wiz-lamp-1': 'Lamp', 'wiz-lamp-2': 'Desk lamp', 'speaker-a': 'Speaker' };
const kinds: Record<string, string> = { 'speaker-a': 'music' };
const hints = (all: Record<string, DeviceState>, live = true) => answeringDevices(all, { label: (id) => labels[id] ?? id, kind: (id) => kinds[id] ?? 'lamp', live });
const deviceIds = (p: SurfacePlan) => leafTiles(p.tiles).flatMap((t) => ('deviceId' in t ? [t.deviceId] : [])).sort();
const hasGimbal = (p: SurfacePlan) => leafTiles(p.tiles).some((t) => t.type === 'gimbal');
const keep = (proposed: SurfacePlan, o: Partial<KeepRoomDevicesInput> & { all?: Record<string, DeviceState> } = {}) =>
  keepRoomDevices(proposed, { before: dashboard, answering: hints(o.all ?? store), stand: true, ...o });

describe('answeringDevices: the room turn is told about every device that answers', () => {
  it('a found WiZ lamp and the speaker are both listed', () => {
    expect(hints(store).map((d) => d.id)).toEqual(['wiz-lamp-1', 'speaker-a']);
  });
  // (sim-main's seeded SIM lamps are gone; only the remembered-lamp half remains.)
  it('a remembered lamp that is not reachable is left out', () => {
    const all = { ...store, 'wiz-lamp-2': lampOn(true) };
    expect(hints(all).map((d) => d.id)).toEqual(['wiz-lamp-1', 'speaker-a']);
  });
});

describe('keepRoomDevices: a rebuild never drops a real device tile', () => {
  it('a reply with only a Connect tile gets the speaker, the gimbal and the lamp back', () => {
    const k = keep(connectOnly());
    expect(deviceIds(k.plan)).toEqual(['speaker-a', 'wiz-lamp-1']);
    expect(hasGimbal(k.plan)).toBe(true);
    expect(k.restored).toEqual(['Speaker', 'Gimbal']);
    expect(k.added).toEqual(['Lamp']);
    expect(keptRoomLine(k)).toBe('Kept Speaker and Gimbal (the reply left them out); added Lamp (it answers here).');
    // the honest diff: nothing removed, the lamp added
    const changes = diffPlans(dashboard, k.plan, { devices: store });
    expect(changes.some((c) => c.op === 'remove')).toBe(false);
    expect(changes.some((c) => c.op === 'add' && /lamp/i.test(c.label))).toBe(true);
    // the headline counts what is really there
    expect(draftSummary(k.plan)).toBe('Draft: 1 lamp and 1 speaker found in this room');
    expect(roomSummary(k.plan)).toMatch(/^This room: 1 lamp and 1 speaker/);
  });
  it('a board tile for a lamp that is not reachable is not put back (and never named as kept)', () => {
    const before: SurfacePlan = { kind: 'room', title: 'x', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-2', label: 'Desk lamp' }, ...dashboard.tiles] };
    const k = keep(connectOnly(), { before, all: { ...store, 'wiz-lamp-2': lampOn(true) } });
    expect(deviceIds(k.plan)).toEqual(['speaker-a', 'wiz-lamp-1']);
    expect(keptRoomLine(k)).not.toMatch(/Desk lamp/);
  });
  it('the gimbal tile is kept or added only while the iPhone reports a stand', () => {
    const proposed: SurfacePlan = { kind: 'room', title: 'x', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] };
    expect(leafTiles(keep(proposed, { before: null, answering: [] }).plan.tiles).map((t) => t.type)).toEqual(['lamp', 'gimbal']);
    expect(keep(proposed, { before: null, answering: [], stand: false }).plan).toBe(proposed);
    // the stand went away: the old board's gimbal tile is not put back
    const k = keep(connectOnly(), { stand: false });
    expect(hasGimbal(k.plan)).toBe(false);
    expect(k.restored).toEqual(['Speaker']);
  });
  it('a tile for a device that is gone is not brought back; a plan that already has everything is untouched', () => {
    const before: SurfacePlan = { kind: 'room', title: 'x', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-9', label: 'Old lamp' }] };
    const proposed: SurfacePlan = { kind: 'room', title: 'x', tiles: [{ type: 'card', title: 'All', children: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }, { type: 'music', deviceId: 'speaker-a', label: 'Speaker' }] }] };
    const k = keep(proposed, { before, stand: false });
    expect(k.plan).toBe(proposed);
    expect(keptRoomLine(k)).toBe('');
  });
  it('a floor plan is never touched', () => {
    const plan: SurfacePlan = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'b-cad', template: 'blank' }] };
    expect(keep(plan).plan).toBe(plan);
  });
});

describe('she narrows the board: the floor follows her words', () => {
  const lampsOnly: SurfacePlan = { kind: 'room', title: 'Lights', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] };
  it('narrowing words count only with a device or kind named after them', () => {
    expect(narrowingOf('build me a dashboard with only the lamps')).toMatchObject({ mode: 'only', kinds: new Set(['lamp']) });
    expect(narrowingOf('build the dashboard without the speaker')).toMatchObject({ mode: 'without', kinds: new Set(['music']) });
    expect(narrowingOf('remove the gimbal')).toMatchObject({ mode: 'without', kinds: new Set(['gimbal']) });
    expect(narrowingOf('only the desk lamp', [{ id: 'wiz-lamp-2', label: 'Desk lamp' }])?.ids).toEqual(new Set(['wiz-lamp-2']));
    expect(narrowingOf('build the dashboard')).toBeNull();
    expect(narrowingOf('just build the dashboard')).toBeNull();
    expect(narrowingOf('connect everything in this room, no rush')).toBeNull();
    expect(narrowingOf('build the dashboard with no speaker')).toMatchObject({ mode: 'without', kinds: new Set(['music']) });
    expect(narrowingOf('only my lamps and the speaker')).toMatchObject({ mode: 'only', kinds: new Set(['lamp', 'music']) });
  });
  it('no false narrowings: the kind must follow the word, and "don\'t" cancels it', () => {
    expect(narrowingOf('just build me a dashboard for my lights')).toBeNull();
    expect(narrowingOf('no problem, build the lights dashboard')).toBeNull();
    expect(narrowingOf("don't remove the speaker")).toBeNull();
    expect(narrowingOf('do not drop the gimbal')).toBeNull();
    expect(narrowingOf('never remove my lamps')).toBeNull();
    expect(narrowingOf('only build it once, with the lamps')).toBeNull();
  });
  it('"only the lamps": the speaker and gimbal are not put back, no other kind is added', () => {
    const k = keep(lampsOnly, { utterance: 'build me a dashboard with only the lamps' });
    expect(k.plan).toBe(lampsOnly);
    expect(keptRoomLine(k)).toBe('');
  });
  it('"only the lamps" with a reply that forgot a lamp: only lamps are added', () => {
    const all = { ...store, 'wiz-lamp-2': lampOn() };
    const k = keep(connectOnly(), { utterance: 'only the lamps', all });
    expect(deviceIds(k.plan)).toEqual(['wiz-lamp-1', 'wiz-lamp-2']);
    expect(hasGimbal(k.plan)).toBe(false);
  });
  it('"without the speaker": everything else is still kept', () => {
    const k = keep(connectOnly(), { utterance: 'build the dashboard without the speaker' });
    expect(deviceIds(k.plan)).toEqual(['wiz-lamp-1']);
    expect(hasGimbal(k.plan)).toBe(true);
  });
  it('a tile she took off stays off on a later plain rebuild; a lamp that only went missing while unreachable comes back', () => {
    const d = createDismissals();
    const real = (all: Record<string, DeviceState>) => (k: string) => k === 'gimbal' || hints(all).some((h) => h.id === k);
    // turn 1: she kept "only the lamps" — the speaker and gimbal went off by her choice
    const withLamp: SurfacePlan = { ...dashboard, tiles: [...dashboard.tiles, { type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] };
    d.note('b1', withLamp, lampsOnly, real(store));
    // turn 2: a plain rebuild whose reply forgets everything
    const k = keep(connectOnly(), { before: lampsOnly, dismissed: d.of('b1', lampsOnly), utterance: 'build the dashboard' });
    expect(deviceIds(k.plan)).toEqual(['wiz-lamp-1']);
    expect(hasGimbal(k.plan)).toBe(false);

    // a lamp flips unreachable → reachable between two turns
    const d2 = createDismissals();
    const off = { ...store, 'wiz-lamp-1': lampOn(true) };
    const t1 = keep(connectOnly(), { before: withLamp, all: off });
    expect(deviceIds(t1.plan)).toEqual(['speaker-a']); // unreachable: not put back
    d2.note('b1', withLamp, t1.plan, real(off)); // she kept it while the lamp was unreachable
    expect(d2.of('b1', t1.plan).has('wiz-lamp-1')).toBe(false);
    const t2 = keep(connectOnly(), { before: t1.plan, dismissed: d2.of('b1', t1.plan) });
    expect(deviceIds(t2.plan)).toEqual(['speaker-a', 'wiz-lamp-1']); // answers again: back on the board
    expect(t2.added).toEqual(['Lamp']);
  });
});

describe('dismissals: only her changes, and they survive a reload', () => {
  const real = (k: string) => k === 'gimbal' || hints(store).some((h) => h.id === k);
  const withLamp: SurfacePlan = { ...dashboard, tiles: [...dashboard.tiles, { type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] };
  const noSpeaker: SurfacePlan = { ...withLamp, tiles: withLamp.tiles.filter((t) => t.type !== 'music') };
  // what canvasApp's history wrapper does with each push (and proposePlan on keep)
  const record = (d: ReturnType<typeof createDismissals>, e: { by: string; kind?: string; before: SurfacePlan; after: SurfacePlan }, kept = false) => {
    if (isHerChange(e, { kept })) d.note('b1', e.before, e.after, real);
  };
  it('a Gemini self-check fix (or a morph patch) that drops a tile is NOT a dismissal; her edit and her kept review are', () => {
    const d = createDismissals();
    record(d, { by: 'gemini', before: withLamp, after: noSpeaker }); // self-check fix, never reviewed
    expect(d.of('b1', noSpeaker).size).toBe(0);
    expect(deviceIds(keep(connectOnly(), { before: noSpeaker, dismissed: d.of('b1', noSpeaker) }).plan)).toEqual(['speaker-a', 'wiz-lamp-1']);
    record(d, { by: 'her', before: withLamp, after: noSpeaker }); // e.g. sent the tile to the phone
    expect([...d.of('b1', noSpeaker)]).toEqual(['speaker-a']);
    const d2 = createDismissals();
    record(d2, { by: 'gemini', before: withLamp, after: noSpeaker }, true); // a review she kept
    expect([...d2.of('b1', noSpeaker)]).toEqual(['speaker-a']);
    expect(isHerChange({ by: 'her', kind: 'layout' })).toBe(false);
  });
  it('round-trips through storage, only for boards that still exist', () => {
    const d = createDismissals();
    d.note('b1', withLamp, noSpeaker, real);
    d.note('b2', withLamp, noSpeaker, real);
    const saved = JSON.parse(JSON.stringify(d.toJSON((id) => id === 'b1')));
    expect(saved).toEqual({ b1: ['speaker-a'] });
    const back = createDismissals(saved);
    expect([...back.of('b1', noSpeaker)]).toEqual(['speaker-a']);
    expect(back.of('b2', noSpeaker).size).toBe(0);
    expect(createDismissals({ b1: [1, null] as unknown as string[] }).of('b1', null).size).toBe(0);
  });
});

describe('placement and fitting', () => {
  const stats = (n: number): TileSpec[] => Array.from({ length: n }, (_, i) => ({ type: 'stat' as const, label: `S${i}`, value: '1' }));
  it('a full board keeps its top-level cap: the extras share one row', () => {
    const k = keep({ kind: 'room', title: 'x', tiles: stats(MAX_TILES) });
    expect(k.plan.tiles.length).toBe(MAX_TILES);
    expect(deviceIds(k.plan)).toEqual(['speaker-a', 'wiz-lamp-1']);
  });
  it('a full board ending in a row: the extras extend that row (no row inside a row)', () => {
    const tiles: TileSpec[] = [...stats(MAX_TILES - 1), { type: 'row', children: stats(2) }];
    const k = keep({ kind: 'room', title: 'x', tiles });
    const last = k.plan.tiles[k.plan.tiles.length - 1];
    expect(last.type).toBe('row');
    expect(last.type === 'row' && last.children.some((c) => c.type === 'row')).toBe(false);
    expect(last.type === 'row' && last.children.length).toBe(5);
  });
  it('past the row cap the joined tiles become a grid', () => {
    const tiles: TileSpec[] = [...stats(MAX_TILES - 1), { type: 'row', children: stats(ROW_MAX_CHILDREN) }];
    const k = keep({ kind: 'room', title: 'x', tiles });
    const last = k.plan.tiles[k.plan.tiles.length - 1];
    expect(last.type).toBe('grid');
    expect(deviceIds(k.plan)).toEqual(['speaker-a', 'wiz-lamp-1']);
  });
  it('the result is fitted, and the line names only tiles that survive the fit', () => {
    // a fit that knows no lamps (the bulb went between reply and review)
    const k = keep(connectOnly(), { fit: (p) => fitLampTiles(p, []) });
    expect(deviceIds(k.plan)).toEqual(['speaker-a']);
    expect(keptRoomLine(k)).toBe('Kept Speaker and Gimbal (the reply left them out).');
  });
});

describe('the Gemini handoff path gets the same floor (fake engines)', () => {
  it('Nano still loading → Gemini replies with only a Connect tile → the kept plan still has every real tile', async () => {
    const req: SurfaceRequest = { utterance: 'build the dashboard', frameTitle: 'Smart Home Dashboard', frameId: 'b1', devices: hints(store), current: dashboard, want: 'room' };
    const prompts: string[] = [];
    const gemini: SurfaceEngine = { id: 'gemini', sim: false, stream: async (p, onText, so) => { prompts.push(p); so?.onCloudSend?.(); onText(CONNECT_ONLY); return CONNECT_ONLY; } };
    const nano: SurfaceEngine = { id: 'nano', sim: false, handoff: gemini, stream: async () => { throw new Error(NANO_STILL_LOADING); } };
    const handoffs: string[] = [];
    const plan = await runSurfaceTurn(req, nano, { onHandoff: (_s, why) => handoffs.push(why) }, { deviceIdSession: createDeviceIdSession() });
    expect(handoffs).toEqual([NANO_STILL_LOADING]);
    // the prompt named both devices (redacted)
    expect(prompts[0]).toMatch(/Device 1: Lamp \(lamp\)/);
    expect(prompts[0]).toMatch(/Device 2: Speaker \(music\)/);
    expect(plan && deviceIds(plan)).toEqual([]);
    const k = keep(plan!, { utterance: req.utterance, answering: req.devices });
    expect(deviceIds(k.plan)).toEqual(['speaker-a', 'wiz-lamp-1']);
    expect(hasGimbal(k.plan)).toBe(true);
  });
});
