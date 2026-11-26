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
import { createHoldEngine, type GestureHand } from '../../src/canvas/gestureHold';
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

  it('a held fist with nothing selected grabs what the palm is on', () => {
    rig.apply({ op: 'add_fixture', kind: 'sofa', nums: { x: 3000, y: 2500, w: 2000, d: 900, rotation: 0 } });
    rig.journal.flush();
    rig.apply({ op: 'select_set', ids: [] });
    const p = toScreen({ x: 3000, y: 2500 });
    rig.stroke(p, { x: p.x + 100, y: p.y - 60 });
    expect(rig.doc().fixtures[0]).toMatchObject({ x: 4000, y: 3100 });
    expect(rig.doc().selectedId).toBe(rig.doc().fixtures[0].id);
  });

  it('a door slides along its wall', () => {
    rig.apply({ op: 'add_wall', x1: 1000, y1: 2000, x2: 5000, y2: 2000 });
    rig.apply({ op: 'add_door', target: rig.doc().walls[0].id, offset: 500, width: 900 });
    rig.journal.flush();
    rig.hand.select(rig.doc().openings[0].id);
    rig.stroke({ x: 400, y: 400 }, { x: 500, y: 430 });
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
    expect(rig.hand.mode().text).toBe('Wall 3.00 m selected — fist: move · peace-and-move: resize · right thumbs-down: remove');
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

  it('R thumbs-down = Remove while the plan shows Remove; a review still wins; otherwise Close', () => {
    expect(resolveGesture(binding('R:thumbsDown'), env({ [REMOVE]: { id: 'remove' } }))).toEqual({ kind: 'click', el: { id: 'remove' }, label: 'Remove' });
    expect(resolveGesture(binding('R:thumbsDown'), env({ [REMOVE]: { id: 'remove' }, '.mc-review-reject': { id: 'reject' } }))).toEqual({ kind: 'click', el: { id: 'reject' }, label: 'Reject' });
    expect(resolveGesture(binding('R:thumbsDown'), env({}, { closer: () => ({ id: 'x' }) }))).toEqual({ kind: 'click', el: { id: 'x' }, label: 'Close' });
  });

  it('L peace = Rotate while the plan shows Rotate, otherwise Tools', () => {
    expect(resolveGesture(binding('L:peace'), env({ [ROTATE]: { id: 'rot' }, '.mc-tools-chip': { id: 'tools' } }))).toEqual({ kind: 'click', el: { id: 'rot' }, label: 'Rotate' });
    expect(resolveGesture(binding('L:peace'), env({ '.mc-tools-chip': { id: 'tools' } }))).toEqual({ kind: 'click', el: { id: 'tools' }, label: 'Tools' });
  });

  it('the badge follows the same priority, and no table gained a duplicate gesture', () => {
    expect(badgeSelectors(binding('R:thumbsDown'))).toEqual(['.mc-review-reject', '.mc-proposal-drop', REMOVE]);
    expect(badgeSelectors(binding('L:peace'))).toEqual([ROTATE, '.mc-tools-chip']);
    expect(duplicateKeys(LAPTOP_GESTURES)).toEqual([]);
    expect(duplicateKeys(PHONE_GESTURES)).toEqual([]);
  });
});

import { isStorablePlanDoc, savedPlanDoc, setSavedPlanDoc, storablePlanDoc } from '../../src/canvas/planDocs';
import { coerceSurfacePlan } from '../../src/canvas/surfacePlan';

describe('the drawing is stored with the board', () => {
  it('a plan tile keeps a sane `doc` through validation and drops a bad one', () => {
    const doc = { walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 100 }], openings: [], rooms: [], dims: [], fixtures: [], texts: [], selectedId: 'w1', selectedIds: ['w1'] };
    const ok = coerceSurfacePlan({ kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'p-cad', template: 'studio', doc }] });
    expect(ok.ok && (ok.value.tiles[0] as { doc?: unknown }).doc).toEqual(doc);
    const bad = coerceSurfacePlan({ kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'p-cad', template: 'studio', doc: 'rm -rf' }] });
    expect(bad.ok && 'doc' in bad.value.tiles[0]).toBe(false);
  });

  it('what is stored has no selection, and the registry hands it to the board by frame + plan id', () => {
    const rig = planHandRig();
    rig.apply({ op: 'add_wall', x1: 0, y1: 0, x2: 3000, y2: 0 });
    const d = storablePlanDoc(rig.doc())!;
    expect(d.selectedId).toBeNull();
    expect((d.walls as unknown[]).length).toBe(1);
    expect(isStorablePlanDoc({ walls: 1 })).toBe(false);
    setSavedPlanDoc('f1', 'p-cad', d);
    expect(savedPlanDoc('f1', 'p-cad')).toBe(d);
    expect(savedPlanDoc('f2', 'p-cad')).toBeNull();
    // A fresh controller restored from it shows the same wall.
    const again = planHandRig();
    again.controller.restoreSnapshot?.(d);
    expect(again.doc().walls).toHaveLength(1);
    setSavedPlanDoc('f1', 'p-cad', null);
    expect(savedPlanDoc('f1', 'p-cad')).toBeNull();
    rig.destroy(); again.destroy();
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
