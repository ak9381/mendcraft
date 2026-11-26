// Peace-and-move scroll: when a peace scrolls vs. stays a hold, and how it ends.
import { describe, expect, it } from 'vitest';
import { createPeaceScroll, PEACE_SCROLL, type ScrollHand } from '../../src/canvas/peaceScroll';
import { adjustLevel, levelReadout, levelStepsFor, LEVEL_STEP_PX } from '../../src/canvas/levelControl';
import { matchScrollVoice } from '../../src/canvas/routeLine';
import type { HandShape, HandSide } from '../../src/canvas/handShape';

const hand = (shape: HandShape, y: number, side: HandSide = 'R', x = 600): ScrollHand => ({ shape, side, point: { x, y } });

/** Feed frames every 33 ms; y(t) gives the hand's screen y. */
function feed(sc: ReturnType<typeof createPeaceScroll>, from: number, to: number, make: (t: number) => ScrollHand[], blocked = false) {
  let dy = 0;
  const states = [];
  for (let t = from; t <= to; t += 33) {
    const s = sc.update(make(t), t, blocked);
    dy += s.dy;
    states.push(s);
  }
  return { dy, states, last: states[states.length - 1] };
}

describe('createPeaceScroll', () => {
  it('a peace that moves ≥ 40 px within 500 ms starts scrolling; content follows the hand ×1.5', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 1000, (t) => [hand('peace', 300 + t * 0.3)]); // 0.3 px/ms down = 300 px
    expect(r.states.some((s) => s.started)).toBe(true);
    expect(r.last.phase).toBe('scrolling');
    // ~300 px of travel minus the 40 px start, ×1.5 (One-Euro lag eats a little).
    expect(r.dy).toBeGreaterThan(250);
    expect(r.dy).toBeLessThan(420);
    expect(sc.suppressed('R')).toBe(true);
    expect(sc.suppressed('L')).toBe(false);
  });

  it('a peace held still never scrolls (its 2 s hold stays possible)', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 2500, () => [hand('peace', 300 + Math.random() * 3)]);
    expect(r.states.some((s) => s.started)).toBe(false);
    expect(r.dy).toBe(0);
    expect(sc.suppressed('R')).toBe(false);
  });

  it('travel AFTER the 500 ms window never starts a scroll (a slow drift is still a hold)', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 600, () => [hand('peace', 300)]);
    expect(r.last.phase).toBe('still');
    const r2 = feed(sc, 633, 1500, (t) => [hand('peace', 300 + (t - 633) * 0.3)]);
    expect(r2.states.some((s) => s.started)).toBe(false);
  });

  it('the hold stays suppressed after scrolling until the hand changes shape', () => {
    const sc = createPeaceScroll();
    feed(sc, 0, 600, (t) => [hand('peace', 300 + t * 0.3)]);
    // Stops moving, still peace: still suppressed.
    feed(sc, 633, 3000, () => [hand('peace', 480)]);
    expect(sc.suppressed('R')).toBe(true);
    // Opens the hand: released.
    const end = feed(sc, 3033, 3300, () => [hand('open', 480)]);
    expect(end.states.some((s) => s.ended === 'release')).toBe(true);
    expect(sc.suppressed('R')).toBe(false);
  });

  it('release carries a glide velocity; hand loss stops dead (no glide)', () => {
    const a = createPeaceScroll();
    feed(a, 0, 600, (t) => [hand('peace', 300 + t * 0.3)]);
    const rel = feed(a, 633, 900, () => [hand('open', 480)]).states.find((s) => s.ended);
    expect(rel?.ended).toBe('release');
    expect(rel!.vy).toBeGreaterThan(0);
    const b = createPeaceScroll();
    feed(b, 0, 600, (t) => [hand('peace', 300 + t * 0.3)]);
    const lost = b.update([], 633, false);
    expect(lost).toMatchObject({ ended: 'lost', vx: 0, vy: 0, phase: 'idle' });
  });

  it('a one-frame misread inside the grace keeps scrolling', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 900, (t) => [hand(t === 495 ? 'other' : 'peace', 300 + t * 0.3)]);
    expect(r.states.filter((s) => s.started)).toHaveLength(1);
    expect(r.last.phase).toBe('scrolling');
  });

  it('blocked (not facing, a fist grab) never scrolls, and stops a running scroll at once', () => {
    const sc = createPeaceScroll();
    expect(feed(sc, 0, 900, (t) => [hand('peace', 300 + t * 0.3)], true).dy).toBe(0);
    const s2 = createPeaceScroll();
    feed(s2, 0, 600, (t) => [hand('peace', 300 + t * 0.3)]);
    expect(s2.update([hand('peace', 500)], 633, true)).toMatchObject({ ended: 'blocked', vy: 0 });
  });

  it('two peace hands (the Register hold) never scroll', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 900, (t) => [hand('peace', 300 + t * 0.3, 'L', 300), hand('peace', 300 + t * 0.3, 'R')]);
    expect(r.dy).toBe(0);
  });

  it('either hand scrolls; horizontal motion gives dx', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 800, (t) => [{ shape: 'peace', side: 'L', point: { x: 300 + t * 0.3, y: 400 } }]);
    expect(r.states.reduce((a, s) => a + s.dx, 0)).toBeGreaterThan(150);
    expect(r.dy).toBe(0);
  });

  it('the dead zone eats jitter while scrolling', () => {
    const sc = createPeaceScroll();
    feed(sc, 0, 400, (t) => [hand('peace', 300 + t * 0.3)]);
    const r = feed(sc, 433, 1500, (t) => [hand('peace', 420 + (t % 66 ? 0.5 : -0.5))]);
    expect(Math.abs(r.dy)).toBeLessThan(25); // the One-Euro tail of the stop, then nothing
    expect(PEACE_SCROLL.deadZonePx).toBeGreaterThan(0);
  });

  it('travel is raw hand travel since the peace appeared (levels step by it)', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 297, (t) => [hand('peace', 300 - t * (90 / 297))]); // up 90 px in 0.3 s
    expect(r.last.travel.y).toBeCloseTo(-90, 0);
    expect(levelStepsFor(r.last.travel.y - 0.5)).toBe(3);
  });
});

