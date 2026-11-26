import { describe, it, expect } from 'vitest';
import { buildControlSnapshot, coerceSnapshot } from '../src/relay/controlSnapshot';

describe('controlSnapshot: new optional fields', () => {
  it('layout/board/transfer round-trip through coerceSnapshot', () => {
    const snap = buildControlSnapshot({
      rev: 2,
      layout: { left: 'android', right: 'ios' },
      board: { kind: 'room', title: 'This room', tiles: [{ type: 'lamp', deviceId: 'lamp-1', label: 'Lamp' }] },
      transfer: { componentId: 'lamp-lamp-1', to: 'left', enterEdge: 'right', rev: 2 },
    });
    expect(snap.layout).toEqual({ left: 'android', right: 'ios' });
    expect(snap.board?.title).toBe('This room');
    expect(snap.transfer).toEqual({ componentId: 'lamp-lamp-1', to: 'left', enterEdge: 'right', rev: 2 });
    const back = coerceSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(back).not.toBeNull();
    expect(back!.layout).toEqual(snap.layout);
    expect(back!.board?.tiles).toHaveLength(1);
    expect(back!.transfer).toEqual(snap.transfer);
  });

  it('OLD snapshots without the new fields still coerce', () => {
    const old = buildControlSnapshot({ rev: 1 });
    expect(old.layout).toBeUndefined();
    expect(old.board).toBeUndefined();
    expect(old.transfer).toBeUndefined();
    const back = coerceSnapshot(JSON.parse(JSON.stringify(old)));
    expect(back).not.toBeNull();
    expect(back!.layout).toBeUndefined();
    expect(back!.board).toBeUndefined();
  });

  it('a board that no longer validates is dropped, not rendered raw', () => {
    const snap = coerceSnapshot({ v: 1, rev: 1, board: { kind: 'junk' } });
    expect(snap).not.toBeNull();
    expect(snap!.board).toBeUndefined();
  });

  it('a media-ish label in a board tile is stripped by coerceSurfacePlan', () => {
    const snap = buildControlSnapshot({
      rev: 1,
      board: { kind: 'room', title: 't', tiles: [{ type: 'lamp', deviceId: 'lamp-1', label: 'Lamp<script>x</script>' }] },
    });
    const tile = snap.board?.tiles[0] as { label?: string } | undefined;
    expect(tile?.label ?? '').not.toContain('<');
  });

  it('a malformed layout/transfer is ignored (backward compatible)', () => {
    const snap = coerceSnapshot({ v: 1, rev: 1, layout: 'nope', transfer: { to: 'mars' } });
    expect(snap).not.toBeNull();
    expect(snap!.layout).toBeUndefined();
    expect(snap!.transfer).toBeUndefined();
  });
});

describe('controlSnapshot: boardFor (a board sent to ONE phone)', () => {
  const board = { kind: 'room', title: 'Kitchen', tiles: [{ type: 'lamp', deviceId: 'lamp-1', label: 'Lamp' }] };
  it('round-trips a valid target', () => {
    const snap = buildControlSnapshot({ rev: 3, board, boardFor: 'ios' });
    expect(snap.boardFor).toBe('ios');
    expect(coerceSnapshot(JSON.parse(JSON.stringify(snap)))!.boardFor).toBe('ios');
  });
  it('drops junk targets and a target without a board', () => {
    expect(buildControlSnapshot({ rev: 3, board, boardFor: 'windows' }).boardFor).toBeUndefined();
    expect(buildControlSnapshot({ rev: 3, boardFor: 'ios' }).boardFor).toBeUndefined();
    const raw = JSON.parse(JSON.stringify(buildControlSnapshot({ rev: 3, board })));
    raw.boardFor = { evil: true };
    expect(coerceSnapshot(raw)!.boardFor).toBeUndefined();
  });
});
