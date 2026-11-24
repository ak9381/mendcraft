// Low-poly glass hand geometry: pure (MediaPipe-free, DOM-free) mesh builder +
// a canvas 2d draw function. Meant to eventually replace the skeleton drawn
// by handOverlay.ts's drawSkeleton. Topology (triangle indices, outline loop,
// per-vertex pastel colours) is FIXED at mesh creation — buildLowpolyHand only
// ever rewrites vertex positions in place, so drawing a hand every frame costs
// zero array allocation.
//
// Shape: 21 MediaPipe landmarks are widened into 5 two-sided finger strips
// (lateral L/R offsets + a pointed tip apex) rooted in a 6-point palm fan
// (wrist, thumb root, four MCPs) with palm-edge midpoints for low-poly detail.

export interface Pt { x: number; y: number }

export interface LowpolyMesh {
  /** Flat [x0,y0,x1,y1,...], length VERTEX_COUNT*2. Rewritten in place every build. */
  verts: Float32Array;
  /** Flat [r,g,b] per vertex, 0..255. Fixed pastel palette, set once. */
  vertColors: Uint8ClampedArray;
  /** Triangle vertex index list, length TRIANGLE_COUNT*3. Fixed. */
  indices: Uint16Array;
  /** Precomputed flat "rgb(r,g,b)" fill colour per triangle. Fixed. */
  triColors: string[];
  /** Deduped triangle edges, length numEdges*2. Fixed. */
  edges: Uint16Array;
  /** Ordered vertex indices forming the closed outer silhouette. Fixed. */
  outline: Uint16Array;
  /** Vertex that sits exactly on the index fingertip landmark (8). */
  tipVertex: number;
}

/** Coral cap colour for the index fingertip — exported so the cursor can match it. */
export const CORAL_TIP_RGB: readonly [number, number, number] = [240, 122, 96];
export const CORAL_TIP_COLOR = '#f07a60';

const FINGERS = [
  { lm: [1, 2, 3, 4], width: 0.72, root: [232, 214, 150], mid: [238, 203, 130], tip: [235, 196, 120] }, // thumb
  { lm: [5, 6, 7, 8], width: 0.62, root: [238, 196, 178], mid: [188, 160, 214], tip: [...CORAL_TIP_RGB] }, // index
  { lm: [9, 10, 11, 12], width: 0.62, root: [205, 185, 222], mid: [196, 172, 224], tip: [190, 165, 222] }, // middle
  { lm: [13, 14, 15, 16], width: 0.56, root: [180, 186, 224], mid: [170, 182, 228], tip: [160, 178, 232] }, // ring
  { lm: [17, 18, 19, 20], width: 0.48, root: [165, 185, 230], mid: [150, 178, 235], tip: [140, 172, 238] }, // pinky
] as const;
const INDEX_FINGER = 1;
/** Soft taper so fingers stay chubby (mockup look) instead of coming to a
 *  thin point. */
const TAPER = [1, 0.9, 0.8, 0.65] as const;
/** How far the palm ring pushes outward from its centroid, in handScale units
 *  — turns the ring fan into a full wide pad instead of a skinny star between
 *  the MCPs. */
const PALM_INFLATE = 0.18;
/** Default fill alpha (the mesh is meant to read as glass, more transparent
 *  than the approved mockup) — opts.alpha in drawLowpolyHand multiplies on
 *  top of this for fades. */
export const LOWPOLY_FILL_ALPHA = 0.6;

/** Palm ring, in fan order: wrist, then each finger's root landmark. */
const RING_LM = [0, 1, 5, 9, 13, 17] as const;
const RING_COUNT = RING_LM.length;
const AQUA: number[] = [145, 224, 206];

const CENTROID_INDEX = RING_COUNT * 2; // after ring (0..5) + mids (6..11)
const FINGER_BASE0 = CENTROID_INDEX + 1; // 13
const FINGER_STRIDE = 10; // L0,R0,L1,R1,L2,R2,L3,R3, center3, apex
const fingerBase = (f: number) => FINGER_BASE0 + f * FINGER_STRIDE;
const vL = (f: number, j: number) => fingerBase(f) + j * 2;
const vR = (f: number, j: number) => fingerBase(f) + j * 2 + 1;
const vCenter3 = (f: number) => fingerBase(f) + 8;
const vApex = (f: number) => fingerBase(f) + 9;

export const VERTEX_COUNT = FINGER_BASE0 + FINGERS.length * FINGER_STRIDE;

