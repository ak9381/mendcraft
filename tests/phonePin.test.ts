import { describe, it, expect } from 'vitest';
import { pinBoard, unpin, loadPin, togglePin } from '../src/canvas/phonePin';
import type { StorageLike } from '../src/relay/pairingStore';
import type { SurfacePlan } from '../src/canvas/surfacePlan';

function memStore(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const board: SurfacePlan = { kind: 'room', title: 'Amma’s room', tiles: [{ type: 'lamp', deviceId: 'lamp-1', label: 'Lamp' }] };

describe('phonePin', () => {
  it('pins and reloads a validated board', () => {
    const s = memStore();
    const st = pinBoard(s, board, 7);
    expect(st.pinned).toBe(true);
    const loaded = loadPin(s);
    expect(loaded.pinned).toBe(true);
    expect(loaded.board?.title).toBe('Amma’s room');
    expect(loaded.at).toBe(7);
  });

  it('unpins', () => {
    const s = memStore();
    pinBoard(s, board);
    expect(unpin(s)).toEqual({ pinned: false, board: null });
    expect(loadPin(s).pinned).toBe(false);
  });

  it('togglePin flips state', () => {
    const s = memStore();
    expect(togglePin(s, board).pinned).toBe(true);
    expect(togglePin(s, board).pinned).toBe(false);
  });

  it('a pinned-but-invalid board loads as pinned with no board', () => {
    const s = memStore();
    s.setItem('mc.relay.phonePin', JSON.stringify({ pinned: true, board: { kind: 'junk' } }));
    const loaded = loadPin(s);
    expect(loaded.pinned).toBe(true);
    expect(loaded.board).toBeNull();
  });
});
