import { describe, expect, it } from 'vitest';
import {
  boardSendLine, createBoardEdgeTransferController, pairedEdgeLayout,
  type BoardSend, type EdgeGlow,
} from '../../src/canvas/edgeTransfer';
import { attachBoardDrag } from '../../src/canvas/boardDrag';
import type { ScreenLayout } from '../../src/canvas/screenLayout';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

// A tiny fake canvas: one board with a world rect, a clock, and the controller
// wired the way canvasApp wires it (the caller applies a move only when the
// controller says so; a commit snaps the board back to where the drag began).
const BOARD: SurfacePlan = { kind: 'room', title: 'Living room', tiles: [] } as unknown as SurfacePlan;
const W = 1000;

function rig(layout: ScreenLayout) {
  let t = 0;
  const rects: Record<string, { x: number; y: number; w: number; h: number }> = { b1: { x: 100, y: 100, w: 300, h: 200 } };
  const sends: BoardSend[] = [];
  const glows: EdgeGlow[] = [];
  const c = createBoardEdgeTransferController({
    getViewportWidth: () => W,
    getLayout: () => layout,
    getRect: (id) => (rects[id] ? { ...rects[id] } : null),
    restoreRect: (id, r) => { rects[id] = { ...r }; },
    getBoard: (id) => (id === 'b1' ? BOARD : null),
    onGlow: (g) => glows.push(g),
    onCommit: (s) => sends.push(s),
    now: () => t,
  });
  /** Hand path: start, then moves to absolute screen x (y fixed). */
  let lastX = 0;
  const hand = {
    start(x: number) { lastX = x; c.handleBoardDrag({ frameId: 'b1', phase: 'start', clientX: x, clientY: 300 }); },
    move(x: number) {
      const dx = x - lastX; lastX = x;
      if (c.handleBoardDrag({ frameId: 'b1', phase: 'move', clientX: x, clientY: 300 })) rects.b1.x += dx;
    },
    end() { c.handleBoardDrag({ frameId: 'b1', phase: 'end', clientX: lastX, clientY: 300 }); },
  };
  return { c, rects, sends, glows, hand, tick: (ms: number) => { t += ms; } };
}

const IPHONE_RIGHT: ScreenLayout = { left: 'android', right: 'ios' };

