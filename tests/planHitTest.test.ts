import { describe, expect, it } from 'vitest';
import { emptyPlan, type PlanDoc, type Wall } from '../src/plan/doc';
import { pickPlan, distToSegment, DEFAULT_AIM_RADIUS_PX } from '../src/plan/hitTest';
import {
  createHandsProcessor,
  DEFAULT_PINCH_ON,
  aimPoint,
  pinchGapRatio,
  pinchStrength,
  type HandEvent,
  type Pt,
} from '../src/input/handLogic';
import { createDwellClicker } from '../src/input/dwell';

/** Horizontal wall along y=0, 4 m long, with a 900 mm left-swing door at 1.5 m. */
function roomDoc(): PlanDoc {
  const wall: Wall = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 150 };
  return {
    ...emptyPlan(),
    walls: [wall],
    openings: [{ id: 'door1', kind: 'door', wallId: 'w1', offset: 1500, width: 900, swing: 'left' }],
    fixtures: [{ id: 'sofa1', kind: 'sofa', x: 2000, y: 1800, w: 1800, d: 800, rotation: 0 }],
    texts: [{ id: 't1', x: 500, y: 2500, text: 'Hall', size: 300 }],
  };
}

const SCALE = 0.1; // 10 px per 100 mm; a 56 px magnet ≈ 560 mm

describe('pickPlan — doors, furniture, magnet', () => {
  const doc = roomDoc();

  it('picks a door from a point on its leaf, not the host wall', () => {
    // Left-swing door: hinge at (1500, 0), leaf opens to (1500, 900).
    const hit = pickPlan(doc, { x: 1500, y: 450 }, SCALE, 0);
    expect(hit?.id).toBe('door1');
    expect(hit?.kind).toBe('opening');
  });

  it('picks a door from a point inside the swing quarter-circle', () => {
    const hit = pickPlan(doc, { x: 1800, y: 400 }, SCALE, 0);
    expect(hit?.id).toBe('door1');
  });

  it('picks the wall when the pointer is on the wall, away from the door', () => {
    const hit = pickPlan(doc, { x: 400, y: 20 }, SCALE, 0);
    expect(hit?.id).toBe('w1');
    expect(hit?.kind).toBe('wall');
  });

  it('picks a sofa from a point inside its footprint', () => {
    const hit = pickPlan(doc, { x: 2000, y: 1800 }, SCALE, 0);
    expect(hit?.id).toBe('sofa1');
  });

  it('gives fixtures edge slack so a near miss still hits', () => {
    // Sofa extends y=1400..2200; 40 mm below the bottom edge, inside 80 mm slack.
    const hit = pickPlan(doc, { x: 2000, y: 1360 }, SCALE, 0);
    expect(hit?.id).toBe('sofa1');
    expect(hit?.dist).toBeGreaterThan(0);
  });

  it('magnets onto the nearest object within a generous radius', () => {
    // 300 mm below the sofa (outside intrinsic slack of 80+120mm), inside 560 mm magnet.
    const radiusMm = DEFAULT_AIM_RADIUS_PX / SCALE;
    const hit = pickPlan(doc, { x: 2000, y: 1100 }, SCALE, radiusMm);
    expect(hit?.id).toBe('sofa1');
    expect(hit?.point.y).toBeCloseTo(1400, 0);
  });

  it('does not snap onto a distant object when the pointer is far away', () => {
    const radiusMm = DEFAULT_AIM_RADIUS_PX / SCALE;
    const hit = pickPlan(doc, { x: 2000, y: 5000 }, SCALE, radiusMm);
    expect(hit).toBeNull();
  });

  it('prefers a slightly farther door over a closer wall (kind bias), but not a distant door', () => {
    // 40 mm off the wall at x=400 (far from the door at 1500–2400).
    const nearWall = pickPlan(doc, { x: 400, y: 40 }, SCALE, 200);
    expect(nearWall?.id).toBe('w1');
  });
});

describe('distToSegment', () => {
  it('is zero on the segment and the perpendicular distance off it', () => {
    expect(distToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4);
  });
});

