// CUSTOM GESTURE TEMPLATES (pure, DOM-free, camera-free).
//
// In setup she can record her own version of any gesture (or a brand-new one)
// in three tries. Each try is a hand pose: 21 landmarks normalised so position,
// size and in-plane rotation don't matter (wrist at origin, wrist→middle-MCP
// pointing up, unit length). The template is the mean of the three tries; a
// try that is too far from the others is rejected so she can redo just that
// one. At run time the live pose is matched to the nearest template within a
// threshold. Templates are numbers only and stay in this browser.

import { WRIST, MIDDLE_MCP, type Pt } from './handLogic';

export const TRIES_NEEDED = 3;
/** Mean per-landmark distance (in hand-size units) a try may sit from the
 *  others' mean and still count as "the same gesture". */
export const TRY_CONSISTENCY = 0.15;
/** Max mean per-landmark distance for a live pose to match a template. */
export const MATCH_THRESHOLD = 0.12;

export interface GestureTemplate {
  id: string;
  label: string;
  /** 42 numbers: x,y of the 21 normalised landmarks. */
  vector: number[];
  createdAt: number;
}

/** Normalise a 21-point hand: translate, rotate, scale. Returns 42 numbers. */
export function normalizePose(p: readonly Pt[]): number[] | null {
  if (!p || p.length < 21) return null;
  const w = p[WRIST];
  const m = p[MIDDLE_MCP];
  const dx = m.x - w.x, dy = m.y - w.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  // Rotate so wrist→middle MCP points to (0,-1) ("up" in screen coords).
  const ang = Math.atan2(dy, dx) - -Math.PI / 2;
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const out: number[] = [];
  for (let i = 0; i < 21; i++) {
    const x = (p[i].x - w.x) / len, y = (p[i].y - w.y) / len;
    out.push(x * c - y * s, x * s + y * c);
  }
  return out;
}

/** Finger joints that carry the pose (thumb + the PIP/DIP/tip of each finger);
 *  the wrist and knuckles barely move between gestures, so they'd dilute it. */
const POSE_POINTS = [2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20];

/** Mean per-joint Euclidean distance (hand-size units) between two vectors. */
export function poseDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length !== 42) return Infinity;
  let sum = 0;
  for (const i of POSE_POINTS) sum += Math.hypot(a[2 * i] - b[2 * i], a[2 * i + 1] - b[2 * i + 1]);
  return sum / POSE_POINTS.length;
}

export function meanVector(vs: readonly (readonly number[])[]): number[] {
  const out = new Array(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i] / vs.length;
  return out;
}

export type RecordResult =
  | { status: 'need-more'; tries: number }
  | { status: 'retry'; tries: number; badTry: number; reason: string }
  | { status: 'done'; template: GestureTemplate };

/**
 * A three-try recorder. Each `addTry` takes one captured pose (the steadiest
 * frame of that try). After the third try it either returns the template or
 * names the try that didn't match the other two, dropping it so only that one
 * is redone.
 */
export function createTemplateRecorder(id: string, label: string, now: () => number = Date.now) {
  let tries: number[][] = [];
  function addTry(pose: readonly Pt[]): RecordResult {
    const v = normalizePose(pose);
    if (!v) return { status: 'retry', tries: tries.length, badTry: tries.length, reason: 'No full hand seen. Keep your whole hand in view.' };
    tries.push(v);
    if (tries.length < TRIES_NEEDED) return { status: 'need-more', tries: tries.length };
    // Check each try against the mean of the others.
    let worst = -1, worstD = 0;
    tries.forEach((t, i) => {
      const others = tries.filter((_, j) => j !== i);
      const d = poseDistance(t, meanVector(others));
      if (d > worstD) { worstD = d; worst = i; }
    });
    if (worstD > TRY_CONSISTENCY) {
      tries = tries.filter((_, j) => j !== worst);
      return { status: 'retry', tries: tries.length, badTry: worst, reason: `Try ${worst + 1} looked different. Please do that one again.` };
    }
    const template: GestureTemplate = { id, label, vector: meanVector(tries).map((n) => Math.round(n * 1e4) / 1e4), createdAt: now() };
    return { status: 'done', template };
  }
  function reset(): void { tries = []; }
  return { addTry, reset, tries: () => tries.length };
}

/** Best-matching template for a live pose, or null if none is close enough. */
export function matchTemplate(pose: readonly Pt[], templates: readonly GestureTemplate[], threshold = MATCH_THRESHOLD): { id: string; distance: number } | null {
  const v = normalizePose(pose);
  if (!v) return null;
  let best: { id: string; distance: number } | null = null;
  for (const t of templates) {
    const d = poseDistance(v, t.vector);
    if (d <= threshold && (!best || d < best.distance)) best = { id: t.id, distance: d };
  }
  return best;
}

