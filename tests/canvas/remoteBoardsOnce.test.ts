// A phone shows each board the laptop sends once (the live bug: after
// re-pairing, the Nothing phone showed the Floor plan board twice).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { duplicateBoards, remoteBoardTarget, sameRemoteBoard } from '../../src/canvas/remoteBoards';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
const FP: SurfacePlan = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'f3-cad', template: 'studio' }] };
const LIFTED: SurfacePlan = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'room-plan', template: 'studio' }] };
const DASH: SurfacePlan = { kind: 'room', title: 'Dashboard', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }] };
const frames = (...ids: string[]) => ids.map((id) => ({ id }));

describe('a phone shows each board once', () => {
  it('the same board: a floor plan by plan id or title, others by kind + title', () => {
    expect(sameRemoteBoard(FP, FP)).toBe(true);
    expect(sameRemoteBoard(LIFTED, FP)).toBe(true); // a lifted older copy of the Floor plan
    expect(sameRemoteBoard({ ...FP, title: 'Plan' }, FP)).toBe(true); // same plan board id
    expect(sameRemoteBoard(DASH, FP)).toBe(false);
    expect(sameRemoteBoard(DASH, { ...DASH, tiles: [] })).toBe(true);
    expect(sameRemoteBoard(undefined, FP)).toBe(false);
  });
  it('a board that arrives again goes to the frame already showing it, never a second one', () => {
    // the phone's focused board is the dashboard; the Floor plan is on f2
    expect(remoteBoardTarget(frames('f1', 'f2'), { f1: DASH, f2: LIFTED }, FP, 'f1')).toEqual({ id: 'f2', duplicates: [] });
    // two copies already: the focused one is used, the other goes
    expect(remoteBoardTarget(frames('f1', 'f2'), { f1: FP, f2: LIFTED }, FP, 'f2')).toEqual({ id: 'f2', duplicates: ['f1'] });
    // a new board: the preferred frame, as before
    expect(remoteBoardTarget(frames('f1'), { f1: DASH }, FP, 'f1')).toEqual({ id: 'f1', duplicates: [] });
    expect(remoteBoardTarget([], {}, FP, null)).toEqual({ id: null, duplicates: [] });
  });
  it('copies saved by an older build collapse on load (the focused one stays)', () => {
    expect(duplicateBoards(frames('f1', 'f2', 'f3'), { f1: FP, f2: DASH, f3: LIFTED }, null)).toEqual(['f3']);
    expect(duplicateBoards(frames('f1', 'f2', 'f3'), { f1: FP, f2: DASH, f3: LIFTED }, 'f3')).toEqual(['f1']);
    expect(duplicateBoards(frames('f1', 'f2'), { f1: FP, f2: DASH }, 'f1')).toEqual([]);
  });
  it('the canvas uses them: on receive, and on a phone at load', () => {
    expect(app).toMatch(/const target = remoteBoardTarget\(reg\.list\(\), surfaces, plan, preferred\);\s*for \(const dup of target\.duplicates\) dropDuplicateBoard\(dup\);/);
    expect(app).toMatch(/if \(phoneShell\) \{\s*for \(const dup of duplicateBoards\(reg\.list\(\), surfaces, focusId\)\)/);
  });
});
