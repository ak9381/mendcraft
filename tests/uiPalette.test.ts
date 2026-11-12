// UI-mode palette logic: insertion index + indicator, alignment-guide
// snapping, sizing modes in layout, wrap-in-stack, batch undo/redo, and the
// HTML export of absolute children + the new components. All pure — no DOM.

import { describe, expect, it } from 'vitest';
import {
  layoutFrame,
  type Frame,
  type StackNode,
  type UiDoc,
} from '../src/ui/design/doc';
import { alignSnap, insertionIndex, stackAt, wrapDirection } from '../src/ui/design/editing';
import { validateUiOp } from '../src/ui/design/ops';
import { UiEngine } from '../src/ui/design/engine';
import { toHtml, toSvg } from '../src/ui/design/export';

function run(engine: UiEngine, env: Record<string, unknown>) {
  const v = validateUiOp(env);
  if (!v.ok) return { ok: false as const, error: v.error };
  return engine.apply(v.op);
}
function mustRun(engine: UiEngine, env: Record<string, unknown>) {
  const r = run(engine, env);
  if (!r.ok) throw new Error(`${JSON.stringify(env)} => ${'error' in r ? r.error : '?'}`);
  return r;
}
function frameOf(engine: UiEngine): Frame {
  const doc = engine.getState() as UiDoc;
  return doc.frames[0];
}

/** Desktop frame with a column stack of three buttons inside the root. */
function engineWithColumn(): { engine: UiEngine; stack: StackNode; frame: Frame } {
  const engine = new UiEngine();
  mustRun(engine, { op: 'add_frame', preset: 'desktop' });
  mustRun(engine, { op: 'add_node', nodeType: 'stack' });
  const stackId = engine.getState().selectedId!;
  for (const label of ['One', 'Two', 'Three']) {
    mustRun(engine, { op: 'add_node', nodeType: 'button', parent: stackId, label });
  }
  const frame = frameOf(engine);
  const stack = frame.root.children.find((c) => c.id === stackId) as StackNode;
  return { engine, stack, frame };
}

describe('insertion index + indicator', () => {
  it('computes before / between / after from the pointer along the main axis', () => {
    const { stack, frame } = engineWithColumn();
    const boxes = layoutFrame(frame);
    const b0 = boxes.get(stack.children[0].id)!;
    const b1 = boxes.get(stack.children[1].id)!;
    const b2 = boxes.get(stack.children[2].id)!;
    // Above the first child's midpoint → index 0.
    expect(insertionIndex(stack, boxes, { x: b0.x + 5, y: b0.y + 1 }).index).toBe(0);
    // Between first and second (below b0 mid, above b1 mid) → index 1.
    expect(insertionIndex(stack, boxes, { x: b1.x + 5, y: b1.y + 1 }).index).toBe(1);
    // Below the last child's midpoint → append (index 3).
    expect(insertionIndex(stack, boxes, { x: b2.x + 5, y: b2.y + b2.h - 1 }).index).toBe(3);
  });

  it('draws a horizontal indicator line in the gap of a column stack', () => {
    const { stack, frame } = engineWithColumn();
    const boxes = layoutFrame(frame);
    const b1 = boxes.get(stack.children[1].id)!;
    const ins = insertionIndex(stack, boxes, { x: b1.x + 5, y: b1.y + 1 });
    expect(ins.line.y1).toBe(ins.line.y2); // horizontal
    expect(ins.line.y1).toBeCloseTo(b1.y - stack.gap / 2, 0);
  });

  it('excludes the dragged node and maps back to parent.children indices', () => {
    const { stack, frame } = engineWithColumn();
    const boxes = layoutFrame(frame);
    const dragged = stack.children[0].id;
    const b2 = boxes.get(stack.children[2].id)!;
    const ins = insertionIndex(stack, boxes, { x: b2.x + 5, y: b2.y + b2.h - 1 }, dragged);
    expect(ins.index).toBe(3); // after the last child in the full array
  });

  it('stackAt finds the deepest stack, falling back to the frame root', () => {
    const { stack, frame } = engineWithColumn();
    const boxes = layoutFrame(frame);
    const sb = boxes.get(stack.id)!;
    expect(stackAt(frame, boxes, { x: sb.x + 5, y: sb.y + 5 })?.id).toBe(stack.id);
    // Far corner of the frame outside the (hug-height) stack → root.
    expect(stackAt(frame, boxes, { x: 5, y: frame.h - 5 })?.id).toBe(frame.root.id);
    expect(stackAt(frame, boxes, { x: -50, y: -50 })).toBeNull();
  });
});