/** Pick the steadiest frame of a try (least movement vs its neighbours). */
export function steadiestFrame(frames: readonly (readonly Pt[])[]): readonly Pt[] | null {
  if (frames.length === 0) return null;
  if (frames.length < 3) return frames[frames.length - 1];
  let best = 1, bestMove = Infinity;
  for (let i = 1; i < frames.length - 1; i++) {
    const a = normalizePose(frames[i - 1]), b = normalizePose(frames[i]), c = normalizePose(frames[i + 1]);
    if (!a || !b || !c) continue;
    const move = poseDistance(a, b) + poseDistance(b, c);
    if (move < bestMove) { bestMove = move; best = i; }
  }
  return frames[best];
}

export function coerceTemplate(raw: unknown): GestureTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(r.id)) return null;
  if (typeof r.label !== 'string' || r.label.length > 60) return null;
  if (!Array.isArray(r.vector) || r.vector.length !== 42 || !r.vector.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10)) return null;
  return { id: r.id, label: r.label, vector: r.vector as number[], createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0 };
}

// ---------------------------------------------------------------------------
// MOTION TEMPLATES — a taught gesture that moves (not held), matched by DTW
// (Dynamic Time Warping) over the normalised pose sequence so a slower or
// faster repeat of the same motion still matches. Reuses normalizePose/
// poseDistance above, so motion templates share the same wrist-relative,
// scale- and rotation-invariant frame as static ones.

export interface MotionTemplate {
  id: string;
  label: string;
  /** One 42-number normalised pose (see normalizePose) per captured frame. */
  frames: number[][];
  createdAt: number;
}

/** Mean per-frame distance a live sequence may sit from a template and still
 *  count as the same motion (DTW cost is normalised by path length, so this
 *  is directly comparable to MATCH_THRESHOLD above). */
export const MOTION_MATCH_THRESHOLD = 0.16;

/**
 * Dynamic Time Warping distance between two normalised pose sequences, using
 * poseDistance as the per-frame cost. O(n*m) with two rolling rows (no O(n*m)
 * allocation), so a ~75-frame sample against a ~75-frame template is cheap.
 * The result is divided by the warped path length so longer sequences don't
 * read as "more different" just by being longer.
 */
export function dtwDistance(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number {
  const n = a.length, m = b.length;
  if (!n || !m) return Infinity;
  let prev = new Array<number>(m + 1).fill(Infinity);
  let cur = new Array<number>(m + 1).fill(Infinity);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur[0] = Infinity;
    for (let j = 1; j <= m; j++) {
      const cost = poseDistance(a[i - 1], b[j - 1]);
      cur[j] = cost + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / Math.max(n, m);
}

/** Best-matching motion template for a live (unnormalised) landmark
 *  sequence, or null if none is close enough. */
export function matchMotionTemplate(
  sequence: readonly (readonly Pt[])[],
  templates: readonly MotionTemplate[],
  threshold = MOTION_MATCH_THRESHOLD,
): { id: string; distance: number } | null {
  const vs = sequence.map(normalizePose).filter((v): v is number[] => v !== null);
  if (vs.length < 2) return null;
  let best: { id: string; distance: number } | null = null;
  for (const t of templates) {
    if (t.frames.length < 2) continue;
    const d = dtwDistance(vs, t.frames);
    if (d <= threshold && (!best || d < best.distance)) best = { id: t.id, distance: d };
  }
  return best;
}

/** Whether a captured sample moved enough to be a motion rather than a held
 *  pose — the mean per-frame drift of its normalised sequence from its own
 *  first frame. Used to decide which matcher (nearest-template vs DTW) a
 *  freshly taught gesture should use. */
export function sequenceMotion(sequence: readonly (readonly Pt[])[]): number {
  const vs = sequence.map(normalizePose).filter((v): v is number[] => v !== null);
  if (vs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < vs.length; i++) sum += poseDistance(vs[0], vs[i]);
  return sum / (vs.length - 1);
}

export function coerceMotionTemplate(raw: unknown): MotionTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(r.id)) return null;
  if (typeof r.label !== 'string' || r.label.length > 60) return null;
  if (!Array.isArray(r.frames) || r.frames.length < 2 || r.frames.length > 200) return null;
  const frames: number[][] = [];
  for (const f of r.frames) {
    if (!Array.isArray(f) || f.length !== 42 || !f.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10)) return null;
    frames.push(f as number[]);
  }
  return { id: r.id, label: r.label, frames, createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0 };
}
