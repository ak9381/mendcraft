// Pure interaction geometry for the ui-mode palette: where a drop lands in a
// stack (insertion index + indicator line), smart alignment guides for free
// (absolute) dragging, and the row/column heuristic for Shift+A wrap. No DOM —
// everything works on the Boxes produced by layoutFrame, so it unit-tests dry
// and behaves identically for mouse and pinch.

import {
  containsId,
  flowChildren,
  type Box,
  type Frame,
  type StackNode,
  type UiNode,
} from './doc';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Insertion {
  /** Index into parent.children (abs siblings included) to splice at. */
  index: number;
  /** Indicator line in frame-local px. */
  line: Segment;
}

/** Where a drop at frame-local point `p` lands inside `stack`: the child index
 *  to insert at (midpoint rule along the main axis) and the indicator line to
 *  draw in the gap. `excludeId` ignores the node being dragged. */
export function insertionIndex(
  stack: StackNode,
  boxes: Map<string, Box>,
  p: { x: number; y: number },
  excludeId?: string,
): Insertion {
  const sb = boxes.get(stack.id) ?? { x: 0, y: 0, w: 0, h: 0 };
  const pad = stack.padding;
  const inner: Box = { x: sb.x + pad, y: sb.y + pad, w: Math.max(0, sb.w - pad * 2), h: Math.max(0, sb.h - pad * 2) };
  const horizontal = stack.direction === 'row';
  const flow = flowChildren(stack).filter((c) => c.id !== excludeId && boxes.has(c.id));

  let flowIdx = flow.length;
  for (let i = 0; i < flow.length; i++) {
    const b = boxes.get(flow[i].id)!;
    const mid = horizontal ? b.x + b.w / 2 : b.y + b.h / 2;
    if ((horizontal ? p.x : p.y) < mid) {
      flowIdx = i;
      break;
    }
  }

  // Indicator sits in the gap before flow[flowIdx] (or after the last child).
  let pos: number;
  if (flow.length === 0) {
    pos = horizontal ? inner.x : inner.y;
  } else if (flowIdx < flow.length) {
    const b = boxes.get(flow[flowIdx].id)!;
    pos = (horizontal ? b.x : b.y) - stack.gap / 2;
  } else {
    const b = boxes.get(flow[flow.length - 1].id)!;
    pos = (horizontal ? b.x + b.w : b.y + b.h) + stack.gap / 2;
  }
  const line: Segment = horizontal
    ? { x1: pos, y1: inner.y, x2: pos, y2: inner.y + inner.h }
    : { x1: inner.x, y1: pos, x2: inner.x + inner.w, y2: pos };

  // Map the flow index back onto parent.children (abs + dragged included).
  const index =
    flowIdx < flow.length
      ? stack.children.findIndex((c) => c.id === flow[flowIdx].id)
      : stack.children.length;
  return { index, line };
}

/** Deepest stack whose box contains `p`, skipping the dragged subtree. Returns
 *  the frame root when nothing deeper matches, null when outside the frame. */
export function stackAt(
  frame: Frame,
  boxes: Map<string, Box>,
  p: { x: number; y: number },
  excludeId?: string,
): StackNode | null {
  const inside = (b: Box | undefined) => !!b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  let best: StackNode | null = null;
  const walk = (s: StackNode) => {
    if (s.id === excludeId || (excludeId && containsId(s, excludeId) && s.id !== frame.root.id)) {
      // still recurse: only skip the dragged stack itself
    }
    if (s.id === excludeId) return;
    if (!inside(boxes.get(s.id))) return;
    best = s;
    for (const c of s.children) if (c.type === 'stack') walk(c);
  };
  walk(frame.root);
  if (!best && inside(boxes.get(frame.id))) return frame.root;
  return best;
}

// ─── Smart alignment guides ────────────────────────────────────────────────

export interface Guide {
  axis: 'v' | 'h';
  /** Frame-local x (v) or y (h) of the guide line. */
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
}

const edgesX = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
const edgesY = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];

/** Snap a moving box to sibling/frame edges + centres within `tol` px.
 *  Returns the snapped top-left and the pink guide lines to draw. */
export function alignSnap(moving: Box, targets: Box[], tol = 6): SnapResult {
  let bestDx: { d: number; pos: number; t: Box } | null = null;
  let bestDy: { d: number; pos: number; t: Box } | null = null;
  for (const t of targets) {
    for (const mx of edgesX(moving)) {
      for (const tx of edgesX(t)) {
        const d = tx - mx;
        if (Math.abs(d) <= tol && (!bestDx || Math.abs(d) < Math.abs(bestDx.d))) bestDx = { d, pos: tx, t };
      }
    }
    for (const my of edgesY(moving)) {
      for (const ty of edgesY(t)) {
        const d = ty - my;
        if (Math.abs(d) <= tol && (!bestDy || Math.abs(d) < Math.abs(bestDy.d))) bestDy = { d, pos: ty, t };
      }
    }
  }
  const x = moving.x + (bestDx?.d ?? 0);
  const y = moving.y + (bestDy?.d ?? 0);
  const guides: Guide[] = [];
  if (bestDx) {
    guides.push({
      axis: 'v',
      pos: bestDx.pos,
      from: Math.min(y, bestDx.t.y),
      to: Math.max(y + moving.h, bestDx.t.y + bestDx.t.h),
    });
  }
  if (bestDy) {
    guides.push({
      axis: 'h',
      pos: bestDy.pos,
      from: Math.min(x, bestDy.t.x),
      to: Math.max(x + moving.w, bestDy.t.x + bestDy.t.w),
    });
  }
  return { x, y, guides };
}

/** Row when the selection spreads wider than tall (Figma-like Shift+A guess). */
export function wrapDirection(boxes: Box[]): 'row' | 'column' {
  if (boxes.length < 2) return 'column';
  const cx = boxes.map((b) => b.x + b.w / 2);
  const cy = boxes.map((b) => b.y + b.h / 2);
  const spreadX = Math.max(...cx) - Math.min(...cx);
  const spreadY = Math.max(...cy) - Math.min(...cy);
  return spreadX > spreadY ? 'row' : 'column';
}

/** Sibling boxes (plus the frame itself) a dragged node can snap to. */
export function snapTargets(frame: Frame, boxes: Map<string, Box>, movingId: string): Box[] {
  const out: Box[] = [];
  const fb = boxes.get(frame.id);
  if (fb) out.push(fb);
  const walk = (s: StackNode) => {
    for (const c of s.children) {
      if (c.id === movingId) continue;
      if (c.type === 'stack' && containsId(c, movingId)) {
        walk(c);
        continue;
      }
      const b = boxes.get(c.id);
      if (b) out.push(b);
      if (c.type === 'stack') walk(c);
    }
  };
  walk(frame.root);
  return out;
}

/** True when `node` (or its id) is positioned absolutely. */
export function isAbs(node: UiNode | undefined): boolean {
  return !!node && !!node.abs;
}
