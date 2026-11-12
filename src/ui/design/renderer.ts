// DOM live-preview renderer for the UI-design mode. Lays the active frame out
// with the pure layoutFrame() (same boxes the exporter uses), draws real-looking
// typography/controls, a selection outline + resize handle, and hit-tests /
// drags in the same pointer path the plan renderer uses. Implements the generic
// ViewportHandle so the mode-agnostic shell drives it unchanged.

import type { ModeController, ViewportHandle } from '../../core/controller';
import { createToolController } from '../../core/tools';
import { createFullscreenControl, createPalette, createTrash } from '../../core/palette';
import {
  activeFrame,
  layoutFrame,
  locate,
  type Box,
  type Frame,
  type UiDoc,
  type UiNode,
} from './doc';
import { alignSnap, insertionIndex, snapTargets, stackAt, wrapDirection, type Guide, type Segment } from './editing';
import { createUiTools, uiPaletteItems, type UiToolCtx } from './tools';
import { createUiPropsPanel } from './propsPanel';

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function createUiRenderer(
  container: HTMLElement,
  controller: ModeController,
  onSelect: (id: string | null) => void,
): ViewportHandle {
  container.classList.add('ui-stage');
  container.setAttribute('tabindex', '0');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Screen canvas');

  // Scrollable grey backdrop; the frame sits centred inside a scaled wrapper.
  const scroll = document.createElement('div');
  scroll.className = 'ui-scroll';
  Object.assign(scroll.style, {
    position: 'absolute', inset: '0', overflow: 'auto', background: '#eef2f7',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px',
  } as CSSStyleDeclaration);
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.transformOrigin = 'top center';
  scroll.appendChild(wrap);
  const frameEl = document.createElement('div');
  frameEl.className = 'ui-frame';
  frameEl.style.position = 'relative';
  wrap.appendChild(frameEl);
  container.appendChild(scroll);

  let scale = 1;
  let boxes = new Map<string, Box>();
  /** Secondary (Shift-click) selection on top of the engine's selectedId. */
  const multi = new Set<string>();
  let propsPanelRef: { update(): void } | null = null;

  const doc = (): UiDoc => controller.snapshot() as UiDoc;
  const frame = (): Frame | undefined => activeFrame(doc());

  /** Everything currently selected (engine primary + shift extras). */
  function selection(): string[] {
    const sel = controller.selectedId();
    const ids = new Set(multi);
    if (sel) ids.add(sel);
    return [...ids];
  }

  // Transient overlay (frame-local px, scales with the wrapper): placement
  // ghost, stack insertion indicator, pink alignment guides.
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '6',
  } as CSSStyleDeclaration);
  wrap.appendChild(overlay);
  const ghostEl = document.createElement('div');
  Object.assign(ghostEl.style, {
    position: 'absolute', border: '1.5px dashed #2563eb', background: 'rgba(37,99,235,.08)',
    borderRadius: '6px', display: 'none', color: '#2563eb', fontSize: '12px',
    fontFamily: FONT_STACK, padding: '2px 6px', boxSizing: 'border-box',
  } as CSSStyleDeclaration);
  overlay.appendChild(ghostEl);
  const insertEl = document.createElement('div');
  Object.assign(insertEl.style, {
    position: 'absolute', background: '#2563eb', borderRadius: '2px', display: 'none',
  } as CSSStyleDeclaration);
  overlay.appendChild(insertEl);
  let guideEls: HTMLElement[] = [];

  function setGhost(b: Box | null, label?: string): void {
    if (!b) {
      ghostEl.style.display = 'none';
      return;
    }
    Object.assign(ghostEl.style, {
      display: 'block', left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`,
    } as CSSStyleDeclaration);
    ghostEl.textContent = label ?? '';
  }
  function setInsertLine(seg: Segment | null): void {
    if (!seg) {
      insertEl.style.display = 'none';
      return;
    }
    const vertical = seg.x1 === seg.x2;
    Object.assign(insertEl.style, {
      display: 'block',
      left: `${vertical ? seg.x1 - 1.5 : seg.x1}px`,
      top: `${vertical ? seg.y1 : seg.y1 - 1.5}px`,
      width: `${vertical ? 3 : seg.x2 - seg.x1}px`,
      height: `${vertical ? seg.y2 - seg.y1 : 3}px`,
    } as CSSStyleDeclaration);
  }
  function setGuides(guides: Guide[]): void {
    for (const g of guideEls) g.remove();
    guideEls = guides.map((g) => {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute', background: '#ec4899',
        left: `${g.axis === 'v' ? g.pos - 0.5 : g.from}px`,
        top: `${g.axis === 'v' ? g.from : g.pos - 0.5}px`,
        width: `${g.axis === 'v' ? 1 : g.to - g.from}px`,
        height: `${g.axis === 'v' ? g.to - g.from : 1}px`,
      } as CSSStyleDeclaration);
      overlay.appendChild(el);
      return el;
    });
  }

  function fitScale(f: Frame): void {
    const rect = scroll.getBoundingClientRect();
    const availW = (rect.width || 800) - 56;
    const availH = (rect.height || 600) - 56;
    scale = Math.min(availW / f.w, availH / f.h, 1);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    wrap.style.transform = `scale(${scale})`;
  }

  function styleNode(node: UiNode, box: Box, selected: boolean): HTMLElement {
    const abs = (e: HTMLElement) => {
      e.style.position = 'absolute';
      e.style.left = `${box.x}px`;
      e.style.top = `${box.y}px`;
      e.style.width = `${box.w}px`;
      e.style.height = `${box.h}px`;
      e.style.boxSizing = 'border-box';
      e.dataset.id = node.id;
      e.style.fontFamily = FONT_STACK;
    };
    let e: HTMLElement;
    switch (node.type) {
      case 'text': {
        e = document.createElement(node.role === 'heading' ? 'h1' : 'p');
        e.textContent = node.text;
        e.style.margin = '0';
        e.style.fontSize = `${node.size}px`;
        e.style.fontWeight = String(node.weight);
        e.style.color = node.color;
        e.style.lineHeight = '1.3';
        e.style.display = 'flex';
        e.style.alignItems = 'center';
        break;
      }
      case 'button': {
        e = document.createElement('div');
        e.textContent = node.label;
        Object.assign(e.style, {
          background: node.fill, color: node.textColor, borderRadius: `${node.radius}px`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '15px', fontWeight: '600', padding: '0 20px',
        } as CSSStyleDeclaration);
        break;
      }
      case 'input': {
        e = document.createElement('div');
        e.style.display = 'flex';
        e.style.flexDirection = 'column';
        e.style.gap = '6px';
        if (node.label) {
          const lab = document.createElement('div');
          lab.textContent = node.label;
          lab.style.fontSize = '13px';
          lab.style.color = '#475569';
          e.appendChild(lab);
        }
        const field = document.createElement('div');
        field.textContent = node.placeholder;
        Object.assign(field.style, {
          flex: '1', display: 'flex', alignItems: 'center', padding: '0 12px',
          border: '1px solid #cbd5e1', borderRadius: '8px', background: '#fff',
          color: '#94a3b8', fontSize: '15px',
        } as CSSStyleDeclaration);
        e.appendChild(field);
        break;
      }
      case 'image': {
        e = document.createElement('div');
        Object.assign(e.style, {
          background: 'repeating-conic-gradient(#e2e8f0 0% 25%, #eef2f7 0% 50%) 50% / 24px 24px',
          borderRadius: `${node.radius}px`, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#94a3b8', fontSize: '13px',
        } as CSSStyleDeclaration);
        e.textContent = 'Image';
        break;
      }
      case 'rect': {
        e = document.createElement('div');
        e.style.background = node.fill;
        e.style.borderRadius = `${node.radius}px`;
        break;
      }
      case 'divider': {
        e = document.createElement('div');
        e.style.background = node.color;
        break;
      }
      case 'icon': {
        e = document.createElement('div');
        e.style.background = node.fill;
        e.style.borderRadius = '50%';
        break;
      }
      case 'stack': {
        e = document.createElement('div');
        if (node.fill) e.style.background = node.fill;
        if (node.radius) e.style.borderRadius = `${node.radius}px`;
        break;
      }
    }
    abs(e);
    if (selected) {
      e.style.outline = '2px solid #2563eb';
      e.style.outlineOffset = '1px';
    }
    return e;
  }

  function render(): void {
    const f = frame();
    frameEl.replaceChildren();
    if (!f) {
      // A real, empty Desktop 1440×900 artboard (scaled to fit) with a label
      // above it — so entering UI mode shows an actual frame, not a placeholder.
      const EW = 1440;
      const EH = 900;
      fitScale({ w: EW, h: EH } as Frame);
      frameEl.style.width = `${EW}px`;
      frameEl.style.height = `${EH}px`;
      frameEl.style.background = '#fff';
      frameEl.style.border = '';
      frameEl.style.boxShadow = '0 1px 3px rgba(15,23,42,.15), 0 8px 24px rgba(15,23,42,.08)';

      const label = document.createElement('div');
      label.textContent = 'Desktop 1440×900';
      Object.assign(label.style, {
        position: 'absolute', left: '0', top: '-26px', fontSize: '13px',
        fontWeight: '600', color: '#64748b', fontFamily: FONT_STACK, whiteSpace: 'nowrap',
      } as CSSStyleDeclaration);
      frameEl.appendChild(label);

      const empty = document.createElement('div');
      empty.className = 'ui-empty';
      empty.textContent = 'Empty frame — say "login screen" or pick a quick-start.';
      Object.assign(empty.style, {
        position: 'absolute', inset: '0', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#94a3b8', fontFamily: FONT_STACK, fontSize: '22px',
        padding: '24px', textAlign: 'center',
      } as CSSStyleDeclaration);
      frameEl.appendChild(empty);
      return;
    }
    fitScale(f);
    boxes = layoutFrame(f);
    frameEl.style.width = `${f.w}px`;
    frameEl.style.height = `${f.h}px`;
    frameEl.style.background = f.background;
    frameEl.style.boxShadow = '0 1px 3px rgba(15,23,42,.15), 0 8px 24px rgba(15,23,42,.08)';
    const sel = doc().selectedId;
    for (const id of [...multi]) if (!boxes.has(id)) multi.delete(id);
    const selected = new Set(multi);
    if (sel) selected.add(sel);

    // Draw in depth order (parents first) so children paint on top.
    const draw = (node: UiNode) => {
      const box = boxes.get(node.id);
      if (!box) return;
      frameEl.appendChild(styleNode(node, box, selected.has(node.id)));
      if (node.type === 'stack') for (const c of node.children) draw(c);
    };
    for (const c of f.root.children) draw(c);
    propsPanelRef?.update();

    // A corner resize handle — only on nodes set_size can actually resize
    // (image/rect/button/input); drawing it on text/stacks would be a no-op.
    if (sel) {
      const box = boxes.get(sel);
      const node = box ? locate(doc(), sel)?.node : undefined;
      const resizable = !!node && (node.type === 'image' || node.type === 'rect' || node.type === 'button' || node.type === 'input');
      if (box && resizable) {
        const h = document.createElement('div');
        Object.assign(h.style, {
          position: 'absolute', left: `${box.x + box.w - 8}px`, top: `${box.y + box.h - 8}px`,
          width: '16px', height: '16px', background: '#2563eb', borderRadius: '3px',
          border: '2px solid #fff', cursor: 'nwse-resize', zIndex: '5',
        } as CSSStyleDeclaration);
        h.dataset.handle = sel;
        h.setAttribute('role', 'slider');
        h.setAttribute('aria-label', 'Resize selection (drag)');
        frameEl.appendChild(h);
      }
    }
  }

  function fit(): void {
    render();
  }

  // ---- hit testing: client coords → deepest node box that contains them ----
  function toFrame(clientX: number, clientY: number): { x: number; y: number } {
    const rect = frameEl.getBoundingClientRect();
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  }

  function pick(clientX: number, clientY: number): string | null {
    const f = frame();
    if (!f) return null;
    const p = toFrame(clientX, clientY);
    const hits: Array<{ id: string; area: number }> = [];
    const hit = (node: UiNode) => {
      const b = boxes.get(node.id);
      if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        hits.push({ id: node.id, area: b.w * b.h });
      }
      if (node.type === 'stack') for (const c of node.children) hit(c);
    };
    for (const c of f.root.children) hit(c);
    if (!hits.length) return null;
    hits.sort((a, b) => a.area - b.area); // smallest (deepest) wins
    return hits[0].id;
  }

  // ---- shared tool framework: status, trash, palette, tools, props ----
  const status = document.createElement('div');
  status.className = 'mc-status';
  status.setAttribute('role', 'status');
  container.appendChild(status);
  const trash = createTrash(container);

  const toolCtx: UiToolCtx = {
    apply(op) {
      const r = controller.applyOp(op);
      if (r.ok) {
        onSelect(controller.selectedId());
        render();
      } else if (r.error) {
        status.textContent = r.error;
      }
      return r;
    },
    frame,
    boxes: () => boxes,
    toFrame,
    setGhost,
    setInsertLine,
    setStatus: (t) => {
      status.textContent = t;
    },
    render: () => render(),
    activateSelect: () => toolCtl.activate('select'),
  };
  const tools = createUiTools(toolCtx);
  const toolCtl = createToolController(tools, {
    defaultId: 'select',
    onToolChange(id) {
      palette.setActive(id);
      status.textContent = tools.find((t) => t.id === id)?.hint ?? '';
    },
  });
  const palette = createPalette(container, uiPaletteItems(tools), {
    onArm: (id) => toolCtl.activate(id),
    onPlaceStart: (id, x, y) => toolCtl.beginPlace(id, { x, y, source: 'mouse' }),
  });
  const fsCtl = createFullscreenControl(container, container, (hint) => {
    status.textContent = hint;
  });
  const propsPanel = createUiPropsPanel(container, {
    apply: (op) => toolCtx.apply(op),
    snapshot: doc,
    selectedId: () => controller.selectedId(),
  });
  propsPanelRef = propsPanel;
  palette.setActive('select');
  status.textContent = tools[0].hint ?? '';

  // ---- drag to move: flow children reorder with the insertion indicator,
  // absolute children move freely with smart alignment guides ----
  let drag: {
    id: string;
    startX: number;
    startY: number;
    box: Box;
    parentId: string;
    parentOrigin: { x: number; y: number };
    curIdx: number;
    mode: 'abs' | 'flow';
    el: HTMLElement | null;
    moved: boolean;
    pendingFlow?: { parent: string; index: number };
    pendingAbs?: { x: number; y: number };
  } | null = null;
  let lastPt = { x: 0, y: 0 };

  function beginDrag(clientX: number, clientY: number): boolean {
    const sel = controller.selectedId();
    if (!sel) return false;
    const loc = locate(doc(), sel);
    const box = boxes.get(sel);
    if (!loc || !loc.parent || !box) return false;
    const parentOrigin = boxes.get(loc.parent.id) ?? { x: 0, y: 0 };
    drag = {
      id: sel, startX: clientX, startY: clientY, box,
      parentId: loc.parent.id,
      parentOrigin: { x: parentOrigin.x, y: parentOrigin.y },
      curIdx: loc.parent.children.findIndex((c) => c.id === sel),
      mode: loc.node.abs ? 'abs' : 'flow',
      el: frameEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(sel)}"]`),
      moved: false,
    };
    return true;
  }

  function doDrag(clientX: number, clientY: number): boolean {
    if (!drag) return false;
    const f = frame();
    if (!f) return false;
    lastPt = { x: clientX, y: clientY };
    const dx = (clientX - drag.startX) / scale;
    const dy = (clientY - drag.startY) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    trash.setHover(trash.isOver(clientX, clientY));
    if (!drag.moved) return true;

    if (drag.mode === 'abs') {
      const moving: Box = { x: drag.box.x + dx, y: drag.box.y + dy, w: drag.box.w, h: drag.box.h };
      const snap = alignSnap(moving, snapTargets(f, boxes, drag.id));
      setGuides(snap.guides);
      drag.pendingAbs = {
        x: Math.round(snap.x - drag.parentOrigin.x),
        y: Math.round(snap.y - drag.parentOrigin.y),
      };
      if (drag.el) {
        drag.el.style.left = `${snap.x}px`;
        drag.el.style.top = `${snap.y}px`;
      }
    } else {
      const fp = toFrame(clientX, clientY);
      const stack = stackAt(f, boxes, fp, drag.id);
      if (stack) {
        const ins = insertionIndex(stack, boxes, fp, drag.id);
        // The engine splices after detaching the dragged node, so same-parent
        // moves past the original slot shift down by one.
        const index = stack.id === drag.parentId && drag.curIdx < ins.index ? ins.index - 1 : ins.index;
        drag.pendingFlow = { parent: stack.id, index };
        setInsertLine(ins.line);
      } else {
        drag.pendingFlow = undefined;
        setInsertLine(null);
      }
      if (drag.el) {
        drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
        drag.el.style.opacity = '0.6';
        drag.el.style.zIndex = '7';
      }
    }
    return true;
  }

  function endDragAt(clientX: number, clientY: number): void {
    const d = drag;
    drag = null;
    setGuides([]);
    setInsertLine(null);
    trash.setHover(false);
    if (!d) return;
    if (d.el) {
      d.el.style.transform = '';
      d.el.style.opacity = '';
      d.el.style.zIndex = '';
    }
    if (!d.moved) {
      render();
      return;
    }
    if (trash.isOver(clientX, clientY)) {
      toolCtx.apply({ op: 'delete', target: d.id });
      multi.clear();
      return;
    }
    if (d.mode === 'abs' && d.pendingAbs) {
      toolCtx.apply({ op: 'set_pos', target: d.id, nums: d.pendingAbs });
      return;
    }
    if (d.mode === 'flow' && d.pendingFlow &&
      !(d.pendingFlow.parent === d.parentId && d.pendingFlow.index === d.curIdx)) {
      toolCtx.apply({ op: 'move', target: d.id, parent: d.pendingFlow.parent, nums: { index: d.pendingFlow.index } });
      return;
    }
    render();
  }
  function endDrag(): void {
    endDragAt(lastPt.x, lastPt.y);
  }

  // ---- drag the corner handle to resize the selection (one set_size on release) ----
  let rz: { id: string; startX: number; startY: number; w: number; h: number; el: HTMLElement | null } | null = null;

  function beginResize(clientX: number, clientY: number, id: string): boolean {
    const box = boxes.get(id);
    if (!box) return false;
    const el = frameEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    rz = { id, startX: clientX, startY: clientY, w: box.w, h: box.h, el };
    return true;
  }
  function liveResize(clientX: number, clientY: number): { w: number; h: number } | null {
    if (!rz) return null;
    const w = Math.max(16, rz.w + (clientX - rz.startX) / scale);
    const h = Math.max(16, rz.h + (clientY - rz.startY) / scale);
    return { w, h };
  }
  function doResize(clientX: number, clientY: number): void {
    const now = liveResize(clientX, clientY);
    if (!now || !rz?.el) return;
    rz.el.style.width = `${now.w}px`;
    rz.el.style.height = `${now.h}px`;
  }
  function endResize(clientX: number, clientY: number): void {
    const now = liveResize(clientX, clientY);
    const target = rz?.id;
    rz = null;
    if (!now || !target) { render(); return; }
    const snap = (n: number) => Math.max(4, Math.round(n / 4) * 4); // snapped to 4px
    controller.applyOp({ op: 'set_size', target, nums: { w: snap(now.w), h: snap(now.h) } });
    render();
  }

  // ---- native pointer + keyboard ----
  scroll.addEventListener('mousedown', (e) => {
    const handleId = (e.target as HTMLElement)?.dataset?.handle;
    if (handleId) { // grabbed the resize handle, not a node
      beginResize(e.clientX, e.clientY, handleId);
      container.focus();
      e.preventDefault();
      return;
    }
    // An armed placement tool consumes the press (click-to-place).
    if (toolCtl.activeId() !== 'select' || toolCtl.placing()) {
      if (toolCtl.down({ x: e.clientX, y: e.clientY, source: 'mouse', shift: e.shiftKey })) {
        container.focus();
        e.preventDefault();
        return;
      }
    }
    const id = pick(e.clientX, e.clientY);
    if (e.shiftKey && id) {
      // Shift-click: toggle in the multi-selection.
      const prev = controller.selectedId();
      if (multi.has(id)) {
        multi.delete(id);
      } else {
        if (prev && prev !== id) multi.add(prev);
        controller.selectId(id);
        onSelect(id);
      }
    } else {
      multi.clear();
      onSelect(id);
      if (id) controller.selectId(id);
    }
    render();
    container.focus();
    if (id && !e.shiftKey) beginDrag(e.clientX, e.clientY);
  });
  scroll.addEventListener('mousemove', (e) => {
    // Ghost previews while a placement tool is armed (no button held).
    if (!drag && !rz && (toolCtl.placing() || toolCtl.activeId() !== 'select')) {
      toolCtl.hover({ x: e.clientX, y: e.clientY, source: 'mouse' });
    }
  });
  window.addEventListener('mousemove', onMove);
  function onMove(e: MouseEvent): void {
    if (rz) doResize(e.clientX, e.clientY);
    else if (drag) doDrag(e.clientX, e.clientY);
    else if (toolCtl.placing()) toolCtl.move({ x: e.clientX, y: e.clientY, source: 'mouse' });
  }
  window.addEventListener('mouseup', onUp);
  function onUp(e: MouseEvent): void {
    if (rz) endResize(e.clientX, e.clientY);
    else if (drag) endDragAt(e.clientX, e.clientY);
    else if (toolCtl.placing()) toolCtl.up({ x: e.clientX, y: e.clientY, source: 'mouse' });
  }

  function siblings(id: string): { ids: string[]; idx: number } | null {
    const loc = locate(doc(), id);
    if (!loc || !loc.parent) return null;
    const ids = loc.parent.children.map((c) => c.id);
    return { ids, idx: ids.indexOf(id) };
  }

  let clipboard: string[] = [];

  function selectOnly(id: string | null): void {
    multi.clear();
    if (id) controller.selectId(id);
    onSelect(id);
    render();
  }

  function onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    const sel = controller.selectedId();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      controller.applyOp({ op: e.shiftKey ? 'redo' : 'undo' }); multi.clear(); render(); e.preventDefault(); return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      controller.applyOp({ op: 'redo' }); multi.clear(); render(); e.preventDefault(); return;
    }
    if (mod && (e.key === 'd' || e.key === 'D')) {
      const ids = selection();
      if (ids.length === 1) toolCtx.apply({ op: 'duplicate', target: ids[0] });
      else if (ids.length > 1) toolCtx.apply({ op: 'batch', ops: ids.map((id) => ({ op: 'duplicate', target: id })) });
      multi.clear();
      e.preventDefault(); return;
    }
    if (mod && (e.key === 'c' || e.key === 'C')) {
      clipboard = selection();
      if (clipboard.length) status.textContent = `Copied ${clipboard.length} element${clipboard.length > 1 ? 's' : ''}.`;
      e.preventDefault(); return;
    }
    if (mod && (e.key === 'v' || e.key === 'V')) {
      const live = clipboard.filter((id) => boxes.has(id));
      if (live.length === 1) toolCtx.apply({ op: 'duplicate', target: live[0] });
      else if (live.length > 1) toolCtx.apply({ op: 'batch', ops: live.map((id) => ({ op: 'duplicate', target: id })) });
      multi.clear();
      e.preventDefault(); return;
    }
    // Shift+A: wrap the selection into a row/column stack (Figma-like).
    if (!mod && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      const ids = selection();
      if (ids.length) {
        const bs = ids.map((id) => boxes.get(id)).filter((b): b is Box => !!b);
        toolCtx.apply({ op: 'wrap', targets: ids, direction: wrapDirection(bs) });
        multi.clear();
      }
      e.preventDefault(); return;
    }
    // Esc: cancel an armed tool, else climb to the parent (Figma-style).
    if (e.key === 'Escape') {
      if (toolCtl.activeId() !== 'select' || toolCtl.placing()) {
        toolCtl.handleKey(e);
        toolCtl.activate('select');
      } else if (sel) {
        const loc = locate(doc(), sel);
        selectOnly(loc?.parent?.id ?? null);
      }
      e.preventDefault(); return;
    }
    // Enter: descend into the first child of a stack.
    if (e.key === 'Enter' && sel) {
      const node = locate(doc(), sel)?.node;
      if (node?.type === 'stack' && node.children[0]) selectOnly(node.children[0].id);
      e.preventDefault(); return;
    }
    // Tool shortcuts (V/A/R/T/H/B/I/G/C/N/O/L).
    if (toolCtl.handleKey(e)) { e.preventDefault(); return; }
    if (!sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const ids = selection();
      if (ids.length === 1) toolCtx.apply({ op: 'delete', target: ids[0] });
      else toolCtx.apply({ op: 'batch', ops: ids.map((id) => ({ op: 'delete', target: id })) });
      multi.clear();
      onSelect(controller.selectedId()); render(); e.preventDefault(); return;
    }
    // Arrow nudge for free-placed nodes (Shift = 10px); flow nodes navigate /
    // Shift-reorder as before.
    const node = locate(doc(), sel)?.node;
    if (node?.abs) {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (dx || dy) {
        toolCtx.apply({ op: 'set_pos', target: sel, nums: { x: node.abs.x + dx, y: node.abs.y + dy } });
        e.preventDefault();
      }
      return;
    }
    const sib = siblings(sel);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      if (e.shiftKey) controller.applyOp({ op: 'move', target: sel, nums: { delta: 1 } });
      else if (sib && sib.idx < sib.ids.length - 1) { controller.selectId(sib.ids[sib.idx + 1]); onSelect(sib.ids[sib.idx + 1]); }
      render(); e.preventDefault();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      if (e.shiftKey) controller.applyOp({ op: 'move', target: sel, nums: { delta: -1 } });
      else if (sib && sib.idx > 0) { controller.selectId(sib.ids[sib.idx - 1]); onSelect(sib.ids[sib.idx - 1]); }
      render(); e.preventDefault();
    }
  }
  container.addEventListener('keydown', onKey);

  const resize = new ResizeObserver(() => render());
  resize.observe(container);

  render();

  return {
    render,
    fit,
    pick,
    beginDrag,
    drag: doDrag,
    endDrag,
    tap(clientX, clientY) {
      // Pinch-taps: palette buttons first, then an armed placement tool.
      const item = palette.itemAt(clientX, clientY);
      if (item) {
        toolCtl.activate(item.toolId);
        return true;
      }
      if (toolCtl.activeId() !== 'select' || toolCtl.placing()) {
        const p = { x: clientX, y: clientY, source: 'pinch' as const };
        if (toolCtl.placing()) toolCtl.up(p);
        else toolCtl.down(p);
        return true;
      }
      return false;
    },
    hover(clientX, clientY) {
      if (toolCtl.placing() || toolCtl.activeId() !== 'select') {
        toolCtl.hover({ x: clientX, y: clientY, source: 'pinch' });
      }
    },
    dispose() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      container.removeEventListener('keydown', onKey);
      resize.disconnect();
      palette.dispose();
      trash.dispose();
      fsCtl.dispose();
      propsPanel.dispose();
      status.remove();
      scroll.remove();
      container.classList.remove('ui-stage');
    },
  };
}
