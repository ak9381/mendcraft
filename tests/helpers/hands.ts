// Shared synthetic hand fixtures (21-point MediaPipe topology, pointing up).
import type { Pt } from '../../src/input/handLogic';

const WRIST: Pt = { x: 0.5, y: 1.0 };
const FINGER_X: Record<string, number> = { index: 0.45, middle: 0.5, ring: 0.55, pinky: 0.6 };
const MCP: Record<string, number> = { index: 5, middle: 9, ring: 13, pinky: 17 };
const PIP: Record<string, number> = { index: 6, middle: 10, ring: 14, pinky: 18 };
const TIP: Record<string, number> = { index: 8, middle: 12, ring: 16, pinky: 20 };

export interface HandSpec {
  index?: boolean; middle?: boolean; ring?: boolean; pinky?: boolean;
  thumb?: 'up' | 'curled' | 'pinch';
}

export function makeHand(spec: HandSpec): Pt[] {
  const p: Pt[] = Array.from({ length: 21 }, () => ({ ...WRIST }));
  for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
    const x = FINGER_X[f];
    p[MCP[f]] = { x, y: 0.7 };
    p[PIP[f]] = { x, y: 0.55 };
    p[TIP[f]] = spec[f] ? { x, y: 0.35 } : { x, y: 0.72 };
    p[MCP[f] + 2] = spec[f] ? { x, y: 0.45 } : { x, y: 0.62 };
  }
  p[1] = { x: 0.43, y: 0.9 };
  p[2] = { x: 0.4, y: 0.8 };
  p[3] = { x: 0.37, y: 0.72 };
  if (spec.thumb === 'up') p[4] = { x: 0.3, y: 0.5 };
  else if (spec.thumb === 'pinch') p[4] = { x: p[TIP.index].x - 0.002, y: p[TIP.index].y + 0.002 };
  else p[4] = { x: 0.45, y: 0.78 };
  return p;
}

export const OPEN = (): Pt[] => makeHand({ index: true, middle: true, ring: true, pinky: true, thumb: 'up' });
export const POINT = (): Pt[] => makeHand({ index: true, thumb: 'curled' });
export const PINCH = (): Pt[] => makeHand({ index: true, thumb: 'pinch' });
export const VSIGN = (): Pt[] => makeHand({ index: true, middle: true, thumb: 'curled' });
export const THREE = (): Pt[] => makeHand({ index: true, middle: true, ring: true, thumb: 'curled' });
export const FIST = (): Pt[] => makeHand({ thumb: 'curled' });

/** Scale about the wrist, then move so the wrist sits at (x, y). */
export function place(p: readonly Pt[], x: number, y: number, scale = 1): Pt[] {
  const w = p[0];
  return p.map((q) => ({ x: x + (q.x - w.x) * scale, y: y + (q.y - w.y) * scale }));
}

/** Rotate about the wrist by `deg` degrees. */
export function rotate(p: readonly Pt[], deg: number): Pt[] {
  const w = p[0];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return p.map((q) => ({ x: w.x + (q.x - w.x) * c - (q.y - w.y) * s, y: w.y + (q.x - w.x) * s + (q.y - w.y) * c }));
}

/** Mirror horizontally about the wrist (palm flip as seen by a 2D camera). */
export function mirror(p: readonly Pt[]): Pt[] {
  const w = p[0];
  return p.map((q) => ({ x: w.x - (q.x - w.x), y: q.y }));
}
