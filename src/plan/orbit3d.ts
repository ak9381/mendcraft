// Pure (three.js-free) spherical-orbit math for driving the 3D extrude view's
// camera by hand (B-160 orbit, B-161 dolly/zoom). The camera offset is the
// vector (camera.position − orbit target); orbiting rotates it around the
// up-axis (+z, matching extrude3d's camera.up) and in elevation; dollying
// scales its length. Kept pure so it unit-tests with plain vectors — extrude3d
// applies the result to the real THREE camera and calls controls.update().

export interface Vec3 { x: number; y: number; z: number }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface Spherical { r: number; theta: number; phi: number }

/** Offset → spherical about +z up. theta = azimuth in the xy-plane, phi =
 *  elevation from the xy-plane (+z is +phi). */
function toSpherical(v: Vec3): Spherical {
  const r = Math.hypot(v.x, v.y, v.z);
  if (r < 1e-9) return { r: 0, theta: 0, phi: 0 };
  return { r, theta: Math.atan2(v.y, v.x), phi: Math.asin(clamp(v.z / r, -1, 1)) };
}

function fromSpherical(s: Spherical): Vec3 {
  const h = s.r * Math.cos(s.phi);
  return { x: h * Math.cos(s.theta), y: h * Math.sin(s.theta), z: s.r * Math.sin(s.phi) };
}

/** Rotate the camera offset by `dAz` radians around up (+z) and `dPolar`
 *  radians in elevation, clamping elevation so the view never flips over the
 *  pole. */
export function orbitOffset(
  offset: Vec3,
  dAz: number,
  dPolar: number,
  minPhi = -1.45,
  maxPhi = 1.45,
): Vec3 {
  const s = toSpherical(offset);
  if (s.r < 1e-9) return { ...offset };
  s.theta += dAz;
  s.phi = clamp(s.phi + dPolar, minPhi, maxPhi);
  return fromSpherical(s);
}

/** Scale the camera distance by 1/factor (factor > 1 ⇒ zoom in, closer),
 *  clamped to [minR, maxR]. Direction is preserved. */
export function dollyOffset(offset: Vec3, factor: number, minR: number, maxR: number): Vec3 {
  const s = toSpherical(offset);
  if (s.r < 1e-9) return { ...offset };
  s.r = clamp(s.r / Math.max(factor, 1e-6), minR, maxR);
  return fromSpherical(s);
}

/** Elevation limits for the plan's 3D view (radians above the floor plane):
 *  never under the floor, never flipped over the top. The mouse
 *  (OrbitControls) uses the same limits. */
export const ELEVATION = { min: 0.08, max: 1.45 } as const;

export interface TurnDelta { yaw: number; pitch: number }

/** One frame of easing towards a pending turn: take `k` of what is left. A
 *  remainder under `eps` is taken whole, so the turn always ends. */
export function easeTurn(pending: TurnDelta, k = 0.35, eps = 1e-4): { step: TurnDelta; rest: TurnDelta } {
  if (Math.abs(pending.yaw) < eps && Math.abs(pending.pitch) < eps) return { step: { ...pending }, rest: { yaw: 0, pitch: 0 } };
  const step = { yaw: pending.yaw * k, pitch: pending.pitch * k };
  return { step, rest: { yaw: pending.yaw - step.yaw, pitch: pending.pitch - step.pitch } };
}