describe('alignment-guide snapping', () => {
  const sibling = { x: 100, y: 100, w: 200, h: 50 };
  it('snaps edges within tolerance and reports guide lines', () => {
    const moving = { x: 104, y: 300, w: 80, h: 40 };
    const snap = alignSnap(moving, [sibling], 6);
    expect(snap.x).toBe(100); // left edge snapped to sibling's left
    expect(snap.y).toBe(300); // nothing vertical in range
    const v = snap.guides.find((g) => g.axis === 'v');
    expect(v?.pos).toBe(100);
    expect(v && v.from <= 100 && v.to >= 340).toBe(true); // spans both boxes
  });
  it('snaps centres too', () => {
    const moving = { x: 158, y: 300, w: 80, h: 40 }; // centre 198 vs sibling centre 200
    const snap = alignSnap(moving, [sibling], 6);
    expect(snap.x + 40).toBe(200);
  });
  it('does not snap beyond the tolerance', () => {
    const moving = { x: 110, y: 300, w: 81, h: 40 };
    const snap = alignSnap(moving, [sibling], 6);
    expect(snap.x).toBe(110);
    expect(snap.guides.filter((g) => g.axis === 'v')).toHaveLength(0);
  });
  it('wrapDirection guesses row for side-by-side boxes', () => {
    expect(wrapDirection([{ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }])).toBe('row');
    expect(wrapDirection([{ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 100, w: 10, h: 10 }])).toBe('column');
  });
});

describe('sizing modes in layout', () => {
  it('fixed overrides intrinsic, fill shares leftover space, hug keeps content size', () => {
    const { engine, stack } = engineWithColumn();
    // Make the stack a fixed 300px-tall row of two: one fixed 100, one fill.
    mustRun(engine, { op: 'set_layout', target: stack.id, direction: 'row', nums: { gap: 10, padding: 0 } });
    const [a, b, c] = stack.children.map((ch) => ch.id);
    mustRun(engine, { op: 'delete', target: c });
    mustRun(engine, { op: 'set_sizing', target: stack.id, wMode: 'fixed', hMode: 'fixed', nums: { w: 510, h: 60 } });
    mustRun(engine, { op: 'set_sizing', target: a, wMode: 'fixed', nums: { w: 100 } });
    mustRun(engine, { op: 'set_sizing', target: b, wMode: 'fill' });
    const frame = frameOf(engine);
    const boxes = layoutFrame(frame);
    const sb = boxes.get(stack.id)!;
    expect(sb.w).toBe(510);
    expect(boxes.get(a)!.w).toBe(100);
    // fill child takes the leftover: 510 - 100 - its intrinsic is absorbed —
    // a + gap + b spans the full inner width.
    expect(boxes.get(b)!.x + boxes.get(b)!.w).toBeCloseTo(sb.x + 510, 0);
    expect(boxes.get(b)!.w).toBeCloseTo(510 - 100 - 10, 0);
  });

  it('hug (default) keeps the intrinsic size', () => {
    const { stack, frame } = engineWithColumn();
    const boxes = layoutFrame(frame);
    const b0 = boxes.get(stack.children[0].id)!;
    expect(b0.h).toBe(44); // button intrinsic height, no stretching on main axis
  });
});

describe('wrap-in-stack op (Shift+A)', () => {
  it('wraps two siblings into a new stack at their position, undoably', () => {
    const { engine, stack } = engineWithColumn();
    const [a, b] = stack.children.map((c) => c.id);
    const r = mustRun(engine, { op: 'wrap', targets: [a, b], direction: 'row' });
    expect(r.ok).toBe(true);
    const after = frameOf(engine).root.children.find((c) => c.id === stack.id) as StackNode;
    expect(after.children).toHaveLength(2); // wrapper + remaining button
    const wrapper = after.children[0] as StackNode;
    expect(wrapper.type).toBe('stack');
    expect(wrapper.direction).toBe('row');
    expect(wrapper.children.map((c) => c.id)).toEqual([a, b]);
    expect(engine.getState().selectedId).toBe(wrapper.id);
    engine.undo();
    const undone = frameOf(engine).root.children.find((c) => c.id === stack.id) as StackNode;
    expect(undone.children.map((c) => c.id)[0]).toBe(a);
    expect(undone.children).toHaveLength(3);
  });
});

