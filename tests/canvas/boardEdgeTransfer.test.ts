import { describe, expect, it } from 'vitest';
import {
  boardSendLine, createBoardEdgeTransferController, createSentBoardMemo, pairedEdgeLayout,
  type BoardSend, type EdgeGlow,
} from '../../src/canvas/edgeTransfer';
import { attachBoardDrag } from '../../src/canvas/boardDrag';
import { createPairFirst } from '../../src/canvas/pairedRow';
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
  const timers = new Set<() => void>();
  const c = createBoardEdgeTransferController({
    every: (fn) => { timers.add(fn); return fn; },
    stopEvery: (h) => { timers.delete(h as () => void); },
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
  return {
    c, rects, sends, glows, hand, timers,
    tick: (ms: number) => { t += ms; },
    /** Advance the clock in timer-sized steps, firing the repeating hold check. */
    hold: (ms: number) => { for (let i = 0; i < ms; i += 60) { t += 60; for (const fn of [...timers]) fn(); } },
  };
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

  it('held STILL at the edge (no more move events) commits after the dwell via the timer', () => {
    const r = rig(IPHONE_RIGHT);
    r.hand.start(400);
    r.hand.move(995); // reaches the edge, then the fist/mouse stops moving
    expect(r.timers.size).toBe(1);
    expect(r.sends).toHaveLength(0);
    r.hold(120);
    expect(r.sends).toHaveLength(0); // still inside the dwell
    r.hold(180);
    expect(r.sends).toHaveLength(1);
    expect(r.sends[0]).toMatchObject({ side: 'right', target: 'ios' });
    expect(r.rects.b1).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    r.hold(500);
    expect(r.sends).toHaveLength(1); // once per drag
    r.hand.end();
    expect(r.timers.size).toBe(0); // the hold check stops with the drag
  });

  it('held still away from the edge never commits', () => {
    const r = rig(IPHONE_RIGHT);
    r.hand.start(400);
    r.hand.move(700);
    r.hold(1000);
    expect(r.sends).toHaveLength(0);
    r.hand.end();
    expect(r.rects.b1.x).toBe(400); // an ordinary move stays where it was dropped
  });

  it('a cancelled drag snaps the board back to where it started', () => {
    const r = rig(IPHONE_RIGHT);
    r.hand.start(400);
    r.hand.move(600);
    r.c.handleBoardDrag({ frameId: 'b1', phase: 'cancel', clientX: 600, clientY: 300 });
    expect(r.rects.b1).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    expect(r.timers.size).toBe(0);
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
    // Released at the edge mid-hold: back to the start, not left half off-screen.
    expect(r.rects.b1).toEqual({ x: 100, y: 100, w: 300, h: 200 });
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
  it('a live phone that announced counts even when the row does not list it', () => {
    const row = [{ id: 'android', label: 'Nothing phone', sim: false }];
    expect(pairedEdgeLayout(layout, row, { live: true, announced: ['ios', 'android'] })).toEqual(layout);
    expect(pairedEdgeLayout(layout, [], { live: true, announced: ['ios'] })).toEqual({ left: null, right: 'ios' });
    // Not live: announces never light a SIM edge.
    expect(pairedEdgeLayout(layout, [], { live: false, announced: ['ios'] })).toEqual({ left: null, right: null });
  });
  it('a live phone is placed by its announce id, never guessed from its label', () => {
    // Not announced (generic id) even though the label says iPhone → strip, not a guess.
    expect(pairedEdgeLayout(layout, [{ id: 'x', label: 'iPhone', sim: false }], { live: true })).toEqual(layout);
    expect(pairedEdgeLayout(layout, [{ id: 'android', label: 'Phone', sim: false }], { live: true })).toEqual({ left: 'android', right: null });
  });
});

describe('createSentBoardMemo', () => {
  const focus = { kind: 'room', title: 'Focus', tiles: [] } as unknown as SurfacePlan;
  it('routine republishes keep the sent board (with its target) until the focus changes', () => {
    const m = createSentBoardMemo();
    expect(m.current('f1', focus)).toEqual({ board: focus, frameId: 'f1' });
    m.remember({ boardFor: 'ios', board: BOARD }, 'f1', focus);
    expect(m.current('f1', focus)).toEqual({ board: BOARD, boardFor: 'ios', frameId: 'f1' });
    expect(m.current('f1', focus)).toEqual({ board: BOARD, boardFor: 'ios', frameId: 'f1' });
    // The focused board was edited (new plan object) → mirror the focus again, for good.
    const edited = { ...focus } as SurfacePlan;
    expect(m.current('f1', edited)).toEqual({ board: edited, frameId: 'f1' });
    expect(m.current('f1', focus)).toEqual({ board: focus, frameId: 'f1' });
  });
  it('remembers which board the sent plan came from (its drawings ride along)', () => {
    const m = createSentBoardMemo();
    m.remember({ boardFor: 'ios', board: BOARD, frameId: 'f9' }, 'f1', focus);
    expect(m.current('f1', focus)).toEqual({ board: BOARD, boardFor: 'ios', frameId: 'f9' });
  });
  it('focusing another board ends the memo', () => {
    const m = createSentBoardMemo();
    m.remember({ boardFor: 'android', board: BOARD }, 'f1', focus);
    expect(m.current('f2', null)).toEqual({ board: null, frameId: 'f2' });
  });
});

describe('boardSendLine', () => {
  it('labels the SIM send and names the phone', () => {
    expect(boardSendLine('ios', 'Living room', false)).toBe('Sent to the iPhone (SIM).');
    expect(boardSendLine('android', 'Living room', true)).toBe('Sent Living room to the Nothing phone.');
  });
});

// Live bug (two real phones, 1550-px laptop): the strip read "◀ iPhone · left
// · Nothing · right ▶", the right edge sent to the Nothing phone, the left edge
// never glowed. The pair-first row listed only the Nothing phone (the iPhone's
// live announce arrived while the row was idle; later ones were keep-alives),
// and the edges were limited to that row. Real controllers end to end:
// createPairFirst + pairedEdgeLayout + the board controller + the title drag.
describe('live phones: both edges, before and after a swap', () => {
  const VW = 1550;
  function live(layout0: ScreenLayout) {
    let layout = layout0;
    let t = 0;
    const timers = new Set<() => void>();
    const pf = createPairFirst({
      say: () => undefined, sim: () => false, openPairing: () => new Promise<boolean>(() => undefined),
      buildDashboard: () => undefined, schedule: () => 0, clear: () => undefined,
    });
    // The iPhone rejoins (remembered pair) before pair-first runs: its announce
    // is live but the row is idle, so it is not listed. The Nothing phone joins
    // during pairing and is listed. Both have announced live this session.
    const announced = new Set<'ios' | 'android'>();
    pf.addPhone({ id: 'ios', label: 'iPhone' }); announced.add('ios');
    void pf.begin();
    pf.addPhone({ id: 'android', label: 'Nothing phone' }); announced.add('android');
    const rect = { x: 0, y: 0, w: 620, h: 520 };
    const sends: BoardSend[] = [];
    const glowSides = new Set<string>();
    const c = createBoardEdgeTransferController({
      every: (fn) => { timers.add(fn); return fn; },
      stopEvery: (h) => { timers.delete(h as () => void); },
      getViewportWidth: () => VW,
      getLayout: () => pairedEdgeLayout(layout, pf.phones(), { live: true, announced }),
      getRect: () => ({ ...rect }),
      restoreRect: (_id, r) => { Object.assign(rect, r); },
      getBoard: () => BOARD,
      onGlow: (g) => { if (g.side && g.glow > 0.05) glowSides.add(g.side); },
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
    const fire = (k: string, x: number) => { for (const fn of l[k] ?? []) fn({ pointerId: 1, button: 0, clientX: x, clientY: 30, stopPropagation() {}, preventDefault() {} }); };
    attachBoardDrag(title as unknown as HTMLElement, {
      frameId: 'b1',
      getZoom: () => 1,
      onMove: (id, dx, dy, cx, cy) => { if (c.handleBoardDrag({ frameId: id, phase: 'move', clientX: cx, clientY: cy })) { rect.x += dx; rect.y += dy; } },
      onEnd: (id, cancelled) => { c.handleBoardDrag({ frameId: id, phase: cancelled ? 'cancel' : 'end', clientX: NaN, clientY: NaN }); },
    });
    /** The live test's drag: down on the title, 30 moves to the edge, 40 hold moves (±1 px, 100 ms apart), up. */
    function drag(side: 'left' | 'right') {
      glowSides.clear();
      const before = sends.length;
      const x0 = rect.x + 300, tx = side === 'left' ? 1 : VW - 1;
      fire('pointerdown', x0);
      for (let i = 1; i <= 30; i++) { t += 16; fire('pointermove', x0 + ((tx - x0) * i) / 30); }
      for (let i = 0; i < 40; i++) { t += 100; for (const fn of [...timers]) fn(); fire('pointermove', tx + (i % 2 ? (side === 'left' ? 1 : -1) : 0)); }
      fire('pointerup', tx);
      return { glowed: glowSides.has(side), sent: sends.slice(before) };
    }
    return { drag, swap: () => { layout = { left: layout.right, right: layout.left }; }, rect, pf };
  }

  it('the row lists only the Nothing phone (the live state behind the bug)', () => {
    expect(live({ left: 'ios', right: 'android' }).pf.phones().map((p) => p.id)).toEqual(['android']);
  });

  it('iPhone on the left: holding at the left edge glows and sends to the iPhone', () => {
    const r = live({ left: 'ios', right: 'android' });
    const res = r.drag('left');
    expect(res.glowed).toBe(true);
    expect(res.sent).toHaveLength(1);
    expect(res.sent[0]).toMatchObject({ side: 'left', target: 'ios' });
    expect(r.rect).toEqual({ x: 0, y: 0, w: 620, h: 520 }); // snapped back
  });

  it('Nothing on the right: holding at the right edge sends to the Nothing phone', () => {
    const r = live({ left: 'ios', right: 'android' });
    const res = r.drag('right');
    expect(res.glowed).toBe(true);
    expect(res.sent[0]).toMatchObject({ side: 'right', target: 'android' });
  });

  it('two drags in a row (the second right after a commit) both send; after a swap both edges send again', () => {
    const r = live({ left: 'ios', right: 'android' });
    expect(r.drag('right').sent[0]).toMatchObject({ target: 'android' });
    expect(r.drag('left').sent[0]).toMatchObject({ target: 'ios' });
    expect(r.drag('left').sent[0]).toMatchObject({ target: 'ios' });
    r.swap();
    const left = r.drag('left'), right = r.drag('right');
    expect(left.glowed && right.glowed).toBe(true);
    expect(left.sent[0]).toMatchObject({ side: 'left', target: 'android' });
    expect(right.sent[0]).toMatchObject({ side: 'right', target: 'ios' });
  });
});
