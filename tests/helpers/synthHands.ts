// Synthetic 21-landmark hands for the live hand-pointer pipeline tests.
//
// The live cursor is anchored to the PALM CENTRE (handFeel.palmCenter: mean
// of landmarks 0/5/9/13/17), so every helper here builds a hand shape and
// then places it so that palm centre maps exactly to the requested screen
// point through mapToScreen (selfie-mirrored, HAND_FEEL.reach active box).
// Hands are scaled down (wrist→middle-MCP 0.12, still well above
// HAND_FEEL.minHandScale) so a palm near the top of the screen keeps its
// raised fingertips inside the camera frame (no edge-guard clip).
import { REACH } from '../../src/canvas/handPointer';
import { palmCenter } from '../../src/canvas/handFeel';
import type { Pt } from '../../src/input/handLogic';

export const SYNTH_SCALE = 0.6;

/** Inverse of mapToScreen (mirror on x) for a W×H screen. */
export function cameraPointFor(px: number, py: number, W: number, H: number): Pt {
  return {
    x: 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0)),
    y: REACH.y0 + (py / H) * (REACH.y1 - REACH.y0),
  };
}

/** Scale a hand about its palm centre and move that centre onto (px, py). */
export function placePalm(lm: readonly Pt[], px: number, py: number, W: number, H: number, scale = SYNTH_SCALE): Pt[] {
  const c = palmCenter(lm);
  const target = cameraPointFor(px, py, W, H);
  return lm.map((p) => ({ x: target.x + (p.x - c.x) * scale, y: target.y + (p.y - c.y) * scale }));
}

/** An open POINTING hand (index extended, middle/ring/pinky curled) — reads
 *  'point' (or 'pinch' with the thumb closed onto the index tip). */
function pointShape(pinched: boolean): Pt[] {
  const cx = 0.5, cy = 0.2;
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[8] = { x: cx, y: cy }; // index tip
  lm[0] = { x: cx, y: cy + 0.42 }; // wrist
  lm[9] = { x: cx, y: cy + 0.22 }; // middle MCP
  lm[5] = { x: cx, y: cy + 0.22 }; // index MCP
  lm[6] = { x: cx, y: cy + 0.12 }; // index PIP: extended
  lm[7] = { x: cx, y: cy + 0.06 };
  const palmY = cy + 0.26;
  lm[10] = { x: cx + 0.05, y: palmY + 0.04 }; lm[11] = { x: cx + 0.05, y: palmY + 0.02 }; lm[12] = { x: cx + 0.05, y: palmY };
  lm[13] = { x: cx + 0.08, y: cy + 0.22 }; lm[14] = { x: cx + 0.08, y: palmY + 0.04 }; lm[15] = { x: cx + 0.08, y: palmY + 0.02 }; lm[16] = { x: cx + 0.08, y: palmY };
  lm[17] = { x: cx + 0.12, y: cy + 0.22 }; lm[18] = { x: cx + 0.12, y: palmY + 0.04 }; lm[19] = { x: cx + 0.12, y: palmY + 0.02 }; lm[20] = { x: cx + 0.12, y: palmY };
  const gap = pinched ? 0.006 : 0.16;
  lm[1] = { x: cx - gap, y: cy + 0.18 }; lm[2] = { x: cx - gap, y: cy + 0.12 }; lm[3] = { x: cx - gap, y: cy + 0.06 };
  lm[4] = { x: cx - gap, y: cy };
  return lm;
}

/** A genuine FIST: every finger (index included) curled — reads 'fist'. */
function fistShape(): Pt[] {
  const cx = 0.5, cy = 0.5;
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  const wrist = { x: cx, y: cy + 0.2 };
  lm[0] = wrist;
  lm[9] = { x: cx, y: cy };
  lm[5] = { x: cx - 0.04, y: cy + 0.01 };
  lm[13] = { x: cx + 0.04, y: cy + 0.01 };
  lm[17] = { x: cx + 0.08, y: cy + 0.03 };
  lm[8] = { x: cx, y: cy };
  lm[6] = { x: wrist.x + (lm[8].x - wrist.x) * 1.5, y: wrist.y + (lm[8].y - wrist.y) * 1.5 };
  const curl = (pip: number, tip: number, ox: number) => {
    lm[pip] = { x: wrist.x + ox, y: wrist.y - 0.3 };
    lm[tip] = { x: wrist.x + ox, y: wrist.y - 0.03 };
  };
  curl(10, 12, 0.05);
  curl(14, 16, 0.1);
  curl(18, 20, 0.15);
  lm[1] = wrist; lm[2] = wrist; lm[3] = wrist; lm[4] = wrist;
  return lm;
}

export interface SynthOpts {
  /** Override the middle fingertip (landmark 12) to this SCREEN point. */
  middle?: { x: number; y: number };
}

/** Open pointing hand whose PALM CENTRE maps exactly to screen (px, py). */
export function synthHand(px: number, py: number, pinched: boolean, W: number, H: number, opts?: SynthOpts): Pt[] {
  const lm = placePalm(pointShape(pinched), px, py, W, H);
  if (opts?.middle) lm[12] = cameraPointFor(opts.middle.x, opts.middle.y, W, H);
  return lm;
}

/** A fist whose PALM CENTRE maps exactly to screen (px, py). */
export function synthFist(px: number, py: number, W: number, H: number): Pt[] {
  return placePalm(fistShape(), px, py, W, H);
}