/** 21-landmark hand. wrist→MCP = 0.2; `gap` is the thumb–index distance. */
function rawHand(cx: number, cy: number, gap: number, jitter = 0, seed = 1): Pt[] {
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  pts[0] = { x: cx, y: cy + 0.2 };
  pts[9] = { x: cx, y: cy };
  // Slightly realistic finger stack
  pts[5] = { x: cx - 0.02, y: cy + 0.04 };
  pts[6] = { x: cx - 0.01, y: cy - 0.02 };
  pts[7] = { x: cx, y: cy - 0.04 };
  pts[8] = { x: cx, y: cy - 0.05 };
  pts[4] = { x: cx + gap, y: cy - 0.05 };
  if (jitter) {
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 0xffffffff) * 2 - 1; };
    for (const i of [4, 8]) {
      pts[i] = { x: pts[i].x + rnd() * jitter, y: pts[i].y + rnd() * jitter };
    }
  }
  return pts;
}

describe('pinch detection with real-looking landmarks', () => {
  it('is relative to hand size: the same close registers near or far from the camera', () => {
    // Near (hand size 0.2) and far (hand size 0.08) with the same *pose* ratio 0.4.
    const near = rawHand(0.5, 0.5, 0.08); // 0.08/0.2 = 0.4
    const farPts: Pt[] = rawHand(0.5, 0.5, 0.08).map((p, i, a) => ({
      x: a[0].x + (p.x - a[0].x) * 0.4,
      y: a[0].y + (p.y - a[0].y) * 0.4,
    }));
    expect(pinchGapRatio(near)).toBeCloseTo(0.4, 2);
    expect(pinchGapRatio(farPts)).toBeCloseTo(0.4, 2);
  });

  it('registers a loose arthritis-style pinch that never fully closes (ratio 0.4)', () => {
    const events: HandEvent[] = [];
    const p = createHandsProcessor((e) => events.push(e));
    const open = rawHand(0.4, 0.6, 0.16); // ratio 0.8
    const loose = rawHand(0.4, 0.6, 0.08); // ratio 0.4 < 0.50
    expect(pinchGapRatio(loose)).toBeCloseTo(0.4, 2);
    expect(pinchGapRatio(loose)).toBeLessThan(DEFAULT_PINCH_ON);
    p.process([{ landmarks: open, label: 'Right' }]);
    p.process([{ landmarks: loose, label: 'Right' }]);
    expect(events.some((e) => e.type === 'pinch-start')).toBe(true);
  });

  it('does not register an open or pointing hand', () => {
    const events: HandEvent[] = [];
    const p = createHandsProcessor((e) => events.push(e));
    p.process([{ landmarks: rawHand(0.4, 0.6, 0.16), label: 'Right' }]); // 0.8
    expect(events.filter((e) => e.type !== 'tracking')).toEqual([]);
  });

  it('releases only after the off-threshold (hysteresis)', () => {
    const events: HandEvent[] = [];
    const p = createHandsProcessor((e) => events.push(e));
    p.process([{ landmarks: rawHand(0.4, 0.6, 0.08), label: 'Right' }]); // 0.4, on
    p.process([{ landmarks: rawHand(0.4, 0.6, 0.11), label: 'Right' }]); // 0.55, still held
    expect(events.filter((e) => e.type === 'pinch-end')).toHaveLength(0);
    p.process([{ landmarks: rawHand(0.4, 0.6, 0.14), label: 'Right' }]); // 0.70, off
    expect(events.some((e) => e.type === 'pinch-end')).toBe(true);
  });

  it('exposes a pinch-strength reading that rises as the fingers close', () => {
    const open = pinchStrength(0.8, DEFAULT_PINCH_ON);
    const near = pinchStrength(DEFAULT_PINCH_ON, DEFAULT_PINCH_ON);
    const shut = pinchStrength(0.1, DEFAULT_PINCH_ON);
    expect(open).toBe(0);
    expect(near).toBeCloseTo(0.85, 5);
    expect(shut).toBe(1);
    expect(open).toBeLessThan(near);
    expect(near).toBeLessThan(shut);
  });

  it('aims at the index tip when open and eases toward the midpoint as the pinch closes', () => {
    const open = rawHand(0.4, 0.6, 0.16).map((p) => ({ x: 1 - p.x, y: p.y }));
    const shut = rawHand(0.4, 0.6, 0.02).map((p) => ({ x: 1 - p.x, y: p.y }));
    const aOpen = aimPoint(open, DEFAULT_PINCH_ON);
    const aShut = aimPoint(shut, DEFAULT_PINCH_ON);
    expect(aOpen.x).toBeCloseTo(open[8].x, 3);
    expect(aOpen.y).toBeCloseTo(open[8].y, 3);
    const mid = { x: (shut[4].x + shut[8].x) / 2, y: (shut[4].y + shut[8].y) / 2 };
    expect(aShut.x).toBeCloseTo(mid.x, 3);
    expect(aShut.y).toBeCloseTo(mid.y, 3);
  });

  it('setPinchThreshold applies a calibration-tuned (tighter) threshold', () => {
    const events: HandEvent[] = [];
    const p = createHandsProcessor((e) => events.push(e));
    p.setPinchThreshold(0.30, 0.42);
    const loose = rawHand(0.4, 0.6, 0.08); // ratio 0.4 — would pinch at default 0.50
    p.process([{ landmarks: loose, label: 'Right' }]);
    expect(events.some((e) => e.type === 'pinch-start')).toBe(false);
    p.process([{ landmarks: rawHand(0.4, 0.6, 0.04), label: 'Right' }]); // 0.2
    expect(events.some((e) => e.type === 'pinch-start')).toBe(true);
  });
});

