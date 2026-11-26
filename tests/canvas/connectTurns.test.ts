import { describe, expect, it } from 'vitest';
import {
  roomScan,
  byName,
  mergeTiles,
  connectAsk,
  foundAfterScan,
} from '../../src/canvas/connectTurns';
import { coerceSurfacePlan, MAX_TILES, type SurfacePlan, type TileSpec } from '../../src/canvas/surfacePlan';

describe('connectTurns', () => {
  // (describe 'pointConnect' tested the stripped scripted point turn;
  //  pointConnectFromIdentity is covered in pointConnect.test.ts.)
  describe('roomScan', () => {
    it('proposes one tile per found device with 5 photos receipt', () => {
      const found = [
        { id: 'wiz-bulb-1', label: 'Ceiling Bulb', kind: 'smart-bulb' },
        { id: 'sonos-one', label: 'Living Room Speaker', kind: 'speaker' },
        { id: 'smart-plug', label: 'AC Plug', kind: 'plug' },
      ];
      const turn = roomScan(found);
      expect(turn.sent.engine).toBe('gemini');
      expect(turn.sent.sent).toBe('5 photos of the room');
      expect(turn.plan.tiles).toHaveLength(3);

      const coerced = coerceSurfacePlan(JSON.parse(turn.json));
      expect(coerced.ok).toBe(true);
      if (coerced.ok) {
        expect(coerced.value.tiles).toHaveLength(3);
        expect(coerced.value.tiles[0].type).toBe('lamp');
        expect(coerced.value.tiles[1].type).toBe('music');
        expect(coerced.value.tiles[2].type).toBe('switch');
      }
    });

    it('with no found devices, a scan proposes nothing — never a made-up lamp and speaker', () => {
      const turn = roomScan([], { sim: true, frameTitle: 'Living room' });
      expect(turn.plan.tiles).toEqual([]);
    });

    it('foundAfterScan returns the photo IDs, else nothing', () => {
      expect(foundAfterScan(undefined)).toEqual([]);
      expect(foundAfterScan([])).toEqual([]);
      const photos = [{ id: 'lamp-x', label: 'Lamp', kind: 'lamp' }];
      expect(foundAfterScan(photos)).toEqual(photos);
    });

    it('caps proposed tiles to MAX_TILES (6)', () => {
      const manyDevices = Array.from({ length: 10 }, (_, i) => ({
        id: `device-${i}`,
        label: `Device ${i}`,
        kind: 'lamp',
      }));
      const turn = roomScan(manyDevices);
      expect(turn.plan.tiles.length).toBeLessThanOrEqual(MAX_TILES);
      expect(turn.plan.tiles).toHaveLength(MAX_TILES);

      const coerced = coerceSurfacePlan(JSON.parse(turn.json));
      expect(coerced.ok).toBe(true);
    });
  });

  describe('byName', () => {
    it('proposes a tile using identify.ts identityFromWords, Nano-only with null receipt', () => {
      const turn = byName('add the lamp');
      expect(turn).not.toBeNull();
      if (turn) {
        expect(turn.sent.engine).toBe('nano');
        expect(turn.sent.sent).toBeNull();
        expect(turn.sent.routeLine).toContain('Nano · on device');
        expect(turn.plan.tiles).toHaveLength(1);
        expect(turn.plan.tiles[0].type).toBe('lamp');

        const coerced = coerceSurfacePlan(JSON.parse(turn.json));
        expect(coerced.ok).toBe(true);
      }
    });

    it('identifies speaker from utterance and creates music tile', () => {
      const turn = byName('connect the speaker please');
      expect(turn).not.toBeNull();
      if (turn) {
        expect(turn.sent.engine).toBe('nano');
        expect(turn.sent.sent).toBeNull();
        expect(turn.plan.tiles[0].type).toBe('music');
      }
    });

    it('returns null for unrecognised utterance without device words', () => {
      const turn = byName('hello world');
      expect(turn).toBeNull();
    });
  });

  describe('mergeTiles', () => {
    it('merges new tiles without duplicates', () => {
      const basePlan: SurfacePlan = {
        kind: 'room',
        title: 'Living room',
        tiles: [
          { type: 'lamp', deviceId: 'lamp-a', label: 'Desk lamp' },
        ],
      };

      const newTiles: TileSpec[] = [
        { type: 'lamp', deviceId: 'lamp-a', label: 'Duplicate lamp' },
        { type: 'music', deviceId: 'speaker-a', label: 'Living room speaker' },
      ];

      const merged = mergeTiles(basePlan, newTiles);
      expect(merged.tiles).toHaveLength(2);
      expect(merged.tiles[0]).toEqual({ type: 'lamp', deviceId: 'lamp-a', label: 'Desk lamp' });
      expect(merged.tiles[1]).toEqual({ type: 'music', deviceId: 'speaker-a', label: 'Living room speaker' });
    });

    it('does not exceed MAX_TILES (6)', () => {
      const basePlan: SurfacePlan = {
        kind: 'room',
        title: 'Full Room',
        tiles: Array.from({ length: 5 }, (_, i) => ({
          type: 'lamp',
          deviceId: `lamp-${i}`,
          label: `Lamp ${i}`,
        })),
      };

      const newTiles: TileSpec[] = [
        { type: 'music', deviceId: 'spk-1', label: 'Speaker 1' },
        { type: 'music', deviceId: 'spk-2', label: 'Speaker 2' },
        { type: 'music', deviceId: 'spk-3', label: 'Speaker 3' },
      ];

      const merged = mergeTiles(basePlan, newTiles);
      expect(merged.tiles).toHaveLength(MAX_TILES);
      expect(merged.tiles.map((t) => (t as { deviceId?: string }).deviceId)).toEqual([
        'lamp-0',
        'lamp-1',
        'lamp-2',
        'lamp-3',
        'lamp-4',
        'spk-1',
      ]);
    });

    it('does not mutate original plan', () => {
      const basePlan: SurfacePlan = {
        kind: 'room',
        title: 'Original Room',
        tiles: [{ type: 'lamp', deviceId: 'lamp-orig', label: 'Orig' }],
      };

      const merged = mergeTiles(basePlan, [{ type: 'music', deviceId: 'spk-orig', label: 'Spk' }]);
      expect(basePlan.tiles).toHaveLength(1);
      expect(merged.tiles).toHaveLength(2);
      expect(merged).not.toBe(basePlan);
    });
  });

  describe('byName with known devices', () => {
    it('reuses a known device whose label is named, instead of minting a new id', () => {
      const turn = byName('connect the speaker', {
        devices: [{ id: 'speaker-a', label: 'Speaker', kind: 'music' }],
      });
      expect(turn).not.toBeNull();
      expect(turn!.plan.tiles[0]).toEqual({ type: 'music', deviceId: 'speaker-a', label: 'Speaker' });
    });

    it('still mints a fresh tile when no known device matches', () => {
      const turn = byName('connect the fan', {
        devices: [{ id: 'speaker-a', label: 'Speaker', kind: 'music' }],
      });
      expect(turn).not.toBeNull();
      expect(turn!.plan.tiles[0].type).toBe('switch');
    });
  });

  describe('connectAsk', () => {
    it('a generic device ask opens the sheet', () => {
      expect(connectAsk('connect a device')).toBe('sheet');
      expect(connectAsk('add device')).toBe('sheet');
      expect(connectAsk('add a device')).toBe('sheet');
    });

    it('a named device goes to the by-name Nano turn', () => {
      expect(connectAsk('connect the speaker')).toBe('byName');
      expect(connectAsk('connect the fan')).toBe('byName');
      expect(connectAsk('add the lamp')).toBe('byName');
    });

    it('leaves room-connect and device commands alone', () => {
      expect(connectAsk('connect everything in this room')).toBeNull();
      expect(connectAsk('turn off the main light')).toBeNull();
      expect(connectAsk('show everything')).toBeNull();
      expect(connectAsk('')).toBeNull();
    });
  });
});
