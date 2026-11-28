// Synthetic hand landmarks for each fixed shape — the unit fixtures for the
// shape classifier and the hold engine, and what the ?sim=1 hook feeds to fire
// a gesture without a camera. Built from a simple kinematic hand (palm facing
// the camera, fingers up) in SELFIE space: a right hand sits right of centre
// with its thumb toward the middle of the frame; a left hand is its mirror.

import type { Pt } from '../input/handLogic';
import type { HandShape, HandSide } from './handShape';

type P3 = Pt & { z?: number };

export interface SyntheticHandOptions {
  /** Wrist position (selfie space, 0..1). Default: 0.68 / 0.32 by side, y 0.7. */
  at?: Pt;
  /** Overall size multiplier (1 ≈ a hand 0.2 tall). */
  size?: number;
  /** Add plausible z (so the 3D finger-bend path runs). */
  depth?: boolean;
  /** MediaPipe label to stamp on the array ('Left' / 'Right'); default = side. */
  label?: 'Left' | 'Right' | null;
}

// Local frame: wrist at 0,0, fingers toward −y, thumb toward −x (a right
// hand in selfie space). Units ≈ normalised image (hand ≈ 0.2 tall).
const MCP: Pt[] = [{ x: -0.04, y: -0.09 }, { x: -0.013, y: -0.1 }, { x: 0.013, y: -0.095 }, { x: 0.035, y: -0.085 }];
const LEN = [[0.04, 0.025, 0.022], [0.045, 0.028, 0.024], [0.042, 0.026, 0.022], [0.032, 0.02, 0.018]];

function finger(i: number, mode: 'ext' | 'curl' | 'camera', depth: boolean): P3[] {
  const m = MCP[i];
  const [a, b, c] = LEN[i];
  if (mode === 'ext') {
    return [
      { x: m.x, y: m.y - a, z: depth ? -0.005 : undefined },
      { x: m.x, y: m.y - a - b, z: depth ? -0.008 : undefined },
      { x: m.x, y: m.y - a - b - c, z: depth ? -0.01 : undefined },
    ];
  }
  if (mode === 'camera') {
    // Pointing at the camera: straight in 3D, short on screen.
    return [
      { x: m.x, y: m.y - 0.01, z: -0.04 },
      { x: m.x, y: m.y - 0.016, z: -0.065 },
      { x: m.x, y: m.y - 0.02, z: -0.085 },
    ];
  }
  // Curled: up a little, folded back down toward the palm (and toward the camera).
  return [
    { x: m.x, y: m.y - 0.022, z: depth ? -0.03 : undefined },
    { x: m.x, y: m.y - 0.004, z: depth ? -0.045 : undefined },
    { x: m.x, y: m.y + 0.012, z: depth ? -0.03 : undefined },
  ];
}

type ThumbMode = 'tucked' | 'side' | 'along';
function thumb(mode: ThumbMode, depth: boolean): P3[] {
  const z = (v: number) => (depth ? v : undefined);
  const cmc = { x: -0.03, y: -0.02, z: z(-0.01) };
  if (mode === 'tucked') return [cmc, { x: -0.05, y: -0.045, z: z(-0.02) }, { x: -0.04, y: -0.07, z: z(-0.035) }, { x: -0.02, y: -0.08, z: z(-0.04) }];
  if (mode === 'side') return [cmc, { x: -0.05, y: -0.045, z: z(-0.015) }, { x: -0.075, y: -0.065, z: z(-0.02) }, { x: -0.095, y: -0.08, z: z(-0.022) }];
  // 'along': straight out past the index knuckle (−x), for thumbs up/down.
  return [cmc, { x: -0.055, y: -0.05, z: z(-0.015) }, { x: -0.085, y: -0.06, z: z(-0.018) }, { x: -0.115, y: -0.066, z: z(-0.02) }];
}

