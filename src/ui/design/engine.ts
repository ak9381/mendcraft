// Pure-data UI engine: applies validated UiOps immutably with undo/redo, a
// revision counter, and an op log (future Firestore sync — same shape as the
// 3D Engine and PlanEngine). All sizes are px. The engine owns node ids: it
// mints stable, readable ids (btn-sign-in, input-email) deduped against the doc.

import {
  activeFrame,
  emptyUi,
  FRAME_PRESETS,
  locate,
  nodeLabel,
  type ButtonNode,
  type Frame,
  type ImageNode,
  type InputNode,
  type RectNode,
  type StackNode,
  type TextNode,
  type UiDoc,
  type UiNode,
  type UiNodeType,
} from './doc';
import { UI_DEFAULTS, type UiOp } from './ops';

export interface UiApplyResult {
  ok: boolean;
  error?: string;
  warnings: string[];
}

export interface UiListItem {
  id: string;
  label: string;
  selected: boolean;
  depth: number;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

/** Collect every id present in a doc (frames + nested nodes). */
function allIds(doc: UiDoc): Set<string> {
  const ids = new Set<string>();
  const walk = (s: StackNode) => {
    ids.add(s.id);
    for (const c of s.children) {
      ids.add(c.id);
      if (c.type === 'stack') walk(c);
    }
  };
  for (const f of doc.frames) {
    ids.add(f.id);
    walk(f.root);
  }
  return ids;
}

export class UiEngine {
  private state: UiDoc = emptyUi();
  private undoStack: UiDoc[] = [];
  private redoStack: UiDoc[] = [];
  revision = 0;
  readonly opLog: Array<{ rev: number; op: UiOp }> = [];

  getState(): UiDoc {
    return this.state;
  }

  resolveRef(ref: string): string | undefined {
    return this.resolveId(this.state, ref);
  }

  /** Mint a readable, unique id from a base slug against the given doc. */
  private mintId(doc: UiDoc, base: string): string {
    const slug = slugify(base) || 'node';
    const used = allIds(doc);
    if (!used.has(slug)) return slug;
    for (let i = 2; i < 1000; i++) {
      const cand = `${slug}-${i}`;
      if (!used.has(cand)) return cand;
    }
    return `${slug}-${doc.frames.length}-${this.revision}`;
  }

  /** Resolve 'selected' / an id / a spoken type-name to a concrete node id. */
  private resolveId(doc: UiDoc, ref: string): string | undefined {
    const r = ref.trim().toLowerCase();
    if (r === 'selected') return doc.selectedId ?? undefined;
    // Exact id first.
    if (allIds(doc).has(ref)) return ref;
    if (allIds(doc).has(r)) return r;
    const frame = activeFrame(doc);
    if (!frame) return undefined;
    if (r === 'frame' || r === 'screen') return frame.id;
    if (r === 'root' || r === 'stack') return frame.root.id;

    // Flatten the active frame's nodes in document order.
    const flat: UiNode[] = [];
    const walk = (s: StackNode) => {
      for (const c of s.children) {
        flat.push(c);
        if (c.type === 'stack') walk(c);
      }
    };
    walk(frame.root);

    const match = (pred: (n: UiNode) => boolean) => flat.find(pred)?.id;
    if (/\bemail\b/.test(r)) return match((n) => n.type === 'input' && n.inputType === 'email') ?? match((n) => n.type === 'input');
    if (/\bpassword\b/.test(r)) return match((n) => n.type === 'input' && n.inputType === 'password') ?? match((n) => n.type === 'input');
    if (/\b(input|field|textbox)\b/.test(r)) return match((n) => n.type === 'input');
    if (/\b(heading|title|header|h1)\b/.test(r)) return match((n) => n.type === 'text' && n.role === 'heading');
    if (/\b(button|btn|cta)\b/.test(r) || /\bsign\b/.test(r)) {
      const byLabel = flat.find((n) => n.type === 'button' && slugify(n.label).includes(slugify(r.replace(/\b(the|button|btn|cta)\b/g, '').trim())));
      return byLabel?.id ?? match((n) => n.type === 'button');
    }
    if (/\b(text|body|paragraph|label)\b/.test(r)) return match((n) => n.type === 'text');
    if (/\b(image|img|picture|photo)\b/.test(r)) return match((n) => n.type === 'image');
    if (/\b(rect|box|card|shape)\b/.test(r)) return match((n) => n.type === 'rect' || n.type === 'stack');
    return undefined;
  }

  apply(op: UiOp): UiApplyResult {
    const result = this.reduce(this.state, op);
    if (typeof result === 'string') return { ok: false, error: result, warnings: [] };
    this.undoStack.push(this.state);
    this.redoStack = [];
    this.state = result;
    this.revision += 1;
    this.opLog.push({ rev: this.revision, op });
    return { ok: true, warnings: this.warnings() };
  }

