// Floating properties panel for the ui-mode selection. Every edit is an op via
// controller.applyOp (validated + undoable): text content, font size/weight,
// colours (swatches + hex), radius, stack layout (direction/gap/padding/align/
// justify), and Figma-style sizing modes (fixed / fill / hug + value). Rebuilt
// on every render; cheap at screen scale.

import { locate, nodeLabel, type SizeMode, type UiDoc, type UiNode } from './doc';

export interface UiPropsIO {
  apply(op: unknown): { ok: boolean; error?: string };
  snapshot(): UiDoc;
  selectedId(): string | null;
}

export interface UiPropsHandle {
  update(): void;
  dispose(): void;
}

const SWATCHES = ['#0f172a', '#64748b', '#ffffff', '#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#e2e8f0'];

export function createUiPropsPanel(host: HTMLElement, io: UiPropsIO): UiPropsHandle {
  const root = document.createElement('div');
  root.className = 'mc-props';
  root.setAttribute('aria-label', 'Properties');
  host.appendChild(root);

  function row(label: string, control: HTMLElement | string): HTMLElement {
    const r = document.createElement('label');
    r.className = 'mc-props-row';
    const span = document.createElement('span');
    span.textContent = label;
    r.appendChild(span);
    if (typeof control === 'string') {
      const v = document.createElement('span');
      v.className = 'mc-props-ro';
      v.textContent = control;
      r.appendChild(v);
    } else {
      r.appendChild(control);
    }
    return r;
  }

  function num(value: number, onCommit: (v: number) => void): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = String(Math.round(value));
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (Number.isFinite(v)) onCommit(v);
    });
    return inp;
  }

  function textInput(value: string, onCommit: (v: string) => void): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.addEventListener('change', () => onCommit(inp.value));
    return inp;
  }

  function sel<T extends string>(value: T, options: readonly T[], onCommit: (v: T) => void): HTMLSelectElement {
    const s = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      if (o === value) opt.selected = true;
      s.appendChild(opt);
    }
    s.addEventListener('change', () => onCommit(s.value as T));
    return s;
  }

  /** Swatch strip + hex field committing one colour op. */
  function colorControl(value: string, onCommit: (v: string) => void): HTMLElement {
    const box = document.createElement('div');
    box.className = 'mc-props-color';
    box.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap';
    for (const c of SWATCHES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = c;
      b.setAttribute('aria-label', `Colour ${c}`);
      b.style.cssText =
        `width:16px;height:16px;border-radius:4px;background:${c};cursor:pointer;` +
        `border:1px solid ${c.toLowerCase() === value.toLowerCase() ? '#2563eb' : '#cbd5e1'}`;
      b.addEventListener('click', () => onCommit(c));
      box.appendChild(b);
    }
    const hex = textInput(value, (v) => {
      if (/^#[0-9a-fA-F]{3,8}$/.test(v.trim())) onCommit(v.trim());
    });
    hex.style.width = '70px';
    box.appendChild(hex);
    return box;
  }

  /** Sizing row: mode select + value input for one axis. */
  function sizingRow(id: string, axis: 'w' | 'h', node: UiNode): HTMLElement {
    const mode = (axis === 'w' ? node.sizing?.wMode : node.sizing?.hMode) ?? 'hug';
    const value = (axis === 'w' ? node.sizing?.w : node.sizing?.h) ?? 0;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px';
    const modeSel = sel<SizeMode>(mode, ['fixed', 'fill', 'hug'], (m) =>
      io.apply({ op: 'set_sizing', target: id, [axis === 'w' ? 'wMode' : 'hMode']: m }));
    wrap.appendChild(modeSel);
    if (mode === 'fixed') {
      const v = num(value, (n) =>
        io.apply({ op: 'set_sizing', target: id, [axis === 'w' ? 'wMode' : 'hMode']: 'fixed', nums: { [axis]: n } }));
      v.style.width = '64px';
      wrap.appendChild(v);
    }
    return wrap;
  }

  function update(): void {
    root.innerHTML = '';
    const d = io.snapshot();
    const id = io.selectedId();
    const loc = id ? locate(d, id) : null;
    if (!id || !loc) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const node = loc.node;
    const title = document.createElement('div');
    title.className = 'mc-props-title';
    title.textContent = nodeLabel(node);
    root.appendChild(title);

    const style = (patch: Record<string, unknown>) => io.apply({ op: 'set_style', target: id, ...patch });

    if (node.type === 'text') {
      root.appendChild(row('Text', textInput(node.text, (v) => io.apply({ op: 'set_text', target: id, text: v }))));
      root.appendChild(row('Size', num(node.size, (v) => style({ nums: { size: v } }))));
      root.appendChild(row('Weight', sel(String(node.weight), ['400', '500', '600', '700'], (v) => style({ weight: Number(v) }))));
      root.appendChild(row('Color', colorControl(node.color, (c) => style({ color: c }))));
    } else if (node.type === 'button') {
      root.appendChild(row('Label', textInput(node.label, (v) => io.apply({ op: 'set_text', target: id, text: v }))));
      root.appendChild(row('Fill', colorControl(node.fill, (c) => io.apply({ op: 'set_fill', target: id, fill: c }))));
      root.appendChild(row('Text', colorControl(node.textColor, (c) => style({ color: c }))));
      root.appendChild(row('Radius', num(node.radius, (v) => style({ nums: { radius: v } }))));
    } else if (node.type === 'input') {
      root.appendChild(row('Label', textInput(node.label, (v) => io.apply({ op: 'set_text', target: id, text: v }))));
    } else if (node.type === 'rect' || node.type === 'image') {
      if (node.type === 'rect')
        root.appendChild(row('Fill', colorControl(node.fill, (c) => io.apply({ op: 'set_fill', target: id, fill: c }))));
      root.appendChild(row('W', num(node.w, (v) => io.apply({ op: 'set_size', target: id, nums: { w: v } }))));
      root.appendChild(row('H', num(node.h, (v) => io.apply({ op: 'set_size', target: id, nums: { h: v } }))));
      root.appendChild(row('Radius', num(node.radius, (v) => style({ nums: { radius: v } }))));
    } else if (node.type === 'icon') {
      root.appendChild(row('Fill', colorControl(node.fill, (c) => io.apply({ op: 'set_fill', target: id, fill: c }))));
      root.appendChild(row('Size', num(node.size, (v) => io.apply({ op: 'set_size', target: id, nums: { w: v } }))));
    } else if (node.type === 'divider') {
      root.appendChild(row('Color', colorControl(node.color, (c) => io.apply({ op: 'set_fill', target: id, fill: c }))));
    } else if (node.type === 'stack') {
      const layout = (patch: Record<string, unknown>) => io.apply({ op: 'set_layout', target: id, ...patch });
      root.appendChild(row('Direction', sel(node.direction, ['column', 'row'], (v) => layout({ direction: v }))));
      root.appendChild(row('Gap', num(node.gap, (v) => layout({ nums: { gap: v } }))));
      root.appendChild(row('Padding', num(node.padding, (v) => layout({ nums: { padding: v } }))));
      root.appendChild(row('Align', sel(node.align, ['start', 'center', 'end', 'stretch'], (v) => layout({ align: v }))));
      root.appendChild(row('Justify', sel(node.justify, ['start', 'center', 'end', 'between'], (v) => layout({ justify: v }))));
      root.appendChild(row('Fill', colorControl(node.fill ?? '#ffffff', (c) => io.apply({ op: 'set_fill', target: id, fill: c }))));
      root.appendChild(row('Radius', num(node.radius ?? 0, (v) => style({ nums: { radius: v } }))));
    }

    // Sizing modes apply to every non-frame node.
    if (loc.parent) {
      root.appendChild(row('Width', sizingRow(id, 'w', node)));
      root.appendChild(row('Height', sizingRow(id, 'h', node)));
      if (node.abs) {
        root.appendChild(row('X', num(node.abs.x, (v) => io.apply({ op: 'set_pos', target: id, nums: { x: v } }))));
        root.appendChild(row('Y', num(node.abs.y, (v) => io.apply({ op: 'set_pos', target: id, nums: { y: v } }))));
      }
    }
  }

  update();
  return {
    update,
    dispose() {
      root.remove();
    },
  };
}
