// Peace-and-move scroll: when a peace scrolls vs. stays a hold, and how it ends.
import { describe, expect, it } from 'vitest';
import { createPeaceScroll, PEACE_SCROLL, SCROLL_STYLE, type ScrollHand } from '../../src/canvas/peaceScroll';
import { adjustLevel, createLevelStepper, levelReadout, LEVEL_STEP_PX, LEVEL_BACK_PX, LEVEL_MIN_GAP_MS } from '../../src/canvas/levelControl';
import { matchScrollVoice } from '../../src/canvas/routeLine';
import { createHoldEngine } from '../../src/canvas/gestureHold';
import type { HandShape, HandSide } from '../../src/canvas/handShape';

/** Real hand scale on a 900 px tall laptop screen: 0.1 camera units ÷ 0.55 reach × 900 ≈ 164 px. */
const SCALE_PX = 164;
const hand = (shape: HandShape, y: number, side: HandSide = 'R', x = 600): ScrollHand => ({ shape, side, point: { x, y }, scalePx: SCALE_PX });

function feed(sc: ReturnType<typeof createPeaceScroll>, from: number, to: number, make: (t: number) => ScrollHand[], blocked = false) {
  let dy = 0, dx = 0;
  const states = [];
  for (let t = from; t <= to; t += 33) {
    const s = sc.update(make(t), t, blocked);
    dy += s.dy; dx += s.dx;
    states.push(s);
  }
  return { dy, dx, states, last: states[states.length - 1] };
}

