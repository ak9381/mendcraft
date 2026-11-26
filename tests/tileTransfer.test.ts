import { describe, it, expect } from 'vitest';
import {
  validateTransfer, parseTransfer, serializeTransfer, enterEdgeForExit,
  applyTileToPlan, removeTileFromPlan, findTile, TRANSFER_JSON_MAX,
} from '../src/canvas/tileTransfer';
import { tileComponentId, type SurfacePlan, type TileSpec } from '../src/canvas/surfacePlan';

const lamp: TileSpec = { type: 'lamp', deviceId: 'lamp-1', label: 'Lamp' };
const music: TileSpec = { type: 'music', deviceId: 'music-1', label: 'Music' };

function plan(tiles: TileSpec[]): SurfacePlan {
  return { kind: 'room', title: 'This room', tiles };
}

describe('tileTransfer validate/serialize', () => {
  it('validates a well-formed transfer and re-coerces the tile', () => {
    const t = validateTransfer({
      tile: { type: 'lamp', deviceId: 'lamp-1', label: 'Lamp' },
      componentId: 'lamp-lamp-1', from: 'laptop', to: 'left', enterEdge: 'right',
    });
    expect(t).not.toBeNull();
    expect(t!.tile.type).toBe('lamp');
    expect(t!.to).toBe('left');
  });

  it('rejects same from/to, bad endpoints, bad tile', () => {
    expect(validateTransfer({ tile: lamp, componentId: 'c', from: 'laptop', to: 'laptop', enterEdge: 'left' })).toBeNull();
    expect(validateTransfer({ tile: lamp, componentId: 'c', from: 'laptop', to: 'nowhere', enterEdge: 'left' })).toBeNull();
    expect(validateTransfer({ tile: { type: 'bogus' }, componentId: 'c', from: 'laptop', to: 'left', enterEdge: 'left' })).toBeNull();
    expect(validateTransfer({ tile: lamp, componentId: 'c', from: 'laptop', to: 'left', enterEdge: 'up' })).toBeNull();
  });

  it('serialises + parses round-trip', () => {
    const t = validateTransfer({ tile: lamp, componentId: 'lamp-lamp-1', from: 'laptop', to: 'right', enterEdge: 'left' })!;
    const text = serializeTransfer(t)!;
    expect(text.length).toBeLessThanOrEqual(TRANSFER_JSON_MAX);
    const back = parseTransfer(text);
    expect(back).toEqual(t);
  });

  it('parseTransfer rejects oversized or junk text', () => {
    expect(parseTransfer('x'.repeat(TRANSFER_JSON_MAX + 1))).toBeNull();
    expect(parseTransfer('not json')).toBeNull();
  });

  it('enterEdgeForExit is the opposite edge', () => {
    expect(enterEdgeForExit('left')).toBe('right');
    expect(enterEdgeForExit('right')).toBe('left');
  });
});

describe('tileTransfer apply/remove', () => {
  it('appends a tile to a plan', () => {
    const p = applyTileToPlan(plan([lamp]), music);
    expect(p.tiles).toHaveLength(2);
    expect(findTile(p, 'music-music-1')).not.toBeNull();
  });

  it('is idempotent for an exact duplicate device tile', () => {
    const p1 = applyTileToPlan(plan([lamp]), lamp);
    expect(p1.tiles).toHaveLength(1);
  });

  it('removes a top-level tile by component id', () => {
    const p = removeTileFromPlan(plan([lamp, music]), tileComponentId(lamp, [0]));
    expect(p.tiles).toHaveLength(1);
    expect(findTile(p, 'lamp-lamp-1')).toBeNull();
  });

  it('does not mutate the input plan', () => {
    const input = plan([lamp]);
    applyTileToPlan(input, music);
    expect(input.tiles).toHaveLength(1);
  });

  it('remove is a no-op when nothing matches', () => {
    const input = plan([lamp]);
    expect(removeTileFromPlan(input, 'nope')).toBe(input);
  });
});
