// Two-hand CAD edit planner (src/plan/twoHandEdit.ts): each hand grabs an
// anchor and the anchors track the fingers. Pure — simulated world points, no
// renderer/DOM. Covers B-117/B-118 (wall stretch), B-121 (room resize),
// B-066 (fixture resize), B-088 (two-hand multi-select).
import { describe, expect, it } from 'vitest';
import { emptyPlan, type Fixture, type Wall } from '../../src/plan/doc';
import {
  detectTwoHandStretch,
  twoHandStretchOps,
  detectTwoHandFixture,
  twoHandFixtureOp,
  twoHandMultiSelect,
} from '../../src/plan/twoHandEdit';

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100,
});
const fixture = (id: string, x: number, y: number, w = 400, d = 400, rotation = 0): Fixture => ({
  id, kind: 'chair', x, y, w, d, rotation,
});

describe('B-117/B-118 two-hand wall stretch', () => {
  it('detects each hand on a distinct wall endpoint, then both ends track the fingers', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const grab = detectTwoHandStretch(doc, ['w1'], { x: 20, y: 0 }, { x: 980, y: 0 }, 200);
    expect(grab).toEqual({ kind: 'wall', a: { wallId: 'w1', end: 'a' }, b: { wallId: 'w1', end: 'b' } });
    const ops = twoHandStretchOps(grab!, { x: -200, y: 0 }, { x: 1200, y: 0 });
    expect(ops).toEqual([
      { op: 'move_end', target: 'w1', end: 'a', x: -200, y: 0 },
      { op: 'move_end', target: 'w1', end: 'b', x: 1200, y: 0 },
    ]);
  });

  it('honours which hand grabbed which end (hands swapped)', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const grab = detectTwoHandStretch(doc, ['w1'], { x: 980, y: 0 }, { x: 20, y: 0 }, 200);
    expect(grab).toEqual({ kind: 'wall', a: { wallId: 'w1', end: 'b' }, b: { wallId: 'w1', end: 'a' } });
  });

  it('returns null when both hands land on the same end (no stretch)', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    expect(detectTwoHandStretch(doc, ['w1'], { x: 10, y: 0 }, { x: 30, y: 0 }, 200)).toBeNull();
  });
});

describe('B-121 two-hand room resize', () => {
  function room() {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    doc.walls.push(wall('w2', 1000, 0, 1000, 1000));
    doc.walls.push(wall('w3', 1000, 1000, 0, 1000));
    doc.walls.push(wall('w4', 0, 1000, 0, 0));
    doc.rooms.push({ id: 'r1', name: 'Room', wallIds: ['w1', 'w2', 'w3', 'w4'] });
    return doc;
  }

  it('grabs two distinct corners and maps each to an owning wall endpoint', () => {
    const doc = room();
    const grab = detectTwoHandStretch(doc, ['r1'], { x: 30, y: 30 }, { x: 970, y: 970 }, 200);
    expect(grab?.kind).toBe('room');
    // (0,0) and (1000,1000) are opposite corners — distinct wall endpoints.
    const a = grab!.a; const b = grab!.b;
    expect(a).not.toEqual(b);
    const ops = twoHandStretchOps(grab!, { x: -100, y: -100 }, { x: 1100, y: 1100 });
    expect(ops[0]).toMatchObject({ op: 'move_end', x: -100, y: -100 });
    expect(ops[1]).toMatchObject({ op: 'move_end', x: 1100, y: 1100 });
  });

  it('returns null when both hands grab the same corner', () => {
    const doc = room();
    expect(detectTwoHandStretch(doc, ['r1'], { x: 10, y: 10 }, { x: 20, y: 20 }, 200)).toBeNull();
  });
});

describe('B-066 two-hand fixture resize', () => {
  it('detects two distinct corners and scales w/d to the finger span, centre-anchored', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0)); // corners at (±200, ±200)
    const grab = detectTwoHandFixture(doc, ['f1'], { x: 200, y: 200 }, { x: -200, y: -200 }, 120);
    expect(grab).toEqual({ kind: 'fixture', id: 'f1' });
    const op = twoHandFixtureOp(doc, grab!, { x: 400, y: 400 }, { x: -400, y: -400 }, { min: 100, max: 10000 });
    expect(op).toEqual({ op: 'set_size', target: 'f1', w: 800, d: 800 });
  });

  it('returns null when both hands are on the same corner', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0));
    expect(detectTwoHandFixture(doc, ['f1'], { x: 200, y: 200 }, { x: 205, y: 205 }, 120)).toBeNull();
  });
});

describe('B-088 two-hand multi-select', () => {
  it('selects the union of what each hand points at', () => {
    expect(twoHandMultiSelect('w1', 'f1')).toEqual({ op: 'select_set', ids: ['w1', 'f1'] });
  });
  it('dedups when both hands point at the same object, and is null when neither hits', () => {
    expect(twoHandMultiSelect('w1', 'w1')).toEqual({ op: 'select_set', ids: ['w1'] });
    expect(twoHandMultiSelect(null, 'f1')).toEqual({ op: 'select_set', ids: ['f1'] });
    expect(twoHandMultiSelect(null, null)).toBeNull();
  });
});
