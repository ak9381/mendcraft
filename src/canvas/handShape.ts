// HAND SHAPES for the fixed button gestures (design 26 Nov: thumbs up / down,
// 1 finger, peace, 3 fingers — plus open palm and fist, which are NOT button
// gestures but are reported so callers can tell them apart).
//
// Pure geometry on the 21 MediaPipe landmarks, reusing the finger-curl test
// the hand pointer already trusts (handFeel.fingerStates: 3D PIP bend when z
// is present, the scale-free tip/PIP ratio otherwise), plus thumb direction.
// Everything is rotation/mirror safe: the selfie flip (x → 1 − x) changes no
// shape, only which side of the face the hand sits on.
//
// Which hand (L/R): MediaPipe's handedness label, cross-checked against the
// hand's position relative to the operator's face when one is known — a
// hand clearly on the user's right side of their face is their right hand,
// whatever the label says (labels flip on some cameras / mirrored feeds).

import type { Pt } from '../input/handLogic';
import { HAND_FEEL, fingerStates, handScale, type HandFeelConfig } from './handFeel';

export type HandShape = 'thumbsUp' | 'thumbsDown' | 'one' | 'peace' | 'three' | 'open' | 'fist' | 'other';
export type HandSide = 'L' | 'R';

/** The shapes that can be bound to a button (never open palm or fist). */
export const FIXED_SHAPES: readonly HandShape[] = ['thumbsUp', 'thumbsDown', 'one', 'peace', 'three'];

export interface HandShapeResult {
  shape: HandShape;
  hand: HandSide;
  /** 0..1 — how clearly the shape (and side) was read. 0 for 'other'. */
  confidence: number;
  /** Where the L/R call came from. */
  handFrom: 'face' | 'label' | 'position';
}

type Pt3 = Pt & { z?: number };

export interface ShapeOptions {
  /** Landmarks are in SELFIE space (x' = 1 − camera x, what the user sees as
   *  a mirror) — presence frames are. False for raw camera-space points. */
  mirrored?: boolean;
  /** Camera frame height ÷ width for the 3D finger bend. */
  cameraAspect?: number;
  /** The face's x must differ from the wrist's by at least this many hand
   *  scales before position overrides the label. */
  faceMarginScales?: number;
}

const THUMB_EXTEND_MIN = 0.5; // thumb tip ↔ index MCP, in hand scales
const THUMB_STRAIGHT_MIN_COS = 0.5; // MCP→IP vs IP→TIP (≤ 60° bend)
const THUMB_DIR_MIN = 0.6; // |unit y| of thumb MCP→TIP for up / down
const FINGER_2D_MIN = 0.55; // extended finger's MCP→TIP 2D length, in hand scales

const FINGER_TIPS = [8, 12, 16, 20] as const;
const FINGER_MCPS = [5, 9, 13, 17] as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Thumb: extended (straight and away from the index knuckle) and its
 *  direction (unit vector, image y grows downward). */
export function thumbInfo(lm: readonly Pt[]): { extended: boolean; dirX: number; dirY: number; reach: number } {
  const s = Math.max(1e-6, handScale(lm));
  const mcp = lm[2], ip = lm[3], tip = lm[4];
  const a = { x: ip.x - mcp.x, y: ip.y - mcp.y };
  const b = { x: tip.x - ip.x, y: tip.y - ip.y };
  const na = Math.hypot(a.x, a.y), nb = Math.hypot(b.x, b.y);
  const cos = na && nb ? (a.x * b.x + a.y * b.y) / (na * nb) : 0;
  const reach = dist(tip, lm[5]) / s;
  const d = { x: tip.x - mcp.x, y: tip.y - mcp.y };
  const nd = Math.hypot(d.x, d.y) || 1;
  return { extended: reach >= THUMB_EXTEND_MIN && cos >= THUMB_STRAIGHT_MIN_COS, dirX: d.x / nd, dirY: d.y / nd, reach };
}

/** L/R for one hand. Selfie space: the user's right hand shows on the right
 *  of their face (larger x). Raw camera space is the opposite. */
