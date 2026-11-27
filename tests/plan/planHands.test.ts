// PLAN HANDS end to end without a DOM: synthetic 21-landmark frames at real
// hand scale → the REAL hand pointer (fist close / hold / release grace) →
// the hand-edit surface → plan/handEdit.ts → the REAL plan controller
// (engine, validation, undo). See tests/helpers/planHandRig.ts.
//
// The story the demo needs: draw a 3 m wall, place a door on it, move a room,
// resize a wall by 30 cm, remove with a thumbs-down, undo.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FRAME, H, W, planHandRig, toScreen, type PlanHandRig } from '../helpers/planHandRig';
import { wallLength, type PlanDoc } from '../../src/plan/doc';
import { createPlanPeace, peaceHandsOf, type PlanPeace } from '../../src/canvas/planPeace';
import { syntheticHand } from '../../src/canvas/handShapeFixtures';
import { palmCenter } from '../../src/canvas/handFeel';
import { REACH } from '../../src/canvas/handPointer';
import { classifyHandShape, type HandShape, type HandSide } from '../../src/canvas/handShape';
import { createHoldEngine, createPairGrace, type GestureHand } from '../../src/canvas/gestureHold';
import { LAPTOP_GESTURES, PHONE_GESTURES, badgeSelectors, duplicateKeys, resolveGesture, type GestureEnv } from '../../src/canvas/gestureBindings';
import { handScale } from '../../src/canvas/handFeel';
import type { Pt } from '../../src/input/handLogic';

/** A selfie-space hand of `shape` whose PALM maps to screen (x, y). */
function shaped(shape: HandShape, side: HandSide, x: number, y: number): Pt[] & { label?: string } {
  const h = syntheticHand(shape, side);
  const pc = palmCenter(h);
  const want = { x: REACH.x0 + (x / W) * (REACH.x1 - REACH.x0), y: REACH.y0 + (y / H) * (REACH.y1 - REACH.y0) };
  const out = h.map((p) => ({ ...p, x: p.x + want.x - pc.x, y: p.y + want.y - pc.y })) as Pt[] & { label?: string };
  out.label = h.label;
  return out;
}

const walls = (d: PlanDoc) => d.walls.map((w) => ({ a: w.a, b: w.b }));

