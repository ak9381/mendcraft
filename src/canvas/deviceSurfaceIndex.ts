// Tracks which live surfaces have a tile bound to a given deviceId, so a
// device's data-model patch can fan out only to surfaces that show it,
// instead of every live surface.
import type { SurfacePlan } from './surfacePlan';

export interface DeviceSurfaceIndex {
  /** Record (replacing any prior entry) the device tiles a surface's plan shows. */
  track(surfaceId: string, plan: SurfacePlan): void;
  /** Drop all associations for a surface, e.g. when it's removed. */
  untrack(surfaceId: string): void;
  /** Surface ids currently showing deviceId, or undefined if none are tracked. */
  targetsFor(deviceId: string): Set<string> | undefined;
}

export function createDeviceSurfaceIndex(): DeviceSurfaceIndex {
  const byDevice = new Map<string, Set<string>>();

  function untrack(surfaceId: string): void {
    for (const [deviceId, set] of byDevice) {
      set.delete(surfaceId);
      if (set.size === 0) byDevice.delete(deviceId);
    }
  }

  return {
    untrack,
    track(surfaceId, plan) {
      untrack(surfaceId);
      for (const t of plan.tiles) {
        if (!('deviceId' in t)) continue;
        let set = byDevice.get(t.deviceId);
        if (!set) { set = new Set(); byDevice.set(t.deviceId, set); }
        set.add(surfaceId);
      }
    },
    targetsFor(deviceId) {
      return byDevice.get(deviceId);
    },
  };
}
