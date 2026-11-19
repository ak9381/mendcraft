// DETERMINISTIC SYNTHETIC TRACKING FIXTURES (pure, DOM-free, camera-free).
//
// Feeds handOverlay.ts / faceOverlay.ts the same shapes a real camera would,
// without MediaPipe or getUserMedia, so overlay visuals are screenshot- and
// test-reproducible. Coordinates are already "screen space" (0..1, mirrored),
// matching HandFrame.points / FaceFrame.box — no further mirroring needed.
//
// Each hand pose is hand-built from local (dx, dy) offsets from the wrist so
// it satisfies the same classifiers hands.ts/gestures.ts use (finger
// "extended" = tip farther from the wrist than its pip; pinch = thumb/index
// tip gap below PINCH_CLASSIFY; thumbs-up = all four fingers curled, thumb
// extended and above the wrist).

import { HAND_COLORS, INDEX_TIP, MIDDLE_MCP, THUMB_TIP, WRIST, type HandFrame, type Pt } from '../input/handLogic';
import type { FaceFrame } from '../input/presence';

export type HandPose = 'open' | 'point' | 'pinch' | 'thumbs-up' | 'fist';

type Local = readonly [number, number];

// Each tuple is [mcp, pip, dip, tip] (thumb: [cmc, mcp, ip, tip]) in wrist-
// relative local units; scaled and translated onto the frame per call.
const EXT = {
  thumb: [[-0.1, 0.05], [-0.2, -0.02], [-0.28, -0.15], [-0.34, -0.28]] as Local[],
  index: [[-0.15, -0.05], [-0.17, -0.35], [-0.18, -0.55], [-0.19, -0.72]] as Local[],
  middle: [[-0.02, -0.07], [-0.03, -0.42], [-0.03, -0.65], [-0.03, -0.85]] as Local[],
  ring: [[0.09, -0.05], [0.1, -0.38], [0.11, -0.58], [0.12, -0.75]] as Local[],
  pinky: [[0.2, 0], [0.22, -0.28], [0.23, -0.44], [0.24, -0.58]] as Local[],
};
const CURL = {
  thumb: [[-0.08, 0.04], [-0.1, 0.1], [-0.05, 0.14], [0.02, 0.16]] as Local[],
  thumbUp: [[-0.05, 0.05], [-0.03, -0.1], [-0.01, -0.3], [0.01, -0.5]] as Local[],
  thumbPinch: [[-0.1, 0.05], [-0.17, -0.1], [-0.19, -0.45], [-0.19, -0.7]] as Local[],
  index: [[-0.15, -0.05], [-0.16, -0.22], [-0.1, -0.12], [-0.06, -0.07]] as Local[],
  middle: [[-0.02, -0.07], [-0.03, -0.25], [-0.02, -0.14], [0, -0.08]] as Local[],
  ring: [[0.09, -0.05], [0.1, -0.24], [0.08, -0.14], [0.05, -0.08]] as Local[],
  pinky: [[0.2, 0], [0.21, -0.17], [0.17, -0.1], [0.12, -0.05]] as Local[],
};

function place(wrist: Pt, scale: number, local: readonly Local[]): Pt[] {
  return local.map(([dx, dy]) => ({ x: wrist.x + dx * scale, y: wrist.y + dy * scale }));
}

/** Build a 21-point hand already in screen space (0..1) for one of the demo poses. */
export function buildHandPose(pose: HandPose, wrist: Pt = { x: 0.62, y: 0.6 }, scale = 0.22): Pt[] {
  const thumb = place(wrist, scale, pose === 'open' || pose === 'point' ? EXT.thumb : pose === 'pinch' ? CURL.thumbPinch : pose === 'thumbs-up' ? CURL.thumbUp : CURL.thumb);
  const index = place(wrist, scale, pose === 'open' || pose === 'point' || pose === 'pinch' ? EXT.index : CURL.index);
  const middle = place(wrist, scale, pose === 'open' ? EXT.middle : CURL.middle);
  const ring = place(wrist, scale, pose === 'open' ? EXT.ring : CURL.ring);
  const pinky = place(wrist, scale, pose === 'open' ? EXT.pinky : CURL.pinky);
  const points: Pt[] = new Array(21);
  points[0] = { ...wrist };
  [1, 2, 3, 4].forEach((i, j) => (points[i] = thumb[j]));
  [5, 6, 7, 8].forEach((i, j) => (points[i] = index[j]));
  [9, 10, 11, 12].forEach((i, j) => (points[i] = middle[j]));
  [13, 14, 15, 16].forEach((i, j) => (points[i] = ring[j]));
  [17, 18, 19, 20].forEach((i, j) => (points[i] = pinky[j]));
  return points;
}

/** Thumb-tip/index-tip gap, normalised by wrist-to-middle-MCP hand size —
 *  mirrors handLogic.ts's pinchGapRatio so synthetic poses classify the same
 *  way a real hand at this scale would. */
function pinchRatio(points: readonly Pt[]): number {
  const a = points[THUMB_TIP], b = points[INDEX_TIP];
  const handSize = Math.hypot(points[WRIST].x - points[MIDDLE_MCP].x, points[WRIST].y - points[MIDDLE_MCP].y) || 1;
  return Math.hypot(a.x - b.x, a.y - b.y) / handSize;
}

/** A ready-to-draw HandFrame for a pose, matching handLogic.ts's slot/colour rules. */
export function buildHandFrame(pose: HandPose, slot: 0 | 1 = 0, wrist?: Pt, scale?: number): HandFrame {
  const points = buildHandPose(pose, wrist, scale);
  const pinching = pose === 'pinch';
  const colors = HAND_COLORS[slot];
  const pinchPoint = {
    x: (points[THUMB_TIP].x + points[INDEX_TIP].x) / 2,
    y: (points[THUMB_TIP].y + points[INDEX_TIP].y) / 2,
  };
  return {
    slot,
    points,
    pinching,
    owner: true,
    pinchPoint,
    aim: pose === 'point' || pose === 'pinch' ? points[INDEX_TIP] : pinchPoint,
    pinchRatio: pinchRatio(points),
    pinchStrength: pinching ? 1 : 0,
    color: pinching ? colors.pinch : colors.idle,
  };
}

export function buildFaceFrame(opts: Partial<FaceFrame> & { box?: FaceFrame['box'] } = {}): FaceFrame {
  return {
    box: opts.box ?? { x: 0.38, y: 0.1, w: 0.24, h: 0.32, cx: 0.5, cy: 0.26 },
    isOperator: opts.isOperator ?? true,
    facing: opts.facing ?? true,
    dim: opts.dim ?? false,
  };
}

export interface SyntheticScene {
  hands: HandFrame[];
  faces: FaceFrame[];
  rejectedHands: Pt[][];
}

/** Named demo scenes for the ?sim tracking screenshots: one operator hand in
 *  a named pose, the operator's face box, and (for 'crowd') a second, dim
 *  stranger face to exercise the non-operator render path. */
export function buildScene(pose: HandPose, variant: 'solo' | 'crowd' = 'solo'): SyntheticScene {
  const hands = [buildHandFrame(pose)];
  const faces = [buildFaceFrame({ facing: pose !== 'point' })];
  if (variant === 'crowd') {
    faces.push(buildFaceFrame({ box: { x: 0.04, y: 0.2, w: 0.16, h: 0.22, cx: 0.12, cy: 0.31 }, isOperator: false, facing: false, dim: true }));
  }
  return { hands, faces, rejectedHands: [] };
}

export const DEMO_POSES: readonly HandPose[] = ['open', 'point', 'pinch'];
