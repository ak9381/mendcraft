// The open-palm highlight core: nearest target, sticky hysteresis, slower
// motion in crowds, and the magnified row for a crowded group.
import { describe, expect, it } from 'vitest';
import { createHighlightCore, PALM_HIGHLIGHT, targetScore, type HighlightTarget } from '../../src/canvas/palmHighlight';

const VP = { w: 1440, h: 900 };
const box = (item: string, left: number, top: number, width = 100, height = 52): HighlightTarget<string> => ({ item, rect: { left, top, width, height } });

/** Two buttons with a 10 px gap, far from anything else. */
const PAIR = [box('A', 400, 400), box('B', 510, 400)];
/** Two rows of five 40 px icon buttons, 8 px apart (a dense icon grid). */
const DENSE = [
  ...['a', 'b', 'c', 'd', 'e'].map((id, i) => box(id, 600 + i * 48, 200, 40, 40)),
  ...['f', 'g', 'h', 'i', 'j'].map((id, i) => box(id, 600 + i * 48, 248, 40, 40)),
];
/** A toolbar: 100 px buttons, 10 px gaps — not a crowd. */
const TOOLBAR = ['n', 's', 'u', 'h', 'd'].map((id, i) => box(id, 200 + i * 110, 30, 100, 52));

describe('createHighlightCore — picking', () => {
  it('snaps to the nearest button, even from outside it', () => {
    const h = createHighlightCore<string>();
    expect(h.update({ x: 450, y: 380 }, PAIR, 0, VP).current).toBe('A');
    const g = createHighlightCore<string>();
    expect(g.update({ x: 640, y: 426 }, PAIR, 0, VP).current).toBe('B');
  });

  it('nothing within capture range → no highlight', () => {
    const h = createHighlightCore<string>();
    expect(h.update({ x: 100, y: 100 }, PAIR, 0, VP).current).toBeNull();
    expect(PALM_HIGHLIGHT.capturePx).toBeLessThan(300);
  });

  it('sticky: crossing into the neighbour only switches once clearly closer', () => {
    const h = createHighlightCore<string>();
    let t = 0;
    h.update({ x: 450, y: 426 }, PAIR, t, VP); // centre of A
    const seen: string[] = [];
    // Walk right one px per frame toward B's centre (560).
    for (let x = 451; x <= 560; x++) seen.push(h.update({ x, y: 426 }, PAIR, (t += 16), VP).current!);
    const switchAt = 451 + seen.indexOf('B');
    expect(switchAt).toBeGreaterThan(515); // not at the boundary (505–510) …
    expect(switchAt).toBeLessThan(560); // … but well before B's centre
    // And back: the switch to A happens on the other side of the gap (hysteresis).
    const back: string[] = [];
    for (let x = 559; x >= 450; x--) back.push(h.update({ x, y: 426 }, PAIR, (t += 16), VP).current!);
    const backAt = 559 - back.indexOf('A');
    expect(backAt).toBeLessThan(510); // back over A's side of the gap …
    expect(switchAt - backAt).toBeGreaterThan(12); // … a wide dead band between the two switches
  });

  it('jitter around the boundary never flickers', () => {
    const h = createHighlightCore<string>();
    h.update({ x: 450, y: 426 }, PAIR, 0, VP);
    const seen = new Set<string>();
    for (let k = 0; k < 120; k++) seen.add(h.update({ x: 507 + Math.sin(k) * 6, y: 426 + Math.cos(k) * 6 }, PAIR, k * 16, VP).current!);
    expect([...seen]).toEqual(['A']);
  });

  it('a target that leaves the screen is dropped', () => {
    const h = createHighlightCore<string>();
    h.update({ x: 450, y: 426 }, PAIR, 0, VP);
    expect(h.update({ x: 450, y: 426 }, [PAIR[1]], 16, VP).current).toBe('B');
  });

  it('no open palm (null) freezes the highlight where it was', () => {
    const h = createHighlightCore<string>();
    h.update({ x: 450, y: 426 }, PAIR, 0, VP);
    expect(h.update(null, PAIR, 16, VP).current).toBe('A');
    // The palm reappears somewhere else (the hand moved while it wasn't open):
    // re-anchored, no jump.
    expect(h.update({ x: 900, y: 700 }, PAIR, 32, VP).current).toBe('A');
  });

  it('inside a rect, being nearer its middle still counts', () => {
    const r = { left: 0, top: 0, width: 100, height: 50 };
    expect(targetScore({ x: 50, y: 25 }, r)).toBeLessThan(targetScore({ x: 95, y: 25 }, r));
  });
});

