import { describe, expect, it, vi } from 'vitest';
import { applyGuestSnapshot, BOARD_NO_MAKER_LINE, createSnapshotOrder, phoneRouteBadge } from '../../src/canvas/phoneCanvasRuntime';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';
import { buildControlSnapshot, coerceSnapshot } from '../../src/relay/controlSnapshot';

const board: SurfacePlan = { kind: 'room', title: 'Living room', tiles: [] };

describe('phoneRouteBadge', () => {
  it('prefers Apple when it is ready; a SIM iOS shell never names Apple', () => {
    expect(phoneRouteBadge({ appleReady: true, ios: true, sim: false, cloud: true })).toBe('Apple · on device');
    expect(phoneRouteBadge({ appleReady: false, ios: true, sim: true, cloud: true })).toBe('SIM · no live model');
  });

  it('?sim=1 is labelled SIM; no cloud and no on-device model says there is no model', () => {
    expect(phoneRouteBadge({ appleReady: false, ios: false, sim: true, cloud: true })).toBe('SIM · no live model');
    expect(phoneRouteBadge({ appleReady: false, ios: false, sim: false, cloud: false })).toBe('No model here');
    expect(phoneRouteBadge({ appleReady: false, ios: true, sim: false, cloud: false })).toBe('No model here');
    for (const sim of [true, false]) expect(phoneRouteBadge({ appleReady: false, ios: true, sim, cloud: false })).not.toMatch(/scripted|Gemini|Apple/);
  });

  it('shows Gemini cloud when that is the live route', () => {
    expect(phoneRouteBadge({ appleReady: false, ios: false, sim: false, cloud: true })).toBe('Gemini · cloud');
  });
});

describe('applyGuestSnapshot', () => {
  const by = 'gemini' as const;
  it('applies a Relay board snapshot and ignores empty ones', () => {
    const show = vi.fn();
    expect(applyGuestSnapshot({}, show)).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(applyGuestSnapshot({ board, boardBy: by }, show)).toBe(true);
    expect(show).toHaveBeenCalledWith(board, {}, { by });
  });
  it('a board sent to one phone shows only on that phone', () => {
    const ios = vi.fn();
    const android = vi.fn();
    expect(applyGuestSnapshot({ board, boardFor: 'ios', boardBy: by }, ios, 'ios')).toBe(true);
    expect(applyGuestSnapshot({ board, boardFor: 'ios', boardBy: by }, android, 'android')).toBe(false);
    expect(ios).toHaveBeenCalledWith(board, {}, { by });
    expect(android).not.toHaveBeenCalled();
    // An untargeted board still mirrors to every phone.
    expect(applyGuestSnapshot({ board, boardBy: by }, android, 'android')).toBe(true);
  });
  it('a board that does not say who made it is refused, and the phone says so', () => {
    const show = vi.fn();
    const said: string[] = [];
    expect(applyGuestSnapshot({ board }, show, 'ios', (l) => said.push(l))).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(said).toEqual([BOARD_NO_MAKER_LINE]);
    expect(BOARD_NO_MAKER_LINE).toBe("Couldn't take the board — it doesn't say who made it. Nothing changed.");
    // A board for the other phone is ignored quietly, maker or not.
    expect(applyGuestSnapshot({ board, boardFor: 'android' }, show, 'ios', (l) => said.push(l))).toBe(false);
    expect(said).toHaveLength(1);
  });
  it('the snapshot keeps only a known maker', () => {
    const real: SurfacePlan = { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'Temperature', value: '21 °C' }] };
    const wire = (boardBy: unknown) => coerceSnapshot(JSON.parse(JSON.stringify({ ...buildControlSnapshot({ board: real }), boardBy })));
    expect(wire('replay')?.board).toBeTruthy();
    expect(wire('replay')?.boardBy).toBe('replay');
    expect(wire('admin')?.boardBy).toBeUndefined();
    expect(wire({ by: 'gemini' })?.boardBy).toBeUndefined();
    // No board, no maker.
    expect(buildControlSnapshot({ boardBy: 'gemini' }).boardBy).toBeUndefined();
  });
});