  undo(): UiApplyResult {
    const prev = this.undoStack.pop();
    if (!prev) return { ok: false, error: 'nothing to undo', warnings: [] };
    this.redoStack.push(this.state);
    this.state = prev;
    this.revision += 1;
    return { ok: true, warnings: this.warnings() };
  }

  redo(): UiApplyResult {
    const next = this.redoStack.pop();
    if (!next) return { ok: false, error: 'nothing to redo', warnings: [] };
    this.undoStack.push(this.state);
    this.state = next;
    this.revision += 1;
    return { ok: true, warnings: this.warnings() };
  }

  /** Replace the whole document with one generated frame, atomically (one undo). */
  loadFrame(frame: Frame): UiApplyResult {
    this.undoStack.push(this.state);
    this.redoStack = [];
    const sel = firstSelectable(frame.root) ?? frame.id;
    this.state = { frames: [frame], selectedId: sel };
    this.revision += 1;
    this.opLog.push({ rev: this.revision, op: { op: 'select', target: sel } });
    return { ok: true, warnings: this.warnings() };
  }

  /** Pure reducer: new document, or an error string (state untouched). */
  private reduce(state: UiDoc, op: UiOp): UiDoc | string {
    switch (op.op) {
      case 'add_frame': {
        const preset = op.preset;
        const { w, h } = FRAME_PRESETS[preset];
        const id = this.mintId(state, `frame-${preset}`);
        const rootId = this.mintId(state, `${id}-root`);
        const root: StackNode = {
          id: rootId, type: 'stack', direction: 'column',
          gap: UI_DEFAULTS.gap, padding: UI_DEFAULTS.padding,
          align: 'stretch', justify: 'start', children: [],
        };
        const frame: Frame = {
          id, type: 'frame', name: FRAME_PRESETS[preset].label, preset, w, h,
          background: '#ffffff', root,
        };
        return { ...state, frames: [...state.frames, frame], selectedId: id };
      }
      case 'add_node': {
        const frame = activeFrame(state);
        if (!frame) return 'add a frame first (e.g. "desktop frame")';
        // Resolve the parent stack: explicit ref → the selected stack → root.
        let parentId = op.parent ? this.resolveId(state, op.parent) : undefined;
        if (!parentId && state.selectedId) {
          const sel = locate(state, state.selectedId);
          if (sel?.node.type === 'stack') parentId = sel.node.id;
          else if (sel?.parent) parentId = sel.parent.id;
        }
        parentId ??= frame.root.id;
        const node = this.makeNode(state, op);
        const next = mapFrames(state, frame.id, (f) => ({
          ...f,
          root: insertInto(f.root, parentId!, node, op.index),
        }));
        return { ...next, selectedId: node.id };
      }
      case 'set_text': {
        const id = this.resolveId(state, op.target);
        if (!id) return this.noNode(op.target);
        return this.edit(state, id, (n) => {
          if (n.type === 'text') return { ...n, text: op.text };
          if (n.type === 'button') return { ...n, label: op.text };
          if (n.type === 'input') return { ...n, label: op.text };
          return n;
        });
      }
      case 'set_size': {
        const id = this.resolveId(state, op.target);
        if (!id) return this.noNode(op.target);
        return this.edit(state, id, (n) => {
          if (n.type === 'image' || n.type === 'rect') {
            return { ...n, ...(op.w !== undefined ? { w: op.w } : {}), ...(op.h !== undefined ? { h: op.h } : {}) };
          }
          if ((n.type === 'button' || n.type === 'input') && op.h !== undefined) return { ...n, height: op.h };
          return n;
        });
      }
      case 'set_fill': {
        const id = this.resolveId(state, op.target);
        if (!id) return this.noNode(op.target);
        return this.edit(state, id, (n) => {
          if (n.type === 'button' || n.type === 'rect') return { ...n, fill: op.fill };
          if (n.type === 'stack') return { ...n, fill: op.fill };
          if (n.type === 'text') return { ...n, color: op.fill };
          return n;
        });
      }
      case 'set_style': {
        const id = this.resolveId(state, op.target);
        if (!id) return this.noNode(op.target);
        return this.edit(state, id, (n) => {
          if (n.type === 'text') return {
            ...n,
            ...(op.size !== undefined ? { size: op.size } : {}),
            ...(op.weight !== undefined ? { weight: op.weight } : {}),
            ...(op.color !== undefined ? { color: op.color } : {}),
          };
          if (n.type === 'button') return {
            ...n,
            ...(op.radius !== undefined ? { radius: op.radius } : {}),
            ...(op.color !== undefined ? { textColor: op.color } : {}),
          };
          if ((n.type === 'rect' || n.type === 'image' || n.type === 'stack') && op.radius !== undefined)
            return { ...n, radius: op.radius };
          return n;
        });
      }
      case 'set_layout': {
        const id = this.resolveId(state, op.target);
        if (!id) return this.noNode(op.target);
        return this.edit(state, id, (n) => {
          if (n.type !== 'stack') return n;
          return {
            ...n,
            ...(op.direction !== undefined ? { direction: op.direction } : {}),
            ...(op.gap !== undefined ? { gap: op.gap } : {}),
            ...(op.padding !== undefined ? { padding: op.padding } : {}),
            ...(op.align !== undefined ? { align: op.align } : {}),
            ...(op.justify !== undefined ? { justify: op.justify } : {}),
          };
        });
      }
      case 'move': {
        const id = this.resolveId(state, op.target);
        if (!id) return this.noNode(op.target);
        const loc = locate(state, id);
        if (!loc || !loc.parent) return 'that node cannot be moved';
        const parent = loc.parent;
        const curIdx = parent.children.findIndex((c) => c.id === id);
        let destParentId = parent.id;
        let destIdx = curIdx;
        if (op.parent) {
          const pid = this.resolveId(state, op.parent);
          const pnode = pid ? locate(state, pid)?.node : undefined;
          if (pnode?.type === 'stack') { destParentId = pnode.id; destIdx = pnode.children.length; }
        }
        if (op.delta !== undefined) destIdx = curIdx + op.delta;
        if (op.index !== undefined) destIdx = op.index;
        const next = mapFrames(state, loc.frame.id, (f) => ({
          ...f,
          root: moveNode(f.root, id, destParentId, destIdx),
        }));
        return { ...next, selectedId: id };
      }
      case 'delete': {
        const id = this.resolveId(state, op.target);
        if (!id) return this.noNode(op.target);
        const frame = state.frames.find((f) => f.id === id);
        if (frame) {
          const frames = state.frames.filter((f) => f.id !== id);
          return { frames, selectedId: frames[0]?.id ?? null };
        }
        const loc = locate(state, id);
        if (!loc) return this.noNode(op.target);
        const next = mapFrames(state, loc.frame.id, (f) => ({ ...f, root: removeNode(f.root, id) }));
        return { ...next, selectedId: loc.parent?.id ?? null };
      }
      case 'select': {
        const id = this.resolveId(state, op.target);
        if (!id) return this.noNode(op.target);
        return { ...state, selectedId: id };
      }
    }
  }

