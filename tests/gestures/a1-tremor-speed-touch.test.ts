// A1 hand-path tests: micro-jitter dead zone, dwell-click fallback, one-euro
// slow/fast motion feel, click-cooldown, lingering-pinch no-retrigger,
// tool-toggle spam gap, and the 6px drag-start threshold.
import { describe, expect, it, vi } from 'vitest';
import { createDeadZone, createToggleLatch, HAND_FEEL } from '../../src/canvas/handFeel';
import { createDwellClicker } from '../../src/input/dwell';
import { createClickCooldown } from '../../src/input/clickCooldown';
import { createOneEuroFilter } from '../../src/input/oneEuro';
import { createHandPointer, DRAG_HANDLE, type HandPointer } from '../../src/canvas/handPointer';
import type { Pt } from '../../src/input/handLogic';

describe('A1-034 micro-jitter dead zone', () => {
  it('moves smaller than 2.5px do not move the cursor; a move at/over the threshold does', () => {
    const dz = createDeadZone(2.5);
    const p0 = dz.apply({ x: 100, y: 100 });
    expect(p0).toEqual({ x: 100, y: 100 });
    // A 1px twitch is swallowed — returns the same frozen point.
    const p1 = dz.apply({ x: 100.8, y: 100.6 });
    expect(p1).toEqual({ x: 100, y: 100 });
    const p2 = dz.apply({ x: 101, y: 101.5 });
    expect(p2).toEqual({ x: 100, y: 100 });
    // A deliberate 3px move clears the zone and the cursor snaps to it.
    const p3 = dz.apply({ x: 103, y: 100 });
    expect(p3).toEqual({ x: 103, y: 100 });
  });
});

describe('A1-035 dwell-click as a tremor fallback', () => {
  it('hovering the same target for 900ms fires once; moving off resets it', () => {
    const dwell = createDwellClicker(900);
    const btn = { id: 'save' };
    let r = dwell.update(btn, 0);
    expect(r.fire).toBe(false);
    r = dwell.update(btn, 500);
    expect(r.fire).toBe(false);
    expect(r.progress).toBeCloseTo(500 / 900, 2);
    r = dwell.update(btn, 900);
    expect(r.fire).toBe(true);
    // Continuing to hover past the fire point doesn't refire every frame.
    r = dwell.update(btn, 950);
    expect(r.fire).toBe(false);
    // Moving to a different target resets the clock.
    r = dwell.update({ id: 'other' }, 960);
    expect(r.fire).toBe(false);
    expect(r.progress).toBeLessThan(0.1);
  });
});

describe('A1-036 / A1-037 one-euro feel: slow motion is smoothed, fast motion lags less', () => {
  it('a slow, steady drift is heavily smoothed per-frame; a fast jump is captured much more per-frame', () => {
    const slow = createOneEuroFilter(HAND_FEEL.cursorFilter);
    let t = 0;
    slow.filter(0, 0, t);
    // Deliberate slow drift: 1 unit every ~33ms frame.
    let out = slow.filter(0, 0, (t += 33));
    out = slow.filter(1, 0, (t += 33));
    const slowFraction = out.x / 1; // how much of the 1-unit step leaked through this frame

    const fast = createOneEuroFilter(HAND_FEEL.cursorFilter);
    let t2 = 0;
    fast.filter(0, 0, t2);
    fast.filter(0, 0, (t2 += 33));
    const outFast = fast.filter(50, 0, (t2 += 33)); // a fast 50-unit flick in one frame
    const fastFraction = outFast.x / 50;

    // One-Euro's beta term raises the cutoff (less lag) as speed increases —
    // the fast flick should track a noticeably larger fraction of its step
    // than the slow drift does of its own, much smaller step.
    expect(fastFraction).toBeGreaterThan(slowFraction);
  });

  it('A1-037 a dropped-frame gap (dt > 0.5s) is clamped to a normal frame step, not a wild catch-up jump', () => {
    const oneSixtySecMs = 1000 / 60;
    const normalGap = createOneEuroFilter(HAND_FEEL.cursorFilter);
    normalGap.filter(0, 0, 0);
    const afterNormalGap = normalGap.filter(10, 0, oneSixtySecMs); // an exact 1/60s frame

    const droppedGap = createOneEuroFilter(HAND_FEEL.cursorFilter);
    droppedGap.filter(0, 0, 0);
    const afterDroppedGap = droppedGap.filter(10, 0, 10000); // a 10s stall (camera hiccup)

    // dt is clamped to 1/60s internally once it exceeds 0.5s, so the same
    // value delta produces the same filtered output as an ordinary 1/60s
    // frame — a stall can't cause the cursor to leap to catch up.
    expect(afterDroppedGap.x).toBeCloseTo(afterNormalGap.x, 6);
  });
});