// ---------------------------------------------------------------- levels

type Btn = { clicks: number; disabled?: boolean; click(): void; getAttribute(k: string): string | null };
function fakeLevel(kind = 'volume', value = 50) {
  const attrs: Record<string, string> = { 'data-level': kind, 'aria-valuenow': String(value), 'aria-valuemin': '0', 'aria-valuemax': '100' };
  const mk = (d: number): Btn => ({ clicks: 0, click() { this.clicks++; attrs['aria-valuenow'] = String(Number(attrs['aria-valuenow']) + d); }, getAttribute: () => null });
  const inc = mk(10), dec = mk(-10);
  const el = {
    tagName: 'DIV', shadowRoot: null,
    getAttribute: (k: string) => attrs[k] ?? null,
    querySelector: (sel: string) => (sel === '[data-level-inc]' ? inc : sel === '[data-level-dec]' ? dec : null),
  };
  return { el: el as unknown as HTMLElement, inc, dec };
}

describe('levelControl', () => {
  it('one step per 30 px of travel, up = more', () => {
    expect(LEVEL_STEP_PX).toBe(30);
    expect(levelStepsFor(-90.5)).toBe(3);
    expect(levelStepsFor(-29)).toBe(0);
    expect(levelStepsFor(61)).toBe(-2);
  });

  it('adjustLevel clicks the control\'s own + / − buttons (no parallel path)', () => {
    const { el, inc, dec } = fakeLevel();
    expect(adjustLevel(el, 1)).toBe(true);
    expect(adjustLevel(el, 1)).toBe(true);
    expect(adjustLevel(el, -1)).toBe(true);
    expect(inc.clicks).toBe(2);
    expect(dec.clicks).toBe(1);
    expect(levelReadout(el)).toBe('Volume 60 %');
  });

  it('a disabled step button does nothing', () => {
    const { el, inc } = fakeLevel();
    inc.disabled = true;
    expect(adjustLevel(el, 1)).toBe(false);
    expect(inc.clicks).toBe(0);
  });

  it('a native range input steps with stepUp/stepDown and fires input + change', () => {
    const events: string[] = [];
    let v = 5;
    const input = {
      tagName: 'INPUT', type: 'range', disabled: false, min: '0', max: '10',
      get value() { return String(v); },
      stepUp() { v = Math.min(10, v + 1); }, stepDown() { v = Math.max(0, v - 1); },
      dispatchEvent(e: Event) { events.push(e.type); return true; },
      getAttribute: () => null,
    } as unknown as HTMLElement;
    expect(adjustLevel(input, 1)).toBe(true);
    expect(events).toEqual(['input', 'change']);
    v = 10;
    expect(adjustLevel(input, 1)).toBe(false); // already at the top
  });

  it('readouts: brightness %, colour temperature in K', () => {
    expect(levelReadout(fakeLevel('brightness', 30).el)).toBe('Brightness 30 %');
    const t = fakeLevel('temp', 4000).el;
    (t as unknown as { getAttribute: (k: string) => string | null }).getAttribute = (k) => ({ 'data-level': 'temp', 'aria-valuenow': '4000', 'aria-valuemin': '2700', 'aria-valuemax': '6500' } as Record<string, string>)[k] ?? null;
    expect(levelReadout(t)).toBe('Colour temperature 4000 K');
  });
});

describe('voice: scroll / page up / down', () => {
  it('matches the four phrases and nothing else', () => {
    expect(matchScrollVoice('scroll down')).toEqual({ dir: 'down', page: false });
    expect(matchScrollVoice('Scroll up.')).toEqual({ dir: 'up', page: false });
    expect(matchScrollVoice('page down')).toEqual({ dir: 'down', page: true });
    expect(matchScrollVoice('please page up')).toEqual({ dir: 'up', page: true });
    expect(matchScrollVoice('scroll to the kitchen')).toBeNull();
    expect(matchScrollVoice('turn the volume up')).toBeNull();
  });
});