  private noNode(target: string): string {
    const frame = activeFrame(this.state);
    if (!frame) return 'No frame yet. Try "login screen" or "desktop frame".';
    if (target === 'selected') return 'Nothing is selected. Pinch or click a node first.';
    return `no node for "${target}"`;
  }

  /** Immutably replace one node (by id) via a mapper, re-selecting it. */
  private edit(state: UiDoc, id: string, fn: (n: UiNode) => UiNode): UiDoc {
    const loc = locate(state, id);
    if (!loc) return state;
    const next = mapFrames(state, loc.frame.id, (f) => ({ ...f, root: mapNode(f.root, id, fn) }));
    return { ...next, selectedId: id };
  }

  /** Build a fresh node with sane defaults + a readable, unique id. */
  private makeNode(state: UiDoc, op: Extract<UiOp, { op: 'add_node' }>): UiNode {
    const type = op.nodeType as UiNodeType;
    switch (type) {
      case 'text': {
        const role = op.role ?? 'body';
        const text = op.text ?? (role === 'heading' ? 'Heading' : 'Text');
        const node: TextNode = {
          id: this.mintId(state, `${role === 'heading' ? 'heading' : 'text'}-${text}`),
          type: 'text', role, text,
          size: role === 'heading' ? UI_DEFAULTS.headingSize : UI_DEFAULTS.bodySize,
          weight: role === 'heading' ? UI_DEFAULTS.headingWeight : UI_DEFAULTS.bodyWeight,
          color: UI_DEFAULTS.textColor,
        };
        return node;
      }
      case 'button': {
        const label = op.label ?? op.text ?? 'Button';
        const node: ButtonNode = {
          id: this.mintId(state, `btn-${label}`), type: 'button', label,
          fill: op.fill ?? UI_DEFAULTS.buttonFill, textColor: UI_DEFAULTS.buttonText,
          radius: UI_DEFAULTS.buttonRadius, height: UI_DEFAULTS.buttonHeight,
        };
        return node;
      }
      case 'input': {
        const it = op.inputType ?? 'text';
        const label = op.label ?? (it === 'email' ? 'Email' : it === 'password' ? 'Password' : 'Field');
        const node: InputNode = {
          id: this.mintId(state, `input-${label}`), type: 'input', label,
          placeholder: op.placeholder ?? label, inputType: it, height: UI_DEFAULTS.inputHeight,
        };
        return node;
      }
      case 'image': {
        const node: ImageNode = {
          id: this.mintId(state, 'image'), type: 'image',
          w: UI_DEFAULTS.imageW, h: UI_DEFAULTS.imageH, radius: 8,
        };
        return node;
      }
      case 'rect': {
        const node: RectNode = {
          id: this.mintId(state, 'rect'), type: 'rect',
          fill: op.fill ?? UI_DEFAULTS.rectFill, w: UI_DEFAULTS.rectW, h: UI_DEFAULTS.rectH, radius: 8,
        };
        return node;
      }
      case 'stack':
      default: {
        const node: StackNode = {
          id: this.mintId(state, 'stack'), type: 'stack', direction: 'column',
          gap: UI_DEFAULTS.gap, padding: 0, align: 'stretch', justify: 'start', children: [],
        };
        return node;
      }
    }
  }