describe('A1-040 repeated click within cooldown', () => {
  it('ready() is false immediately after arming, true once the window elapses', () => {
    const cd = createClickCooldown(500);
    expect(cd.ready(0)).toBe(true); // nothing armed yet
    cd.arm(1000);
    expect(cd.ready(1000)).toBe(false);
    expect(cd.ready(1400)).toBe(false);
    expect(cd.ready(1500)).toBe(true);
    cd.reset();
    expect(cd.ready(1500)).toBe(true);
  });
});

function fakeButton() {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const rect = { left: 90, top: 90, right: 150, bottom: 130, width: 60, height: 40 };
  return {
    tagName: 'BUTTON',
    disabled: false,
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    getAttribute: () => null,
    closest: () => null,
    matches: (sel: string) => sel.split(',').some((s) => s.trim() === 'button'),
    getBoundingClientRect: () => rect,
    getRootNode: () => ({ host: null }),
    parentElement: null,
    addEventListener(t: string, f: (e: unknown) => void) { (listeners[t] ??= []).push(f); },
    dispatchEvent(e: { type: string }) { (listeners[e.type] ?? []).forEach((f) => f(e)); return true; },
    click() { this.dispatchEvent({ type: 'click' }); },
  };
}
function fakeDocFor(target: ReturnType<typeof fakeButton>) {
  return {
    createElement: () => ({ className: '', hidden: true, style: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, setAttribute: () => {}, remove: () => {} }),
    body: { append: () => {} },
    querySelectorAll: (sel: string) => (sel.includes('button') ? [target] : []),
    elementFromPoint: (x: number, y: number) => {
      const r = target.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? target : null;
    },
  } as unknown as Document;
}

describe('A1-041 pinch held through the cooldown window', () => {
  it('a lingering held pinch over a button fires exactly one click, not one per frame', () => {
    (globalThis as Record<string, unknown>).innerWidth = 1000;
    (globalThis as Record<string, unknown>).innerHeight = 800;
    const btn = fakeButton();
    let clicks = 0;
    btn.addEventListener('click', () => { clicks++; });
    const hp: HandPointer = createHandPointer(fakeDocFor(btn), {});
    hp.pointAt(120, 110);
    expect(hp.target).toBe(btn as unknown as HTMLElement);
    hp.pinch(true);
    expect(clicks).toBe(0); // press alone never clicks
    // Hold the pinch through many frames — still only "down" once.
    hp.pointAt(120, 110);
    hp.pointAt(120, 110);
    hp.pointAt(120, 110);
    expect(clicks).toBe(0);
    hp.pinch(false);
    expect(clicks).toBe(1);
    // Releasing again without a fresh press is a no-op, not a second click.
    hp.pinch(false);
    expect(clicks).toBe(1);
    hp.destroy();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });
});