describe('plan hands: the demo story through the real pointer', () => {
  let rig: PlanHandRig;
  beforeEach(() => { rig = planHandRig(); });
  afterEach(() => rig.destroy());

  it('draws a 3 m wall with a held fist: fist start = first point, open hand = end point', () => {
    rig.tools.activate('wall');
    rig.stroke({ x: 300, y: 500 }, { x: 600, y: 500 });
    const d = rig.doc();
    expect(d.walls).toHaveLength(1);
    expect(d.walls[0].a).toEqual({ x: 1000, y: 2000 });
    expect(d.walls[0].b).toEqual({ x: 4000, y: 2000 });
    expect(wallLength(d.walls[0])).toBe(3000);
    // The fist drew: it never moved the board or panned the canvas.
    expect(rig.board).toHaveLength(0);
    expect(rig.pans).toHaveLength(0);
    expect(rig.overlays).toBeGreaterThan(3); // live preview while the fist moved
    expect(rig.entries.map((e) => e.summary)).toEqual(['Drew a wall 3.00 m']);
    // One stroke = one engine undo step.
    rig.apply({ op: 'undo' });
    expect(rig.doc().walls).toHaveLength(0);
  });

  it('shows the live length in metres while the fist is down', () => {
    rig.tools.activate('wall');
    rig.open(300, 500, 10);
    rig.fist(300, 500, 14);
    rig.fistTo({ x: 300, y: 500 }, { x: 500, y: 500 }, 20);
    rig.fist(500, 500, 10);
    const m = rig.hand.mode();
    expect(m.live).toBe(true);
    expect(m.readout).toBe('Wall: 2.00 m');
    expect(m.text).toMatch(/open your hand to finish/);
    expect(rig.doc().walls).toHaveLength(0); // nothing applied until the hand opens
    rig.open(500, 500, 8);
    expect(rig.doc().walls).toHaveLength(1);
    expect(rig.hand.mode().live).toBe(false);
  });

  it('places a door on that wall with a fist tap near it (snapped onto the wall)', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.tools.activate('door');
    rig.tap(450, 470); // 30 px (30 cm) above the wall, mid-span
    const d = rig.doc();
    expect(d.openings).toHaveLength(1);
    expect(d.openings[0]).toMatchObject({ kind: 'door', wallId: d.walls[0].id, width: 900 });
    expect(d.openings[0].offset % 50).toBe(0);
    expect(d.openings[0].offset).toBe(1050); // centred 1.5 m along the wall, under the palm
    expect(rig.entries.at(-1)?.summary).toBe('Placed a door');
    expect(rig.board).toHaveLength(0);
  });

  it('a door far from any wall still lands on the nearest one (wide reach for a hand)', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.tools.activate('door');
    rig.tap(450, 380); // 120 px away
    expect(rig.doc().openings).toHaveLength(1);
  });

  it('moves a room with a held fist (Select): all its walls travel together, snapped to 10 cm, one undo step', () => {
    rig.apply({ op: 'add_room', x: 1000, y: 1000, w: 4000, h: 3000 });
    rig.journal.flush();
    const room = rig.doc().rooms[0];
    const before = walls(rig.doc());
    rig.hand.select(room.id);
    rig.stroke({ x: 500, y: 500 }, { x: 553, y: 500 }); // 53 px → 0.5 m on the grid
    const after = walls(rig.doc());
    expect(after).toHaveLength(4);
    after.forEach((w, i) => {
      expect(w.a).toEqual({ x: before[i].a.x + 500, y: before[i].a.y });
      expect(w.b).toEqual({ x: before[i].b.x + 500, y: before[i].b.y });
    });
    expect(rig.board).toHaveLength(0);
    expect(rig.pans).toHaveLength(0);
    expect(rig.entries.at(-1)?.summary).toBe(`Moved ${room.name}`);
    rig.apply({ op: 'undo' });
    expect(walls(rig.doc())).toEqual(before);
  });

  it('resizes the selected wall by 30 cm with peace-and-move (10 cm per 30 px), one undo step', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.journal.flush();
    rig.hand.select(rig.doc().walls[0].id);
    const peace: PlanPeace = createPlanPeace();
    const ctx = { blocked: false, targetAt: () => rig.hand };
    let t = 0;
    const feed = (shape: HandShape, x: number, y: number) => { t += FRAME; return peace.update(peaceHandsOf([shaped(shape, 'R', x, y)]), t, ctx); };
    expect(classifyHandShape(shaped('peace', 'R', 450, 450), 'Right', null, { mirrored: true }).shape).toBe('peace');
    feed('peace', 450, 450);
    for (let i = 1; i <= 6; i++) feed('peace', 450 + (95 * i) / 6, 450);
    expect(peace.state.phase).toBe('resizing');
    expect(peace.claimed('R')).toBe(true); // its 2 s peace hold must not run
    for (let i = 0; i < 5; i++) feed('peace', 545, 450);
    expect(rig.hand.mode().readout).toBe('Wall: 3.30 m');
    for (let i = 0; i < 8; i++) feed('open', 545, 450); // shape changes: keep
    expect(peace.state.phase).toBe('idle');
    expect(wallLength(rig.doc().walls[0])).toBe(3300);
    expect(rig.entries.at(-1)?.summary).toBe('Resized Wall 3.00 m');
    rig.apply({ op: 'undo' });
    expect(wallLength(rig.doc().walls[0])).toBe(3000);
  });

  it('removes the selected element with a right thumbs-down held 2 s, and the journal undo brings it back', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.journal.flush();
    rig.hand.select(rig.doc().walls[0].id);
    // The real classifier → the real 2 s hold engine → the binding table.
    const engine = createHoldEngine();
    const down = shaped('thumbsDown', 'R', 500, 300);
    const read = classifyHandShape(down, 'Right', null, { mirrored: true });
    expect(read.shape).toBe('thumbsDown');
    const hands: GestureHand[] = [{ shape: read.shape, hand: read.hand, palm: palmCenter(down), scale: handScale(down) }];
    let fired: string | null = null;
    for (let t = 0; t <= 1900; t += FRAME) fired = engine.update({ hands, facing: true, now: t }).fired ?? fired;
    expect(fired).toBeNull(); // not before 2 s
    expect(rig.doc().walls).toHaveLength(1);
    for (let t = 1900 + FRAME; t <= 2100; t += FRAME) fired = engine.update({ hands, facing: true, now: t }).fired ?? fired;
    expect(fired).toBe('R:thumbsDown');
    const removeBtn = { click: () => rig.hand.remove() };
    const env: GestureEnv<typeof removeBtn> = {
      visible: (sel) => (sel.includes('.mc-plan-remove') && rig.hand.selection() ? removeBtn : null),
      any: () => null, highlighted: () => null, closer: () => null,
    };
    const action = resolveGesture(LAPTOP_GESTURES.find((b) => b.key === fired)!, env);
    expect(action).toMatchObject({ kind: 'click', label: 'Remove' });
    if (action.kind === 'click') action.el.click();
    expect(rig.doc().walls).toHaveLength(0);
    const entry = rig.entries.at(-1)!;
    expect(entry.summary).toBe('Removed Wall 3.00 m');
    // Undo (the canvas Undo = L thumbs-down) takes the removal back through
    // the plan engine's own undo stack.
    expect(rig.journal.undo(entry.steps)).toBe(entry.steps);
    expect(rig.doc().walls).toHaveLength(1);
    expect(wallLength(rig.doc().walls[0])).toBe(3000);
  });

  it('the whole story, then Undo walks every hand edit back in order', () => {
    rig.tools.activate('wall');
    rig.stroke({ x: 300, y: 500 }, { x: 600, y: 500 });
    rig.tools.activate('door');
    rig.tap(450, 480);
    rig.tools.activate('select');
    rig.hand.select(rig.doc().walls[0].id);
    expect(rig.hand.step('a', 1)).toBe(true);
    expect(wallLength(rig.doc().walls[0])).toBe(3100);
    expect(rig.hand.remove()).toBe(true);
    expect(rig.doc().walls).toHaveLength(0);
    expect(rig.entries.map((e) => e.summary)).toEqual(['Drew a wall 3.00 m', 'Placed a door', 'Resized Wall 3.00 m', 'Removed Wall 3.10 m']);
    const undo = () => { const e = rig.entries.pop()!; rig.journal.undo(e.steps); };
    undo();
    expect(rig.doc().walls).toHaveLength(1);
    expect(rig.doc().openings).toHaveLength(1);
    undo();
    expect(wallLength(rig.doc().walls[0])).toBe(3000);
    undo();
    expect(rig.doc().openings).toHaveLength(0);
    undo();
    expect(rig.doc().walls).toHaveLength(0);
  });
});