function lerp3(a: readonly number[], b: readonly number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function buildTopology(): {
  indices: Uint16Array;
  outline: Uint16Array;
  vertColors: Uint8ClampedArray;
} {
  const tris: number[] = [];

  // Palm fan: ring[i] -> mid[i] -> ring[i+1], mid[i] -> centroid.
  for (let i = 0; i < RING_COUNT; i++) {
    const a = i;
    const b = (i + 1) % RING_COUNT;
    const mid = RING_COUNT + i;
    tris.push(a, mid, CENTROID_INDEX);
    tris.push(mid, b, CENTROID_INDEX);
  }

  FINGERS.forEach((_, f) => {
    const ringIdx = f + 1; // thumb=1 .. pinky=5 (wrist=0 has no finger)
    tris.push(ringIdx, vL(f, 0), vR(f, 0)); // base cap
    for (let j = 0; j < 3; j++) {
      tris.push(vL(f, j), vR(f, j), vL(f, j + 1));
      tris.push(vR(f, j), vL(f, j + 1), vR(f, j + 1));
    }
    tris.push(vL(f, 3), vApex(f), vCenter3(f));
    tris.push(vCenter3(f), vApex(f), vR(f, 3));
  });

  // Outline: wrist -> mid[0] -> (thumb .. pinky: ring, L chain, apex, R chain, mid) -> back to wrist.
  const outline: number[] = [0, RING_COUNT + 0];
  FINGERS.forEach((_, f) => {
    const ringIdx = f + 1;
    outline.push(ringIdx, vL(f, 0), vL(f, 1), vL(f, 2), vL(f, 3), vApex(f), vR(f, 3), vR(f, 2), vR(f, 1), vR(f, 0));
    outline.push(RING_COUNT + ringIdx); // mid between this finger root and the next ring point (wraps for pinky)
  });

  const vertColors = new Uint8ClampedArray(VERTEX_COUNT * 3);
  const ringColors = [AQUA, FINGERS[0].root, FINGERS[1].root, FINGERS[2].root, FINGERS[3].root, FINGERS[4].root];
  const setColor = (v: number, c: readonly number[]) => {
    vertColors[v * 3] = c[0]; vertColors[v * 3 + 1] = c[1]; vertColors[v * 3 + 2] = c[2];
  };
  for (let i = 0; i < RING_COUNT; i++) setColor(i, ringColors[i]);
  for (let i = 0; i < RING_COUNT; i++) {
    setColor(RING_COUNT + i, lerp3(ringColors[i], ringColors[(i + 1) % RING_COUNT], 0.5));
  }
  const avg = ringColors.reduce((acc, c) => [acc[0] + c[0] / RING_COUNT, acc[1] + c[1] / RING_COUNT, acc[2] + c[2] / RING_COUNT], [0, 0, 0]);
  setColor(CENTROID_INDEX, avg);
  FINGERS.forEach((fdef, f) => {
    setColor(vL(f, 0), lerp3(fdef.root, fdef.mid, 0));
    setColor(vR(f, 0), lerp3(fdef.root, fdef.mid, 0));
    setColor(vL(f, 1), lerp3(fdef.root, fdef.mid, 0.5));
    setColor(vR(f, 1), lerp3(fdef.root, fdef.mid, 0.5));
    setColor(vL(f, 2), fdef.mid);
    setColor(vR(f, 2), fdef.mid);
    setColor(vL(f, 3), lerp3(fdef.mid, fdef.tip, 0.6));
    setColor(vR(f, 3), lerp3(fdef.mid, fdef.tip, 0.6));
    setColor(vCenter3(f), lerp3(fdef.mid, fdef.tip, 0.92));
    setColor(vApex(f), fdef.tip);
  });

  return { indices: Uint16Array.from(tris), outline: Uint16Array.from(outline), vertColors };
}

function buildEdges(indices: Uint16Array): Uint16Array {
  const seen = new Set<number>();
  const edges: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    for (let i = 0; i < 3; i++) {
      const a = tri[i];
      const b = tri[(i + 1) % 3];
      const key = a < b ? a * VERTEX_COUNT + b : b * VERTEX_COUNT + a;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  }
  return Uint16Array.from(edges);
}

function triColor(vertColors: Uint8ClampedArray, a: number, b: number, c: number): string {
  const r = Math.round((vertColors[a * 3] + vertColors[b * 3] + vertColors[c * 3]) / 3);
  const g = Math.round((vertColors[a * 3 + 1] + vertColors[b * 3 + 1] + vertColors[c * 3 + 1]) / 3);
  const bl = Math.round((vertColors[a * 3 + 2] + vertColors[b * 3 + 2] + vertColors[c * 3 + 2]) / 3);
  return `rgb(${r},${g},${bl})`;
}

export function createLowpolyMesh(): LowpolyMesh {
  const { indices, outline, vertColors } = buildTopology();
  const edges = buildEdges(indices);
  const triColors: string[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    triColors.push(triColor(vertColors, indices[t], indices[t + 1], indices[t + 2]));
  }
  return {
    verts: new Float32Array(VERTEX_COUNT * 2),
    vertColors,
    indices,
    triColors,
    edges,
    outline,
    tipVertex: vCenter3(INDEX_FINGER),
  };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Build/update a low-poly hand mesh from 21 MediaPipe-style landmarks.
 *  Pass a previously-returned mesh back in to rewrite its verts in place —
 *  the only allocation is on first call (when `mesh` is omitted). */
export function buildLowpolyHand(landmarks: readonly Pt[], mesh: LowpolyMesh = createLowpolyMesh()): LowpolyMesh {
  const P = mesh.verts;
  const lx = (i: number) => landmarks[i].x;
  const ly = (i: number) => landmarks[i].y;
  const setV = (v: number, x: number, y: number) => { P[v * 2] = x; P[v * 2 + 1] = y; };

  const handScale = Math.max(1e-6, dist(lx(0), ly(0), lx(9), ly(9)));

  const ringLm = RING_LM;
  // Palm fan pushed outward from its own centroid so it reads as a full wide
  // pad (mockup look), not a thin fan strung between the MCPs.
  let rawCx = 0, rawCy = 0;
  for (let i = 0; i < RING_COUNT; i++) { rawCx += lx(ringLm[i]); rawCy += ly(ringLm[i]); }
  rawCx /= RING_COUNT; rawCy /= RING_COUNT;
  const inflate = handScale * PALM_INFLATE;
  for (let i = 0; i < RING_COUNT; i++) {
    const rx = lx(ringLm[i]); const ry = ly(ringLm[i]);
    const dx = rx - rawCx; const dy = ry - rawCy;
    const dlen = Math.hypot(dx, dy) || 1;
    setV(i, rx + (dx / dlen) * inflate, ry + (dy / dlen) * inflate);
  }
  for (let i = 0; i < RING_COUNT; i++) {
    const a = i;
    const b = (i + 1) % RING_COUNT;
    setV(RING_COUNT + i, (P[a * 2] + P[b * 2]) / 2, (P[a * 2 + 1] + P[b * 2 + 1]) / 2);
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < RING_COUNT; i++) { cx += P[i * 2]; cy += P[i * 2 + 1]; }
  setV(CENTROID_INDEX, cx / RING_COUNT, cy / RING_COUNT);

  FINGERS.forEach((fdef, f) => {
    const lm = fdef.lm;
    const pts: Pt[] = lm.map((i) => landmarks[i]);
    for (let j = 0; j < 4; j++) {
      const prev = pts[Math.max(0, j - 1)];
      const next = pts[Math.min(3, j + 1)];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const tlen = Math.hypot(tx, ty) || 1;
      tx /= tlen; ty /= tlen;
      const nx = -ty, ny = tx; // perpendicular, consistent winding
      const width = (fdef.width * TAPER[j] * handScale) / 2;
      const p = pts[j];
      setV(vL(f, j), p.x + nx * width, p.y + ny * width);
      setV(vR(f, j), p.x - nx * width, p.y - ny * width);
      if (j === 3) {
        setV(vCenter3(f), p.x, p.y);
        // Apex sits on (or only just past) the tip — a curled/fist pose can
        // make the last segment short or its direction noisy, so the
        // extension is clamped to a small multiple of handScale, never the
        // long spike the old `segLen * 0.8` produced.
        const segLen = Math.hypot(p.x - pts[2].x, p.y - pts[2].y);
        const ext = Math.min(segLen * 0.35, handScale * 0.05);
        setV(vApex(f), p.x + tx * ext, p.y + ty * ext);
      }
    }
  });

  return mesh;
}

export const TRIANGLE_COUNT = RING_COUNT * 2 + FINGERS.length * (1 + 6 + 2);

export interface DrawLowpolyOptions {
  /** Global alpha multiplier (fade in/out). */
  alpha?: number;
}

/** Draw one hand's low-poly mesh: flat faceted triangle fills, faint white
 *  edges, then a faint white outer rim. One ctx, batched edge/outline paths. */
export function drawLowpolyHand(ctx: CanvasRenderingContext2D, mesh: LowpolyMesh, opts: DrawLowpolyOptions = {}): void {
  const { verts, indices, triColors, edges, outline } = mesh;
  const alpha = opts.alpha ?? 1;

  ctx.globalAlpha = LOWPOLY_FILL_ALPHA * alpha;
  for (let t = 0, c = 0; t < indices.length; t += 3, c++) {
    const a = indices[t], b = indices[t + 1], cc = indices[t + 2];
    ctx.beginPath();
    ctx.moveTo(verts[a * 2], verts[a * 2 + 1]);
    ctx.lineTo(verts[b * 2], verts[b * 2 + 1]);
    ctx.lineTo(verts[cc * 2], verts[cc * 2 + 1]);
    ctx.closePath();
    ctx.fillStyle = triColors[c];
    ctx.fill();
  }

  ctx.globalAlpha = 0.22 * alpha;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e], b = edges[e + 1];
    ctx.moveTo(verts[a * 2], verts[a * 2 + 1]);
    ctx.lineTo(verts[b * 2], verts[b * 2 + 1]);
  }
  ctx.stroke();

  ctx.globalAlpha = 0.5 * alpha;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(verts[outline[0] * 2], verts[outline[0] * 2 + 1]);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(verts[outline[i] * 2], verts[outline[i] * 2 + 1]);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = 1;
}
