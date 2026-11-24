import { describe, expect, it } from 'vitest';
import { diffPlans, diffTile, floorPlanSummary, languagePackChanges, NO_VISIBLE_CHANGE } from '../../src/canvas/planDiff';
import { coerceSurfacePlan, type SurfacePlan } from '../../src/canvas/surfacePlan';
import { mapKindToTile, mergeTiles } from '../../src/canvas/connectTurns';
import { buildEnergyShowcaseDoc } from '../../src/canvas/showcaseFixture';

// The scripted engines' exact replies (canvasApp.ts SCRIPTS) — the plans a
// sim/replay review actually shows.
const NANO_ROOM = '{"kind":"room","title":"This room","tiles":[{"type":"lamp","deviceId":"wiz-desk","label":"Desk lamp"},{"type":"lamp","deviceId":"wiz-ceiling","label":"Ceiling light"}]}';
const GEMINI_ROOM = '{"kind":"room","title":"Living room","tiles":[{"type":"lamp","deviceId":"wiz-ceiling","label":"Main light"},{"type":"lamp","deviceId":"wiz-desk","label":"Reading lamp"},{"type":"music","deviceId":"speaker-1","label":"Speaker"},{"type":"plan","boardId":"room-plan","template":"oneRoom"},{"type":"connect","label":"Connect a device"}]}';
const NANO_PLAN = '{"kind":"plan","title":"Floor plan","tiles":[{"type":"plan","boardId":"BOARD-cad","template":"twoBedroom"}]}';

function plan(json: string): SurfacePlan {
  const c = coerceSurfacePlan(JSON.parse(json));
  if (!c.ok) throw new Error(c.error);
  return c.value;
}

describe('diffPlans — the review window’s plan list', () => {
  it('Draft on a blank board: the title and each lamp, with live brightness', () => {
    const changes = diffPlans(null, plan(NANO_ROOM), { devices: { 'wiz-desk': { on: true, brightness: 70 }, 'wiz-ceiling': { on: false, brightness: 40 } } });
    expect(changes).toEqual([
      { op: 'add', label: 'Title', detail: 'This room' },
      { op: 'add', label: 'Desk lamp', detail: 'lamp · currently 70%' },
      { op: 'add', label: 'Ceiling light', detail: 'lamp · currently off' },
    ]);
  });

  it('Better on top of Draft: retitle, renames, new speaker / room plan / connect, reorder', () => {
    const changes = diffPlans(plan(NANO_ROOM), plan(GEMINI_ROOM), { devices: { 'speaker-1': { on: true, brightness: 0, trackTitle: 'Morning light' } } });
    expect(changes[0]).toEqual({ op: 'change', label: 'Title', detail: 'This room → Living room' });
    expect(changes).toContainEqual({ op: 'change', label: 'Ceiling light', detail: 'renamed to Main light' });
    expect(changes).toContainEqual({ op: 'change', label: 'Desk lamp', detail: 'renamed to Reading lamp' });
    expect(changes).toContainEqual({ op: 'add', label: 'Speaker', detail: 'music · currently Morning light' });
    expect(changes).toContainEqual({ op: 'add', label: 'Room plan', detail: '1 room (Room)' });
    expect(changes).toContainEqual({ op: 'add', label: 'Connect a device', detail: 'button' });
    expect(changes.some((c) => c.op === 'remove')).toBe(false);
  });

  it('floor plan: rooms and doors in plain words', () => {
    const changes = diffPlans(null, plan(NANO_PLAN));
    expect(changes[1]).toEqual({
      op: 'add', label: 'Floor plan',
      detail: '5 rooms (Bedroom 1, Bedroom 2, Living room, Kitchen, Bathroom) · 5 doors · 5 windows',
    });
    expect(floorPlanSummary('studio')).toBe('1 room (Studio) · 1 door · 1 window');
  });

  it('point-to-connect: only the one new lamp is added', () => {
    const before: SurfacePlan = { kind: 'room', title: 'Board 3', tiles: [] };
    const after = mergeTiles(before, [mapKindToTile('lamp', 'Reading lamp', 'wiz-desk')]);
    expect(diffPlans(before, after, { devices: { 'wiz-desk': { on: true, brightness: 55 } } })).toEqual([
      { op: 'add', label: 'Reading lamp', detail: 'lamp · currently 55%' },
    ]);
  });

  it('removed tiles are listed as removals', () => {
    const changes = diffPlans(plan(GEMINI_ROOM), plan(NANO_ROOM));
    expect(changes).toContainEqual({ op: 'remove', label: 'Speaker', detail: 'music' });
    expect(changes).toContainEqual({ op: 'remove', label: 'Connect a device', detail: 'button' });
  });

  it('an identical plan says “No visible change”', () => {
    expect(diffPlans(plan(GEMINI_ROOM), plan(GEMINI_ROOM))).toEqual([{ op: 'change', label: NO_VISIBLE_CHANGE }]);
  });

  it('falls back to the label when a device id changes underneath', () => {
    const a: SurfacePlan = { kind: 'room', title: 'R', tiles: [{ type: 'lamp', deviceId: 'lamp-1', label: 'Desk lamp' }] };
    const b: SurfacePlan = { kind: 'room', title: 'R', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }] };
    expect(diffPlans(a, b)).toEqual([{ op: 'change', label: NO_VISIBLE_CHANGE }]);
  });

  it('nested showcase plan: groups, charts and stats are named, not dumped', () => {
    const doc = buildEnergyShowcaseDoc();
    const after = doc.surfaces[doc.focusId!]!;
    const changes = diffPlans(null, after);
    expect(changes.length).toBeGreaterThan(3);
    for (const c of changes) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(`${c.label} ${c.detail ?? ''}`).not.toMatch(/[{}[\]]/);
    }
  });

  it('grouping the same tiles into a card reads as a regroup + a new group', () => {
    const a = plan(NANO_ROOM);
    const b: SurfacePlan = { ...a, tiles: [{ type: 'card', title: 'Lights', children: a.tiles }] };
    expect(diffPlans(a, b)).toEqual([
      { op: 'add', label: 'Group “Lights”', detail: '2 tiles' },
      { op: 'change', label: 'Layout', detail: 'tiles regrouped' },
    ]);
  });

  it('a stat’s new value is a change, not a remove+add', () => {
    expect(diffTile({ type: 'stat', label: 'Today', value: '4 kWh' }, { type: 'stat', label: 'Today', value: '5 kWh' }))
      .toEqual([{ op: 'change', label: 'Today', detail: 'value 4 kWh → 5 kWh' }]);
  });
});