describe('A1-043 tool-panel toggle spam', () => {
  it('rejects a second toggle inside 450ms; allows one after the gap', () => {
    const latch = createToggleLatch(450);
    expect(latch.allow(0)).toBe(true);
    expect(latch.allow(100)).toBe(false);
    expect(latch.allow(449)).toBe(false);
    expect(latch.allow(450)).toBe(true);
    latch.reset();
    expect(latch.allow(0)).toBe(true);
  });
});

function synthHandAt(cx: number, cy: number, pinched: boolean): Pt[] {
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  const dm = -0.02;
  lm[0] = { x: cx, y: cy + 9 * -dm };
  for (const i of [5, 9, 13, 17]) lm[i] = { x: cx, y: cy + dm };
  const gap = pinched ? 0.05 : 0.16;
  lm[4] = { x: cx - gap / 2, y: cy + 0.05 };
  lm[8] = { x: cx + gap / 2, y: cy + 0.05 };
  return lm;
}

describe('A1-046 drag-start threshold (6px)', () => {
  it('a pinch-hold that moves under 6px on a drag handle reads as a tap (click); 6px or more reads as a real drag (no click)', () => {
    (globalThis as Record<string, unknown>).innerWidth = 1000;
    (globalThis as Record<string, unknown>).innerHeight = 800;

    function dragHandle() {
      const listeners: Record<string, Array<(e: unknown) => void>> = {};
      const rect = { left: 90, top: 90, right: 190, bottom: 130, width: 100, height: 40 };
      return {
        tagName: 'BUTTON',
        disabled: false,
        classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
        getAttribute: (n: string) => (n === 'data-mc-drag-handle' ? '' : null),
        closest: () => null,
        matches: (sel: string) => sel.includes('data-mc-drag-handle') || sel.split(',').some((s) => s.trim() === 'button'),
        getBoundingClientRect: () => rect,
        getRootNode: () => ({ host: null }),
        parentElement: null,
        addEventListener(t: string, f: (e: unknown) => void) { (listeners[t] ??= []).push(f); },
        dispatchEvent(e: { type: string }) { (listeners[e.type] ?? []).forEach((f) => f(e)); return true; },
        click() { this.dispatchEvent({ type: 'click' }); },
      };
    }
    function docFor(handle: ReturnType<typeof dragHandle>) {
      return {
        createElement: () => ({ className: '', hidden: true, style: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, setAttribute: () => {}, remove: () => {} }),
        body: { append: () => {} },
        querySelectorAll: (sel: string) => (sel.includes('button') || sel.includes('data-mc-drag-handle') ? [handle] : []),
        elementFromPoint: (x: number, y: number) => {
          const r = handle.getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? handle : null;
        },
      } as unknown as Document;
    }

    // Case 1: tiny move (< 6px) — tap semantics, a click fires on release.
    const tapHandle = dragHandle();
    let tapClicks = 0;
    tapHandle.addEventListener('click', () => { tapClicks++; });
    const hp1: HandPointer = createHandPointer(docFor(tapHandle), { createDragEvent: (t) => ({ type: t }) as unknown as Event });
    hp1.pointAt(140, 110);
    hp1.pinch(true);
    hp1.pointAt(144, 110); // 4px — under the 6px threshold
    hp1.pinch(false);
    expect(tapClicks).toBe(1);
    hp1.destroy();

    // Case 2: a real move (>= 6px) — drag semantics, release does NOT also fire a click.
    const dragHandleEl = dragHandle();
    let dragClicks = 0;
    dragHandleEl.addEventListener('click', () => { dragClicks++; });
    const hp2: HandPointer = createHandPointer(docFor(dragHandleEl), { createDragEvent: (t) => ({ type: t }) as unknown as Event });
    hp2.pointAt(140, 110);
    hp2.pinch(true);
    hp2.pointAt(147, 110); // 7px — at/over the threshold
    hp2.pinch(false);
    expect(dragClicks).toBe(0);
    expect(hp2.lastActivated).toBe(dragHandleEl as unknown as HTMLElement);
    hp2.destroy();

    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });
});
