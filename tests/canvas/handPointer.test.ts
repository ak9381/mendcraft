import { describe, expect, it, vi } from 'vitest';
import { distToRect, DRAG_HANDLE, mapToScreen, nextPinch, pickNearest, pinchRatio, sliderValueAt, REACH, SCREEN_MARGIN_PX } from '../../src/canvas/handPointer';
import { micFabState, mountMicFab, MIC_LISTENING_LABEL } from '../../src/canvas/micFab';

const hand = (gap: number) => {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  lm[0] = { x: 0.5, y: 0.8 }; lm[9] = { x: 0.5, y: 0.5 }; // size 0.3
  lm[4] = { x: 0.5, y: 0.4 }; lm[8] = { x: 0.5 + gap, y: 0.4 };
  return lm;
};

describe('hand pointer maths', () => {
  it('maps the mirrored central 80% reach box to the screen, then clamps to the margin', () => {
    const m = SCREEN_MARGIN_PX;
    const a = mapToScreen({ x: 1 - REACH.x0, y: REACH.y0 }, 1000, 800);
    expect(a.x).toBeCloseTo(m); expect(a.y).toBeCloseTo(m);
    const b = mapToScreen({ x: 1 - REACH.x1, y: REACH.y1 }, 1000, 800);
    expect(b.x).toBeCloseTo(1000 - m); expect(b.y).toBeCloseTo(800 - m);
    expect(mapToScreen({ x: 0.5, y: 0.5 }, 1000, 800).x).toBeCloseTo(500);
    expect(mapToScreen({ x: -1, y: 5 }, 1000, 800)).toEqual({ x: 1000 - m, y: 800 - m });
  });
  it('detects pinch with hysteresis, scale-invariant', () => {
    expect(pinchRatio(hand(0.03))).toBeCloseTo(0.1);
    expect(nextPinch(false, pinchRatio(hand(0.05)))).toBe(true);   // 0.167 < 0.20
    expect(nextPinch(false, pinchRatio(hand(0.084)))).toBe(false); // 0.28, between on/off
    expect(nextPinch(true, pinchRatio(hand(0.084)))).toBe(true);   // held until > 0.30
    expect(nextPinch(true, pinchRatio(hand(0.12)))).toBe(false);   // 0.40, off
  });
  it('picks the control under the point, else the nearest within the snap radius', () => {
    const items = [
      { item: 'big', rect: { left: 0, top: 0, width: 300, height: 300 } },
      { item: 'small', rect: { left: 100, top: 100, width: 20, height: 20 } },
      { item: 'far', rect: { left: 600, top: 0, width: 40, height: 40 } },
    ];
    expect(pickNearest({ x: 110, y: 110 }, items, 56)).toBe('small');
    expect(pickNearest({ x: 340, y: 20 }, items, 56)).toBe('big');
    expect(pickNearest({ x: 560, y: 20 }, items, 56)).toBe('far');
    expect(pickNearest({ x: 450, y: 500 }, items, 56)).toBeNull();
    expect(distToRect({ x: 5, y: 5 }, items[0].rect)).toBe(0);
  });
  it('drags a slider to the pinch position with its step', () => {
    const r = { left: 100, top: 0, width: 200, height: 20 };
    expect(sliderValueAt(100, r, 0, 100, 1)).toBe(0);
    expect(sliderValueAt(200, r, 0, 100, 1)).toBe(50);
    expect(sliderValueAt(263, r, 0, 100, 10)).toBe(80);
    expect(sliderValueAt(999, r, 0, 100, 1)).toBe(100);
  });
});

describe('DRAG_HANDLE', () => {
  it('forwards pinch-hold for both panel-drag and editBoard move/resize handles', () => {
    // editBoard.ts's move/resize handles ride the same pointerdown/move/up
    // forwarding dragPanel.ts's title bars use — the hand pointer only needs
    // to recognise the element as "forward, don't tap-activate", regardless
    // of which handle kind it is.
    expect(DRAG_HANDLE).toContain('[data-mc-drag-handle]');
    expect(DRAG_HANDLE).toContain('[data-mc-resize-handle]');
  });
});

describe('floating mic', () => {
  function fakeRoot() {
    const listeners: Record<string, () => void> = {};
    const el: any = {
      type: '', className: '', innerHTML: '', attrs: {} as Record<string, string>,
      classList: { toggle: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      addEventListener(t: string, f: () => void) { listeners[t] = f; },
      querySelector: () => ({ textContent: '' }),
      append() {},
      remove: vi.fn(),
    };
    const root: any = { ownerDocument: { createElement: () => el }, append: vi.fn() };
    return { root, el, click: () => listeners.click() };
  }
  it('toggles listening with aria-pressed and a clear label', () => {
    const { root, el, click } = fakeRoot();
    const voice = { supported: true, pushToTalkStart: vi.fn(), pushToTalkStop: vi.fn() };
    const fab = mountMicFab(root, voice, () => {}, { setTimer: (() => 1) as never, clearTimer: (() => {}) as never });
    expect(el.attrs['aria-pressed']).toBe('false');
    click();
    expect(fab.listening).toBe(true); expect(voice.pushToTalkStart).toHaveBeenCalled();
    expect(el.attrs['aria-pressed']).toBe('true');
    click();
    expect(fab.listening).toBe(false); expect(voice.pushToTalkStop).toHaveBeenCalled();
    expect(micFabState(true).label).toBe(MIC_LISTENING_LABEL);
  });
  it('explains instead of failing when the browser has no speech recognition', () => {
    const { root, click } = fakeRoot();
    const said: string[] = [];
    const fab = mountMicFab(root, { supported: false, pushToTalkStart: vi.fn(), pushToTalkStop: vi.fn() }, (t) => said.push(t));
    click();
    expect(fab.listening).toBe(false);
    expect(said[0]).toMatch(/type in the say box/);
  });
});
