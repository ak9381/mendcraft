import { describe, expect, it, vi } from 'vitest';
import { buildControlSnapshot, coerceSnapshot, snapshotBytes } from '../src/relay/controlSnapshot';
import { fitsRoomMessageRules } from '../src/relay/protocol';
import { BOARD_DRAWINGS_MAX_CHARS, coerceBoardDrawings, planBoardIds } from '../src/canvas/planDocs';
import { applyGuestSnapshot } from '../src/canvas/phoneCanvasRuntime';
import { applyPlanEdit, planRooms } from '../src/canvas/planEdit';
import { PlanEngine } from '../src/plan/engine';
import { validatePlanOp, type PlanOp } from '../src/plan/ops';
import { buildPlanTemplate } from '../src/plan/templates';
import type { PlanDoc } from '../src/plan/doc';
import type { SurfacePlan } from '../src/canvas/surfacePlan';

function studio(): PlanDoc {
  const e = new PlanEngine();
  const ops = buildPlanTemplate('studio').map((o) => validatePlanOp(o)).filter((v): v is { ok: true; op: PlanOp } => v.ok).map((v) => v.op);
  e.applyGenerated(ops);
  return structuredClone(e.getState());
}
/** The live bug: Studio, then "add a bedroom next to the studio" (approved). */
function edited(): PlanDoc {
  const r = applyPlanEdit(studio(), { a: 'add', r: 'Studio', n: 'Bedroom' });
  if (!r.ok) throw new Error(r.error);
  return r.value.doc;
}
const BOARD: SurfacePlan = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'board-cad', template: 'studio' }] };
const names = (doc: unknown): string[] => planRooms(doc as PlanDoc).map((r) => r.name).sort();

describe('board snapshot carries the CURRENT plan drawing', () => {
  it('an edited plan rides beside the board and survives the wire (coerceSnapshot)', () => {
    const doc = edited();
    expect(names(doc)).toEqual(['Bedroom', 'Studio']);
    const snap = buildControlSnapshot({ rev: 3, board: BOARD, boardFor: 'ios', boardDrawings: { 'board-cad': doc } });
    expect(names(snap.boardDrawings?.['board-cad'])).toEqual(['Bedroom', 'Studio']);
    // The surface plan itself stays drawing-free (what models / morphs see).
    expect(JSON.stringify(snap.board)).not.toContain('Bedroom');
    const wire = JSON.parse(JSON.stringify({ v: 1, from: 'host', type: 'state', snapshot: snap }));
    expect(fitsRoomMessageRules(wire)).toBe(true);
    const back = coerceSnapshot(wire.snapshot);
    expect(back?.boardFor).toBe('ios');
    expect(names(back?.boardDrawings?.['board-cad'])).toEqual(['Bedroom', 'Studio']);
    expect(back?.boardDrawings?.['board-cad']).not.toHaveProperty('selectedId');
  });

  it('the phone hands the drawing to its board (and only the targeted phone)', () => {
    const snap = coerceSnapshot(JSON.parse(JSON.stringify(buildControlSnapshot({ rev: 4, board: BOARD, boardFor: 'android', boardDrawings: { 'board-cad': edited() } }))))!;
    const show = vi.fn();
    expect(applyGuestSnapshot(snap, show, 'android')).toBe(true);
    expect(names(show.mock.calls[0][1]['board-cad'])).toEqual(['Bedroom', 'Studio']);
    const other = vi.fn();
    expect(applyGuestSnapshot(snap, other, 'ios')).toBe(false);
    expect(other).not.toHaveBeenCalled();
  });

  it('never trusts it: junk, foreign board ids and broken docs are dropped', () => {
    const doc = edited();
    const snap = buildControlSnapshot({
      board: BOARD,
      boardDrawings: { 'board-cad': { walls: 'nope', openings: [] }, 'other-board': doc, __proto__: doc },
    });
    expect(snap.boardDrawings).toBeUndefined();
    expect(snap.omitted.drawings).toBe(1);
    // Openings / rooms pointing at walls that do not exist are dropped.
    const bad = { ...doc, openings: [{ id: 'o1', kind: 'door', wallId: 'ghost', offset: 1, width: 900 }], rooms: [{ id: 'r9', name: '<img src=x>', wallIds: ['ghost'] }] };
    const c = coerceBoardDrawings({ 'board-cad': bad }, BOARD).drawings['board-cad'] as unknown as PlanDoc;
    expect(c.openings).toEqual([]);
    expect(c.rooms[0].wallIds).toEqual([]);
    // No board, no drawings.
    expect(buildControlSnapshot({ boardDrawings: { 'board-cad': doc } }).boardDrawings).toBeUndefined();
  });

  it('is bounded: a drawing over the size cap is left out (counted), never cut', () => {
    const doc = edited();
    const texts = Array.from({ length: 1500 }, (_, i) => ({ id: `t${i}`, x: i, y: i, text: 'x'.repeat(190), size: 200 }));
    const big = { ...doc, texts };
    expect(JSON.stringify(big).length).toBeGreaterThan(BOARD_DRAWINGS_MAX_CHARS);
    const snap = buildControlSnapshot({ board: BOARD, boardDrawings: { 'board-cad': big } });
    expect(snap.boardDrawings).toBeUndefined();
    expect(snap.omitted.drawings).toBe(1);
    // A normal edited plan is a few kB — far under a Firestore document.
    expect(snapshotBytes(buildControlSnapshot({ board: BOARD, boardDrawings: { 'board-cad': doc } }))).toBeLessThan(20_000);
  });

  it('finds plan tiles nested in containers', () => {
    const nested = { kind: 'room', title: 'R', tiles: [{ type: 'card', title: 'C', children: [{ type: 'plan', boardId: 'p-2', template: 'oneRoom' }] }] };
    expect(planBoardIds(nested)).toEqual(['p-2']);
    const snap = buildControlSnapshot({ board: nested, boardDrawings: { 'p-2': edited() } });
    expect(Object.keys(snap.boardDrawings ?? {})).toEqual(['p-2']);
  });

  it('old snapshots (no drawings) keep their exact shape', () => {
    const snap = buildControlSnapshot({ rev: 1, board: BOARD });
    expect(snap).not.toHaveProperty('boardDrawings');
    expect(snap.omitted).not.toHaveProperty('drawings');
  });
});
