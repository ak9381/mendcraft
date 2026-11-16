import { describe, it, expect } from 'vitest';
import { classifyPose, createMotionRecognizer, type MotionEvent } from '../src/input/motionGestures';
import { GESTURE_CATALOG, catalogGesture, defaultGestureFor, bindableGestures } from '../src/input/gestureCatalog';
import { resolveGesture, gestureForTarget, nextRestState } from '../src/input/gestureDispatch';
import { createDwellClicker } from '../src/input/dwell';
import { OPEN, POINT, PINCH, VSIGN, THREE, FIST, place, rotate, mirror } from './helpers/hands';
import type { Pt } from '../src/input/handLogic';

const S = 0.5; // hand scale used in sequences
type Frame = { hands: Pt[][]; now: number };

function run(frames: Frame[], rec = createMotionRecognizer()): MotionEvent[] {
  const out: MotionEvent[] = [];
  for (const f of frames) out.push(...rec.update(f));
  return out;
}
const ids = (evs: MotionEvent[]) => evs.map((e) => e.id);

/** A pose held at one spot for `ms`, at 30 fps. */
function hold(pose: () => Pt[], ms: number, t0 = 0, x = 0.5, y = 0.8): Frame[] {
  const f: Frame[] = [];
  for (let t = 0; t <= ms; t += 33) f.push({ hands: [place(pose(), x, y, S)], now: t0 + t });
  return f;
}
/** A pose moving linearly from (x0,y0) to (x1,y1) over `ms`. */
function move(pose: () => Pt[], ms: number, x0: number, y0: number, x1: number, y1: number, t0 = 0, scale = S): Frame[] {
  const f: Frame[] = [];
  for (let t = 0; t <= ms; t += 33) {
    const k = t / ms;
    f.push({ hands: [place(pose(), x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, scale)], now: t0 + t });
  }
  return f;
}

describe('classifyPose', () => {
  it('adds V and three fingers on top of the base poses', () => {
    expect(classifyPose(VSIGN())).toBe('v-sign');
    expect(classifyPose(THREE())).toBe('three-fingers');
    expect(classifyPose(OPEN())).toBe('open-palm');
    expect(classifyPose(POINT())).toBe('point');
    expect(classifyPose(PINCH())).toBe('pinch');
    expect(classifyPose(FIST())).toBe('fist');
    expect(classifyPose([])).toBe('none');
  });
});

describe('held poses', () => {
  it('V held 400 ms fires undo-gesture once', () => {
    expect(ids(run(hold(VSIGN, 1000)))).toEqual(['v-sign']);
  });
  it('a V flashed for 200 ms does not fire (tremor-safe)', () => {
    expect(ids(run([...hold(VSIGN, 200), ...hold(FIST, 300, 233)]))).toEqual([]);
  });
  it('three fingers held fires redo-gesture', () => {
    expect(ids(run(hold(THREE, 600)))).toEqual(['three-fingers']);
  });
  it('open palm held 1 s fires stop/cancel', () => {
    expect(ids(run(hold(OPEN, 1200)))).toEqual(['palm-hold']);
  });
  it('both palms held fire rest mode once', () => {
    const f: Frame[] = [];
    for (let t = 0; t <= 1200; t += 33) f.push({ hands: [place(OPEN(), 0.3, 0.8, S), place(OPEN(), 0.7, 0.8, S)], now: t });
    expect(ids(run(f))).toEqual(['both-palms']);
  });
});