/** Local landmarks for a shape (before rotation / placement). */
function localHand(shape: HandShape | 'relaxed' | 'pointCamera' | 'four', depth: boolean): { pts: P3[]; rotate: number } {
  const modes: Record<string, { f: ('ext' | 'curl' | 'camera')[]; t: ThumbMode; rotate: number }> = {
    open: { f: ['ext', 'ext', 'ext', 'ext'], t: 'side', rotate: 0 },
    // Four fingers up, thumb folded across the palm: the four-finger send.
    four: { f: ['ext', 'ext', 'ext', 'ext'], t: 'tucked', rotate: 0 },
    fist: { f: ['curl', 'curl', 'curl', 'curl'], t: 'tucked', rotate: 0 },
    one: { f: ['ext', 'curl', 'curl', 'curl'], t: 'tucked', rotate: 0 },
    peace: { f: ['ext', 'ext', 'curl', 'curl'], t: 'tucked', rotate: 0 },
    three: { f: ['ext', 'ext', 'ext', 'curl'], t: 'tucked', rotate: 0 },
    // The fist turned on its side so the thumb (along −x) points up / down.
    thumbsUp: { f: ['curl', 'curl', 'curl', 'curl'], t: 'along', rotate: 1 },
    thumbsDown: { f: ['curl', 'curl', 'curl', 'curl'], t: 'along', rotate: -1 },
    pointCamera: { f: ['camera', 'curl', 'curl', 'curl'], t: 'tucked', rotate: 0 },
    other: { f: ['ext', 'curl', 'ext', 'curl'], t: 'tucked', rotate: 0 },
  };
  if (shape === 'relaxed') {
    // A resting hand: every finger loosely bent (between curled and extended).
    const pts: P3[] = [{ x: 0, y: 0, z: depth ? 0 : undefined }, ...thumb('side', depth)];
    for (let i = 0; i < 4; i++) {
      const m = MCP[i];
      const [a, b, c] = LEN[i];
      pts.push({ x: m.x, ...MCP_Z(depth), y: m.y }, { x: m.x, y: m.y - a * 0.9, z: depth ? -0.02 : undefined },
        { x: m.x, y: m.y - a * 0.9 - b * 0.4, z: depth ? -0.035 : undefined }, { x: m.x, y: m.y - a * 0.9 - b * 0.4 - c * 0.1, z: depth ? -0.045 : undefined });
    }
    return { pts, rotate: 0 };
  }
  const m = modes[shape];
  const pts: P3[] = [{ x: 0, y: 0, z: depth ? 0 : undefined }, ...thumb(m.t, depth)];
  for (let i = 0; i < 4; i++) pts.push({ x: MCP[i].x, y: MCP[i].y, ...MCP_Z(depth) }, ...finger(i, m.f[i], depth || m.f[i] === 'camera'));
  if (shape === 'pointCamera') for (const p of pts) if (p.z === undefined) p.z = 0;
  return { pts, rotate: m.rotate };
}
function MCP_Z(depth: boolean): { z?: number } { return depth ? { z: 0 } : {}; }

/** 21 landmarks (selfie space) for `shape` on the given hand. */
export function syntheticHand(
  shape: HandShape | 'relaxed' | 'pointCamera' | 'four',
  side: HandSide,
  opts: SyntheticHandOptions = {},
): P3[] & { label?: string } {
  const size = opts.size ?? 1;
  const at = opts.at ?? { x: side === 'R' ? 0.68 : 0.32, y: 0.7 };
  const { pts, rotate } = localHand(shape, !!opts.depth);
  const out = pts.map((p) => {
    // rotate +1: (x, y) → (−y, x) maps the thumb (−x) to up (−y); −1 → down.
    let x = p.x, y = p.y;
    if (rotate === 1) { x = -p.y; y = p.x; }
    else if (rotate === -1) { x = p.y; y = -p.x; }
    // Left hand = mirror image of the right one.
    if (side === 'L') x = -x;
    const q: P3 = { x: at.x + x * size, y: at.y + y * size };
    if (p.z !== undefined) q.z = p.z * size;
    return q;
  }) as P3[] & { label?: string };
  const label = opts.label === undefined ? (side === 'R' ? 'Right' : 'Left') : opts.label;
  if (label) out.label = label;
  return out;
}

/** Mirror a hand (x → 1 − x), keeping its label — the selfie flip. */
export function mirrorHand<T extends Pt>(lm: readonly T[]): T[] & { label?: string } {
  const out = lm.map((p) => ({ ...p, x: 1 - p.x })) as T[] & { label?: string };
  const l = (lm as { label?: string }).label;
  if (l) out.label = l;
  return out;
}
