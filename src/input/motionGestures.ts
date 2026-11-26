// MOTION + HELD-POSE GESTURE RECOGNIZER (pure, DOM-free, camera-free).
//
// Layered beside input/gestures.ts (which owns pinch / double pinch / two-hand
// zoom / thumbs up). This one recognises the rest of the default catalog from a
// short history of the operator's hand: swipes, wave, palm flip, palm
// raise/lower, palm tap, twist, held pinch, air tap, circle, the held V and
// three-finger poses, palm hold, and both palms. Thresholds are in screen
// fractions scaled by her calibrated reach, so a small reach still swipes.
// Static poses must be HELD (default 400 ms) so tremor and passing shapes don't
// fire them. Clock is injected through each frame's `now`.

import { classifyGesture, fingerStates, handSize, isTwoFingerScrollPose, pinchRatio, PINCH_CLASSIFY, type Pt } from './gestures';
import { INDEX_TIP, THUMB_TIP, WRIST } from './handLogic';

export type Pose = ReturnType<typeof classifyGesture> | 'v-sign' | 'three-fingers';

/** classifyGesture plus the two extra counting poses (V, three fingers). */
export function classifyPose(p: readonly Pt[]): Pose {
  if (!p || p.length < 21) return 'none';
  const s = fingerStates(p as Pt[]);
  // Named digit poses beat a relaxed open-palm (3 loosely extended fingers
  // would otherwise swallow "three fingers" and a V as scroll/cancel).
  // Thumb tucked + two fingers is SCROLL, not the V-sign undo hold.
  if (s.index && s.middle && !s.ring && !s.pinky && pinchRatio(p as Pt[]) >= PINCH_CLASSIFY) {
    if (isTwoFingerScrollPose(p as Pt[])) return classifyGesture(p as Pt[]);
    return 'v-sign';
  }
  if (s.index && s.middle && s.ring && !s.pinky) return 'three-fingers';
  return classifyGesture(p as Pt[]);
}

export interface MotionEvent {
  id: string;
  /** For continuous gestures: +1 / -1 step direction. For circle: its bbox. */
  value?: number;
  box?: { x0: number; y0: number; x1: number; y1: number };
}

export interface MotionOptions {
  /** Reach width/height (from calibration) — distance thresholds scale by it. */
  reachW?: number;
  reachH?: number;
  holdMs?: number;
}

interface Sample {
  t: number;
  pose: Pose;
  palm: Pt;
  tip: Pt;
  size: number;
  /** Sign of index-MCP x minus pinky-MCP x: flips when the palm turns over. */
  orient: number;
  /** Thumb→index angle (radians), for twist. */
  angle: number;
}

const HISTORY_MS = 2000;
const COOLDOWN_MS = 700;

