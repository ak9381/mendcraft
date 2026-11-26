// Hands on the plan's 3D view (no DOM; planHandSurface.ts gives it a face).
// See docs/plan/2026-11-26-plan-hands-design.md, "3D view by hand".
//
//  - held fist + move  = orbit: sideways turns the model (yaw), up / down
//    tilts it (pitch, clamped by the 3D view so it never goes under the floor
//    or flips over the top); the 3D view eases towards the hand, so a jittery
//    camera hand still turns smoothly;
//  - two fists         = closer / farther (their spread, like the 2D zoom);
//  - peace and move    = ZOOM: up = closer, down = farther (one doubling per
//    PEACE_PX_PER_DOUBLING px). Tilt is already the fist's up / down, so the
//    peace does the one thing a single fist cannot;
//  - opening the hand stops (the last bit of easing finishes); a lost hand or
//    looking away stops AT ONCE (the pending easing is dropped).

export interface Orbit3dView {
  is3D?(): boolean;
  /** Turn by a screen-px delta (the hand moved this much). */
  orbit3D?(dx: number, dy: number): void;
  /** Turn by angles (radians): yaw about up, pitch (elevation). */
  turn3D?(dYaw: number, dPitch: number): void;
  /** Drop any easing still pending: the view stops where it is. */
  orbitStop3D?(): void;
  /** factor > 1 = closer. */
  dolly3D?(factor: number): void;
}

export const PEACE_PX_PER_DOUBLING = 240;
/** One press of the 3D buttons. */
export const TURN_STEP = Math.PI / 6; // 30°
export const TILT_STEP = Math.PI / 12; // 15°
export const DOLLY_STEP = 1.25;

type P = { x: number; y: number };

export interface Plan3dHands {
  /** A fist orbit, a two-fist zoom or a peace zoom is running. */
  busy(): boolean;
  orbiting(): boolean;
  fistStart(x: number, y: number): boolean;
  fistMove(x: number, y: number): void;
  /** The hand opened: stop (easing finishes). */
  fistEnd(): void;
  /** Hand lost / looked away / a second fist: stop at once. */
  fistCancel(): void;
  zoom2(phase: 'start' | 'move' | 'end', a: P, b: P): void;
  peaceBegin(): boolean;
  /** Total travel since the peace started (px). */
  peaceTravel(dx: number, dy: number): void;
  peaceEnd(): void;
  peaceCancel(): void;
  /** The 3D buttons. */
  step(what: 'left' | 'right' | 'up' | 'down' | 'closer' | 'farther'): void;
}

export function createPlan3dHands(view: Orbit3dView): Plan3dHands {
  let orbit: P | null = null;
  let two: number | null = null;
  let peace: number | null = null; // the zoom factor applied so far
  const on = () => !!view.is3D?.();
  const turn = (yaw: number, pitch: number) => {
    if (view.turn3D) view.turn3D(yaw, pitch);
  };
  return {
    busy: () => !!orbit || two !== null || peace !== null,
    orbiting: () => !!orbit,
    fistStart(x, y) {
      if (!on()) return false;
      orbit = { x, y };
      return true;
    },
    fistMove(x, y) {
      if (!orbit) return;
      const dx = x - orbit.x, dy = y - orbit.y;
      orbit = { x, y };
      if (dx || dy) view.orbit3D?.(dx, dy);
    },
    fistEnd() { orbit = null; },
    fistCancel() { orbit = null; view.orbitStop3D?.(); },
    zoom2(phase, a, b) {
      if (phase === 'end') { two = null; return; }
      const span = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      if (phase === 'start' || two === null) {
        if (orbit) { orbit = null; view.orbitStop3D?.(); }
        two = span;
        return;
      }
      view.dolly3D?.(span / two);
      two = span;
    },
    peaceBegin() {
      if (!on() || orbit) return false;
      peace = 1;
      return true;
    },
    peaceTravel(_dx, dy) {
      if (peace === null) return;
      const want = Math.pow(2, -dy / PEACE_PX_PER_DOUBLING); // up (dy < 0) = closer
      view.dolly3D?.(want / peace);
      peace = want;
    },
    peaceEnd() { peace = null; },
    peaceCancel() { peace = null; },
    step(what) {
      if (!on()) return;
      if (what === 'closer') view.dolly3D?.(DOLLY_STEP);
      else if (what === 'farther') view.dolly3D?.(1 / DOLLY_STEP);
      else if (what === 'left') turn(TURN_STEP, 0);
      else if (what === 'right') turn(-TURN_STEP, 0);
      else if (what === 'up') turn(0, TILT_STEP);
      else turn(0, -TILT_STEP);
    },
  };
}