describe('diffPlans — renames and live state', () => {
  it('a renamed stat / chart reads as one “~ renamed to …”, not − and +', () => {
    const a: SurfacePlan = { kind: 'room', title: 'R', tiles: [
      { type: 'stat', label: 'Today', value: '4 kWh' },
      { type: 'chart', title: 'Usage', chartType: 'bar', series: [{ label: 'Mon', value: 1 }] },
    ] };
    const b: SurfacePlan = { kind: 'room', title: 'R', tiles: [
      { type: 'stat', label: 'Energy today', value: '4 kWh' },
      { type: 'chart', title: 'Weekly usage', chartType: 'bar', series: [{ label: 'Mon', value: 1 }] },
    ] };
    expect(diffPlans(a, b)).toEqual([
      { op: 'change', label: 'Today', detail: 'renamed to Energy today' },
      { op: 'change', label: 'Usage', detail: 'renamed to Weekly usage' },
    ]);
  });

  it('uneven leftovers of a kind stay honest adds/removes', () => {
    const a: SurfacePlan = { kind: 'room', title: 'R', tiles: [{ type: 'stat', label: 'A', value: '1' }] };
    const b: SurfacePlan = { kind: 'room', title: 'R', tiles: [{ type: 'stat', label: 'B', value: '1' }, { type: 'stat', label: 'C', value: '2' }] };
    const ops = diffPlans(a, b).map((c) => `${c.op} ${c.label}`);
    expect(ops).toEqual(['add B', 'add C', 'remove A']);
  });

  it('live lamp state is labelled “currently”, never as part of the change', () => {
    const p: SurfacePlan = { kind: 'room', title: 'R', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }] };
    const [line] = diffPlans({ ...p, tiles: [] }, p, { devices: { 'wiz-desk': { on: true, brightness: 70 } } });
    expect(line.detail).toBe('lamp · currently 70%');
  });
});

describe('languagePackChanges', () => {
  it('Kannada pack is one plain line with the label count', () => {
    expect(languagePackChanges('Kannada', 19)).toEqual([{ op: 'change', label: 'Switch the interface to Kannada (19 labels)' }]);
  });
});
