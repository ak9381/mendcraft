// "build the dashboard" on an existing dashboard: the live run reviewed a
// plan that was only "Connect a device" (the speaker and gimbal tiles gone,
// the answering WiZ lamp ignored). These pin the deterministic floor under
// every room turn, whichever engine wrote it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runSurfaceTurn, NANO_STILL_LOADING, type SurfaceEngine, type SurfaceRequest } from '../../src/canvas/aiTurn';
import { answeringDevices, keepRoomDevices, keptRoomLine, leafTiles } from '../../src/canvas/roomRebuild';
import { draftSummary, roomSummary } from '../../src/canvas/planTruth';
import { diffPlans } from '../../src/canvas/planDiff';
import { createDeviceIdSession } from '../../src/privacy/deviceRedact';
import type { DeviceState, SurfacePlan } from '../../src/canvas/surfacePlan';
import { MAX_TILES } from '../../src/canvas/surfacePlan';

const CONNECT_ONLY = '{"kind":"room","title":"Smart Home Dashboard","tiles":[{"type":"connect","label":"Connect a device"}]}';
const dashboard: SurfacePlan = {
  kind: 'room', title: 'Smart Home Dashboard',
  tiles: [{ type: 'music', deviceId: 'speaker-1', label: 'Speaker' }, { type: 'gimbal', label: 'Gimbal' }],
};
const store: Record<string, DeviceState> = {
  'wiz-lamp-1': { on: true, brightness: 80, sim: false, unreachable: false },
  'speaker-1': { on: false, playing: false, volume: 40 } as DeviceState,
};
const labels: Record<string, string> = { 'wiz-lamp-1': 'Lamp', 'speaker-1': 'Speaker' };
const kinds: Record<string, string> = { 'speaker-1': 'music' };
const hints = (all: Record<string, DeviceState>, live = true) => answeringDevices(all, { label: (id) => labels[id] ?? id, kind: (id) => kinds[id] ?? 'lamp', live });
const deviceIds = (p: SurfacePlan) => leafTiles(p.tiles).flatMap((t) => ('deviceId' in t ? [t.deviceId] : []));

describe('answeringDevices: the room turn is told about every device that answers', () => {
  it('a found WiZ lamp and the speaker are both listed', () => {
    expect(hints(store).map((d) => d.id)).toEqual(['wiz-lamp-1', 'speaker-1']);
  });
  it('a remembered lamp that is not reachable is left out; a seeded SIM lamp only on a SIM canvas', () => {
    const all = { ...store, 'wiz-lamp-2': { on: false, brightness: 50, sim: true, unreachable: true }, 'wiz-desk': { on: true, brightness: 50, sim: true } };
    expect(hints(all).map((d) => d.id)).toEqual(['wiz-lamp-1', 'speaker-1']);
    expect(hints(all, false).map((d) => d.id)).toEqual(['wiz-lamp-1', 'speaker-1', 'wiz-desk']);
  });
});

describe('keepRoomDevices: a rebuild never drops a real device tile', () => {
  const known = new Set(Object.keys(store));
  it('a reply with only a Connect tile gets the speaker, the gimbal and the lamp back', () => {
    const proposed: SurfacePlan = JSON.parse(CONNECT_ONLY);
    const k = keepRoomDevices(proposed, { before: dashboard, answering: hints(store), known, stand: true });
    expect(deviceIds(k.plan).sort()).toEqual(['speaker-1', 'wiz-lamp-1']);
    expect(leafTiles(k.plan.tiles).some((t) => t.type === 'gimbal')).toBe(true);
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
  it('a gimbal tile joins a new dashboard while the iPhone reports a stand, not otherwise', () => {
    const proposed: SurfacePlan = { kind: 'room', title: 'x', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] };
    expect(leafTiles(keepRoomDevices(proposed, { before: null, answering: [], known, stand: true }).plan.tiles).map((t) => t.type)).toEqual(['lamp', 'gimbal']);
    expect(keepRoomDevices(proposed, { before: null, answering: [], known, stand: false }).plan).toBe(proposed);
  });
  it('a tile for a device that is gone is not brought back; a plan that already has everything is untouched', () => {
    const before: SurfacePlan = { kind: 'room', title: 'x', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-9', label: 'Old lamp' }] };
    const proposed: SurfacePlan = { kind: 'room', title: 'x', tiles: [{ type: 'card', title: 'All', children: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }, { type: 'music', deviceId: 'speaker-1', label: 'Speaker' }] }] };
    const k = keepRoomDevices(proposed, { before, answering: hints(store), known, stand: false });
    expect(k.plan).toBe(proposed);
    expect(keptRoomLine(k)).toBe('');
  });
  it('a floor plan is never touched', () => {
    const plan: SurfacePlan = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'b-cad', template: 'studio' }] };
    expect(keepRoomDevices(plan, { before: dashboard, answering: hints(store), known, stand: true }).plan).toBe(plan);
  });
  it('a full board keeps its top-level cap: the extras share one row', () => {
    const stats = Array.from({ length: MAX_TILES }, (_, i) => ({ type: 'stat' as const, label: `S${i}`, value: '1' }));
    const proposed: SurfacePlan = { kind: 'room', title: 'x', tiles: stats };
    const k = keepRoomDevices(proposed, { before: dashboard, answering: hints(store), known, stand: true });
    expect(k.plan.tiles.length).toBeLessThanOrEqual(MAX_TILES);
    expect(deviceIds(k.plan).sort()).toEqual(['speaker-1', 'wiz-lamp-1']);
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
    const k = keepRoomDevices(plan!, { before: dashboard, answering: req.devices, known: new Set(Object.keys(store)), stand: true });
    expect(deviceIds(k.plan).sort()).toEqual(['speaker-1', 'wiz-lamp-1']);
    expect(leafTiles(k.plan.tiles).some((t) => t.type === 'gimbal')).toBe(true);
  });
});

describe('canvasApp wires the floor into every room turn', () => {
  const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
  const fn = (name: string): string => { const at = src.indexOf(`async function ${name}(`); return src.slice(at, src.indexOf('\n  }\n', at)); };
  it('the room prompt lists the devices that answer (not every id in the store)', () => {
    expect(fn('streamTurn')).toContain('roomDeviceHints()');
  });
  it('the draft (Nano or its Gemini handoff) and the improved turn both keep the real tiles before the review and its headline', () => {
    expect(fn('draftTurn')).toMatch(/roomPlan\(frameId, out\.plan, out\.si\)/);
    expect(fn('aiTurn')).toMatch(/roomPlan\(frameId, out\.plan, out\.si\)/);
  });
});
