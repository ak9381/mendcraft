// Final review I3: a lamp discovery that finds nothing (or a different bulb)
// never removes or re-points a lamp tile on a stored board. The tile stays
// as approved and shows "Not connected" until its bulb answers again.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyRealLamps } from '../../src/canvas/realLamps';
import { expandPlan, type DeviceState, type SurfacePlan } from '../../src/canvas/surfacePlan';

const canvas = (state: Record<string, DeviceState>, surfaces: Record<string, SurfacePlan>) => ({
  state, surfaces, labels: {} as Record<string, string>, ips: new Map<string, string>(),
  store: { all: () => ({ ...state }), add: (id: string, s: DeviceState) => { state[id] = s; }, remove: (id: string) => { delete state[id]; } },
});
const lamp = { id: 'wiz-lamp-1', ip: '192.168.1.40', label: 'Lamp', state: { cls: 'lamp' as const, on: true, brightness: 60, sim: false, unreachable: false } };

describe('I3: discovery never removes lamp tiles', () => {
  it('a discovery that finds no bulb leaves every board as approved; the lamp leaves the device list only', () => {
    const board: SurfacePlan = { kind: 'room', title: 'Living room', tiles: [
      { type: 'card', title: 'Lights', children: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] },
      { type: 'music', deviceId: 'speaker-a', label: 'Speaker' },
    ] };
    const copy = JSON.parse(JSON.stringify(board));
    const c = canvas({ 'wiz-lamp-1': lamp.state, 'speaker-a': { on: false, brightness: 0 } }, { room: board });
    const rerender = applyRealLamps(c, []);
    expect(c.surfaces.room).toBe(board);
    expect(c.surfaces.room).toEqual(copy);
    expect(Object.keys(c.state)).toEqual(['speaker-a']);
    expect(rerender).toEqual(['room']); // re-rendered (to show Not connected), never rewritten
    // the bulb answers again: the same tile is live again
    applyRealLamps(c, [lamp]);
    expect(c.surfaces.room).toBe(board);
    expect(c.state['wiz-lamp-1']).toEqual(lamp.state);
  });

  it('a different bulb answering does not re-point a stored tile (no change without Approve)', () => {
    const board: SurfacePlan = { kind: 'room', title: 'r', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] };
    const c = canvas({ 'wiz-lamp-1': lamp.state }, { room: board });
    applyRealLamps(c, [{ ...lamp, id: 'wiz-lamp-2', label: 'Lamp' }]);
    expect(c.surfaces.room).toBe(board);
    expect(c.surfaces.room.tiles).toEqual([{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }]);
  });

  it('a board with no lamp tile is not re-rendered by a lamp change', () => {
    const c = canvas({ 'wiz-lamp-1': lamp.state }, { notes: { kind: 'room', title: 'n', tiles: [{ type: 'connect', label: 'Connect a device' }] } });
    expect(applyRealLamps(c, [])).toEqual([]);
  });

  it('an imported board whose lamp is not found yet keeps its tile; it renders "Not connected"', () => {
    const spare: SurfacePlan = { kind: 'room', title: 'Spare', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] };
    const c = canvas({}, { spare });
    applyRealLamps(c, []);
    expect(c.surfaces.spare.tiles).toHaveLength(1);
    const msgs = JSON.stringify(expandPlan(c.surfaces.spare, 'spare', c.state, { heading: false }));
    expect(msgs).toContain('"unreachable":true');
  });

  it('the canvas renders a stored board without writing a fitted copy back, and discovery does not save', () => {
    const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(app).not.toContain('surfaces[id] = fitPlan(');
    const at = app.indexOf('const changed = applyRealLamps(lampSwap, lamps);');
    expect(at).toBeGreaterThan(0);
    expect(app.slice(at, at + 400)).not.toContain('persist()');
  });

  it('a "Not connected" lamp tile keeps the 30 s re-discovery going, so the tile is live again when the bulb answers', () => {
    const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(app).toContain('|| Object.values(surfaces).some((p) => [...managedLampIdsOn(p)].some((id) => !store.get(id)));');
    expect(app).toContain('if (!cur && id && isManagedLampId(id) && liveLamps) { void rediscoverLamps(); return; }');
  });
});
