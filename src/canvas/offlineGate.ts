// "Simulate offline" (and a real lost network) must stop every cloud call,
// not only the build and Kannada turns (final review sim-1 A2). Chat may still
// run on this device (Nano); morph and the self-check fix need Gemini, so they
// say so and send nothing.
import type { EngineId, SurfaceEngine } from './aiTurn';

export const OFFLINE_CHAT_LINE = 'Offline — chat runs on this device only, and the on-device model isn’t here. Nothing was sent.';
export const OFFLINE_CHAT_FAIL_LINE = 'Offline — the on-device model didn’t answer, and nothing goes to the cloud while offline.';
export const OFFLINE_MORPH_LINE = 'Offline — changing a tile needs Gemini. Nothing was sent; try again when you’re back online.';
export const OFFLINE_POINT_LINE = 'Offline — naming what you point at can send the photo to Gemini, so nothing was sent. Try again online, or name the device.';
export const OFFLINE_FIX_LINE = 'offline — the fix needs Gemini, so nothing was sent';

/** Thrown by an engine that stands in for the cloud while offline. */
export class OfflineError extends Error {
  constructor(message = OFFLINE_FIX_LINE) { super(message); this.name = 'OfflineError'; }
}

/** An engine that never sends: every call fails at once with OfflineError. */
export function offlineEngine(id: EngineId): SurfaceEngine {
  return { id, sim: false, stream: () => Promise.reject(new OfflineError()) };
}

/** True when this engine runs on this device (Chrome Nano, an on-device
 *  plugin, or the ?sim=1 script) — never the cloud. */
export function onDevice(engine: SurfaceEngine): boolean {
  return engine.id === 'nano' || engine.sim;
}

/** The engines a chat turn may use. Online: as given. Offline: the on-device
 *  Nano only, with the cloud replaced by an engine that never sends (its
 *  handoff is dropped too); null when no on-device model is here at all. */
export function chatEngines(online: boolean, nano: SurfaceEngine, gemini: SurfaceEngine): { nano: SurfaceEngine; gemini: SurfaceEngine } | null {
  if (online) return { nano, gemini };
  if (!onDevice(nano)) return null;
  const fallback = nano.fallback && onDevice(nano.fallback) ? nano.fallback : undefined;
  return { nano: { ...nano, handoff: undefined, fallback }, gemini: offlineEngine('gemini') };
}