describe('plan hands: who gets the fist', () => {
  let rig: PlanHandRig;
  beforeEach(() => { rig = planHandRig(); });
  afterEach(() => rig.destroy());

  it('with hand edit OFF a held fist on the plan moves the board, as before', () => {
    rig.armed = false;
    rig.tools.activate('wall');
    rig.stroke({ x: 300, y: 500 }, { x: 600, y: 500 });
    expect(rig.doc().walls).toHaveLength(0);
    expect(rig.board.some((e) => e.phase === 'start')).toBe(true);
  });

  it('a fist outside the plan surface still pans the canvas', () => {
    rig.tools.activate('wall');
    rig.stroke({ x: 40, y: 400 }, { x: 80, y: 400 }); // left of the board
    expect(rig.pans.some((e) => e.phase === 'start')).toBe(true);
    expect(rig.doc().walls).toHaveLength(0);
  });

  it('a fist on the board but outside the drawing surface moves the board', () => {
    rig.tools.activate('wall');
    rig.stroke({ x: 500, y: 90 }, { x: 560, y: 90 }); // the board's top strip
    expect(rig.board.some((e) => e.phase === 'start')).toBe(true);
    expect(rig.doc().walls).toHaveLength(0);
  });

  it('a hand lost mid-stroke draws nothing and leaves no undo or redo step', () => {
    rig.tools.activate('wall');
    rig.open(300, 500, 10);
    rig.fist(300, 500, 14);
    rig.fistTo({ x: 300, y: 500 }, { x: 600, y: 500 }, 20);
    expect(rig.hand.busy()).toBe(true);
    rig.hp.lost();
    expect(rig.hand.busy()).toBe(false);
    expect(rig.doc().walls).toHaveLength(0);
    expect(rig.entries).toHaveLength(0);
    expect(rig.journal.pending()).toBe(0);
    expect(rig.controller.applyOp({ op: 'redo' }).ok).toBe(false);
  });

  it('a second fist cancels the stroke (two fists zoom the canvas)', () => {
    rig.tools.activate('wall');
    rig.open(300, 500, 10);
    rig.fist(300, 500, 14);
    rig.fistTo({ x: 300, y: 500 }, { x: 500, y: 500 }, 12);
    for (let i = 0; i < 20; i++) rig.hp.update([...twoFists(500, 500, 800, 400)], (rig.t += FRAME));
    expect(rig.doc().walls).toHaveLength(0);
    expect(rig.zooms.some((e) => e.phase === 'start')).toBe(true);
  });

  it('two fists that both close ON the plan zoom the plan itself, not the canvas', () => {
    rig.destroy();
    rig = planHandRig([], { zoom2: true });
    rig.tools.activate('wall');
    for (let i = 0; i < 10; i++) rig.hp.update([synthHand(400, 450, false, W, H), synthHand(600, 450, false, W, H)], (rig.t += FRAME));
    for (let i = 0; i < 16; i++) rig.hp.update(twoFists(400, 450, 600, 450), (rig.t += FRAME));
    for (let i = 1; i <= 10; i++) rig.hp.update(twoFists(400 - i * 8, 450, 600 + i * 8, 450), (rig.t += FRAME));
    expect(rig.planZooms[0]?.phase).toBe('start');
    const moves = rig.planZooms.filter((e) => e.phase === 'move');
    expect(moves.length).toBeGreaterThan(3);
    const span = (e: { a: { x: number }; b: { x: number } }) => Math.abs(e.b.x - e.a.x);
    expect(span(moves.at(-1)!)).toBeGreaterThan(span(rig.planZooms[0]) + 80);
    expect(rig.zooms).toHaveLength(0); // the canvas did not zoom
    expect(rig.doc().walls).toHaveLength(0);
    for (let i = 0; i < 8; i++) rig.hp.update([synthHand(320, 450, false, W, H), synthHand(680, 450, false, W, H)], (rig.t += FRAME));
    expect(rig.planZooms.at(-1)?.phase).toBe('end');
  });

  it('one fist on the plan and one off it still zoom the canvas', () => {
    rig.destroy();
    rig = planHandRig([], { zoom2: true });
    for (let i = 0; i < 10; i++) rig.hp.update([synthHand(400, 450, false, W, H), synthHand(950, 450, false, W, H)], (rig.t += FRAME));
    for (let i = 0; i < 20; i++) rig.hp.update(twoFists(400, 450, 950, 450), (rig.t += FRAME));
    expect(rig.planZooms).toHaveLength(0);
    expect(rig.zooms.some((e) => e.phase === 'start')).toBe(true);
  });

  it('a message for the hand rides in the banner for a few seconds', () => {
    rig.tools.activate('door');
    rig.tap(400, 400); // no wall anywhere
    expect(rig.hand.mode().note).toBe('Draw a wall first — a door sits in a wall.');
  });

  it('a fist held STILL draws nothing with any drawing tool (no 10 px walls, no surprise openings or dimensions)', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 5000, y2: 2000 });
    rig.journal.flush(); rig.entries.length = 0;
    for (const tool of ['wall', 'room', 'dim', 'opening', 'stairs', 'measure']) {
      rig.tools.activate(tool);
      rig.stroke({ x: 450, y: 495 }, { x: 462, y: 497 }); // 12 px of drift, on the wall
    }
    const d = rig.doc();
    expect([d.walls.length, d.rooms.length, d.dims.length, d.openings.length, d.fixtures.length]).toEqual([1, 0, 0, 0, 0]);
    expect(rig.entries).toHaveLength(0);
    expect(rig.statuses.at(-1)).toMatch(/Nothing drawn/);
    expect(rig.hand.mode().note).toMatch(/Nothing drawn/);
  });

  it('a wall shorter than 30 cm is not drawn even after a real stroke', () => {
    rig.tools.activate('wall');
    // 80 px out and back to 18 px from the start: the travel counts, the wall is 0.2 m.
    rig.open(300, 500, 10); rig.fist(300, 500, 14);
    rig.fistTo({ x: 300, y: 500 }, { x: 380, y: 500 }, 12);
    rig.fist(380, 500, 8);
    rig.fistTo({ x: 380, y: 500 }, { x: 318, y: 500 }, 12);
    rig.fist(318, 500, 12); rig.open(318, 500, 8);
    expect(rig.doc().walls).toHaveLength(0);
    expect(rig.statuses.at(-1)).toMatch(/Too short for a wall/);
  });

  it('opening the hand while NOT facing the screen cancels the stroke (inside the 400 ms before the lock ends the grab)', () => {
    rig.tools.activate('wall');
    rig.open(300, 500, 10);
    rig.fist(300, 500, 14);
    rig.fistTo({ x: 300, y: 500 }, { x: 600, y: 500 }, 20);
    rig.fist(600, 500, 6);
    rig.hp.setFacing?.(false, rig.t);
    rig.fist(600, 500, 10); // 330 ms: locked (300 ms), the grab not yet ended (400 ms)
    expect(rig.hp.handsLocked?.()).toBe(true);
    rig.open(600, 500, 8); // the hand opens while looking away
    expect(rig.doc().walls).toHaveLength(0);
    expect(rig.hand.busy()).toBe(false);
    expect(rig.entries).toHaveLength(0);
  });

  it('a fist TAP with the Wall tool draws nothing (drawing needs a held fist)', () => {
    rig.tools.activate('wall');
    rig.tap(400, 400);
    expect(rig.doc().walls).toHaveLength(0);
    expect(rig.statuses.at(-1)).toMatch(/Keep your fist closed/);
  });

  it('not facing the screen cancels a running stroke', () => {
    rig.tools.activate('wall');
    rig.open(300, 500, 10);
    rig.fist(300, 500, 14);
    rig.fistTo({ x: 300, y: 500 }, { x: 500, y: 500 }, 12);
    rig.hp.setFacing?.(false, rig.t);
    rig.fist(500, 500, 20); // > 400 ms looking away
    expect(rig.hand.busy()).toBe(false);
    rig.hp.setFacing?.(true, rig.t);
    rig.open(500, 500, 8);
    expect(rig.doc().walls).toHaveLength(0);
  });
});