  warnings(): string[] {
    const out: string[] = [];
    const frame = activeFrame(this.state);
    if (frame && countNodes(frame.root) === 0) out.push('This frame is empty — add a heading, input, or button.');
    return out;
  }

  /** Accessible, indented list of the active frame's nodes. */
  listItems(): UiListItem[] {
    const items: UiListItem[] = [];
    for (const frame of this.state.frames) {
      items.push({ id: frame.id, label: nodeLabel(frame), selected: this.state.selectedId === frame.id, depth: 0 });
      const walk = (s: StackNode, depth: number) => {
        for (const c of s.children) {
          items.push({ id: c.id, label: nodeLabel(c), selected: this.state.selectedId === c.id, depth });
          if (c.type === 'stack') walk(c, depth + 1);
        }
      };
      if (this.state.frames.length === 1 || activeFrame(this.state)?.id === frame.id) walk(frame.root, 1);
    }
    return items;
  }

  summary(): string {
    const frame = activeFrame(this.state);
    const describe = (s: StackNode): unknown => ({
      id: s.id, type: 'stack', dir: s.direction, gap: s.gap, pad: s.padding,
      children: s.children.map((c) => (c.type === 'stack' ? describe(c) : { id: c.id, type: c.type })),
    });
    return JSON.stringify({
      rev: this.revision,
      selected: this.state.selectedId,
      frames: this.state.frames.map((f) => ({ id: f.id, preset: f.preset, w: f.w, h: f.h })),
      active: frame ? describe(frame.root) : null,
    });
  }
}

// ─── Immutable tree edits (module-level, pure) ─────────────────────────────

function mapFrames(doc: UiDoc, frameId: string, fn: (f: Frame) => Frame): UiDoc {
  return { ...doc, frames: doc.frames.map((f) => (f.id === frameId ? fn(f) : f)) };
}

function mapNode(stack: StackNode, id: string, fn: (n: UiNode) => UiNode): StackNode {
  if (stack.id === id) return fn(stack) as StackNode;
  return {
    ...stack,
    children: stack.children.map((c) => {
      if (c.id === id) return fn(c);
      if (c.type === 'stack') return mapNode(c, id, fn);
      return c;
    }),
  };
}

function insertInto(stack: StackNode, parentId: string, node: UiNode, index?: number): StackNode {
  if (stack.id === parentId) {
    const children = [...stack.children];
    const at = index === undefined ? children.length : Math.max(0, Math.min(index, children.length));
    children.splice(at, 0, node);
    return { ...stack, children };
  }
  return {
    ...stack,
    children: stack.children.map((c) => (c.type === 'stack' ? insertInto(c, parentId, node, index) : c)),
  };
}

function removeNode(stack: StackNode, id: string): StackNode {
  return {
    ...stack,
    children: stack.children
      .filter((c) => c.id !== id)
      .map((c) => (c.type === 'stack' ? removeNode(c, id) : c)),
  };
}

function moveNode(root: StackNode, id: string, destParentId: string, destIdx: number): StackNode {
  // Find + detach the node.
  let moved: UiNode | null = null;
  const detach = (s: StackNode): StackNode => ({
    ...s,
    children: s.children
      .filter((c) => {
        if (c.id === id) { moved = c; return false; }
        return true;
      })
      .map((c) => (c.type === 'stack' ? detach(c) : c)),
  });
  const detached = detach(root);
  if (!moved) return root;
  return insertInto(detached, destParentId, moved, destIdx);
}

function countNodes(s: StackNode): number {
  let n = s.children.length;
  for (const c of s.children) if (c.type === 'stack') n += countNodes(c);
  return n;
}

/** First non-stack node (or the root) to pre-select after a generate. */
function firstSelectable(s: StackNode): string | undefined {
  for (const c of s.children) {
    if (c.type === 'button') return c.id;
  }
  for (const c of s.children) {
    if (c.type !== 'stack') return c.id;
    const deep = firstSelectable(c);
    if (deep) return deep;
  }
  return s.children[0]?.id ?? s.id;
}
