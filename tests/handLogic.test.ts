import { describe, expect, it } from 'vitest';
import { createHandsProcessor, HAND_CONNECTIONS, HAND_COLORS, type HandEvent, type Pt } from '../src/input/handLogic';

/** 21 landmarks; wrist->middle MCP = 0.2. `gap` = thumb-index tip distance. */
function hand(cx: number, cy: number, gap: number): Pt[] {
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  pts[0] = { x: cx, y: cy + 0.2 };
  pts[9] = { x: cx, y: cy };
  pts[8] = { x: cx, y: cy - 0.05 };
  pts[4] = { x: cx + gap, y: cy - 0.05 };
  return pts;
}
const OPEN = 0.15; // ratio 0.75 -> not pinching
const PINCH = 0.02; // ratio 0.1 -> pinching

function setup() {
  const events: HandEvent[] = [];
  const p = createHandsProcessor((e) => events.push(e));
  return { p, events, types: () => events.filter((e) => e.type !== 'tracking').map((e) => `${e.type}${'hand' in e ? e.hand : ''}`) };
}

describe('hand skeleton', () => {
  it('connects all 21 landmarks', () => {
    const used = new Set(HAND_CONNECTIONS.flat());
    expect(used.size).toBe(21);
    expect(HAND_CONNECTIONS.length).toBe(21);
  });

  it('returns all 21 mirrored points, per-hand colours, pinch colour change', () => {
    const { p } = setup();
    let f = p.process([{ landmarks: hand(0.3, 0.5, OPEN), label: 'Left' }, { landmarks: hand(0.7, 0.5, OPEN), label: 'Right' }]);
    expect(f).toHaveLength(2);
    expect(f[0].points).toHaveLength(21);
    expect(f[0].points[0].x).toBeCloseTo(0.7);
    expect(f[0].color).toBe(HAND_COLORS[0].idle);
    expect(f[1].color).toBe(HAND_COLORS[1].idle);
    f = p.process([{ landmarks: hand(0.3, 0.5, PINCH), label: 'Left' }, { landmarks: hand(0.7, 0.5, OPEN), label: 'Right' }]);
    expect(f[0].pinching).toBe(true);
    expect(f[0].color).toBe(HAND_COLORS[0].pinch);
  });
});

describe('two-hand pinch arbitration', () => {
  it('pinch tap works with either hand', () => {
    const { p, types } = setup();
    p.process([{ landmarks: hand(0.3, 0.5, OPEN), label: 'Right' }]);
    p.process([{ landmarks: hand(0.3, 0.5, PINCH), label: 'Right' }]);
    p.process([{ landmarks: hand(0.3, 0.5, OPEN), label: 'Right' }]);
    expect(types()).toEqual(['pinch-start0', 'pinch-tap0', 'pinch-end0']);
  });

  it('second hand cannot steal an active drag', () => {
    const { p, events, types } = setup();
    const L = (g: number, x = 0.3) => ({ landmarks: hand(x, 0.5, g), label: 'Left' });
    const R = (g: number, x = 0.7) => ({ landmarks: hand(x, 0.5, g), label: 'Right' });
    p.process([L(OPEN), R(OPEN)]);
    p.process([L(PINCH), R(OPEN)]); // left owns
    p.process([L(PINCH, 0.35), R(PINCH)]); // right pinches too: ignored
    p.process([L(PINCH, 0.4), R(PINCH, 0.6)]);
    expect(p.owner).toBe(0);
    const moves = events.filter((e) => e.type === 'pinch-move');
    expect(moves.every((e) => e.type === 'pinch-move' && e.hand === 0)).toBe(true);
    expect(moves).toHaveLength(2);
    p.process([L(OPEN), R(PINCH, 0.6)]); // left releases; right still held, no takeover mid-pinch
    expect(p.owner).toBe(null);
    p.process([L(OPEN), R(OPEN)]);
    p.process([L(OPEN), R(PINCH)]); // fresh right pinch now owns
    expect(p.owner).toBe(1);
    expect(types()).toEqual(['pinch-start0', 'pinch-move0', 'pinch-move0', 'pinch-end0', 'pinch-start1']);
  });

  it('ends the drag if the owning hand leaves the frame', () => {
    const { p, types } = setup();
    p.process([{ landmarks: hand(0.3, 0.5, PINCH), label: 'Left' }, { landmarks: hand(0.7, 0.5, OPEN), label: 'Right' }]);
    p.process([{ landmarks: hand(0.7, 0.5, OPEN), label: 'Right' }]);
    expect(types()).toEqual(['pinch-start0', 'pinch-end0']);
    expect(p.owner).toBe(null);
    p.process([]);
    expect(types().at(-1)).toBe('lost');
  });

  it('keeps colour slots stable when hand order swaps', () => {
    const { p } = setup();
    p.process([{ landmarks: hand(0.3, 0.5, OPEN), label: 'Left' }, { landmarks: hand(0.7, 0.5, OPEN), label: 'Right' }]);
    const f = p.process([{ landmarks: hand(0.7, 0.5, OPEN), label: 'Right' }, { landmarks: hand(0.3, 0.5, OPEN), label: 'Left' }]);
    expect(f.map((h) => h.slot)).toEqual([1, 0]);
  });
});