import { synthFist, synthHand } from '../helpers/synthHands';
const twoFists = (x1: number, y1: number, x2: number, y2: number) => [synthFist(x1, y1, W, H), synthFist(x2, y2, W, H)];

describe('plan hands: drawing and placing tools', () => {
  let rig: PlanHandRig;
  beforeEach(() => { rig = planHandRig(); });
  afterEach(() => rig.destroy());

  it('Room: a diagonal fist drag makes a rectangle of four walls', () => {
    rig.tools.activate('room');
    rig.stroke({ x: 300, y: 600 }, { x: 700, y: 300 });
    const d = rig.doc();
    expect(d.rooms).toHaveLength(1);
    expect(d.walls).toHaveLength(4);
    expect(rig.entries.at(-1)?.summary).toBe('Drew a room 4.00 m × 3.00 m');
    expect(rig.hand.mode().readout).toBe('Room: 4.00 m × 3.00 m');
  });

  it('Wall: the start snaps to an existing endpoint within the hand reach', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.tools.activate('wall');
    const end = toScreen({ x: 4000, y: 2000 });
    rig.stroke({ x: end.x + 12, y: end.y - 9 }, { x: end.x + 10, y: end.y - 200 });
    const w = rig.doc().walls[1];
    expect(w.a).toEqual({ x: 4000, y: 2000 });
    expect(w.b).toEqual({ x: 4000, y: 4000 }); // held to 90° and the grid
  });

  it('Dimension: a fist drag adds a free dimension; a fist tap pins one to the nearest wall', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.tools.activate('dim');
    rig.stroke({ x: 300, y: 300 }, { x: 500, y: 300 });
    expect(rig.doc().dims).toHaveLength(1);
    expect(rig.doc().dims[0].a).toEqual({ x: 1000, y: 4000 });
    expect(rig.doc().dims[0].b).toEqual({ x: 3000, y: 4000 });
    rig.tap(450, 520);
    expect(rig.doc().dims).toHaveLength(2);
    expect(rig.doc().dims[1].wallId).toBe(rig.doc().walls[0].id);
  });

  it('Opening: a fist drag along a wall cuts an opening of that span', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 5000, y2: 2000 });
    rig.tools.activate('opening');
    rig.stroke({ x: 400, y: 510 }, { x: 550, y: 495 });
    const o = rig.doc().openings[0];
    expect(o).toMatchObject({ kind: 'opening', offset: 1000, width: 1500 });
  });

  it('Furniture: a fist tap places the component at the palm point', () => {
    rig.tools.activate('fx:sofa');
    rig.tap(500, 400);
    const f = rig.doc().fixtures;
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('sofa');
    expect(rig.entries.at(-1)?.summary).toBe('Placed sofa');
  });

  it('Text: a fist tap drops a "Note" label (no keyboard needed)', () => {
    rig.tools.activate('text');
    rig.tap(500, 400);
    expect(rig.doc().texts.map((t) => t.text)).toEqual(['Note']);
  });

  it('Measure: a fist drag reads the length and changes nothing', () => {
    rig.tools.activate('measure');
    rig.stroke({ x: 300, y: 300 }, { x: 620, y: 300 });
    expect(rig.hand.mode().readout).toBe('Measured: 3.20 m');
    expect(rig.entries).toHaveLength(0);
    expect(rig.journal.pending()).toBe(0);
  });
});

