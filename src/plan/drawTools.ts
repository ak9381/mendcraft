// Pure state machines + constraints for the plan drawing tools (no DOM):
// the wall polyline chain, the 45°-increment ortho constraint, and rectangle
// normalization for the room tool. Unit-tested in tests/planTools.test.ts.

import type { Point } from './doc';

/** Snap `moving` onto the nearest 45°-increment ray through `anchor` (ortho by
 *  default: horizontal/vertical/diagonal). Length along the ray is preserved. */
export function ortho45(anchor: Point, moving: Point): Point {
  const dx = moving.x - anchor.x;
  const dy = moving.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { ...moving };
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + Math.cos(ang) * len, y: anchor.y + Math.sin(ang) * len };
}

export interface WallChainState {
  pts: Point[];
}

export const emptyChain = (): WallChainState => ({ pts: [] });

export interface ChainResult {
  state: WallChainState;
  /** A wall segment to commit (click extended the chain). */
  wall?: { a: Point; b: Point };
  /** Chain ended (clicked on/near the last point = double-click finish). */
  finished?: boolean;
}

/** Advance the click-click wall chain. First click anchors; each further click
 *  emits a wall from the previous point. A click within `minLen` of the last
 *  point finishes the chain (double-click behaviour). */
export function chainClick(state: WallChainState, p: Point, minLen = 100): ChainResult {
  if (state.pts.length === 0) return { state: { pts: [p] } };
  const last = state.pts[state.pts.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) < minLen) {
    return { state: emptyChain(), finished: true };
  }
  return { state: { pts: [...state.pts, p] }, wall: { a: last, b: p } };
}

/** Normalize two drag corners into an {x, y, w, h} rectangle (w/h >= 0). */
export function normRect(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}