describe('createHighlightCore — dense areas are slower', () => {
  it('the same hand motion moves the highlight less among many targets', () => {
    const sparse = createHighlightCore<string>();
    const dense = createHighlightCore<string>({ expandAfterMs: 1e9 });
    sparse.update({ x: 300, y: 600 }, PAIR, 0, VP);
    dense.update({ x: 620, y: 238 }, DENSE, 0, VP);
    for (let k = 1; k <= 10; k++) {
      sparse.update({ x: 300 + k * 5, y: 600 }, PAIR, k * 16, VP);
      dense.update({ x: 620 + k * 5, y: 238 }, DENSE, k * 16, VP);
    }
    const sparseMoved = sparse.view.point!.x - 300;
    const denseMoved = dense.view.point!.x - 620;
    expect(sparseMoved).toBeGreaterThan(45);
    expect(denseMoved).toBeLessThan(sparseMoved * 0.7);
  });
});

describe('createHighlightCore — crowded group magnifies', () => {
  it('≥4 targets within 48 px, hovered with an open palm 500 ms → a spaced row', () => {
    const h = createHighlightCore<string>();
    let v = h.update({ x: 668, y: 238 }, DENSE, 0, VP);
    expect(v.expanded).toBeNull();
    v = h.update({ x: 668, y: 238 }, DENSE, 300, VP);
    expect(v.expanded).toBeNull();
    v = h.update({ x: 668, y: 238 }, DENSE, 520, VP);
    expect(v.expanded).not.toBeNull();
    const slots = v.expanded!.slots;
    expect(slots.length).toBeGreaterThanOrEqual(3);
    // Spaced and big: every slot is far wider and further apart than the originals.
    for (let i = 1; i < slots.length; i++) expect(slots[i].left - (slots[i - 1].left + slots[i - 1].width)).toBeGreaterThanOrEqual(24);
    expect(slots[0].width).toBeGreaterThan(120);
    // The highlight stays on the same button, now shown at its slot.
    expect(v.current).toBe('b');
    expect(v.rect).toEqual(slots[v.expanded!.items.indexOf('b')]);
  });

  it('the palm then moves across the row: one slot per slot-width of motion', () => {
    const h = createHighlightCore<string>();
    for (let t = 0; t <= 520; t += 40) h.update({ x: 668, y: 238 }, DENSE, t, VP);
    const v0 = h.view;
    const items = v0.expanded!.items;
    const i0 = items.indexOf(v0.current!);
    let x = 668;
    let t = 560;
    // Move right by ~1.2 slot pitches.
    const pitch = PALM_HIGHLIGHT.slotW + PALM_HIGHLIGHT.slotGap;
    for (let k = 0; k < 24; k++) h.update({ x: (x += pitch * 1.2 / 24), y: 238 }, DENSE, (t += 16), VP);
    expect(items.indexOf(h.view.current!)).toBe(i0 + 1);
    expect(h.view.expanded).not.toBeNull();
  });

  it('moving well away from the row collapses it', () => {
    const h = createHighlightCore<string>();
    for (let t = 0; t <= 520; t += 40) h.update({ x: 668, y: 238 }, DENSE, t, VP);
    let y = 220;
    let t = 560;
    for (let k = 0; k < 30; k++) h.update({ x: 668, y: (y += 12) }, DENSE, (t += 16), VP);
    expect(h.view.expanded).toBeNull();
  });

  it('a loose (not open) hand never magnifies, nor does an open palm that was not open the whole 500 ms', () => {
    const h = createHighlightCore<string>();
    for (let t = 0; t <= 2000; t += 40) h.update({ x: 668, y: 238 }, DENSE, t, VP, false);
    expect(h.view.expanded).toBeNull();
    const g = createHighlightCore<string>();
    for (let t = 0; t <= 2000; t += 40) g.update({ x: 668, y: 238 }, DENSE, t, VP, t % 400 !== 0);
    expect(g.view.expanded).toBeNull();
  });

  it('a normal toolbar (100 px buttons, 10 px gaps) never magnifies', () => {
    const h = createHighlightCore<string>();
    for (let t = 0; t <= 2000; t += 40) h.update({ x: 360, y: 56 }, TOOLBAR, t, VP);
    expect(h.view.expanded).toBeNull();
  });

  it('adopt: the cursor directly on a control takes the highlight there', () => {
    const h = createHighlightCore<string>();
    h.update({ x: 450, y: 426 }, PAIR, 0, VP);
    h.adopt('B');
    expect(h.update(null, PAIR, 16, VP).current).toBe('B');
  });

  it('a sparse pair never magnifies', () => {
    const h = createHighlightCore<string>();
    for (let t = 0; t <= 2000; t += 40) h.update({ x: 450, y: 426 }, PAIR, t, VP);
    expect(h.view.expanded).toBeNull();
  });

  it('reset clears everything', () => {
    const h = createHighlightCore<string>();
    for (let t = 0; t <= 520; t += 40) h.update({ x: 668, y: 238 }, DENSE, t, VP);
    h.reset();
    expect(h.view).toEqual({ current: null, point: null, rect: null, expanded: null });
  });
});
