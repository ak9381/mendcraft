import { describe, expect, it } from 'vitest';
import { createDeviceSurfaceIndex } from '../../src/canvas/deviceSurfaceIndex';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

describe('src/canvas/deviceSurfaceIndex.ts (which surfaces show a device)', () => {
  const roomPlan: SurfacePlan = {
    kind: 'room',
    title: 'Living room',
    tiles: [
      { type: 'lamp', deviceId: 'lamp-1', label: 'Desk lamp' },
      { type: 'music', deviceId: 'speaker-a', label: 'Speaker' },
    ],
  };
  const otherPlan: SurfacePlan = {
    kind: 'room',
    title: 'Other room',
    tiles: [{ type: 'switch', deviceId: 'switch-1', label: 'Switch' }],
  };

  it('returns only the surfaces whose plan has a tile for that device', () => {
    const idx = createDeviceSurfaceIndex();
    idx.track('surf-a', roomPlan);
    idx.track('surf-b', otherPlan);

    expect(idx.targetsFor('lamp-1')).toEqual(new Set(['surf-a']));
    expect(idx.targetsFor('switch-1')).toEqual(new Set(['surf-b']));
    expect(idx.targetsFor('unknown-device')).toBeUndefined();
  });

  it('re-tracking a surface replaces its previous associations', () => {
    const idx = createDeviceSurfaceIndex();
    idx.track('surf-a', roomPlan);
    idx.track('surf-a', otherPlan);

    expect(idx.targetsFor('lamp-1')).toBeUndefined();
    expect(idx.targetsFor('switch-1')).toEqual(new Set(['surf-a']));
  });

  it('untrack drops a surface from every device it was associated with', () => {
    const idx = createDeviceSurfaceIndex();
    idx.track('surf-a', roomPlan);
    idx.untrack('surf-a');

    expect(idx.targetsFor('lamp-1')).toBeUndefined();
    expect(idx.targetsFor('speaker-a')).toBeUndefined();
  });

  it('a device shown on multiple surfaces fans out to all of them', () => {
    const idx = createDeviceSurfaceIndex();
    const sharedPlan: SurfacePlan = { kind: 'room', title: 'Dock', tiles: [{ type: 'lamp', deviceId: 'lamp-1', label: 'Desk lamp' }] };
    idx.track('surf-a', roomPlan);
    idx.track('surf-a-dock', sharedPlan);

    expect(idx.targetsFor('lamp-1')).toEqual(new Set(['surf-a', 'surf-a-dock']));
  });
});
