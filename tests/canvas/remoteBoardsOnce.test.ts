// A phone shows each board the laptop sends once (the live bug: after
// re-pairing, the Nothing phone showed the Floor plan board twice) — and
// never takes one of her own boards for a copy.
import { describe, expect, it } from 'vitest';
import { duplicateBoards, isNativePhoneApp, remoteBoardTarget, sameRemoteBoard } from '../../src/canvas/remoteBoards';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

const FP: SurfacePlan = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'f3-cad', template: 'studio' }] };
const OTHER_FP: SurfacePlan = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'f7-cad', template: 'studio' }] };
const DASH: SurfacePlan = { kind: 'room', title: 'Dashboard', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }] };
const local = (id: string) => ({ id });
const remote = (id: string) => ({ id, from: 'laptop' as const });

describe('the same board, strictly', () => {
  it('floor plans by plan board id; by title only when one side has none', () => {
    expect(sameRemoteBoard({ plan: FP, fromLaptop: false }, { plan: FP, fromLaptop: true })).toBe(true);
    expect(sameRemoteBoard({ plan: { ...FP, title: 'Plan' }, fromLaptop: false }, { plan: FP, fromLaptop: true })).toBe(true);
    expect(sameRemoteBoard({ plan: OTHER_FP, fromLaptop: true }, { plan: FP, fromLaptop: true })).toBe(false);
    expect(sameRemoteBoard({ plan: { kind: 'plan', title: 'Floor plan', tiles: [] }, fromLaptop: false }, { plan: FP, fromLaptop: true })).toBe(true);
  });
  it('other boards only when both came from the laptop', () => {
    expect(sameRemoteBoard({ plan: DASH, fromLaptop: true }, { plan: DASH, fromLaptop: true })).toBe(true);
    expect(sameRemoteBoard({ plan: DASH, fromLaptop: false }, { plan: DASH, fromLaptop: true })).toBe(false);
    expect(sameRemoteBoard({ plan: DASH, fromLaptop: true }, { plan: FP, fromLaptop: true })).toBe(false);
    expect(sameRemoteBoard({ plan: undefined, fromLaptop: true }, { plan: FP, fromLaptop: true })).toBe(false);
  });
});

describe('a received board goes where it already is', () => {
  it('to the frame already showing it, never a second one', () => {
    expect(remoteBoardTarget([local('f1'), local('f2')], { f1: DASH, f2: FP }, FP, 'f1')).toEqual({ id: 'f2', duplicates: [] });
    expect(remoteBoardTarget([remote('f1'), local('f2')], { f1: FP, f2: FP }, FP, 'f2')).toEqual({ id: 'f2', duplicates: ['f1'] });
  });
  it('a new board goes to the preferred frame, as before', () => {
    expect(remoteBoardTarget([local('f1')], { f1: DASH }, FP, 'f1')).toEqual({ id: 'f1', duplicates: [] });
    expect(remoteBoardTarget([], {}, FP, null)).toEqual({ id: null, duplicates: [] });
  });
  it('her own boards with the same title are never taken', () => {
    const t = remoteBoardTarget([local('f1'), local('f2'), local('f3')], { f1: DASH, f2: DASH, f3: OTHER_FP }, { ...DASH }, 'f1');
    expect(t.duplicates).toEqual([]);
    expect(remoteBoardTarget([local('f1'), local('f2')], { f1: OTHER_FP, f2: DASH }, FP, 'f2')).toEqual({ id: 'f2', duplicates: [] });
  });
});

describe('copies an older build saved collapse on load (phone app only)', () => {
  it('a received copy and a same-id plan go; the focused one stays', () => {
    expect(duplicateBoards([remote('f1'), local('f2'), local('f3')], { f1: FP, f2: DASH, f3: FP }, null)).toEqual(['f3']);
    expect(duplicateBoards([remote('f1'), local('f2'), local('f3')], { f1: FP, f2: DASH, f3: FP }, 'f3')).toEqual(['f1']);
    expect(duplicateBoards([remote('f1'), remote('f2')], { f1: DASH, f2: DASH }, null)).toEqual(['f2']);
  });
  it('two distinct floor plans both stay; two of her own dashboards both stay', () => {
    expect(duplicateBoards([local('f1'), local('f2')], { f1: FP, f2: OTHER_FP }, null)).toEqual([]);
    expect(duplicateBoards([local('f1'), local('f2')], { f1: DASH, f2: DASH }, null)).toEqual([]);
    expect(duplicateBoards([local('f1'), remote('f2')], { f1: DASH, f2: DASH }, null)).toEqual([]);
  });
  it('runs only in the native phone app — never a narrow laptop window or a phone browser', () => {
    expect(isNativePhoneApp(null)).toBe(false);
    expect(isNativePhoneApp({ isNativePlatform: () => false, getPlatform: () => 'web' })).toBe(false);
    expect(isNativePhoneApp({ isNativePlatform: () => true, getPlatform: () => 'electron' })).toBe(false);
    expect(isNativePhoneApp({ isNativePlatform: () => true, getPlatform: () => 'android' })).toBe(true);
    expect(isNativePhoneApp({ isNativePlatform: () => true, getPlatform: () => 'ios' })).toBe(true);
  });
});