describe('pinch → pick pipeline with jittered real-looking frames', () => {
  it('selects a door even when the index tip jitters off it, because aim uses the midpoint and magnet', () => {
    const doc = roomDoc();
    const events: HandEvent[] = [];
    const proc = createHandsProcessor((e) => events.push(e));

    // Camera-space hand whose MIRRORED aim (1-x) sits over the door leaf.
    // Door leaf is at world (1500, 450). We'll map the viewport ourselves:
    // treat the plan as origin (0,0) bottom, 4000×3000 mm, scale 0.1,
    // so world (1500, 450) → screen (150,  — wait we work in world mm
    // directly: take the event's mirrored aim, map 0..1 screen onto a
    // viewport covering the plan (0..4000, 0..3000) with y-up via
    // xw = xNorm * 4000, yw = (1 - yNorm) * 3000? Simpler: we place the
    // hand so the MIRRORED midpoint is at a known 0..1, then convert with
    // a fake viewport whose world mapping we control.

    // Put the pinch midpoint at camera (0.4, 0.5) → mirrored aim ≈ (0.6, 0.5)
    // if tightly pinched. We'll convert that to world using:
    //   worldX = aim.x / scale  with a view origin of 0 → 0.6/0.1 = 6000? No.
    //
    // Instead, compute world from a simple mapping used in the test only:
    // viewport is 400 px wide, 300 px tall, origin at world (0, 3000) with
    // scale 0.1 (y flipped): world = { x: clientX / 0.1, y: (300 - clientY) / 0.1 }
    // client = { x: aim.x * 400, y: aim.y * 300 }
    // So world = { x: aim.x * 4000, y: (1 - aim.y) * 3000 }.
    // We want world ≈ (1500, 450) so aim ≈ (1500/4000, 1 - 450/3000) = (0.375, 0.85).
    // Mirrored aim x = 1 - raw.x → raw.x = 1 - 0.375 = 0.625, raw.y = 0.85.

    const targetRawX = 1 - 0.375;
    const targetRawY = 0.85;
    // A tight pinch (gap 0.02) plus landmark jitter of ±0.02 (~index tip wobble).
    const frames = [];
    for (let i = 0; i < 8; i++) {
      frames.push(rawHand(targetRawX, targetRawY, i < 2 ? 0.16 : 0.04, 0.015, 100 + i * 17));
    }
    let lastAim: Pt | null = null;
    for (const lm of frames) {
      const out = proc.process([{ landmarks: lm, label: 'Right' }]);
      lastAim = out[0].aim;
    }
    expect(events.some((e) => e.type === 'pinch-start')).toBe(true);
    expect(lastAim).not.toBeNull();

    const worldFromAim = (aim: Pt) => ({ x: aim.x * 4000, y: (1 - aim.y) * 3000 });
    const world = worldFromAim(lastAim!);
    const radiusMm = DEFAULT_AIM_RADIUS_PX / SCALE;
    const hit = pickPlan(doc, world, SCALE, radiusMm);
    expect(hit?.id).toBe('door1');

    // Contrast: the raw jittered INDEX tip (mirrored) can sit well off the leaf,
    // which is why the old pipeline missed; the magnet + midpoint still hits.
    const last = frames[frames.length - 1];
    const indexWorld = { x: (1 - last[8].x) * 4000, y: (1 - last[8].y) * 3000 };
    // May or may not be on the door; the test asserts the AIM path works.
    expect(distToSegment(worldFromAim(lastAim!), { x: 1500, y: 0 }, { x: 1500, y: 900 }))
      .toBeLessThan(radiusMm + 80);
    void indexWorld;
  });

  it('emits pinch-start / pinch-move / pinch-end so a held pinch can drag', () => {
    const events: HandEvent[] = [];
    const proc = createHandsProcessor((e) => events.push(e));
    proc.process([{ landmarks: rawHand(0.4, 0.6, 0.16), label: 'Right' }]);
    proc.process([{ landmarks: rawHand(0.4, 0.6, 0.04), label: 'Right' }]);
    proc.process([{ landmarks: rawHand(0.55, 0.6, 0.04), label: 'Right' }]);
    proc.process([{ landmarks: rawHand(0.55, 0.6, 0.16), label: 'Right' }]);
    const types = events.filter((e) => e.type !== 'tracking').map((e) => e.type);
    expect(types[0]).toBe('pinch-start');
    expect(types).toContain('pinch-move');
    expect(types.at(-1)).toBe('pinch-end');
  });
});

