// UI-design document model. Pure data + a pure layout function only — no DOM,
// no AI. A UiDoc is a set of device FRAMES (desktop / mobile presets); each
// frame owns a ROOT stack (auto-layout-like: direction row|column, gap,
// padding, align, justify — no wrap). Inside a stack sit typed nodes:
// text / button / input / image / rect, and nested stacks.
//
// This mirrors PlanDoc/PlanOp (see ../../plan/doc.ts): the shell is generic
// over a document + typed ops + validate + engine + renderer + exporter + AI
// schema + rule parser, so a 'ui' mode is just another such document.

export type FramePreset = 'desktop' | 'tablet' | 'mobile';
export type StackDir = 'row' | 'column';
export type Align = 'start' | 'center' | 'end' | 'stretch';
export type Justify = 'start' | 'center' | 'end' | 'between';
export type TextRole = 'heading' | 'body';
export type InputType = 'text' | 'email' | 'password';
export type FontWeight = 400 | 500 | 600 | 700;

export const FRAME_PRESETS: Record<FramePreset, { w: number; h: number; label: string }> = {
  desktop: { w: 1440, h: 900, label: 'Desktop' },
  tablet: { w: 834, h: 1194, label: 'Tablet' },
  mobile: { w: 390, h: 844, label: 'Mobile' },
};

export type SizeMode = 'fixed' | 'fill' | 'hug';
export interface Sizing {
  wMode?: SizeMode;
  w?: number;
  hMode?: SizeMode;
  h?: number;
}

/** Shared optional fields: free (absolute) placement + Figma-style sizing.
 *  A node with `abs` set is out of flow, positioned relative to its parent
 *  stack's box; everything else lays out in the stack flow as before. */
export interface NodeExtras {
  abs?: { x: number; y: number };
  sizing?: Sizing;
}

export interface StackNode extends NodeExtras {
  id: string;
  type: 'stack';
  direction: StackDir;
  gap: number;
  padding: number;
  align: Align;
  justify: Justify;
  /** Optional card background + corner radius (used by pricing cards / sections). */
  fill?: string;
  radius?: number;
  /** Optional fixed width (px) — a centred card/column, e.g. a ~400px login. */
  width?: number;
  children: UiNode[];
}

export interface TextNode extends NodeExtras {
  id: string;
  type: 'text';
  role: TextRole;
  text: string;
  size: number;
  weight: FontWeight;
  color: string;
}

export interface ButtonNode extends NodeExtras {
  id: string;
  type: 'button';
  label: string;
  fill: string;
  textColor: string;
  radius: number;
  height: number;
}

export interface InputNode extends NodeExtras {
  id: string;
  type: 'input';
  label: string;
  placeholder: string;
  inputType: InputType;
  height: number;
}

export interface ImageNode extends NodeExtras {
  id: string;
  type: 'image';
  w: number;
  h: number;
  radius: number;
}

export interface RectNode extends NodeExtras {
  id: string;
  type: 'rect';
  fill: string;
  w: number;
  h: number;
  radius: number;
}

/** Horizontal rule (exports as <hr>). */
export interface DividerNode extends NodeExtras {
  id: string;
  type: 'divider';
  color: string;
  thickness: number;
}

/** Circle icon placeholder (avatar / glyph slot). */
export interface IconNode extends NodeExtras {
  id: string;
  type: 'icon';
  fill: string;
  size: number;
}

export type UiNode = StackNode | TextNode | ButtonNode | InputNode | ImageNode | RectNode | DividerNode | IconNode;
export type UiNodeType = UiNode['type'];

export interface Frame {
  id: string;
  type: 'frame';
  name: string;
  preset: FramePreset;
  w: number;
  h: number;
  background: string;
  root: StackNode;
}

export interface UiDoc {
  frames: Frame[];
  /** Currently selected node/frame id, or null. */
  selectedId: string | null;
}

export function emptyUi(): UiDoc {
  return { frames: [], selectedId: null };
}

// ─── Tree helpers (all pure) ──────────────────────────────────────────────

/** The frame that contains `selectedId` (or the first frame) — the one the
 *  renderer draws and most edits target. */
export function activeFrame(doc: UiDoc): Frame | undefined {
  if (doc.selectedId) {
    const f = doc.frames.find((fr) => fr.id === doc.selectedId || containsId(fr.root, doc.selectedId!));
    if (f) return f;
  }
  return doc.frames[0];
}