describe('batch ops undo/redo', () => {
  it('applies atomically as ONE undo step and rolls back entirely on failure', () => {
    const engine = new UiEngine();
    mustRun(engine, { op: 'add_frame', preset: 'desktop' });
    const rootKids = () => frameOf(engine).root.children.length;
    mustRun(engine, {
      op: 'batch',
      ops: [
        { op: 'add_node', nodeType: 'button', label: 'A' },
        { op: 'add_node', nodeType: 'button', label: 'B' },
      ],
    });
    // add_node targets the selected node's stack; both land somewhere in the tree.
    const afterBatch = JSON.stringify(frameOf(engine));
    expect(rootKids()).toBeGreaterThan(0);
    engine.undo();
    expect(rootKids()).toBe(0); // one undo removed both
    engine.redo();
    expect(JSON.stringify(frameOf(engine))).toBe(afterBatch);
    // A batch with a failing op leaves the doc untouched.
    const before = JSON.stringify(engine.getState());
    const bad = run(engine, { op: 'batch', ops: [{ op: 'add_node', nodeType: 'button' }, { op: 'delete', target: 'nope-xyz' }] });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(engine.getState())).toBe(before);
  });

  it('duplicate clones with fresh ids and offsets absolute copies', () => {
    const engine = new UiEngine();
    mustRun(engine, { op: 'add_frame', preset: 'desktop' });
    mustRun(engine, { op: 'add_node', nodeType: 'rect', nums: { x: 50, y: 60 } });
    const orig = engine.getState().selectedId!;
    mustRun(engine, { op: 'duplicate', target: orig });
    const copy = engine.getState().selectedId!;
    expect(copy).not.toBe(orig);
    const kids = frameOf(engine).root.children;
    expect(kids).toHaveLength(2);
    const copyNode = kids.find((c) => c.id === copy)!;
    expect(copyNode.abs).toEqual({ x: 62, y: 72 });
  });
});

describe('export: absolute children + new components', () => {
  function build(): UiEngine {
    const engine = new UiEngine();
    mustRun(engine, { op: 'add_frame', preset: 'desktop' });
    mustRun(engine, { op: 'add_node', nodeType: 'navbar' });
    mustRun(engine, { op: 'add_node', nodeType: 'card', parent: 'root' });
    mustRun(engine, { op: 'add_node', nodeType: 'divider', parent: 'root' });
    mustRun(engine, { op: 'add_node', nodeType: 'icon', parent: 'root' });
    mustRun(engine, { op: 'add_node', nodeType: 'button', parent: 'root', label: 'Free', nums: { x: 40, y: 500 } });
    return engine;
  }

  it('absolute child exports position:absolute inside a position:relative parent', () => {
    const html = toHtml(frameOf(build()));
    expect(html).toContain('position:relative');
    expect(html).toContain('position:absolute;left:40px;top:500px');
  });

  it('new components export as nav-like row, card, <hr>, and circle icon', () => {
    const html = toHtml(frameOf(build()));
    expect(html).toContain('<hr');
    expect(html).toContain('border-radius:50%');
    expect(html).toContain('justify-content:space-between'); // navbar row
    expect(html).toMatch(/Card title/);
    expect(html).toContain('Sign up');
  });

  it('sizing modes export as width px / flex grow', () => {
    const engine = build();
    const sel = engine.getState().selectedId!;
    mustRun(engine, { op: 'set_sizing', target: sel, wMode: 'fixed', nums: { w: 222 } });
    const html = toHtml(frameOf(engine));
    expect(html).toContain('width:222px');
  });

  it('svg export covers divider + icon', () => {
    const svg = toSvg(frameOf(build()));
    expect(svg).toContain('<circle');
    expect(svg).toContain('<svg');
  });

  it('tablet frame preset is 834x1194', () => {
    const engine = new UiEngine();
    mustRun(engine, { op: 'add_frame', preset: 'tablet' });
    const f = frameOf(engine);
    expect(f.w).toBe(834);
    expect(f.h).toBe(1194);
  });
});
