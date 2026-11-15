// GESTURE → COMMAND RESOLUTION (pure, DOM-free).
//
// Given a recognised gesture id, where she is (studio vs devices), whether rest
// mode is on, and her setup bindings, decide which button/command runs. Her
// own bindings win over the defaults; devices-scope gestures only act while the
// devices surface (lamp panel) is open; rest mode swallows everything except
// wake (wave) and the rest toggle (both palms).

import { catalogGesture } from './gestureCatalog';
import type { ButtonBinding } from '../setup/setupState';

export type GestureContext = 'studio' | 'devices';

export interface DispatchState {
  context: GestureContext;
  resting: boolean;
  bindings: readonly ButtonBinding[];
}

export type DispatchResult =
  | { kind: 'run'; target: string; gesture: string; source: 'custom' | 'default' }
  | { kind: 'ignored'; reason: 'resting' | 'scope' | 'unbound' | 'unwired' };

/** Two-finger swipe sideways means "skip track" only in devices scope. */
export function resolveGesture(gesture: string, st: DispatchState): DispatchResult {
  if (st.resting && gesture !== 'wave' && gesture !== 'both-palms') return { kind: 'ignored', reason: 'resting' };
  if (!st.resting && gesture === 'wave') return { kind: 'ignored', reason: 'unbound' }; // wave only wakes
  const custom = st.bindings.find((b) => b.gesture === gesture);
  if (custom) return { kind: 'run', target: custom.target, gesture, source: 'custom' };
  const g = catalogGesture(gesture);
  if (!g || !g.target) return { kind: 'ignored', reason: 'unbound' };
  if (g.scope === 'devices' && st.context !== 'devices') return { kind: 'ignored', reason: 'scope' };
  if (!g.wired) return { kind: 'ignored', reason: 'unwired' };
  // A default gesture whose target she re-bound to a different gesture stops
  // driving it (so "replace" really replaces).
  if (st.bindings.some((b) => b.target === g.target && b.gesture && b.gesture !== gesture)) {
    return { kind: 'ignored', reason: 'unbound' };
  }
  return { kind: 'run', target: g.target, gesture, source: 'default' };
}

/** The gesture shown on a button: her binding if any, else the default. */
export function gestureForTarget(target: string, bindings: readonly ButtonBinding[], defaults: (t: string) => string | undefined): string | undefined {
  const b = bindings.find((x) => x.target === target && x.gesture);
  return b?.gesture ?? defaults(target);
}

/** Rest-mode transitions. */
export function nextRestState(resting: boolean, target: string): boolean {
  if (target === 'rest-toggle') return !resting;
  if (target === 'wake') return false;
  return resting;
}