describe('plan hands: select, move, rotate, resize', () => {
  let rig: PlanHandRig;
  beforeEach(() => { rig = planHandRig(); });
  afterEach(() => rig.destroy());

  it('offers a handle for every element only while the Select tool is active', () => {
    rig.apply({ op: 'add_room', x: 1000, y: 1000, w: 4000, h: 3000 });
    rig.apply({ op: 'add_door', target: rig.doc().walls[0].id, offset: 1000, width: 900 });
    rig.apply({ op: 'add_fixture', kind: 'sofa', nums: { x: 3000, y: 2500, w: 2000, d: 900, rotation: 0 } });
    const t = rig.hand.targets();
    expect(t.map((x) => x.kind).sort()).toEqual(['door', 'fixture', 'room', 'wall', 'wall', 'wall', 'wall']);
    expect(t.find((x) => x.kind === 'room')!.label).toBe(rig.doc().rooms[0].name);
    expect(t.find((x) => x.kind === 'wall')!.label).toMatch(/^Wall \d\.\d\d m$/);
    rig.tools.activate('wall');
    expect(rig.hand.targets()).toEqual([]);
  });

  it('a held fist with nothing selected never grabs a nearby element (it pans the plan)', () => {
    rig.apply({ op: 'add_fixture', kind: 'sofa', nums: { x: 3000, y: 2500, w: 2000, d: 900, rotation: 0 } });
    rig.journal.flush(); rig.entries.length = 0;
    rig.apply({ op: 'select_set', ids: [] });
    const p = toScreen({ x: 3000, y: 2500 });
    rig.stroke(p, { x: p.x + 100, y: p.y - 60 });
    expect(rig.doc().fixtures[0]).toMatchObject({ x: 3000, y: 2500 });
    expect(rig.doc().selectedId).toBeNull();
    expect(rig.entries).toHaveLength(0);
  });

  it('the selected element moves only when the fist closes on or near it; elsewhere the fist pans', () => {
    rig.apply({ op: 'add_fixture', kind: 'sofa', nums: { x: 3000, y: 2500, w: 2000, d: 900, rotation: 0 } });
    rig.journal.flush();
    const p = toScreen({ x: 3000, y: 2500 });
    // Far from it (300 px away): nothing moves.
    rig.stroke({ x: p.x + 300, y: p.y + 150 }, { x: p.x + 400, y: p.y + 150 });
    expect(rig.doc().fixtures[0]).toMatchObject({ x: 3000, y: 2500 });
    expect(rig.hand.mode().text).not.toMatch(/Moving/);
    // On it: it moves.
    rig.stroke(p, { x: p.x + 100, y: p.y - 60 });
    expect(rig.doc().fixtures[0]).toMatchObject({ x: 4000, y: 3100 });
  });

  it('a trembling fist on the selected element moves nothing (under 2 grid steps)', () => {
    rig.apply({ op: 'add_fixture', kind: 'sofa', nums: { x: 3000, y: 2500, w: 2000, d: 900, rotation: 0 } });
    rig.journal.flush(); rig.entries.length = 0;
    const p = toScreen({ x: 3000, y: 2500 });
    rig.stroke(p, { x: p.x + 9, y: p.y }); // 9 px ≈ 0.1 m after snapping
    expect(rig.doc().fixtures[0]).toMatchObject({ x: 3000, y: 2500 });
    expect(rig.entries).toHaveLength(0);
    expect(rig.journal.pending()).toBe(0);
    expect(rig.controller.applyOp({ op: 'redo' }).ok).toBe(false);
  });

  it('a door slides along its wall', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 5000, y2: 2000 });
    rig.apply({ op: 'add_door', target: rig.doc().walls[0].id, offset: 500, width: 900 });
    rig.journal.flush();
    rig.hand.select(rig.doc().openings[0].id);
    rig.stroke({ x: 400, y: 480 }, { x: 500, y: 500 }); // the fist closes on the door
    expect(rig.doc().openings[0].offset).toBe(1500);
  });

  it('rotate turns furniture 90° and flips a door swing; the bar offers the right verb', () => {
    rig.apply({ op: 'add_fixture', kind: 'sofa', nums: { x: 3000, y: 2500, w: 2000, d: 900, rotation: 0 } });
    expect(rig.hand.selection()?.rotate).toBe('Rotate');
    expect(rig.hand.rotate()).toBe(true);
    expect(rig.doc().fixtures[0].rotation).toBe(90);
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 5000, y2: 2000 });
    rig.apply({ op: 'add_door', target: rig.doc().walls[0].id, offset: 500, width: 900, swing: 'left' });
    rig.hand.select(rig.doc().openings[0].id);
    expect(rig.hand.selection()?.rotate).toBe('Flip swing');
    rig.hand.rotate();
    expect(rig.doc().openings[0].swing).toBe('right');
    rig.hand.select(rig.doc().walls[0].id);
    expect(rig.hand.selection()?.rotate).toBeNull();
    expect(rig.hand.rotate()).toBe(false);
  });

  it('a room resizes on two axes with the readout "Name: W × D"', () => {
    rig.apply({ op: 'add_room', x: 1000, y: 1000, w: 4000, h: 3000, name: 'Bedroom' });
    rig.hand.select(rig.doc().rooms[0].id);
    expect(rig.hand.selection()?.readout).toBe('Bedroom: 4.00 m × 3.00 m');
    expect(rig.hand.resizeBegin()).toBe(true);
    rig.hand.resizeTravel(35, 0); // one step wider
    expect(rig.hand.mode().readout).toBe('Bedroom: 4.10 m × 3.00 m');
    rig.hand.resizeTravel(35, -65); // and two steps deeper (up)
    rig.hand.resizeEnd();
    expect(rig.hand.selection()?.readout).toBe('Bedroom: 4.10 m × 3.20 m');
    expect(rig.doc().rooms).toHaveLength(1);
    rig.apply({ op: 'undo' }); // one step for the whole resize
    expect(rig.hand.selection()?.readout).toBe('Bedroom: 4.00 m × 3.00 m');
  });

  it('a cancelled resize (hand lost) applies nothing', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.journal.flush();
    rig.hand.select(rig.doc().walls[0].id);
    rig.hand.resizeBegin();
    rig.hand.resizeTravel(95, 0);
    expect(wallLength(rig.doc().walls[0])).toBe(3300);
    rig.hand.resizeCancel();
    expect(wallLength(rig.doc().walls[0])).toBe(3000);
    expect(rig.controller.applyOp({ op: 'redo' }).ok).toBe(false);
  });

  it('the banner names the mode for every tool', () => {
    expect(rig.hand.mode().text).toMatch(/^Select/);
    rig.tools.activate('wall');
    expect(rig.hand.mode()).toMatchObject({ kind: 'draw', text: 'Drawing walls with your hand — close your fist to start, open your hand to finish' });
    rig.tools.activate('door');
    expect(rig.hand.mode()).toMatchObject({ kind: 'place', text: 'Placing a door — fist-tap where it goes (it snaps to the nearest wall)' });
    rig.tools.activate('select');
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.hand.select(rig.doc().walls[0].id);
    expect(rig.hand.mode().text).toBe('Wall 3.00 m selected — fist on it: move · peace-and-move: resize · right thumbs-down: remove');
  });
});

