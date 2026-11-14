// Lamp + music recipe interpreter (pure). A 'lamp' or 'music' recipe stores the
// same { op: {...} } steps as everything else, but the ops name lamp/music verbs
// instead of editor ops. This module turns a validated step into a concrete
// LampIntent (for lampControl) or PlayerAction(s) (for musicController), so the
// SAME recipe runs from Chrome or from the iPad /control card. Nothing here
// sends to a network service, so no confirm gate is needed; every value is
// clamped to the device's own limits before it is emitted.

import type { RecipeStep } from './model';
import { clampDim, clampTemp, clampByte, type LampIntent, type Rgb } from '../devices/wiz';
import type { PlayerAction, Track } from '../music/player';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

// Named colour temperatures so "lamp warm" is readable in the recipe JSON.
export const TEMP_PRESETS: Record<string, number> = { warm: 2700, neutral: 4000, cool: 6500 };

/** Interpret one lamp op into a clamped LampIntent, or return an error string. */
export function interpretLampStep(op: Record<string, unknown>): LampIntent | string {
  switch (op.op) {
    case 'lamp_power':
      return { kind: 'power', on: op.on !== false };
    case 'lamp_dim': {
      const d = num(op.dimming);
      if (d === undefined) return 'lamp_dim needs a dimming number';
      return { kind: 'dim', dimming: clampDim(d) };
    }
    case 'lamp_temp': {
      const preset = typeof op.preset === 'string' ? TEMP_PRESETS[op.preset.toLowerCase()] : undefined;
      const t = num(op.temp) ?? preset;
      if (t === undefined) return 'lamp_temp needs a temp (K) or preset warm|neutral|cool';
      return { kind: 'temp', temp: clampTemp(t) };
    }
    case 'lamp_color': {
      const rgb = isObj(op.rgb) ? op.rgb : op;
      const r = num(rgb.r);
      const g = num(rgb.g);
      const b = num(rgb.b);
      if (r === undefined || g === undefined || b === undefined) return 'lamp_color needs r,g,b';
      const clamped: Rgb = { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
      return { kind: 'color', rgb: clamped };
    }
    default:
      return `unknown lamp step "${String(op.op)}"`;
  }
}

/** Case-insensitive substring match of a track title/artist; -1 if none. */
export function resolveTrackIndex(tracks: readonly Track[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  return tracks.findIndex((t) =>
    t.title.toLowerCase().includes(q) || (t.artist ?? '').toLowerCase().includes(q));
}

/** Interpret one music op into zero or more PlayerActions, or an error string.
 *  A play-with-query resolves the query to a track index against `tracks`. */
export function interpretMusicStep(op: Record<string, unknown>, tracks: readonly Track[] = []): PlayerAction[] | string {
  switch (op.op) {
    case 'music_play': {
      const query = typeof op.query === 'string' ? op.query : '';
      if (query) {
        const idx = resolveTrackIndex(tracks, query);
        if (idx >= 0) return [{ type: 'select', index: idx }, { type: 'play' }];
        // No match yet (tracks may load later) — still start playback.
      }
      return [{ type: 'play' }];
    }
    case 'music_pause':
      return [{ type: 'pause' }];
    case 'music_next':
      return [{ type: 'next' }];
    case 'music_prev':
      return [{ type: 'prev' }];
    case 'music_volume': {
      const v = num(op.volume);
      if (v === undefined) return 'music_volume needs a 0..1 volume';
      return [{ type: 'setVolume', volume: Math.min(1, Math.max(0, v)) }];
    }
    default:
      return `unknown music step "${String(op.op)}"`;
  }
}

export type DeviceAction =
  | { device: 'lamp'; intent: LampIntent }
  | { device: 'music'; action: PlayerAction };

export type DevicePlan =
  | { ok: true; actions: DeviceAction[] }
  | { ok: false; error: string };

/** Turn a whole lamp/music recipe into an ordered list of device actions. */
export function buildDeviceActions(
  device: 'lamp' | 'music',
  steps: readonly RecipeStep[],
  tracks: readonly Track[] = [],
): DevicePlan {
  if (steps.length === 0) return { ok: false, error: 'recipe has no steps' };
  const actions: DeviceAction[] = [];
  for (let i = 0; i < steps.length; i++) {
    const op = steps[i].op;
    if (device === 'lamp') {
      const intent = interpretLampStep(op);
      if (typeof intent === 'string') return { ok: false, error: `step ${i + 1}: ${intent}` };
      actions.push({ device: 'lamp', intent });
    } else {
      const acts = interpretMusicStep(op, tracks);
      if (typeof acts === 'string') return { ok: false, error: `step ${i + 1}: ${acts}` };
      for (const action of acts) actions.push({ device: 'music', action });
    }
  }
  return { ok: true, actions };
}
