import { describe, expect, it, vi } from 'vitest';
import { buildControlSnapshot, coerceSnapshot, snapshotBytes, snapshotFieldCount, SNAPSHOT_MAX_BYTES, SNAPSHOT_MAX_FIELDS } from '../src/relay/controlSnapshot';
import { createFakeTransport } from '../src/relay/transport';
import { createHostSession, createGuestSession } from '../src/relay/session';
import { fitsRoomMessageRules } from '../src/relay/protocol';
import { coerceBoardDrawings, planBoardIds, sanitizePlanDoc } from '../src/canvas/planDocs';
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
    const snap = coerceSnapshot(JSON.parse(JSON.stringify(buildControlSnapshot({ rev: 4, board: BOARD, boardFor: 'android', boardBy: 'gemini', boardDrawings: { 'board-cad': edited() } }))))!;
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

  // A LEGAL drawing (sanitizePlanDoc keeps it) that is still large: n text
  // notes of `text` each.
  const withTexts = (n: number, text: string) => ({ ...edited(), texts: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, x: i, y: i, text, size: 200 })) });
  const BOARD2: SurfacePlan = { kind: 'room', title: 'Two plans', tiles: [{ type: 'plan', boardId: 'big', template: 'studio' }, { type: 'plan', boardId: 'small', template: 'studio' }] };

  it('the WHOLE snapshot is bounded in UTF-8 bytes: non-ASCII drawings are shed, largest first', () => {
    // 1 550 notes of 190 chars of a 3-byte script: ~0.95 MB of UTF-8, yet
    // under PLAN_DOC_MAX_CHARS in chars — a legal drawing.
    const big = withTexts(1550, 'ಕ'.repeat(190));
    expect(sanitizePlanDoc(big)).not.toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(SNAPSHOT_MAX_BYTES);
    const small = edited();
    small.rooms[1].name = 'ಮಲಗುವ ಕೋಣೆ'; // a non-ASCII room name survives
    const snap = buildControlSnapshot({ board: BOARD2, boardFor: 'ios', boardDrawings: { big, small } });
    expect(Object.keys(snap.boardDrawings ?? {})).toEqual(['small']);
    expect(names(snap.boardDrawings?.small)).toContain('ಮಲಗುವ ಕೋಣೆ');
    expect(snap.omitted.drawings).toBe(1);
    expect(snapshotBytes(snap)).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    // The count survives the wire, so the phone can say a drawing was left out.
    const back = coerceSnapshot(JSON.parse(JSON.stringify(snap)))!;
    expect(back.omitted.drawings).toBe(1);
    expect(Object.keys(back.boardDrawings ?? {})).toEqual(['small']);
  });

  it('…and in Firestore fields (every key and array element counts)', () => {
    // Many tiny notes + fixtures (2 000 each, the per-list cap): few bytes,
    // but over the field budget.
    const many = { ...withTexts(2000, 'a'), fixtures: Array.from({ length: 2000 }, (_, i) => ({ id: `fx${i}`, kind: 'bed', x: i, y: 0, w: 900, d: 2000, rotation: 0 })) };
    expect(sanitizePlanDoc(many)).not.toBeNull();
    expect(snapshotBytes(buildControlSnapshot({ board: BOARD2 }))).toBeLessThan(SNAPSHOT_MAX_BYTES);
    expect(snapshotFieldCount(many)).toBeGreaterThan(SNAPSHOT_MAX_FIELDS);
    const snap = buildControlSnapshot({ board: BOARD2, boardDrawings: { big: many, small: edited() } });
    expect(Object.keys(snap.boardDrawings ?? {})).toEqual(['small']);
    expect(snapshotFieldCount(snap)).toBeLessThanOrEqual(SNAPSHOT_MAX_FIELDS);
    expect(snap.omitted.drawings).toBe(1);
    // A normal edited plan is a few kB — far under a Firestore document.
    expect(snapshotBytes(buildControlSnapshot({ board: BOARD, boardDrawings: { 'board-cad': edited() } }))).toBeLessThan(20_000);
  });

  it('the phone is told when a drawing was left out', () => {
    const snap = coerceSnapshot(JSON.parse(JSON.stringify(buildControlSnapshot({ board: BOARD, boardBy: 'gemini', boardDrawings: { 'board-cad': withTexts(1550, 'ಕ'.repeat(190)) } }))))!;
    expect(snap.boardDrawings).toBeUndefined();
    const show = vi.fn();
    applyGuestSnapshot(snap, show, 'ios');
    expect(show).toHaveBeenCalledWith(BOARD, {}, { drawingsOmitted: 1, by: 'gemini' });
  });

  it('a rejected publish is not kept for replay to late joiners', async () => {
    const fake = createFakeTransport();
    const t = { ...fake, async publish(room: string, msg: Parameters<typeof fake.publish>[1]) {
      if (msg.type === 'state' && msg.snapshot.rev === 2) throw new Error('rejected');
      return fake.publish(room, msg);
    } };
    const TOKEN = 'ABCDEFGHJKMNPQRSTVWXYZ01';
    const host = await createHostSession(t, undefined, { token: TOKEN });
    await host.publishState(buildControlSnapshot({ rev: 1, board: BOARD }));
    await expect(host.publishState(buildControlSnapshot({ rev: 2, board: BOARD }))).rejects.toThrow();
    const guest = await createGuestSession(t, TOKEN);
    const seen: number[] = [];
    guest.onSnapshot((s) => seen.push(s.rev));
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toContain(1);
    expect(seen).not.toContain(2);
    await Promise.all([guest.close(), host.close()]);
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