describe('createPeaceScroll', () => {
  it('scroll-wheel style by default: hand DOWN = scroll down (show what is below)', () => {
    expect(SCROLL_STYLE).toBe('wheel');
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 1500, (t) => [hand('peace', 300 + t * 0.3)]);
    expect(r.states.some((s) => s.started)).toBe(true);
    expect(r.last.phase).toBe('scrolling');
    expect(r.dy).toBeGreaterThan(200); // positive = scrollTop grows
    expect(sc.suppressed('R')).toBe(true);
    expect(sc.suppressed('L')).toBe(false);
  });

  it('start needs > 0.8 hand scales of travel — above the hold drift limit', () => {
    expect(PEACE_SCROLL.startScales).toBeGreaterThan(0.6);
    const sc = createPeaceScroll();
    // 0.7 hand scales (≈ 115 px) quickly: not a scroll.
    const r = feed(sc, 0, 900, (t) => [hand('peace', 300 + Math.min(115, t * 0.4))]);
    expect(r.states.some((s) => s.started)).toBe(false);
  });

  it('the first 150 ms (the hand settling into the V) never count', () => {
    const sc = createPeaceScroll();
    // A big jump while the shape forms, then still.
    const r = feed(sc, 0, 1500, (t) => [hand('peace', t < 130 ? 300 + t * 1.5 : 495)]);
    expect(r.states.some((s) => s.started)).toBe(false);
  });

  it('trembling / back-and-forth motion never starts a scroll (one consistent direction needed)', () => {
    const sc = createPeaceScroll();
    // A strong tremor: ±45 px (0.55 hand scales peak to peak) at ~2.6 Hz.
    const r = feed(sc, 0, 2000, (t) => [hand('peace', 400 + Math.sin(t / 60) * 45)]);
    expect(r.states.some((s) => s.started)).toBe(false);
  });

  it('a peace held still never scrolls, and a slow drift during a hold keeps it a hold that fires', () => {
    const sc = createPeaceScroll();
    const hold = createHoldEngine();
    let fired: string | null = null;
    let scrolled = false;
    // Drift 0.4 hand scales over 2.2 s (≈ 66 px): fine for the hold (< 0.6).
    for (let t = 0; t <= 2200; t += 33) {
      const y = 300 + (t / 2200) * 66;
      const s = sc.update([hand('peace', y, 'L')], t, false);
      if (s.started) scrolled = true;
      const shape = sc.suppressed('L') ? 'other' : 'peace';
      const h = hold.update({ hands: [{ shape, hand: 'L', palm: { x: 0.3, y: y / 1640 }, scale: 0.1 }], facing: true, now: t });
      if (h.fired) fired = h.fired;
    }
    expect(scrolled).toBe(false);
    expect(fired).toBe('L:peace');
  });

  it('the hold stays suppressed after scrolling until the hand changes shape', () => {
    const sc = createPeaceScroll();
    feed(sc, 0, 900, (t) => [hand('peace', 300 + t * 0.3)]);
    feed(sc, 933, 3000, () => [hand('peace', 570)]);
    expect(sc.suppressed('R')).toBe(true);
    const end = feed(sc, 3033, 3300, () => [hand('open', 570)]);
    expect(end.states.some((s) => s.ended === 'release')).toBe(true);
    expect(sc.suppressed('R')).toBe(false);
  });

  it('two peaces (Register) clear the latches and never scroll', () => {
    const sc = createPeaceScroll();
    feed(sc, 0, 900, (t) => [hand('peace', 300 + t * 0.3)]);
    expect(sc.suppressed('R')).toBe(true);
    const both = feed(sc, 933, 2000, (t) => [hand('peace', 300 + t * 0.3, 'L', 300), hand('peace', 570)]);
    expect(both.dy).toBe(0);
    sc.clearLatches();
    expect(sc.suppressed('R')).toBe(false);
    expect(sc.suppressed('L')).toBe(false);
  });

  it('release carries a glide velocity; hand loss stops dead (no glide)', () => {
    const a = createPeaceScroll();
    feed(a, 0, 1000, (t) => [hand('peace', 300 + t * 0.3)]);
    const rel = feed(a, 1033, 1300, () => [hand('open', 600)]).states.find((s) => s.ended);
    expect(rel?.ended).toBe('release');
    expect(rel!.vy).toBeGreaterThan(0);
    const b = createPeaceScroll();
    feed(b, 0, 1000, (t) => [hand('peace', 300 + t * 0.3)]);
    expect(b.update([], 1033, false)).toMatchObject({ ended: 'lost', vx: 0, vy: 0, phase: 'idle' });
  });

  it('blocked (not facing, a grab, a point capture) never scrolls and stops a running scroll at once', () => {
    const sc = createPeaceScroll();
    expect(feed(sc, 0, 1500, (t) => [hand('peace', 300 + t * 0.3)], true).dy).toBe(0);
    const s2 = createPeaceScroll();
    feed(s2, 0, 1000, (t) => [hand('peace', 300 + t * 0.3)]);
    expect(s2.update([hand('peace', 620)], 1033, true)).toMatchObject({ ended: 'blocked', vy: 0 });
  });

  it('either hand; horizontal motion scrolls horizontally', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 1500, (t) => [{ shape: 'peace', side: 'L', point: { x: 300 + t * 0.3, y: 400 }, scalePx: SCALE_PX }]);
    expect(r.dx).toBeGreaterThan(150);
    expect(r.dy).toBe(0);
  });

  it('travel counts only from the scroll start (smoothed)', () => {
    const sc = createPeaceScroll();
    const r = feed(sc, 0, 1500, (t) => [hand('peace', 300 - t * 0.3)]);
    const started = r.states.findIndex((s) => s.started);
    expect(r.states[started].travel).toEqual({ x: 0, y: 0 });
    expect(r.last.travel.y).toBeLessThan(-150);
    expect(r.last.travel.y).toBeGreaterThan(-450 + 100); // far less than the full 450 px
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

describe('createLevelStepper', () => {
  it('one step per 30 px up, catching up at ≤ 1 step / 150 ms', () => {
    expect([LEVEL_STEP_PX, LEVEL_BACK_PX, LEVEL_MIN_GAP_MS]).toEqual([30, 15, 150]);
    const st = createLevelStepper();
    const steps: number[] = [];
    // Hand jumps to 95 px up and stays: three steps, spaced ≥ 150 ms.
    for (let t = 0; t <= 600; t += 33) { const d = st.update(95, t); if (d) steps.push(t); }
    expect(st.steps).toBe(3);
    for (let i = 1; i < steps.length; i++) expect(steps[i] - steps[i - 1]).toBeGreaterThanOrEqual(150);
  });

  it('jitter at a step boundary never ping-pongs (hysteresis)', () => {
    const st = createLevelStepper();
    const dirs: number[] = [];
    for (let t = 0; t <= 4000; t += 33) {
      const up = 30 + Math.sin(t / 40) * 12; // wobbling 18…42 px around the 30 px boundary
      const d = st.update(up, t);
      if (d) dirs.push(d);
    }
    expect(dirs).toEqual([1]);
    // Clearly back below 15 px: undone once.
    expect(st.update(10, 5000)).toBe(-1);
    expect(st.steps).toBe(0);
  });

  it('down steps mirror up steps', () => {
    const st = createLevelStepper();
    expect(st.update(-31, 0)).toBe(-1);
    expect(st.update(-20, 200)).toBe(0); // inside the hysteresis band
    expect(st.update(-14, 400)).toBe(1); // back past −15: undone
  });
});

describe('levelControl', () => {
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
    expect(adjustLevel(input, 1)).toBe(false);
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