export function resolveHandSide(
  lm: readonly Pt[],
  label: string | undefined,
  faceX: number | null | undefined,
  opts: Pick<ShapeOptions, 'mirrored' | 'faceMarginScales'> = {},
): { hand: HandSide; from: HandShapeResult['handFrom'] } {
  const mirrored = opts.mirrored ?? true;
  const wristX = lm[0].x;
  const s = Math.max(0.02, handScale(lm));
  if (typeof faceX === 'number' && Number.isFinite(faceX)) {
    const dx = (wristX - faceX) * (mirrored ? 1 : -1); // > 0 = the user's right side
    if (Math.abs(dx) >= s * (opts.faceMarginScales ?? 0.75)) return { hand: dx > 0 ? 'R' : 'L', from: 'face' };
  }
  if (label === 'Left') return { hand: 'L', from: 'label' };
  if (label === 'Right') return { hand: 'R', from: 'label' };
  const sx = (wristX - 0.5) * (mirrored ? 1 : -1);
  return { hand: sx >= 0 ? 'R' : 'L', from: 'position' };
}

/** Classify one hand's shape. `handedness` is MediaPipe's label ('Left' /
 *  'Right') — the landmark array's own `.label` is used when omitted. */
export function classifyHandShape(
  landmarks: readonly Pt3[],
  handedness?: string,
  faceX?: number | null,
  opts: ShapeOptions = {},
): HandShapeResult {
  const label = handedness ?? (landmarks as { label?: string }).label;
  if (!landmarks || landmarks.length < 21) return { shape: 'other', hand: 'R', confidence: 0, handFrom: 'position' };
  const side = resolveHandSide(landmarks, label, faceX, opts);
  const handConf = side.from === 'face' ? 1 : side.from === 'label' ? 0.85 : 0.5;
  const out = (shape: HandShape, conf: number): HandShapeResult => ({
    shape, hand: side.hand, confidence: shape === 'other' ? 0 : clamp01(conf) * handConf, handFrom: side.from,
  });

  const cfg: Parameters<typeof fingerStates>[1] = { ...(HAND_FEEL as HandFeelConfig), cameraAspect: opts.cameraAspect ?? HAND_FEEL.cameraAspect };
  const f = fingerStates(landmarks, cfg);
  const ext = f.map((x) => x.state === 'extended');
  const curled = f.map((x) => x.state === 'curled');
  const s = Math.max(1e-6, handScale(landmarks));
  // A finger pointing AT the camera reads straight in 3D but is short on
  // screen: it is not a clear finger count (ambiguous → 'other').
  const visible = (i: number) => dist(landmarks[FINGER_MCPS[i]], landmarks[FINGER_TIPS[i]]) / s >= FINGER_2D_MIN;

  if (curled.every(Boolean)) {
    const t = thumbInfo(landmarks);
    if (!t.extended) return out('fist', 1);
    const others = landmarks.filter((_, i) => i < 1 || i > 4);
    const tipY = landmarks[4].y;
    if (t.dirY <= -THUMB_DIR_MIN && others.every((p) => p.y > tipY)) {
      return out('thumbsUp', 0.6 + 0.4 * clamp01((-t.dirY - THUMB_DIR_MIN) / 0.3));
    }
    if (t.dirY >= THUMB_DIR_MIN && others.every((p) => p.y < tipY)) {
      return out('thumbsDown', 0.6 + 0.4 * clamp01((t.dirY - THUMB_DIR_MIN) / 0.3));
    }
    return out('other', 0); // thumb out sideways: neither
  }

  const pattern = (want: boolean[]) => want.every((w, i) => (w ? ext[i] : curled[i]));
  const allVisible = (n: number) => Array.from({ length: n }, (_, i) => i).every(visible);
  if (pattern([true, false, false, false])) {
    // A lone index must be strongly extended (as in curlState) and visible.
    return f[0].strong && allVisible(1) ? out('one', 1) : out('other', 0);
  }
  if (pattern([true, true, false, false])) return allVisible(2) ? out('peace', 1) : out('other', 0);
  if (pattern([true, true, true, false])) return allVisible(3) ? out('three', 1) : out('other', 0);
  if (ext.every(Boolean)) return out('open', 1);
  return out('other', 0);
}