describe('motion gestures', () => {
  it('palm swipe left and right', () => {
    expect(ids(run(move(OPEN, 400, 0.7, 0.8, 0.35, 0.8)))).toContain('palm-swipe-left');
    expect(ids(run(move(OPEN, 400, 0.3, 0.8, 0.65, 0.8)))).toContain('palm-swipe-right');
  });
  it('a small calibrated reach makes a shorter swipe count', () => {
    const rec = createMotionRecognizer();
    rec.setReach(0.4, 0.4);
    expect(ids(run(move(OPEN, 400, 0.5, 0.8, 0.38, 0.8), rec))).toContain('palm-swipe-left');
    expect(ids(run(move(OPEN, 400, 0.5, 0.8, 0.38, 0.8)))).not.toContain('palm-swipe-left');
  });
  it('two-finger swipe up / down scrolls, sideways skips', () => {
    expect(ids(run(move(VSIGN, 400, 0.5, 0.9, 0.5, 0.65)))).toContain('two-finger-swipe-up');
    expect(ids(run(move(VSIGN, 400, 0.5, 0.65, 0.5, 0.9)))).toContain('two-finger-swipe-down');
    expect(ids(run(move(VSIGN, 400, 0.3, 0.8, 0.55, 0.8)))).toContain('two-finger-swipe-side');
  });
  it('a moving V does not also fire undo', () => {
    expect(ids(run(move(VSIGN, 400, 0.5, 0.9, 0.5, 0.65)))).not.toContain('v-sign');
  });
  it('wave: three or more back-and-forth turns', () => {
    const f: Frame[] = [];
    for (let t = 0; t <= 1100; t += 33) f.push({ hands: [place(OPEN(), 0.5 + 0.06 * Math.sin((t / 1100) * 2 * Math.PI * 2.5), 0.8, S)], now: t });
    expect(ids(run(f))).toContain('wave');
  });
  it('palm flip: palm turns over in place', () => {
    const f = [...hold(OPEN, 200), ...hold(() => mirror(OPEN()), 200, 233)];
    expect(ids(run(f))).toContain('palm-flip');
  });
  it('palm raise / lower emit steps (lamp brightness)', () => {
    const up = run(move(OPEN, 600, 0.5, 0.9, 0.5, 0.7));
    expect(up.filter((e) => e.id === 'palm-raise').length).toBeGreaterThanOrEqual(2);
    const down = run(move(OPEN, 600, 0.5, 0.7, 0.5, 0.9));
    expect(down.some((e) => e.id === 'palm-lower' && e.value === -1)).toBe(true);
  });
  it('palm tap: palm comes toward the camera and back', () => {
    const f: Frame[] = [];
    for (let t = 0; t <= 400; t += 33) {
      const k = t < 200 ? t / 200 : (400 - t) / 200;
      f.push({ hands: [place(OPEN(), 0.5, 0.8, S * (1 + 0.3 * k))], now: t });
    }
    expect(ids(run(f))).toContain('palm-tap');
  });
  it('air tap: index dips and comes back while the palm stays', () => {
    const f: Frame[] = [];
    for (let t = 0; t <= 400; t += 33) {
      const k = t < 200 ? t / 200 : (400 - t) / 200;
      const p = place(POINT(), 0.5, 0.8, S);
      p[8] = { x: p[8].x, y: p[8].y + 0.06 * k };
      f.push({ hands: [p], now: t });
    }
    expect(ids(run(f))).toContain('air-tap');
  });
  it('circle with a fingertip selects its box', () => {
    const f: Frame[] = [];
    for (let t = 0; t <= 1500; t += 33) {
      const a = (t / 1500) * 2 * Math.PI;
      const p = place(POINT(), 0.5, 0.8, S);
      const dx = 0.08 * Math.cos(a), dy = 0.08 * Math.sin(a);
      f.push({ hands: [p.map((q) => ({ x: q.x + dx, y: q.y + dy }))], now: t });
    }
    const evs = run(f);
    const c = evs.find((e) => e.id === 'circle');
    expect(c).toBeTruthy();
    expect(c!.box!.x1 - c!.box!.x0).toBeGreaterThan(0.12);
  });
  it('twist a pinched hand emits rotate steps', () => {
    const f: Frame[] = [];
    for (let t = 0, i = 0; t <= 600; t += 33, i++) f.push({ hands: [rotate(place(PINCH(), 0.5, 0.8, S), i * 4)], now: t });
    const evs = run(f).filter((e) => e.id === 'twist');
    expect(evs.length).toBeGreaterThanOrEqual(2);
    expect(evs.every((e) => e.value === 1)).toBe(true);
  });
  it('pinch held still 1.2 s = talk; a pinch that moves does not', () => {
    expect(ids(run(hold(PINCH, 1400)))).toContain('pinch-hold-still');
    expect(ids(run(move(PINCH, 1400, 0.3, 0.8, 0.7, 0.8)))).not.toContain('pinch-hold-still');
  });
  it('pinch and slide sideways emits volume steps', () => {
    const evs = run(move(PINCH, 600, 0.3, 0.8, 0.6, 0.8)).filter((e) => e.id === 'pinch-slide');
    expect(evs.length).toBeGreaterThanOrEqual(3);
    expect(evs.every((e) => e.value === 1)).toBe(true);
  });
  it('no hand clears state', () => {
    const rec = createMotionRecognizer();
    run(hold(VSIGN, 300), rec);
    expect(rec.update({ hands: [], now: 400 })).toEqual([]);
    expect(ids(run(hold(VSIGN, 300, 500), rec))).toEqual([]);
  });
});

