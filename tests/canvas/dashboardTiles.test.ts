import { describe, expect, it, vi } from 'vitest';
import { Catalog, MessageProcessor } from '@a2ui/web_core/v0_9';
import {
  coerceSurfacePlan,
  expandPlan,
  ROOM_CATALOG_ID,
  type A2uiMessage,
} from '../../src/canvas/surfacePlan';
import {
  CATALOG_SCHEMAS,
  ConnectTileApi,
  MusicTileApi,
  SceneTileApi,
  SwitchTileApi,
} from '../../src/canvas/catalogApi';
import { gateMessages } from '../../src/canvas/gate';
import { createDeviceStore } from '../../src/canvas/deviceActions';

describe('Part 1: Dashboard tiles in A2UI catalog', () => {
  describe('Zod APIs and CATALOG_SCHEMAS', () => {
    it('has strict schemas for MusicTile, SwitchTile, SceneTile, ConnectTile', () => {
      expect(CATALOG_SCHEMAS.MusicTile).toBeDefined();
      expect(CATALOG_SCHEMAS.SwitchTile).toBeDefined();
      expect(CATALOG_SCHEMAS.SceneTile).toBeDefined();
      expect(CATALOG_SCHEMAS.ConnectTile).toBeDefined();

      // MusicTile valid & rejects extra props
      const validMusic = {
        label: 'Stereo',
        playing: true,
        trackTitle: 'Ambient Wave',
        volume: 65,
        onPlayPause: { event: { name: 'music.playPause' } },
        onNext: { event: { name: 'music.next' } },
        onLouder: { event: { name: 'music.louder' } },
        onSofter: { event: { name: 'music.softer' } },
      };
      expect(MusicTileApi.schema.safeParse(validMusic).success).toBe(true);
      expect(MusicTileApi.schema.safeParse({ ...validMusic, extraProp: 123 }).success).toBe(false);

      // SwitchTile valid & rejects extra props
      const validSwitch = {
        label: 'Fan',
        on: false,
        onToggle: { event: { name: 'switch.toggle' } },
      };
      expect(SwitchTileApi.schema.safeParse(validSwitch).success).toBe(true);
      expect(SwitchTileApi.schema.safeParse({ ...validSwitch, hack: true }).success).toBe(false);

      // SceneTile valid & rejects extra props
      const validScene = {
        label: 'Night mode',
        active: true,
        onActivate: { event: { name: 'scene.activate' } },
      };
      expect(SceneTileApi.schema.safeParse(validScene).success).toBe(true);
      expect(SceneTileApi.schema.safeParse({ ...validScene, bogus: 'x' }).success).toBe(false);

      // ConnectTile valid & rejects extra props
      const validConnect = {
        label: 'Connect a device',
        onConnect: { event: { name: 'connect.start' } },
      };
      expect(ConnectTileApi.schema.safeParse(validConnect).success).toBe(true);
      expect(ConnectTileApi.schema.safeParse({ ...validConnect, unknown: true }).success).toBe(false);
    });
  });

  describe('coerceSurfacePlan validation', () => {
    it('coerces music, switch, scene, connect tiles', () => {
      const planDraft = {
        kind: 'room',
        title: 'Living Room',
        tiles: [
          { type: 'music', deviceId: 'speaker-1', label: 'Living Speaker' },
          { type: 'switch', deviceId: 'fan-1', label: 'Ceiling Fan' },
          { type: 'scene', sceneId: 'movie-night', label: 'Movie Time' },
          { type: 'connect' },
        ],
      };
      const res = coerceSurfacePlan(planDraft);
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error();
      expect(res.value.tiles).toHaveLength(4);
      expect(res.value.tiles[0]).toEqual({ type: 'music', deviceId: 'speaker-1', label: 'Living Speaker' });
      expect(res.value.tiles[1]).toEqual({ type: 'switch', deviceId: 'fan-1', label: 'Ceiling Fan' });
      expect(res.value.tiles[2]).toEqual({ type: 'scene', sceneId: 'movie-night', label: 'Movie Time' });
      expect(res.value.tiles[3]).toEqual({ type: 'connect', label: 'Connect a device' });
    });

    it('rejects invalid deviceIds or sceneIds', () => {
      expect(coerceSurfacePlan({ kind: 'room', title: 'R', tiles: [{ type: 'music', deviceId: '../bad' }] }).ok).toBe(false);
      expect(coerceSurfacePlan({ kind: 'room', title: 'R', tiles: [{ type: 'switch', deviceId: '' }] }).ok).toBe(false);
      expect(coerceSurfacePlan({ kind: 'room', title: 'R', tiles: [{ type: 'scene', sceneId: '123!!!' }] }).ok).toBe(false);
    });
  });

  describe('expandPlan & gateMessages', () => {
    it('expands all new tile types with expected data-model bindings and action events', () => {
      const coerced = coerceSurfacePlan({
        kind: 'room',
        title: 'Media Room',
        tiles: [
          { type: 'music', deviceId: 'spk-1', label: 'Sonos' },
          { type: 'switch', deviceId: 'sw-1', label: 'Main Switch' },
          { type: 'scene', sceneId: 'sc-1', label: 'Focus' },
          { type: 'connect' },
        ],
      });
      if (!coerced.ok) throw new Error();

      const devices = {
        'spk-1': { playing: true, trackTitle: 'Lo-Fi Chill', volume: 45, on: false, brightness: 0 },
        'sw-1': { on: true, brightness: 0 },
      };

      const msgs = expandPlan(coerced.value, 'surf-1', devices as never);
      expect(msgs).toHaveLength(4); // createSurface, updateComponents, updateDataModel(/devices), updateDataModel(/scenes)

      const updateComponents = msgs.find((m) => 'updateComponents' in m)?.updateComponents as {
        components: Array<{ id: string; component: string; [k: string]: unknown }>;
      };
      expect(updateComponents).toBeDefined();

      const musicComp = updateComponents.components.find((c) => c.component === 'MusicTile');
      expect(musicComp).toMatchObject({
        id: 'music-spk-1',
        component: 'MusicTile',
        label: 'Sonos',
        playing: { path: '/devices/spk-1/playing' },
        trackTitle: { path: '/devices/spk-1/trackTitle' },
        volume: { path: '/devices/spk-1/volume' },
        onPlayPause: { event: { name: 'music.playPause', context: { deviceId: 'spk-1' } } },
        onNext: { event: { name: 'music.next', context: { deviceId: 'spk-1' } } },
        onLouder: { event: { name: 'music.louder', context: { deviceId: 'spk-1' } } },
        onSofter: { event: { name: 'music.softer', context: { deviceId: 'spk-1' } } },
      });

      const switchComp = updateComponents.components.find((c) => c.component === 'SwitchTile');
      expect(switchComp).toMatchObject({
        id: 'switch-sw-1',
        component: 'SwitchTile',
        label: 'Main Switch',
        on: { path: '/devices/sw-1/on' },
        onToggle: { event: { name: 'switch.toggle', context: { deviceId: 'sw-1' } } },
      });

      const sceneComp = updateComponents.components.find((c) => c.component === 'SceneTile');
      expect(sceneComp).toMatchObject({
        id: 'scene-sc-1',
        component: 'SceneTile',
        label: 'Focus',
        active: { path: '/scenes/sc-1/active' },
        onActivate: { event: { name: 'scene.activate', context: { sceneId: 'sc-1' } } },
      });

      const connectComp = updateComponents.components.find((c) => c.component === 'ConnectTile');
      expect(connectComp).toMatchObject({
        id: 'connect-tile',
        component: 'ConnectTile',
        onConnect: { event: { name: 'connect.start' } },
      });

      // Gate accepts expanded messages
      const gateResult = gateMessages(msgs, CATALOG_SCHEMAS);
      expect(gateResult.ok).toBe(true);

      // Gate rejects extra props on any of the new tiles
      const badMsg = [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'surf-1',
            components: [
              {
                id: 'bad-music',
                component: 'MusicTile',
                label: 'M',
                playing: false,
                volume: 50,
                onPlayPause: { event: { name: 'music.playPause' } },
                unauthorizedScript: 'eval()',
              },
            ],
          },
        },
      ];
      expect(gateMessages(badMsg, CATALOG_SCHEMAS).ok).toBe(false);
    });
  });

  describe('deviceActions generic store (music & lamps)', () => {
    it('acks music intents and updates state', async () => {
      const emitted: A2uiMessage[] = [];
      const store = createDeviceStore(
        {
          'audio-1': { playing: false, volume: 30, trackTitle: 'Silence', on: false, brightness: 0 },
        },
        {
          run: async (intent) => {
            return {
              playing: intent.playing ?? true,
              volume: intent.volume ?? 30,
              trackTitle: intent.next ? 'Next Song' : 'Silence',
            };
          },
        },
        (m) => emitted.push(m),
        () => 'surf-1',
      );

      const s = await store.act({ deviceId: 'audio-1', playing: true, volume: 40 });
      expect(s.playing).toBe(true);
      expect(s.volume).toBe(40);
      expect(s.pending).toBe(false);
      expect(s.error).toBe('');
      expect(emitted.length).toBeGreaterThanOrEqual(2);
    });

    it('rolls back and emits error on music intent failure / timeout', async () => {
      vi.useFakeTimers();
      const store = createDeviceStore(
        {
          'audio-1': { playing: false, volume: 30, on: false, brightness: 0 },
        },
        {
          run: () => new Promise(() => {}), // never resolves
        },
        () => {},
        () => 'surf-1',
        100,
      );

      const actPromise = store.act({ deviceId: 'audio-1', playing: true });
      await vi.advanceTimersByTimeAsync(150);
      const res = await actPromise;
      vi.useRealTimers();

      expect(res.playing).toBe(false);
      expect(res.pending).toBe(false);
      expect(res.error).toMatch(/reach the music player/i);
    });
  });
});