describe('peace-and-move stepper', () => {
  const target = () => {
    const calls: string[] = [];
    return { calls, resizeBegin: () => { calls.push('begin'); return true; }, resizeTravel: (dx: number, dy: number) => { calls.push(`travel ${Math.round(dx)},${Math.round(dy)}`); }, resizeEnd: () => { calls.push('end'); }, resizeCancel: () => { calls.push('cancel'); } };
  };
  const hand = (shape: HandShape, x: number, y: number, side: HandSide = 'R') => ({ side, shape, point: { x, y } });

  it('a peace held still never resizes, so its 2 s button still fires', () => {
    const p = createPlanPeace(); const tg = target();
    for (let t = 0; t <= 2200; t += FRAME) p.update([hand('peace', 400 + (t % 3), 400)], t, { blocked: false, targetAt: () => tg });
    expect(tg.calls).toEqual([]);
    expect(p.claimed('R')).toBe(false);
    expect(p.state.phase).toBe('still');
  });

  it('two peace hands (the two-hand hold) never resize', () => {
    const p = createPlanPeace(); const tg = target();
    for (let t = 0, x = 400; t <= 600; t += FRAME, x += 12) p.update([hand('peace', x, 400), hand('peace', 700, 400, 'L')], t, { blocked: false, targetAt: () => tg });
    expect(tg.calls).toEqual([]);
  });

  it('nothing resizable under the hand: the peace is left to its other meanings', () => {
    const p = createPlanPeace();
    for (let t = 0, x = 400; t <= 600; t += FRAME, x += 12) p.update([hand('peace', x, 400)], t, { blocked: false, targetAt: () => null });
    expect(p.claimed('R')).toBe(false);
    expect(p.state.phase).toBe('idle');
  });

  it('a hand that vanishes mid-resize cancels; a blocked frame cancels at once', () => {
    const p = createPlanPeace(); const tg = target();
    let t = 0;
    for (let x = 400; x <= 480; x += 12) p.update([hand('peace', x, 400)], (t += FRAME), { blocked: false, targetAt: () => tg });
    expect(tg.calls[0]).toBe('begin');
    for (let i = 0; i < 8; i++) p.update([], (t += FRAME), { blocked: false, targetAt: () => tg });
    expect(tg.calls.at(-1)).toBe('cancel');
    const q = createPlanPeace(); const tg2 = target();
    for (let x = 400; x <= 480; x += 12) q.update([hand('peace', x, 400)], (t += FRAME), { blocked: false, targetAt: () => tg2 });
    q.update([hand('peace', 480, 400)], (t += FRAME), { blocked: true, targetAt: () => tg2 });
    expect(tg2.calls.at(-1)).toBe('cancel');
  });

  it('the claim holds until the hand shows another shape', () => {
    const p = createPlanPeace(); const tg = target();
    let t = 0;
    for (let x = 400; x <= 480; x += 12) p.update([hand('peace', x, 400)], (t += FRAME), { blocked: false, targetAt: () => tg });
    for (let i = 0; i < 8; i++) p.update([hand('open', 480, 400)], (t += FRAME), { blocked: false, targetAt: () => tg });
    expect(tg.calls.at(-1)).toBe('end');
    expect(p.claimed('R')).toBe(false);
  });
});

describe('contextual fixed gestures for the plan', () => {
  type El = { id: string };
  const env = (visible: Record<string, El>, extra: Partial<GestureEnv<El>> = {}): GestureEnv<El> => ({
    visible: (s) => visible[s] ?? null, any: () => null, highlighted: () => null, closer: () => null, ...extra,
  });
  const REMOVE = '.mc-plan-hand-on .mc-plan-remove';
  const ROTATE = '.mc-plan-hand-on .mc-plan-rotate';
  const binding = (key: string) => LAPTOP_GESTURES.find((b) => b.key === key)!;

  it('R thumbs-down CLOSES what is open before it ever removes (Tools, a menu, a dialog, the drawer)', () => {
    const open = env({ [REMOVE]: { id: 'remove' } }, { closer: () => ({ id: 'tools-close' }) });
    expect(resolveGesture(binding('R:thumbsDown'), open)).toEqual({ kind: 'click', el: { id: 'tools-close' }, label: 'Close' });
    const phone = PHONE_GESTURES.find((b) => b.key === 'R:thumbsDown')!;
    expect(resolveGesture(phone, open)).toEqual({ kind: 'click', el: { id: 'tools-close' }, label: 'Close' });
  });

  it('L peace stays Tools while the Tools palette is open, even with Rotate on screen', () => {
    const e = env({ [ROTATE]: { id: 'rot' }, '.mc-tools-chip': { id: 'tools' }, '.mc-tools-chip[aria-expanded="true"]': { id: 'tools' } });
    expect(resolveGesture(binding('L:peace'), e)).toEqual({ kind: 'click', el: { id: 'tools' }, label: 'Tools' });
  });

  it('R thumbs-down = Remove while the plan shows Remove; a review still wins; otherwise Close', () => {
    expect(resolveGesture(binding('R:thumbsDown'), env({ [REMOVE]: { id: 'remove' } }))).toEqual({ kind: 'click', el: { id: 'remove' }, label: 'Remove' });
    expect(resolveGesture(binding('R:thumbsDown'), env({ [REMOVE]: { id: 'remove' }, '.mc-review-reject': { id: 'reject' } }))).toEqual({ kind: 'click', el: { id: 'reject' }, label: 'Reject' });
    expect(resolveGesture(binding('R:thumbsDown'), env({}, { closer: () => ({ id: 'x' }) }))).toEqual({ kind: 'click', el: { id: 'x' }, label: 'Close' });
  });

  it('L peace = Rotate while the plan shows Rotate, otherwise Tools', () => {
    expect(resolveGesture(binding('L:peace'), env({ [ROTATE]: { id: 'rot' }, '.mc-tools-chip': { id: 'tools' } }))).toEqual({ kind: 'click', el: { id: 'rot' }, label: 'Rotate' });
    expect(resolveGesture(binding('L:peace'), env({ '.mc-tools-chip': { id: 'tools' } }))).toEqual({ kind: 'click', el: { id: 'tools' }, label: 'Tools' });
  });

  it('Remove and Rotate wait under the pair grace like any one-hand hold (both thumbs down / both peace are bound)', () => {
    const grace = createPairGrace(LAPTOP_GESTURES.map((b) => b.key));
    // The right hand has held thumbs-down; the LEFT hand just changed shape (it may be joining a pair).
    grace.observe([{ shape: 'thumbsDown', hand: 'R' }], 0);
    grace.observe([{ shape: 'thumbsDown', hand: 'R' }, { shape: 'thumbsDown', hand: 'L' }], 1000);
    expect(grace.defer('R:thumbsDown', 1010)).toBe(true); // Remove does not fire into a forming both-thumbs-down
    expect(grace.defer('R:thumbsDown', 1000 + 5000)).toBe(false);
    grace.observe([{ shape: 'peace', hand: 'L' }], 7000);
    grace.observe([{ shape: 'peace', hand: 'L' }, { shape: 'peace', hand: 'R' }], 8000);
    expect(grace.defer('L:peace', 8010)).toBe(true); // Rotate does not fire into a forming both-peace (Register)
    // Nothing new shares L peace or R thumbs-down as a one-hand key.
    expect(LAPTOP_GESTURES.filter((b) => b.key === 'L:peace' || b.key === 'R:thumbsDown').map((b) => b.label)).toEqual(['Reject', 'Tools']);
  });

  it('the badge follows the same priority, and no table gained a duplicate gesture', () => {
    expect(badgeSelectors(binding('R:thumbsDown'))).toEqual(['.mc-review-reject', '.mc-proposal-drop', REMOVE]);
    expect(badgeSelectors(binding('L:peace'))).toEqual([ROTATE, '.mc-tools-chip']);
    expect(duplicateKeys(LAPTOP_GESTURES)).toEqual([]);
    expect(duplicateKeys(PHONE_GESTURES)).toEqual([]);
  });
});

