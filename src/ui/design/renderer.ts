// DOM live-preview renderer for the UI-design mode. Lays the active frame out
// with the pure layoutFrame() (same boxes the exporter uses), draws real-looking
// typography/controls, a selection outline + resize handle, and hit-tests /
// drags in the same pointer path the plan renderer uses. Implements the generic
// ViewportHandle so the mode-agnostic shell drives it unchanged.

import type { ModeController, ViewportHandle } from '../../core/controller';
import {
  activeFrame,
  layoutFrame,
  locate,
  type Box,
  type Frame,
  type UiDoc,
  type UiNode,
} from './doc';

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

  const doc = (): UiDoc => controller.snapshot() as UiDoc;
  const frame = (): Frame | undefined => activeFrame(doc());

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
      frameEl.style.width = '0';
      frameEl.style.height = '0';
      const empty = document.createElement('div');
      empty.className = 'ui-empty';
      empty.textContent = 'No frame yet — pick a quick-start below, or say "login screen".';
      Object.assign(empty.style, {
        position: 'absolute', inset: '0', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#64748b', fontFamily: FONT_STACK, padding: '24px', textAlign: 'center',
      } as CSSStyleDeclaration);
      frameEl.style.width = '420px';
      frameEl.style.height = '300px';
      frameEl.style.background = '#fff';
      frameEl.style.border = '1px dashed #cbd5e1';
      frameEl.appendChild(empty);
      fitScale({ w: 420, h: 300 } as Frame);
      return;
    }
    fitScale(f);
    boxes = layoutFrame(f);
    frameEl.style.width = `${f.w}px`;
    frameEl.style.height = `${f.h}px`;
    frameEl.style.background = f.background;
    frameEl.style.boxShadow = '0 1px 3px rgba(15,23,42,.15), 0 8px 24px rgba(15,23,42,.08)';
    const sel = doc().selectedId;

    // Draw in depth order (parents first) so children paint on top.
    const draw = (node: UiNode) => {
      const box = boxes.get(node.id);
      if (!box) return;
      frameEl.appendChild(styleNode(node, box, node.id === sel));
      if (node.type === 'stack') for (const c of node.children) draw(c);
    };
    for (const c of f.root.children) draw(c);

    // A corner resize handle on the current selection (if it's a frame node).
    if (sel) {
      const box = boxes.get(sel);
      if (box) {
        const h = document.createElement('div');
        Object.assign(h.style, {
          position: 'absolute', left: `${box.x + box.w - 6}px`, top: `${box.y + box.h - 6}px`,
          width: '12px', height: '12px', background: '#2563eb', borderRadius: '3px',
          border: '2px solid #fff', cursor: 'nwse-resize', zIndex: '5',
        } as CSSStyleDeclaration);
        h.dataset.handle = sel;
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

  // ---- drag to reorder within the parent stack ----
  let drag: { id: string; startY: number; startX: number; moved: boolean } | null = null;

  function beginDrag(clientX: number, clientY: number): boolean {
    const sel = controller.selectedId();
    if (!sel) return false;
    drag = { id: sel, startX: clientX, startY: clientY, moved: false };
    return true;
  }
  function doDrag(clientX: number, clientY: number): boolean {
    if (!drag) return false;
    const f = frame();
    if (!f) return false;
    const loc = locate(doc(), drag.id);
    if (!loc || !loc.parent) return false;
    const horizontal = loc.parent.direction === 'row';
    const delta = horizontal ? (clientX - drag.startX) : (clientY - drag.startY);
    const threshold = 40 * scale;
    if (Math.abs(delta) >= threshold) {
      const dir = Math.sign(delta);
      controller.applyOp({ op: 'move', target: drag.id, nums: { delta: dir } });
      drag.startX = clientX;
      drag.startY = clientY;
      drag.moved = true;
      render();
    }
    return true;
  }
  function endDrag(): void { drag = null; }

  // ---- native pointer + keyboard ----
  scroll.addEventListener('mousedown', (e) => {
    const id = pick(e.clientX, e.clientY);
    onSelect(id);
    if (id) controller.selectId(id);
    render();
    container.focus();
    if (id) beginDrag(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', onMove);
  function onMove(e: MouseEvent): void { if (drag) doDrag(e.clientX, e.clientY); }
  window.addEventListener('mouseup', onUp);
  function onUp(): void { endDrag(); }

  function siblings(id: string): { ids: string[]; idx: number } | null {
    const loc = locate(doc(), id);
    if (!loc || !loc.parent) return null;
    const ids = loc.parent.children.map((c) => c.id);
    return { ids, idx: ids.indexOf(id) };
  }

  function onKey(e: KeyboardEvent): void {
    const sel = controller.selectedId();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      controller.applyOp({ op: e.shiftKey ? 'redo' : 'undo' }); render(); e.preventDefault(); return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      controller.applyOp({ op: 'redo' }); render(); e.preventDefault(); return;
    }
    if (!sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      controller.applyOp({ op: 'delete', target: sel }); onSelect(controller.selectedId()); render(); e.preventDefault(); return;
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
    dispose() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      container.removeEventListener('keydown', onKey);
      resize.disconnect();
      scroll.remove();
      container.classList.remove('ui-stage');
    },
  };
}
