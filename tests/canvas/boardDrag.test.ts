import { describe, expect, it, vi } from 'vitest';
import { attachBoardDrag } from '../../src/canvas/boardDrag';

// Minimal fake title element (the suite runs in node, no jsdom).
type Fn = (e: Record<string, unknown>) => void;
function fakeTitle() {
  const l: Record<string, Array<{ fn: Fn; capture: boolean }>> = {};
  const el = {
    dataset: {} as Record<string, string>,
    addEventListener(t: string, fn: Fn, capture?: boolean) { (l[t] ??= []).push({ fn, capture: !!capture }); },
    removeEventListener(t: string, fn: Fn) { l[t] = (l[t] ?? []).filter((x) => x.fn !== fn); },
    setPointerCapture() {}, releasePointerCapture() {},
  };
  const stopped = { v: false };
  const fire = (t: string, p: Record<string, unknown> = {}) => {
    stopped.v = false;
    const ev = { pointerId: 1, button: 0, clientX: 0, clientY: 0, ...p, stopPropagation() { stopped.v = true; }, preventDefault() {} };
    for (const x of l[t] ?? []) x.fn(ev);
    return { stopped: stopped.v };
  };
  return { el: el as unknown as HTMLElement, raw: el, fire, stopped };
}

describe('attachBoardDrag', () => {
  it('drags in world units (screen delta / zoom) and ends once', () => {
    const t = fakeTitle(); const moves: Array<[number, number]> = [];
    const onEnd = vi.fn();
    attachBoardDrag(t.el, { frameId: 'f1', getZoom: () => 0.5, onMove: (_i, dx, dy) => moves.push([dx, dy]), onEnd });
    t.fire('pointerdown', { clientX: 100, clientY: 100 });
    t.fire('pointermove', { clientX: 120, clientY: 110 });
    t.fire('pointerup', { clientX: 120, clientY: 110 });
    expect(moves.reduce((a, m) => [a[0] + m[0], a[1] + m[1]], [0, 0])).toEqual([40, 20]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(t.raw.dataset.dragged).toBe('1');
  });
  it('stops pointerdown propagation so the viewport does not pan', () => {
    const t = fakeTitle();
    attachBoardDrag(t.el, { frameId: 'f1', getZoom: () => 1, onMove() {}, onEnd() {} });
    expect(t.fire('pointerdown').stopped).toBe(true);
  });
  it('a 3px wiggle is a click: no move, no end, click not swallowed', () => {
    const t = fakeTitle(); const onMove = vi.fn(); const onEnd = vi.fn();
    attachBoardDrag(t.el, { frameId: 'f1', getZoom: () => 1, onMove, onEnd });
    t.fire('pointerdown', { clientX: 10, clientY: 10 });
    t.fire('pointermove', { clientX: 13, clientY: 10 });
    t.fire('pointerup', { clientX: 13, clientY: 10 });
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(t.raw.dataset.dragged).toBeUndefined();
    expect(t.fire('click').stopped).toBe(false);
  });
  it('after a real drag the click is swallowed once', () => {
    const t = fakeTitle();
    attachBoardDrag(t.el, { frameId: 'f1', getZoom: () => 1, onMove() {}, onEnd() {} });
    t.fire('pointerdown'); t.fire('pointermove', { clientX: 30 }); t.fire('pointerup', { clientX: 30 });
    expect(t.fire('click').stopped).toBe(true);
    expect(t.fire('click').stopped).toBe(false);
  });
  it('detach removes the listeners', () => {
    const t = fakeTitle(); const onMove = vi.fn();
    const off = attachBoardDrag(t.el, { frameId: 'f1', getZoom: () => 1, onMove, onEnd() {} });
    off();
    t.fire('pointerdown'); t.fire('pointermove', { clientX: 50 });
    expect(onMove).not.toHaveBeenCalled();
  });
});
