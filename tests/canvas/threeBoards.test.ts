import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { floorPlanTarget, FLOOR_PLAN_TITLE, roomSummary, roomWithoutPlanTiles } from '../../src/canvas/planTruth';
import { connectedDeviceRows, connectedDevicesPlan, DEVICES_BOARD_TITLE, TICK } from '../../src/canvas/connectedDevices';
import { ruleSuggestions } from '../../src/canvas/nextSteps';
import { journeyStepOf } from '../../src/canvas/journey';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');

describe('(a) a room dashboard never holds a floor-plan tile', () => {
  it('strips plan tiles, top level and nested, and keeps the title honest', () => {
    const gemini: SurfacePlan = { kind: 'room', title: 'Living room', tiles: [
      { type: 'card', title: 'Lights', children: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }, { type: 'plan', boardId: 'room-plan', template: 'oneRoom' }] },
      { type: 'music', deviceId: 'speaker-1', label: 'Speaker' },
      { type: 'plan', boardId: 'room-plan', template: 'oneRoom' },
    ] };
    expect(roomSummary(gemini)).toMatch(/a room plan/);
    const out = roomWithoutPlanTiles(gemini);
    expect(JSON.stringify(out)).not.toContain('"plan"');
    expect(out.tiles).toHaveLength(2);
    expect(roomSummary(out)).not.toMatch(/room plan/);
    // nothing to strip → the same object; a floor-plan board keeps its plan
    const lamps: SurfacePlan = { kind: 'room', title: 'r', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] };
    expect(roomWithoutPlanTiles(lamps)).toBe(lamps);
    const fp: SurfacePlan = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'f1-cad', template: 'studio' }] };
    expect(roomWithoutPlanTiles(fp)).toBe(fp);
    // a room of only a plan tile offers Connect instead
    expect(roomWithoutPlanTiles({ kind: 'room', title: 'r', tiles: [{ type: 'plan', boardId: 'x', template: 'studio' }] }).tiles).toEqual([{ type: 'connect', label: 'Connect a device' }]);
  });
  it('every board, review and title goes through the strip; the goals no longer ask for a plan tile', () => {
    expect(app).toContain('const fitPlan = (plan: SurfacePlan): SurfacePlan => roomWithoutPlanTiles(fitLampTiles(plan, lampSlots()));');
    expect(app).toMatch(/summary\(fitPlan\(plan\)\)/);
    expect(app).not.toMatch(/add a room plan tile/);
    const geminiRoom = /geminiRoom: '([^']+)'/.exec(app)![1];
    expect(geminiRoom).not.toContain('"type":"plan"');
  });
});

describe('(b) "draw the floor plan" goes to its own board', () => {
  const frames = [{ id: 'dash', title: 'Living room' }, { id: 'b2', title: 'Board 2' }];
  const surfaces: Record<string, SurfacePlan> = { dash: { kind: 'room', title: 'Living room', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] } };
  it('never the dashboard: a new board, or the empty board she is on', () => {
    expect(floorPlanTarget({ frames, surfaces, from: 'dash' })).toEqual({ id: null, make: true });
    expect(floorPlanTarget({ frames, surfaces, from: 'b2' })).toEqual({ id: 'b2', reuseEmpty: true });
    expect(floorPlanTarget({ frames, surfaces, from: null })).toEqual({ id: null, make: true });
  });
  it('focuses the existing floor-plan board', () => {
    const s2 = { ...surfaces, fp: { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'fp-cad', template: 'studio' }] } as SurfacePlan };
    expect(floorPlanTarget({ frames: [...frames, { id: 'fp', title: FLOOR_PLAN_TITLE }], surfaces: s2, from: 'dash' })).toEqual({ id: 'fp', existing: true });
  });
  it('voice, chip and the empty-board button all use it', () => {
    expect(app).toMatch(/case 'floorPlan': openFloorPlan\(focusId, text\); return true;/);
    expect(app).toMatch(/act\.dataset\.act === 'floorplan'\) openFloorPlan\(frame\)/);
    expect(app).toMatch(/id = reg\.add\('plan', FLOOR_PLAN_TITLE\)\.id;/);
  });
});