export function containsId(stack: StackNode, id: string): boolean {
  for (const c of stack.children) {
    if (c.id === id) return true;
    if (c.type === 'stack' && containsId(c, id)) return true;
  }
  return false;
}

/** Depth-first find of a node by id within a frame (incl. nested stacks). */
export function findNode(frame: Frame, id: string): UiNode | Frame | undefined {
  if (frame.id === id) return frame;
  if (frame.root.id === id) return frame.root;
  const walk = (s: StackNode): UiNode | undefined => {
    for (const c of s.children) {
      if (c.id === id) return c;
      if (c.type === 'stack') {
        const hit = walk(c);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(frame.root);
}

/** Find any node across all frames, plus the frame + parent stack it lives in. */
export function locate(
  doc: UiDoc,
  id: string,
): { frame: Frame; node: UiNode; parent: StackNode | null } | null {
  for (const frame of doc.frames) {
    if (frame.root.id === id) return { frame, node: frame.root, parent: null };
    const search = (parent: StackNode): { node: UiNode; parent: StackNode } | null => {
      for (const c of parent.children) {
        if (c.id === id) return { node: c, parent };
        if (c.type === 'stack') {
          const deep = search(c);
          if (deep) return deep;
        }
      }
      return null;
    };
    const hit = search(frame.root);
    if (hit) return { frame, node: hit.node, parent: hit.parent };
  }
  return null;
}

/** A short human label for a node (list panel + confirmations + a11y). */
export function nodeLabel(node: UiNode | Frame): string {
  switch (node.type) {
    case 'frame': return `Frame · ${node.name} ${node.w}×${node.h}`;
    case 'stack': return `Stack · ${node.direction} · gap ${node.gap}`;
    case 'text': return `${node.role === 'heading' ? 'Heading' : 'Text'} · "${trunc(node.text)}"`;
    case 'button': return `Button · "${trunc(node.label)}"`;
    case 'input': return `Input · ${node.inputType} · "${trunc(node.label || node.placeholder)}"`;
    case 'image': return `Image · ${node.w}×${node.h}`;
    case 'rect': return `Rect · ${node.w}×${node.h}`;
    case 'divider': return 'Divider';
    case 'icon': return `Icon · ${node.size}`;
  }
}

function trunc(s: string, n = 18): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ─── Layout (pure): absolute boxes from the stack tree ────────────────────
// A deterministic flexbox-ish layout used by BOTH the renderer and hit-testing.
// Main axis = direction; cross axis = perpendicular. align=stretch fills the
// cross axis (what makes inputs/buttons full-width in a column form).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rough intrinsic size of a node (content box) before stretching. */
export function intrinsicSize(node: UiNode): { w: number; h: number } {
  const base = ((): { w: number; h: number } => {
    switch (node.type) {
      case 'text': {
        const charW = node.size * 0.56;
        return { w: Math.max(40, Math.round(node.text.length * charW)), h: Math.round(node.size * 1.4) };
      }
      case 'button':
        return { w: Math.max(96, node.label.length * 10 + 48), h: node.height };
      case 'input':
        return { w: 280, h: node.height + (node.label ? 22 : 0) };
      case 'image':
        return { w: node.w, h: node.h };
      case 'rect':
        return { w: node.w, h: node.h };
      case 'divider':
        return { w: 160, h: Math.max(1, node.thickness) };
      case 'icon':
        return { w: node.size, h: node.size };
      case 'stack': {
        const s = stackIntrinsic(node);
        return node.width !== undefined ? { w: node.width, h: s.h } : s;
      }
    }
  })();
  // Fixed sizing overrides the intrinsic measure (fill is resolved in layout).
  const sz = node.sizing;
  return {
    w: sz?.wMode === 'fixed' && sz.w !== undefined ? sz.w : base.w,
    h: sz?.hMode === 'fixed' && sz.h !== undefined ? sz.h : base.h,
  };
}

/** Children that participate in the stack flow (abs nodes are out of flow). */
export function flowChildren(s: StackNode): UiNode[] {
  return s.children.filter((c) => !c.abs);
}

function stackIntrinsic(s: StackNode): { w: number; h: number } {
  const kids = flowChildren(s).map(intrinsicSize);
  const mainIsW = s.direction === 'row';
  let main = 0;
  let cross = 0;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    main += mainIsW ? k.w : k.h;
    cross = Math.max(cross, mainIsW ? k.h : k.w);
    if (i < kids.length - 1) main += s.gap;
  }
  const pad = s.padding * 2;
  return mainIsW ? { w: main + pad, h: cross + pad } : { w: cross + pad, h: main + pad };
}

/** Compute absolute boxes (frame-local coords) for every node in a frame. */
export function layoutFrame(frame: Frame): Map<string, Box> {
  const out = new Map<string, Box>();
  const frameBox: Box = { x: 0, y: 0, w: frame.w, h: frame.h };
  out.set(frame.id, frameBox);
  layoutStack(frame.root, frameBox, out);
  return out;
}

function layoutStack(stack: StackNode, box: Box, out: Map<string, Box>): void {
  out.set(stack.id, box);
  const pad = stack.padding;
  const inner: Box = { x: box.x + pad, y: box.y + pad, w: Math.max(0, box.w - pad * 2), h: Math.max(0, box.h - pad * 2) };
  const mainIsW = stack.direction === 'row';

  // Absolute children: parent-box-relative, out of flow.
  for (const child of stack.children) {
    if (!child.abs) continue;
    const sz = intrinsicSize(child);
    const childBox: Box = { x: box.x + child.abs.x, y: box.y + child.abs.y, w: sz.w, h: sz.h };
    out.set(child.id, childBox);
    if (child.type === 'stack') layoutStack(child, childBox, out);
  }

  const flow = flowChildren(stack);
  const n = flow.length;
  if (n === 0) return;

  const sizes = flow.map(intrinsicSize);
  const innerMain = mainIsW ? inner.w : inner.h;
  const innerCross = mainIsW ? inner.h : inner.w;
  const mainMode = (c: UiNode) => (mainIsW ? c.sizing?.wMode : c.sizing?.hMode);
  const crossMode = (c: UiNode) => (mainIsW ? c.sizing?.hMode : c.sizing?.wMode);

  let totalMain = 0;
  for (let i = 0; i < n; i++) totalMain += mainIsW ? sizes[i].w : sizes[i].h;

  // 'fill' on the main axis: share the leftover space equally.
  const fillIdx = flow.map((c, i) => (mainMode(c) === 'fill' ? i : -1)).filter((i) => i >= 0);
  const leftover = Math.max(0, innerMain - totalMain - stack.gap * (n - 1));
  const fillExtra = fillIdx.length ? leftover / fillIdx.length : 0;
  const mainSize = (i: number) =>
    (mainIsW ? sizes[i].w : sizes[i].h) + (fillIdx.includes(i) ? fillExtra : 0);
  totalMain += fillExtra * fillIdx.length;
  const free = innerMain - totalMain;

  let gap = stack.gap;
  let start = 0;
  if (stack.justify === 'between' && n > 1) {
    gap = Math.max(stack.gap, (innerMain - totalMain) / (n - 1));
  } else {
    const usableFree = free - stack.gap * (n - 1);
    if (stack.justify === 'center') start = usableFree / 2;
    else if (stack.justify === 'end') start = usableFree;
  }

  let cursor = (mainIsW ? inner.x : inner.y) + Math.max(0, start);
  for (let i = 0; i < n; i++) {
    const child = flow[i];
    const cm = mainSize(i);
    const intrinsicCross = mainIsW ? sizes[i].h : sizes[i].w;
    // A stack with an explicit width keeps it (a centred card) even inside a
    // stretch parent; everything else stretches to fill the cross axis.
    const fixedCross = (!mainIsW && child.type === 'stack' && child.width !== undefined) || crossMode(child) === 'fixed' || crossMode(child) === 'hug';
    const stretch = crossMode(child) === 'fill' ||
      (stack.align === 'stretch' && child.type !== 'image' && child.type !== 'icon' && !fixedCross);
    const cc = stretch ? innerCross : Math.min(intrinsicCross, innerCross);
    let crossPos = mainIsW ? inner.y : inner.x;
    if (!stretch) {
      if (stack.align === 'center') crossPos += (innerCross - cc) / 2;
      else if (stack.align === 'end') crossPos += innerCross - cc;
    }
    const childBox: Box = mainIsW
      ? { x: cursor, y: crossPos, w: cm, h: cc }
      : { x: crossPos, y: cursor, w: cc, h: cm };
    out.set(child.id, childBox);
    if (child.type === 'stack') layoutStack(child, childBox, out);
    cursor += cm + gap;
  }
}
