import { describe, it, expect } from 'vitest';
import {
  defaultLayout, assignSide, coerceLayout, sideFor, EMPTY_LAYOUT,
  edgeIntent, evaluateDwell, INITIAL_DWELL, phoneExitIntent,
  type ScreenLayout,
} from '../src/canvas/screenLayout';

describe('screenLayout arrangement', () => {
  it('default suggestion is android→left, ios→right when empty', () => {
    expect(defaultLayout({ android: true, ios: true })).toEqual({ left: 'android', right: 'ios' });
  });
  it('does not overwrite a manual swap', () => {
    const swapped: ScreenLayout = { left: 'ios', right: 'android' };
    expect(defaultLayout({ android: true, ios: true }, swapped)).toEqual(swapped);
  });
  it('fills only the empty slot', () => {
    expect(defaultLayout({ android: true }, { left: null, right: 'ios' })).toEqual({ left: 'android', right: 'ios' });
  });
  it('assignSide moves a phone and clears the opposite side', () => {
    const l = assignSide({ left: 'android', right: 'ios' }, 'left', 'ios');
    expect(l).toEqual({ left: 'ios', right: null });
  });
  it('coerceLayout rejects same phone on both sides', () => {
    expect(coerceLayout({ left: 'ios', right: 'ios' })).toEqual({ left: 'ios', right: null });
    expect(coerceLayout({ left: 'x', right: 'android' })).toEqual({ left: null, right: 'android' });
    expect(coerceLayout('nope')).toEqual(EMPTY_LAYOUT);
  });
  it('sideFor finds a platform', () => {
    expect(sideFor({ left: 'android', right: 'ios' }, 'ios')).toBe('right');
    expect(sideFor({ left: null, right: null }, 'ios')).toBeNull();
  });
});

const LAYOUT: ScreenLayout = { left: 'android', right: 'ios' };

describe('screenLayout edgeIntent', () => {
  it('no glow in the middle', () => {
    expect(edgeIntent(500, 1000, LAYOUT).glow).toBe(0);
    expect(edgeIntent(500, 1000, LAYOUT).side).toBeNull();
  });
  it('glows toward a paired left edge and names the target', () => {
    const e = edgeIntent(10, 1000, LAYOUT);
    expect(e.side).toBe('left');
    expect(e.target).toBe('android');
    expect(e.glow).toBeGreaterThan(0.8);
  });
  it('glows toward the paired right edge', () => {
    const e = edgeIntent(990, 1000, LAYOUT);
    expect(e.side).toBe('right');
    expect(e.target).toBe('ios');
  });
  it('does NOT glow toward an edge with no phone', () => {
    const e = edgeIntent(5, 1000, { left: null, right: 'ios' });
    expect(e.side).toBeNull();
    expect(e.glow).toBe(0);
  });
  it('pastThreshold only fires well past the edge', () => {
    expect(edgeIntent(2, 1000, LAYOUT).pastThreshold).toBe(false);
    expect(edgeIntent(-40, 1000, LAYOUT).pastThreshold).toBe(true);
  });
});

describe('screenLayout dwell / tremor guard', () => {
  it('a deliberate hold past the edge commits after dwellMs', () => {
    const intent = edgeIntent(4, 1000, LAYOUT);
    let st = INITIAL_DWELL;
    let r = evaluateDwell(st, intent, 0, 220);
    expect(r.commit).toBe(false);
    st = r.state;
    r = evaluateDwell(st, intent, 100, 220);
    expect(r.commit).toBe(false);
    st = r.state;
    r = evaluateDwell(st, intent, 230, 220);
    expect(r.commit).toBe(true);
  });

  it('a deep push commits immediately', () => {
    const r = evaluateDwell(INITIAL_DWELL, edgeIntent(-50, 1000, LAYOUT), 0, 220);
    expect(r.commit).toBe(true);
  });

  it('tremor across the zone boundary never accumulates dwell', () => {
    // Jitter: in the zone, out, in, out — each "out" resets the clock, so even
    // though total elapsed time exceeds dwellMs, it never commits.
    let st = INITIAL_DWELL;
    const inZone = edgeIntent(8, 1000, LAYOUT);          // just inside
    const outZone = edgeIntent(90, 1000, LAYOUT);        // outside the zone
    const samples: Array<[typeof inZone, number]> = [
      [inZone, 0], [outZone, 80], [inZone, 160], [outZone, 240], [inZone, 320],
    ];
    for (const [intent, t] of samples) {
      const r = evaluateDwell(st, intent, t, 220);
      expect(r.commit).toBe(false);
      st = r.state;
    }
  });
});

describe('screenLayout phoneExitIntent', () => {
  it('phone on LEFT: inner edge is the RIGHT edge → back to laptop', () => {
    const e = phoneExitIntent({ clientX: 395, viewportWidth: 400, side: 'left', hasOtherPhone: false });
    expect(e.inZone).toBe(true);
    expect(e.target).toBe('laptop');
    expect(e.glow).toBeGreaterThan(0.8);
  });
  it('phone on RIGHT: inner edge is the LEFT edge', () => {
    const e = phoneExitIntent({ clientX: 5, viewportWidth: 400, side: 'right', hasOtherPhone: false });
    expect(e.inZone).toBe(true);
    expect(e.target).toBe('laptop');
  });
  it('no glow dragging toward the OUTER edge', () => {
    const e = phoneExitIntent({ clientX: 5, viewportWidth: 400, side: 'left', hasOtherPhone: false });
    expect(e.inZone).toBe(false);
    expect(e.glow).toBe(0);
  });
  it('pushing deep past the inner edge hops to the other phone', () => {
    const e = phoneExitIntent({ clientX: 460, viewportWidth: 400, side: 'left', hasOtherPhone: true });
    expect(e.target).toBe('other');
    expect(e.pastThreshold).toBe(true);
  });
});