function palmCenter(p: readonly Pt[]): Pt {
  const ids = [WRIST, 5, 9, 13, 17];
  return { x: ids.reduce((s, i) => s + p[i].x, 0) / 5, y: ids.reduce((s, i) => s + p[i].y, 0) / 5 };
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function createMotionRecognizer(opts: MotionOptions = {}) {
  let reachW = opts.reachW ?? 1;
  let reachH = opts.reachH ?? 1;
  const holdMs = opts.holdMs ?? 400;
  let hist: Sample[] = [];
  const lastFire = new Map<string, number>();
  // Held-pose tracking.
  let heldPose: Pose = 'none';
  let heldSince = 0;
  let heldFired = false;
  let heldAnchor: Pt | null = null;
  // Both palms.
  let bothSince: number | null = null;
  let bothFired = false;
  // Pinch tracking (twist, slide, hold-still).
  let pinchStart: Sample | null = null;
  let pinchMoved = false;
  let pinchHoldFired = false;
  let twistRef = 0;
  let slideRef = 0;
  // Palm raise/lower.
  let levelRef: number | null = null;

  const W = (f: number) => f * reachW;
  const H = (f: number) => f * reachH;

  function canFire(id: string, now: number): boolean {
    const t = lastFire.get(id);
    return t === undefined || now - t >= COOLDOWN_MS;
  }
  function fire(out: MotionEvent[], ev: MotionEvent, now: number): void {
    if (!canFire(ev.id, now) && ev.value === undefined) return;
    lastFire.set(ev.id, now);
    out.push(ev);
  }

  function recent(now: number, ms: number, pose?: (p: Pose) => boolean): Sample[] {
    return hist.filter((s) => now - s.t <= ms && (!pose || pose(s.pose)));
  }

  function detectWave(now: number, out: MotionEvent[]): boolean {
    const s = recent(now, 1200, (p) => p === 'open-palm');
    if (s.length < 8) return false;
    let dir = 0, turns = 0, ext = s[0].palm.x;
    for (const q of s) {
      const d = q.palm.x - ext;
      if (dir >= 0 && d < -W(0.035)) { if (dir > 0) turns++; dir = -1; ext = q.palm.x; }
      else if (dir <= 0 && d > W(0.035)) { if (dir < 0) turns++; dir = 1; ext = q.palm.x; }
      else if ((dir > 0 && q.palm.x > ext) || (dir < 0 && q.palm.x < ext)) ext = q.palm.x;
    }
    if (turns >= 3) { fire(out, { id: 'wave' }, now); hist = []; return true; }
    return false;
  }

  function detectSwipe(now: number, out: MotionEvent[], pose: (p: Pose) => boolean, prefix: 'palm' | 'two-finger'): boolean {
    const s = recent(now, 550, pose);
    if (s.length < 4) return false;
    const a = s[0], b = s[s.length - 1];
    const dx = b.palm.x - a.palm.x, dy = b.palm.y - a.palm.y;
    if (prefix === 'palm' && Math.abs(dx) >= W(0.22) && Math.abs(dy) < Math.abs(dx) * 0.6) {
      fire(out, { id: dx < 0 ? 'palm-swipe-left' : 'palm-swipe-right' }, now);
      hist = []; return true;
    }
    if (prefix === 'two-finger') {
      if (Math.abs(dy) >= H(0.15) && Math.abs(dx) < Math.abs(dy) * 0.7) {
        fire(out, { id: dy < 0 ? 'two-finger-swipe-up' : 'two-finger-swipe-down' }, now);
        hist = []; return true;
      }
      if (Math.abs(dx) >= W(0.18) && Math.abs(dy) < Math.abs(dx) * 0.6) {
        fire(out, { id: 'two-finger-swipe-side', value: dx < 0 ? -1 : 1 }, now);
        hist = []; return true;
      }
    }
    return false;
  }

  function detectFlip(now: number, out: MotionEvent[]): boolean {
    const s = recent(now, 650, (p) => p === 'open-palm' || p === 'none' || p === 'three-fingers');
    if (s.length < 4) return false;
    const a = s[0], b = s[s.length - 1];
    if (a.orient !== 0 && b.orient !== 0 && a.orient !== b.orient && Math.hypot(b.palm.x - a.palm.x, b.palm.y - a.palm.y) < W(0.1)) {
      fire(out, { id: 'palm-flip' }, now); hist = []; return true;
    }
    return false;
  }

  function detectPalmTap(now: number, out: MotionEvent[]): boolean {
    const s = recent(now, 500, (p) => p === 'open-palm');
    if (s.length < 5) return false;
    const base = s[0].size;
    const peak = Math.max(...s.map((q) => q.size));
    const end = s[s.length - 1].size;
    if (peak >= base * 1.18 && end <= base * 1.07 && Math.abs(s[s.length - 1].palm.x - s[0].palm.x) < W(0.05)) {
      fire(out, { id: 'palm-tap' }, now); hist = []; return true;
    }
    return false;
  }

  function detectAirTap(now: number, out: MotionEvent[]): boolean {
    const s = recent(now, 450, (p) => p === 'point');
    if (s.length < 5) return false;
    const y0 = s[0].tip.y, yEnd = s[s.length - 1].tip.y;
    const yMax = Math.max(...s.map((q) => q.tip.y));
    const palmMove = Math.hypot(s[s.length - 1].palm.x - s[0].palm.x, s[s.length - 1].palm.y - s[0].palm.y);
    if (yMax - y0 >= H(0.035) && yMax - yEnd >= H(0.03) && palmMove < W(0.025)) {
      fire(out, { id: 'air-tap' }, now); hist = []; return true;
    }
    return false;
  }

  function detectCircle(now: number, out: MotionEvent[]): boolean {
    const s = recent(now, 2000, (p) => p === 'point');
    if (s.length < 12) return false;
    const cx = s.reduce((a, q) => a + q.tip.x, 0) / s.length;
    const cy = s.reduce((a, q) => a + q.tip.y, 0) / s.length;
    const r = s.reduce((a, q) => a + Math.hypot(q.tip.x - cx, q.tip.y - cy), 0) / s.length;
    if (r < W(0.04)) return false;
    let total = 0;
    for (let i = 1; i < s.length; i++) {
      total += wrapAngle(Math.atan2(s[i].tip.y - cy, s[i].tip.x - cx) - Math.atan2(s[i - 1].tip.y - cy, s[i - 1].tip.x - cx));
    }
    if (Math.abs(total) >= (330 * Math.PI) / 180) {
      const xs = s.map((q) => q.tip.x), ys = s.map((q) => q.tip.y);
      fire(out, { id: 'circle', box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } }, now);
      hist = []; return true;
    }
    return false;
  }

  function update(frame: { hands: readonly (readonly Pt[])[]; now: number }): MotionEvent[] {
    const { hands, now } = frame;
    const out: MotionEvent[] = [];

    // Both palms open, held 800 ms → rest toggle (one fire per hold).
    if (hands.length >= 2 && classifyPose(hands[0]) === 'open-palm' && classifyPose(hands[1]) === 'open-palm') {
      if (bothSince === null) bothSince = now;
      if (!bothFired && now - bothSince >= 800) { bothFired = true; fire(out, { id: 'both-palms' }, now); }
      hist = [];
      return out;
    }
    bothSince = null; bothFired = false;

    const p = hands[0];
    if (!p || p.length < 21) {
      hist = []; heldPose = 'none'; pinchStart = null; levelRef = null;
      return out;
    }
    const pose = classifyPose(p);
    const sample: Sample = {
      t: now, pose, palm: palmCenter(p), tip: { ...p[INDEX_TIP] }, size: handSize(p as Pt[]),
      orient: Math.sign(p[5].x - p[17].x),
      angle: Math.atan2(p[INDEX_TIP].y - p[THUMB_TIP].y, p[INDEX_TIP].x - p[THUMB_TIP].x),
    };
    hist.push(sample);
    hist = hist.filter((s) => now - s.t <= HISTORY_MS);

    // ---- pinch family: twist, slide, hold-still ----
    if (pose === 'pinch') {
      if (!pinchStart) { pinchStart = sample; pinchMoved = false; pinchHoldFired = false; twistRef = sample.angle; slideRef = sample.palm.x; }
      const moved = Math.hypot(sample.tip.x - pinchStart.tip.x, sample.tip.y - pinchStart.tip.y);
      if (moved > W(0.03)) pinchMoved = true;
      const dAng = wrapAngle(sample.angle - twistRef);
      if (Math.abs(dAng) >= (25 * Math.PI) / 180) { out.push({ id: 'twist', value: Math.sign(dAng) }); twistRef = sample.angle; pinchMoved = true; }
      const dx = sample.palm.x - slideRef;
      if (Math.abs(dx) >= W(0.05)) { out.push({ id: 'pinch-slide', value: Math.sign(dx) }); slideRef = sample.palm.x; }
      if (!pinchMoved && !pinchHoldFired && now - pinchStart.t >= 1200) { pinchHoldFired = true; fire(out, { id: 'pinch-hold-still' }, now); }
    } else {
      pinchStart = null;
    }

    // ---- palm raise / lower (continuous) + palm hold ----
    if (pose === 'open-palm') {
      if (levelRef === null) levelRef = sample.palm.y;
      const dy = sample.palm.y - levelRef;
      const s = recent(now, 400, (q) => q === 'open-palm');
      const xDrift = s.length ? Math.abs(sample.palm.x - s[0].palm.x) : 0;
      if (Math.abs(dy) >= H(0.06) && xDrift < W(0.05)) {
        out.push({ id: dy < 0 ? 'palm-raise' : 'palm-lower', value: dy < 0 ? 1 : -1 });
        levelRef = sample.palm.y;
      }
    } else {
      levelRef = null;
    }

    // ---- motion gestures (first match wins) ----
    if (detectWave(now, out) || detectSwipe(now, out, (q) => q === 'open-palm', 'palm')
      || detectSwipe(now, out, (q) => q === 'v-sign', 'two-finger') || detectFlip(now, out)
      || detectPalmTap(now, out) || detectAirTap(now, out) || detectCircle(now, out)) {
      heldPose = 'none'; heldFired = true;
      return out;
    }

    // ---- held static poses: V, three fingers (400 ms), open palm (0.8 s) ----
    if (pose !== heldPose) {
      heldPose = pose; heldSince = now; heldFired = false; heldAnchor = sample.palm;
    } else if (heldAnchor && Math.hypot(sample.palm.x - heldAnchor.x, sample.palm.y - heldAnchor.y) > W(0.05)) {
      heldSince = now; heldAnchor = sample.palm; // moving: restart the hold
    }
    if (!heldFired) {
      if ((pose === 'v-sign' || pose === 'three-fingers') && now - heldSince >= holdMs) {
        heldFired = true; fire(out, { id: pose }, now);
      } else if (pose === 'open-palm' && now - heldSince >= 800) {
        heldFired = true; fire(out, { id: 'palm-hold' }, now);
      }
    }
    return out;
  }

  function setReach(w: number, h: number): void {
    reachW = Math.max(0.25, Math.min(1, w));
    reachH = Math.max(0.25, Math.min(1, h));
  }

  function reset(): void {
    hist = []; heldPose = 'none'; heldFired = false; bothSince = null; bothFired = false;
    pinchStart = null; levelRef = null;
  }

  return { update, reset, setReach };
}