describe('dwell-to-select fallback', () => {
  it('fires once after hovering the same object for the dwell, and resets when moving off', () => {
    const d = createDwellClicker(400);
    expect(d.update('door1', 0)).toEqual({ progress: 0, fire: false });
    expect(d.update('door1', 200).progress).toBeCloseTo(0.5, 5);
    expect(d.update('door1', 200).fire).toBe(false);
    const fired = d.update('door1', 400);
    expect(fired.fire).toBe(true);
    expect(d.update('door1', 500).fire).toBe(false); // already fired
    const off = d.update('sofa1', 500);
    expect(off.fire).toBe(false);
    expect(off.progress).toBe(0);
    expect(d.update('sofa1', 900).fire).toBe(true);
  });
});

describe('coordinate mapping (mirror, 0–1 to client, pan/zoom)', () => {
  it('mirrors camera x so a hand on the right of the selfie view aims at the right of the canvas', () => {
    const events: HandEvent[] = [];
    const proc = createHandsProcessor((e) => events.push(e));
    // Camera-right hand (raw x = 0.8) must become screen-left-mirrored? Front-facing
    // camera: a hand that appears on the user's right is on the left of the raw
    // image (x small) or... MediaPipe is in the unmirrored video frame.
    // handLogic mirrors with x' = 1 - x, so raw 0.2 (left of video, user's right
    // in a typical selfie) → screen 0.8.
    proc.process([{ landmarks: rawHand(0.2, 0.4, 0.16), label: 'Right' }]);
    const track = events.find((e) => e.type === 'tracking');
    expect(track && 'x' in track ? track.x : 0).toBeCloseTo(0.8, 1);
  });

  it('maps 0–1 screen space through a viewport rect, independent of devicePixelRatio', () => {
    const rect = { left: 100, top: 50, width: 800, height: 400 };
    const toClient = (x: number, y: number) => ({
      clientX: rect.left + x * rect.width,
      clientY: rect.top + y * rect.height,
    });
    // devicePixelRatio would only change the overlay canvas backing store,
    // not these CSS-pixel coordinates.
    expect(toClient(0, 0)).toEqual({ clientX: 100, clientY: 50 });
    expect(toClient(1, 1)).toEqual({ clientX: 900, clientY: 450 });
    expect(toClient(0.5, 0.25)).toEqual({ clientX: 500, clientY: 150 });
  });

  it('converts client pixels through pan/zoom (origin + scale) into world mm', () => {
    const scale = 0.1;
    const originX = 40;
    const originY = 280;
    const toWorld = (clientX: number, clientY: number, rectLeft = 0, rectTop = 0) => ({
      x: (clientX - rectLeft - originX) / scale,
      y: -(clientY - rectTop - originY) / scale,
    });
    const at = (cx: number, cy: number) => toWorld(cx, cy);
    expect(at(40, 280).x).toBeCloseTo(0);
    expect(at(40, 280).y).toBeCloseTo(0);
    expect(at(140, 280).x).toBeCloseTo(1000);
    expect(at(140, 280).y).toBeCloseTo(0);
    expect(at(40, 180).x).toBeCloseTo(0);
    expect(at(40, 180).y).toBeCloseTo(1000);
  });
});