describe('board → phone edge transfer', () => {
  it('reaching the right edge with an iPhone paired there + dwell → one send, board snaps back', () => {
    const r = rig(IPHONE_RIGHT);
    r.hand.start(400);
    r.hand.move(700);
    r.hand.move(990); // inside the right edge zone
    expect(r.glows.at(-1)?.side).toBe('right');
    expect(r.glows.at(-1)!.glow).toBeGreaterThan(0);
    expect(r.sends).toHaveLength(0);
    r.tick(300);
    r.hand.move(992); // still holding at the edge past the dwell
    expect(r.sends).toHaveLength(1);
    expect(r.sends[0]).toMatchObject({ frameId: 'b1', side: 'right', target: 'ios', board: BOARD });
    expect(r.rects.b1).toEqual({ x: 100, y: 100, w: 300, h: 200 }); // restored, not deleted
    expect(r.glows.at(-1)).toEqual({ side: null, glow: 0 });
    // The fist is still closed: further moves do not drag the board or re-send.
    r.tick(500);
    r.hand.move(995);
    expect(r.rects.b1.x).toBe(100);
    expect(r.sends).toHaveLength(1);
    r.hand.end();
    expect(r.c.sharedBoards().has('b1')).toBe(true);
    // A fresh drag works again.
    r.hand.start(400); r.hand.move(500);
    expect(r.rects.b1.x).toBe(200);
  });

  it('leaving the edge before the dwell sends nothing', () => {
    const r = rig(IPHONE_RIGHT);
    r.hand.start(400);
    r.hand.move(990);
    r.tick(100);
    r.hand.move(700); // back out
    r.tick(400);
    r.hand.move(705);
    r.hand.end();
    expect(r.sends).toHaveLength(0);
    expect(r.glows.at(-1)).toEqual({ side: null, glow: 0 });
    expect(r.c.sharedBoards().size).toBe(0);
  });

  it('releasing at the edge before the dwell cancels (no transfer)', () => {
    const r = rig(IPHONE_RIGHT);
    r.hand.start(400);
    r.hand.move(995);
    r.tick(100);
    r.hand.end();
    expect(r.sends).toHaveLength(0);
    expect(r.glows.at(-1)).toEqual({ side: null, glow: 0 });
  });

  it('a lost hand (cancel) mid-dwell sends nothing', () => {
    const r = rig(IPHONE_RIGHT);
    r.hand.start(400);
    r.hand.move(995);
    r.tick(100);
    r.c.handleBoardDrag({ frameId: 'b1', phase: 'cancel', clientX: 995, clientY: 300 });
    r.tick(400);
    expect(r.sends).toHaveLength(0);
  });

  it('no phone on that side → no glow, no send', () => {
    const r = rig({ left: 'android', right: null });
    r.hand.start(400);
    r.hand.move(995);
    r.tick(500);
    r.hand.move(996);
    r.hand.end();
    expect(r.sends).toHaveLength(0);
    expect(r.glows.every((g) => g.side === null && g.glow === 0)).toBe(true);
  });

  it('mouse title drag (boardDrag) behaves the same', () => {
    let t = 0;
    const rect = { x: 100, y: 100, w: 300, h: 200 };
    const sends: BoardSend[] = [];
    const c = createBoardEdgeTransferController({
      getViewportWidth: () => W,
      getLayout: () => IPHONE_RIGHT,
      getRect: () => ({ ...rect }),
      restoreRect: (_id, r) => { Object.assign(rect, r); },
      getBoard: () => BOARD,
      onGlow: () => undefined,
      onCommit: (s) => sends.push(s),
      now: () => t,
    });
    type Fn = (e: Record<string, unknown>) => void;
    const l: Record<string, Fn[]> = {};
    const title = {
      dataset: {} as Record<string, string>,
      addEventListener(k: string, fn: Fn) { (l[k] ??= []).push(fn); },
      removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
    };
    const fire = (k: string, x: number) => { for (const fn of l[k] ?? []) fn({ pointerId: 1, button: 0, clientX: x, clientY: 300, stopPropagation() {}, preventDefault() {} }); };
    attachBoardDrag(title as unknown as HTMLElement, {
      frameId: 'b1',
      getZoom: () => 1,
      onMove: (id, dx, dy, cx, cy) => {
        if (c.handleBoardDrag({ frameId: id, phase: 'move', clientX: cx, clientY: cy })) { rect.x += dx; rect.y += dy; }
      },
      onEnd: (id, cancelled) => { c.handleBoardDrag({ frameId: id, phase: cancelled ? 'cancel' : 'end', clientX: 0, clientY: 0 }); },
    });
    fire('pointerdown', 400);
    fire('pointermove', 700);
    expect(rect.x).toBe(400);
    fire('pointermove', 990);
    t += 300;
    fire('pointermove', 992);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ side: 'right', target: 'ios' });
    expect(rect).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    fire('pointerup', 992);
    expect(c.sharedBoards().has('b1')).toBe(true);

    // Early release with the mouse: no send.
    fire('pointerdown', 400);
    fire('pointermove', 995);
    t += 50;
    fire('pointerup', 995);
    expect(sends).toHaveLength(1);
  });
});

describe('pairedEdgeLayout', () => {
  const layout: ScreenLayout = { left: 'android', right: 'ios' };
  it('nothing paired and no host session → no edges', () => {
    expect(pairedEdgeLayout(layout, [], { live: false })).toEqual({ left: null, right: null });
  });
  it('SIM phones light only the sides of the phones that joined', () => {
    expect(pairedEdgeLayout(layout, [{ id: 'sim-2', label: 'iPhone', sim: true }], { live: false })).toEqual({ left: null, right: 'ios' });
    expect(pairedEdgeLayout(layout, [
      { id: 'sim-1', label: 'Nothing phone', sim: true }, { id: 'sim-2', label: 'iPhone', sim: true },
    ], { live: false })).toEqual(layout);
  });
  it('a live host session with an announced phone restricts to that side', () => {
    expect(pairedEdgeLayout(layout, [{ id: 'ios', label: 'iPhone', sim: false }], { live: true })).toEqual({ left: null, right: 'ios' });
  });
  it('a live host session with only an unnamed phone trusts the arrangement strip', () => {
    expect(pairedEdgeLayout(layout, [{ id: 'phone-generic', label: 'Phone', sim: false }], { live: true })).toEqual(layout);
    expect(pairedEdgeLayout(layout, [], { live: true })).toEqual(layout);
  });
});

describe('boardSendLine', () => {
  it('labels the SIM send and names the phone', () => {
    expect(boardSendLine('ios', 'Living room', false)).toBe('Sent to iPhone (SIM).');
    expect(boardSendLine('android', 'Living room', true)).toBe('Sent Living room to the Nothing phone.');
  });
});