describe('the Connected devices board', () => {
  it('ticks only devices that truly answer; plain words otherwise', () => {
    const rows = connectedDeviceRows({
      laptop: true,
      iphone: { sim: false, gimbal: 'tracking' },
      android: null,
      lamps: [{ label: 'Lamp', state: 'answering' }, { label: 'Lamp 2', state: 'unreachable' }],
      speaker: { sim: false, spotifyTokens: true, playingOn: 'iPhone' },
    });
    expect(rows).toEqual([
      { device: 'Laptop', status: 'This canvas', ok: true },
      { device: 'iPhone', status: 'Paired · Gimbal: tracking you', ok: true },
      { device: 'Nothing phone', status: 'Not paired', ok: false },
      { device: 'Lamp', status: 'WiZ · answering', ok: true },
      { device: 'Lamp 2', status: 'Not reachable', ok: false },
      { device: 'Speaker', status: 'Spotify · iPhone', ok: true },
    ]);
  });
  it('gimbal words, no stand, Chrome blocking, Spotify not connected, SIM never ticked', () => {
    const rows = connectedDeviceRows({
      iphone: { sim: false, gimbal: 'none' }, android: { sim: true },
      lamps: [], lampWhy: 'Chrome is blocking local network access for this page — allow it in Site settings to control your lamp.',
      speaker: { sim: false, spotifyTokens: false, playingOn: '' },
    });
    expect(rows.find((r) => r.device === 'iPhone')?.status).toBe('Paired · Gimbal: no stand');
    expect(rows.find((r) => r.device === 'Nothing phone')).toEqual({ device: 'Nothing phone', status: 'SIM · paired', ok: false });
    expect(rows.find((r) => r.device === 'WiZ lamp')).toMatchObject({ ok: false, status: expect.stringMatching(/^Chrome is blocking/) });
    expect(rows.find((r) => r.device === 'Speaker')).toEqual({ device: 'Speaker', status: 'Spotify not connected', ok: false });
    expect(connectedDeviceRows({ iphone: { sim: false, gimbal: 'ready' }, lamps: [{ label: 'Desk lamp', state: 'sim' }] }).filter((r) => r.ok).map((r) => r.device)).toEqual(['Laptop', 'iPhone']);
    expect(connectedDeviceRows({ iphone: { sim: false, gimbal: 'ready' }, lamps: [] })[1].status).toBe('Paired · Gimbal: docked');
  });
  it('is one table; the tick is in the device cell', () => {
    const plan = connectedDevicesPlan([{ device: 'Laptop', status: 'This canvas', ok: true }, { device: 'iPhone', status: 'Not paired', ok: false }]);
    expect(plan.title).toBe(DEVICES_BOARD_TITLE);
    expect(plan.tiles[0]).toMatchObject({ type: 'table', rows: [[`${TICK} Laptop`, 'This canvas'], ['iPhone', 'Not paired']] });
  });
  it('the chips walk Connected devices → Build the dashboard → Draw the floor plan', () => {
    const ctx = { lang: 'en', online: true, phones: 1, devicesBoard: true };
    const at = journeyStepOf({ kind: 'room', tiles: [{ kind: 'table' }], pinned: false }, ctx);
    expect(at).toBe('devices');
    expect(ruleSuggestions(at, ctx).map((s) => s.label).slice(0, 2)).toEqual(['Build the dashboard', 'Draw the floor plan']);
    expect(ruleSuggestions('dashboard', { lang: 'en', online: true, phones: 1 }).map((s) => s.id)).toContain('floorplan');
  });
  it('"connect devices" makes it; "build the dashboard" goes to its own board', () => {
    expect(app).toMatch(/const target = ensureDevicesBoard\(\);\s*pairFrame = target;/);
    expect(app).toMatch(/const id = dashboardTarget\(focusId \?\? lastFocus\);/);
    expect(app).toMatch(/const target = dashboardTarget\(focusId\);/);
  });
});