describe('phoneRouteBadge — why Apple is not on device', () => {
  const base = { appleReady: false, ios: true, sim: false, cloud: true };
  it('says Apple Intelligence is off', () => {
    expect(phoneRouteBadge({ ...base, appleReason: 'appleIntelligenceNotEnabled' })).toBe('Gemini · cloud · Apple Intelligence is off');
  });
  it('says the Apple model is still downloading', () => {
    expect(phoneRouteBadge({ ...base, appleReason: 'modelNotReady' })).toBe('Gemini · cloud · Apple model downloading');
  });
  it('says the device is not eligible', () => {
    expect(phoneRouteBadge({ ...base, appleReason: 'deviceNotEligible' })).toBe('Gemini · cloud · this iPhone has no Apple model');
  });
  it('stays plain when ready or no reason is known', () => {
    expect(phoneRouteBadge({ ...base, appleReady: true, appleReason: 'available' })).toBe('Apple · on device');
    expect(phoneRouteBadge(base)).toBe('Gemini · cloud');
  });
});

describe('applyGuestSnapshot — pins', () => {
  const by = 'gemini' as const;
  it('pins[platform] null takes the received boards off; nothing is shown', () => {
    const show = vi.fn();
    const clear = vi.fn();
    expect(applyGuestSnapshot({ pins: { ios: null, android: 'f1' } }, show, 'ios', undefined, undefined, clear)).toBe(false);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    // The other phone, still pinned, keeps its board.
    const clearA = vi.fn();
    expect(applyGuestSnapshot({ pins: { ios: null, android: 'f1' } }, show, 'android', undefined, undefined, clearA)).toBe(false);
    expect(clearA).not.toHaveBeenCalled();
  });
  it('a board is taken only when it is this phone\'s pin', () => {
    const show = vi.fn();
    const clear = vi.fn();
    expect(applyGuestSnapshot({ board, boardFor: 'android', boardBy: by, pins: { ios: null, android: 'f2' }, boardPin: 'f1' }, show, 'android', undefined, undefined, clear)).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(applyGuestSnapshot({ board, boardFor: 'android', boardBy: by, pins: { ios: null, android: 'f2' }, boardPin: 'f2' }, show, 'android', undefined, undefined, clear)).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
  });
  it('an old laptop (no pins): a board-less snapshot changes nothing, a board shows as before', () => {
    const show = vi.fn();
    const clear = vi.fn();
    expect(applyGuestSnapshot({}, show, 'ios', undefined, undefined, clear)).toBe(false);
    expect(applyGuestSnapshot({ board, boardBy: by }, show, 'ios', undefined, undefined, clear)).toBe(true);
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('createSnapshotOrder — history never acts', () => {
  it('a replayed older snapshot is refused; a live one always acts (a reloaded laptop counts from 1)', () => {
    const o = createSnapshotOrder();
    expect(o.accept({ rev: 5 })).toBe(true);
    expect(o.accept({ rev: 3 }, { buffered: true })).toBe(false);
    expect(o.accept({ rev: 4, boardSend: { id: 'a', at: 1, replay: true } })).toBe(false);
    expect(o.accept({ rev: 5 }, { buffered: true })).toBe(true); // the newest, replayed on hello
    expect(o.accept({ rev: 1 })).toBe(true); // the laptop reloaded
    expect(o.accept({ rev: 2 }, { buffered: true })).toBe(true);
  });
  it('a replay older than the newest pins never brings an old board back (end to end through applyGuestSnapshot)', () => {
    const o = createSnapshotOrder();
    const show = vi.fn();
    const clear = vi.fn();
    const sent = coerceSnapshot(JSON.parse(JSON.stringify(buildControlSnapshot({ rev: 1, board: { ...board, tiles: [{ type: 'stat', label: 'A', value: '1' }] }, boardFor: 'ios', boardBy: 'gemini', pins: { ios: 'f1', android: null }, boardPin: 'f1', boardSend: { id: 's1', at: 1 } }))))!;
    const back = coerceSnapshot(JSON.parse(JSON.stringify(buildControlSnapshot({ rev: 2, pins: { ios: null, android: null } }))))!;
    const apply = (s: typeof sent, buffered = false) => o.accept(s, { buffered }) && applyGuestSnapshot(s, show, 'ios', undefined, undefined, clear);
    expect(apply(sent)).toBe(true);
    expect(apply(back)).toBe(false);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(apply({ ...sent, boardSend: { ...sent.boardSend!, replay: true } })).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