import { coerceDrawings, feedDrawings, sanitizePlanDoc, savedPlanDoc, setSavedPlanDoc, storedDrawings, type Drawings } from '../../src/canvas/planDocs';
import { coerceSurfacePlan } from '../../src/canvas/surfacePlan';
import { parseCanvasDoc } from '../../src/canvas/frames';
import { buildSurfacePrompt } from '../../src/canvas/aiTurn';

describe('the drawing is stored BESIDE the board, never inside what is sent out', () => {
  const SECRET = 'Grandma Lakshmi bedroom';
  const drawing = () => {
    const rig = planHandRig();
    rig.apply({ op: 'add_room', x: 0, y: 0, w: 4000, h: 3000, name: SECRET });
    rig.apply({ op: 'add_text', nums: { x: 500, y: 500 }, text: `${SECRET} note` });
    const d = sanitizePlanDoc(rig.doc())!;
    rig.destroy();
    return d;
  };

  it('a surface plan has no place for a drawing: a model, a relayed board or storage cannot put one on a tile', () => {
    const r = coerceSurfacePlan({ kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'p-cad', template: 'blank', doc: drawing() }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tiles[0]).toEqual({ type: 'plan', boardId: 'p-cad', template: 'blank' });
      expect(JSON.stringify(r.value)).not.toContain(SECRET);
    }
  });

  it('a stored canvas with a drawing: the drawing loads, and neither the surfaces nor a model prompt built from them carry its text', () => {
    const stored = {
      version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1',
      frames: [{ id: 'f1', kind: 'plan', title: 'Floor plan', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }],
      surfaces: { f1: { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'f1-cad', template: 'blank' }] } },
      drawings: { f1: { 'f1-cad': drawing() }, ghost: { x: drawing() } },
    };
    const doc = parseCanvasDoc(JSON.parse(JSON.stringify(stored)))!;
    expect(doc).not.toBeNull();
    expect(Object.keys(doc.drawings ?? {})).toEqual(['f1']); // a drawing for a board that is not there is dropped
    expect(JSON.stringify(doc.drawings)).toContain(SECRET);
    expect(JSON.stringify(doc.surfaces)).not.toContain(SECRET);
    for (const engine of ['gemini', 'nano'] as const) {
      const sent = buildSurfacePrompt({ utterance: 'add a lamp', frameTitle: 'Floor plan', devices: [], current: doc.surfaces.f1, frameId: 'f1' } as never, engine);
      const text = JSON.stringify(sent);
      expect(text).toContain('f1-cad'); // the board itself is in the prompt…
      expect(text).not.toContain(SECRET); // …what was drawn on it is not
      expect(text).not.toContain('"walls"');
      expect(text.length).toBeLessThan(20_000);
    }
  });

  it('sanitizePlanDoc drops malformed elements, dangling references and duplicate ids, and clears the selection', () => {
    const d = sanitizePlanDoc({
      walls: [
        { id: 'w1', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 100 },
        { id: 'w1', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, thickness: 100 }, // duplicate id
        { id: 'w2', a: { x: 'NaN', y: 0 }, b: { x: 1, y: 1 }, thickness: 100 }, // bad point
        { id: 'w3', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, thickness: -5 },
      ],
      openings: [
        { id: 'o1', kind: 'door', wallId: 'w1', offset: 500, width: 900, swing: 'left' },
        { id: 'o2', kind: 'door', wallId: 'gone', offset: 500, width: 900 },
        { id: 'o3', kind: 'portal', wallId: 'w1', offset: 500, width: 900 },
      ],
      rooms: [{ id: 'r1', name: 'Room', wallIds: ['w1', 'gone', 7] }],
      dims: [{ id: 'm1', wallId: 'w1' }, { id: 'm2' }],
      fixtures: [{ id: 'f1', kind: 'sofa', x: 0, y: 0, w: 2000, d: 900, rotation: 0 }, { id: 'f2', kind: '<img>', x: 0, y: 0, w: 1, d: 1, rotation: 0 }],
      texts: [{ id: 't1', x: 0, y: 0, text: 'Note', size: 300 }, { id: 't2', x: 0, y: 0, text: 5, size: 300 }],
      selectedId: 'w1', selectedIds: ['w1'], extra: 'ignored',
    })!;
    expect((d.walls as { id: string }[]).map((w) => w.id)).toEqual(['w1']);
    expect((d.openings as { id: string }[]).map((o) => o.id)).toEqual(['o1']);
    expect(d.rooms).toEqual([{ id: 'r1', name: 'Room', wallIds: ['w1'] }]);
    expect((d.dims as { id: string }[]).map((m) => m.id)).toEqual(['m1']);
    expect((d.fixtures as { id: string }[]).map((f) => f.id)).toEqual(['f1']);
    expect((d.texts as { id: string }[]).map((t) => t.id)).toEqual(['t1']);
    expect(d.selectedId).toBeNull();
    expect('extra' in d).toBe(false);
    expect(sanitizePlanDoc('rm -rf')).toBeNull();
    expect(sanitizePlanDoc({ walls: 1 })).toBeNull();
    expect(coerceDrawings({ f1: { 'BAD ID': d } }, new Set(['f1']))).toEqual({});
  });

  it('reload, then draw: new ids never repeat a restored one, so Remove hits the right element', () => {
    // The first session: the template plus two drawn walls.
    const first = planHandRig();
    first.apply({ op: 'add_room', x: 0, y: 0, w: 4000, h: 3000 }); // "the template": w1..w4
    first.apply({ op: 'add_wall', x1: 5000, y1: 0, x2: 8000, y2: 0 }); // w6 (r5 took 5)
    first.apply({ op: 'add_wall', x1: 5000, y1: 1000, x2: 8000, y2: 1000 });
    const saved = sanitizePlanDoc(first.doc())!;
    const savedIds = [...(saved.walls as { id: string }[]), ...(saved.rooms as { id: string }[])].map((x) => x.id);
    first.destroy();
    // The reload: the board rebuilds its template (the id counter restarts
    // low), then restores the saved drawing.
    const rig = planHandRig();
    rig.controller.applyGenerated?.({ ops: [{ op: 'add_room', x: 0, y: 0, w: 4000, h: 3000 }] });
    expect(rig.controller.restoreSnapshot?.(saved).ok).toBe(true);
    rig.journal.flush();
    // Draw with the hand, through the real pointer.
    rig.tools.activate('wall');
    rig.stroke({ x: 300, y: 200 }, { x: 600, y: 200 });
    const walls = rig.doc().walls;
    const fresh = walls[walls.length - 1];
    expect(savedIds).not.toContain(fresh.id);
    expect(new Set(walls.map((w) => w.id)).size).toBe(walls.length);
    // Remove the new wall: exactly that one goes.
    rig.tools.activate('select');
    rig.hand.select(fresh.id);
    rig.hand.remove();
    expect(rig.doc().walls.map((w) => w.id)).toEqual(walls.slice(0, -1).map((w) => w.id));
    rig.destroy();
  });

  it('an AI edit that drops the plan tile, then Undo: the drawing is back (rendering never deletes one)', () => {
    const d = drawing();
    const drawings: Drawings = { f1: { 'f1-cad': d } };
    feedDrawings(drawings, 'f1', ['f1-cad']); // the board as it was
    expect(savedPlanDoc('f1', 'f1-cad')).toBe(d);
    feedDrawings(drawings, 'f1', []); // the AI rebuild: no plan tile any more
    expect(drawings.f1['f1-cad']).toBe(d); // still held for this session
    // While the tile is gone the drawing is not written to storage…
    expect(storedDrawings(drawings, { f1: [] })).toEqual({});
    feedDrawings(drawings, 'f1', ['f1-cad']); // Undo: the old surface renders again
    expect(savedPlanDoc('f1', 'f1-cad')).toBe(d); // …and the board mounts with what was drawn
    expect(storedDrawings(drawings, { f1: ['f1-cad'] })).toEqual({ f1: { 'f1-cad': d } });
    setSavedPlanDoc('f1', 'f1-cad', null);
  });

  it('a morph that renames the plan tile and is rolled back by the self-check keeps the drawing', () => {
    const d = drawing();
    const drawings: Drawings = { f1: { 'f1-cad': d } };
    feedDrawings(drawings, 'f1', ['plan-1']); // the morphed board (new plan board id): starts from its template
    expect(savedPlanDoc('f1', 'plan-1')).toBeNull();
    feedDrawings(drawings, 'f1', ['f1-cad']); // rollback to the board before the morph
    expect(savedPlanDoc('f1', 'f1-cad')).toBe(d);
    // A closed board (frame gone) takes its drawings out of what is stored.
    expect(storedDrawings(drawings, {})).toEqual({});
    setSavedPlanDoc('f1', 'f1-cad', null);
  });

  it('with several elements selected a fist pans, and says how to move one', () => {
    const rig = planHandRig();
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.apply({ op: 'add_wall', x1: 1000, y1: 3000, x2: 4000, y2: 3000 });
    const before = rig.doc().walls.map((w) => ({ ...w.a }));
    rig.apply({ op: 'select_set', ids: rig.doc().walls.map((w) => w.id) });
    rig.journal.flush(); rig.entries.length = 0;
    rig.stroke({ x: 450, y: 500 }, { x: 550, y: 500 });
    expect(rig.doc().walls.map((w) => ({ ...w.a }))).toEqual(before);
    expect(rig.statuses).toContain('Select one item to move it.');
    expect(rig.entries).toHaveLength(0);
    rig.destroy();
  });

  it('the registry hands a drawing to its board by frame + plan board id', () => {
    const d = drawing();
    setSavedPlanDoc('f1', 'p-cad', d);
    expect(savedPlanDoc('f1', 'p-cad')).toBe(d);
    expect(savedPlanDoc('f2', 'p-cad')).toBeNull();
    setSavedPlanDoc('f1', 'p-cad', null);
    expect(savedPlanDoc('f1', 'p-cad')).toBeNull();
  });

  it('focusBox is the selected element on screen (what the view keeps visible after an edit)', () => {
    const rig = planHandRig();
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 4000, y2: 2000 });
    rig.hand.select(rig.doc().walls[0].id);
    expect(rig.hand.focusBox()).toEqual({ left: 300, top: 500, right: 600, bottom: 500 });
    rig.hand.select(null);
    expect(rig.hand.focusBox()).toBeNull();
    rig.destroy();
  });
});
