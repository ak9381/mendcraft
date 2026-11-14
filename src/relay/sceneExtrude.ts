// PURE extrude geometry for the /control dashboard's fullscreen 3D review.
//
// The iPad only ever receives the privacy-safe ControlSnapshot — compact 2D
// ScenePrimitives (plan wall segments, part/ui boxes), never the full PlanDoc
// (which stays on the laptop). So the dashboard can't call the editor's
// extrude3d (that needs a PlanDoc). Instead it extrudes exactly what crossed the
// wire: each wall segment becomes a box, each box primitive a low slab. Same
// z-up box convention as plan/extrude3d, so the review matches the editor.
//
// This module is DOM-free and three.js-free so the geometry is unit-testable;
// sceneView3d.ts turns these boxes into meshes.

import type { ScenePrimitive } from './controlSnapshot';

/** Fallbacks for the dimensions the privacy snapshot deliberately omits — wall
 *  thickness/height never leave the device, so the review uses sensible mm
 *  defaults (matches plan DEFAULTS.wallHeight = 2500). */
export const DEFAULT_WALL_HEIGHT = 2500;
export const DEFAULT_WALL_THICKNESS = 120;
/** A box primitive (part/ui snapshot) is shown as a thin floor slab. */
export const DEFAULT_SLAB = 120;

export interface ExtrudeOptions {
  wallHeight?: number;
  wallThickness?: number;
  slab?: number;
}

/** One axis-aligned-then-rotated box: centre (cx,cy,cz), size (len×width×depth),
 *  spun `angle` radians about the z axis. `kind` only tints the mesh. */
export interface ExtrudedBox {
  cx: number;
  cy: number;
  cz: number;
  len: number;
  width: number;
  depth: number;
  angle: number;
  kind: 'wall' | 'slab';
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A camera framing that fits the whole model: where to orbit around (`target`)
 *  and a good starting eye position. `radius` is the model's bounding radius. */
export interface CameraFrame {
  target: Vec3;
  position: Vec3;
  radius: number;
}

export interface ExtrudedScene {
  boxes: ExtrudedBox[];
  frame: CameraFrame;
}

function len2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * Extrude the snapshot's 2D primitives into 3D boxes plus a camera frame.
 * Deterministic and pure — no clock, DOM or three.js — so it is unit-testable.
 */
export function extrudeScene(
  primitives: readonly ScenePrimitive[],
  opts: ExtrudeOptions = {},
): ExtrudedScene {
  const height = opts.wallHeight && opts.wallHeight > 0 ? opts.wallHeight : DEFAULT_WALL_HEIGHT;
  const thickness =
    opts.wallThickness && opts.wallThickness > 0 ? opts.wallThickness : DEFAULT_WALL_THICKNESS;
  const slab = opts.slab && opts.slab > 0 ? opts.slab : DEFAULT_SLAB;

  const boxes: ExtrudedBox[] = [];
  // Track bounds in the plan's 2D footprint to frame the camera.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const stretch = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const p of primitives) {
    if (p.t === 'seg') {
      const dx = p.x2 - p.x1;
      const dy = p.y2 - p.y1;
      const len = len2(dx, dy);
      if (len <= 1) continue; // a zero-length wall is nothing to extrude
      boxes.push({
        cx: (p.x1 + p.x2) / 2,
        cy: (p.y1 + p.y2) / 2,
        cz: height / 2,
        len,
        width: thickness,
        depth: height,
        angle: Math.atan2(dy, dx),
        kind: 'wall',
      });
      stretch(p.x1, p.y1);
      stretch(p.x2, p.y2);
    } else {
      const w = Math.abs(p.w);
      const h = Math.abs(p.h);
      if (w < 1 && h < 1) continue;
      boxes.push({
        cx: p.x + p.w / 2,
        cy: p.y + p.h / 2,
        cz: slab / 2,
        len: w || 1,
        width: h || 1,
        depth: slab,
        angle: 0,
        kind: 'slab',
      });
      stretch(p.x, p.y);
      stretch(p.x + p.w, p.y + p.h);
    }
  }

  return { boxes, frame: frameCamera(boxes.length ? { minX, minY, maxX, maxY } : null, height) };
}

/** Pick an orbit target (model centre) and an eye position that sees the whole
 *  footprint from a raised corner, mirroring plan/extrude3d's starting view. */
export function frameCamera(
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  height: number,
): CameraFrame {
  if (!bounds) {
    // Nothing extruded yet — a stable default so the viewport still orbits.
    const r = Math.max(height, 1000);
    return { target: { x: 0, y: 0, z: height / 2 }, position: { x: r, y: -r, z: r }, radius: r };
  }
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const radius = Math.max(len2(spanX, spanY) / 2, height, 500);
  return {
    target: { x: cx, y: cy, z: height / 2 },
    // Raised corner looking back at the centre (south-east, above).
    position: { x: cx + radius * 1.6, y: cy - radius * 2, z: radius * 1.7 },
    radius,
  };
}