describe('catalog', () => {
  it('has unique ids and every scope', () => {
    const all = GESTURE_CATALOG.map((g) => g.id);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(GESTURE_CATALOG.map((g) => g.scope))).toEqual(new Set(['core', 'studio', 'devices', 'safety']));
  });
  it('covers the agreed default list', () => {
    for (const id of ['point', 'pinch', 'pinch-drag', 'double-pinch', 'palm-hold', 'pinch-hold-still', 'thumbs-up',
      'palm-swipe-left', 'palm-swipe-right', 'two-finger-swipe-up', 'two-finger-swipe-down', 'two-hand-zoom', 'twist',
      'air-tap', 'v-sign', 'three-fingers', 'palm-flip', 'circle', 'palm-raise', 'palm-lower', 'palm-tap', 'pinch-slide',
      'two-finger-swipe-side', 'both-palms', 'wave', 'dwell']) {
      expect(catalogGesture(id), id).toBeTruthy();
    }
  });
  it('maps toolbar buttons to their default gestures', () => {
    expect(defaultGestureFor('btn-undo')?.id).toBe('v-sign');
    expect(defaultGestureFor('btn-redo')?.id).toBe('three-fingers');
    expect(defaultGestureFor('btn-more')?.id).toBe('palm-flip');
    expect(defaultGestureFor('btn-mic')?.id).toBe('pinch-hold-still');
  });
  it('only discrete gestures are bindable', () => {
    expect(bindableGestures().every((g) => g.kind === 'discrete')).toBe(true);
  });
});

describe('dispatch', () => {
  const base = { context: 'studio' as const, resting: false, bindings: [] };
  it('runs the default target', () => {
    expect(resolveGesture('v-sign', base)).toEqual({ kind: 'run', target: 'btn-undo', gesture: 'v-sign', source: 'default' });
  });
  it('device gestures only act in devices scope', () => {
    expect(resolveGesture('palm-raise', base)).toEqual({ kind: 'ignored', reason: 'scope' });
    expect(resolveGesture('palm-raise', { ...base, context: 'devices' })).toMatchObject({ kind: 'run', target: 'lamp-up' });
  });
  it('music volume and skip-track run in devices scope', () => {
    expect(resolveGesture('pinch-slide', { ...base, context: 'devices' })).toMatchObject({ kind: 'run', target: 'volume' });
    expect(resolveGesture('two-finger-swipe-side', { ...base, context: 'devices' })).toMatchObject({ kind: 'run', target: 'next-track' });
    expect(resolveGesture('pinch-slide', base)).toEqual({ kind: 'ignored', reason: 'scope' });
  });
  it('her binding wins, and replaces the old default', () => {
    const bindings = [{ target: 'btn-undo', gesture: 'custom:my-v' }];
    expect(resolveGesture('custom:my-v', { ...base, bindings })).toMatchObject({ kind: 'run', target: 'btn-undo', source: 'custom' });
    expect(resolveGesture('v-sign', { ...base, bindings })).toEqual({ kind: 'ignored', reason: 'unbound' });
    expect(resolveGesture('three-fingers', { ...base, bindings: [{ target: 'btn-export', gesture: 'three-fingers' }] }))
      .toMatchObject({ target: 'btn-export' });
  });
  it('rest mode swallows everything but wake and the rest toggle', () => {
    const r = { ...base, resting: true };
    expect(resolveGesture('v-sign', r)).toEqual({ kind: 'ignored', reason: 'resting' });
    expect(resolveGesture('wave', r)).toMatchObject({ target: 'wake' });
    expect(resolveGesture('both-palms', r)).toMatchObject({ target: 'rest-toggle' });
    expect(resolveGesture('wave', base)).toEqual({ kind: 'ignored', reason: 'unbound' });
    expect(nextRestState(false, 'rest-toggle')).toBe(true);
    expect(nextRestState(true, 'wake')).toBe(false);
    expect(nextRestState(true, 'btn-undo')).toBe(true);
  });
  it('the hint shows her gesture over the default', () => {
    const d = (t: string) => defaultGestureFor(t)?.id;
    expect(gestureForTarget('btn-undo', [], d)).toBe('v-sign');
    expect(gestureForTarget('btn-undo', [{ target: 'btn-undo', gesture: 'custom:x' }], d)).toBe('custom:x');
    expect(gestureForTarget('btn-help', [], d)).toBeUndefined();
  });
});

describe('dwell click', () => {
  it('clicks once after the dwell, resets when moving off', () => {
    const d = createDwellClicker(900);
    expect(d.update('btn-undo', 0).fire).toBe(false);
    expect(d.update('btn-undo', 500).progress).toBeCloseTo(500 / 900);
    expect(d.update('btn-undo', 950).fire).toBe(true);
    expect(d.update('btn-undo', 1500).fire).toBe(false);
    d.update(null, 1600);
    d.update('btn-redo', 1700);
    expect(d.update('btn-redo', 2700).fire).toBe(true);
  });
});
