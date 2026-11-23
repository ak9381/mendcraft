// Round-2 gesture gap tests for src/plan/propsPanel.ts. The checklist marks
// these GAP-UNTESTED because only the underlying op logic was tested
// (tests/planTools.test.ts / planComponents.test.ts), never the actual
// button-click / numInput-change dispatch path a pinch-tap or pinch-drag
// reaches. propsPanel.ts never uses `instanceof HTMLElement` (unlike
// src/ui/onscreenKeyboard.ts), so the same hand-rolled fake-doc technique as
// browser-panel-hand-path.test.ts is enough — no jsdom needed.
import { describe, expect, it } from 'vitest';
import { createPropsPanel, type PropsPanelIO } from '../../src/plan/propsPanel';
import { emptyPlan, type Fixture, type Opening, type PlanDoc, type Text, type Wall } from '../../src/plan/doc';

class FakeNode {
  tagName: string;
  children: FakeNode[] = [];
  hidden = false;
  type = '';
  value = '';
  step = '';
  private _className = '';
  private _text = '';
  private attrs: Record<string, string> = {};
  private listeners: Record<string, Array<(e: Record<string, unknown>) => void>> = {};
  get innerHTML() { return ''; }
  set innerHTML(_v: string) { this.children = []; }

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get className() { return this._className; }
  set className(v: string) { this._className = v; if (v === '') this.innerHTML = this.innerHTML; }
  get textContent() { return this._text; }
  set textContent(v: string) { this._text = v; }
  classList = {
    add: (c: string) => { const s = new Set(this._className.split(/\s+/).filter(Boolean)); s.add(c); this._className = [...s].join(' '); },
    remove: (c: string) => { this._className = this._className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    toggle: (c: string, on: boolean) => { if (on) this.classList.add(c); else this.classList.remove(c); },
    contains: (c: string) => this._className.split(/\s+/).includes(c),
  };
  setAttribute(n: string, v: string) { this.attrs[n] = v; }
  getAttribute(n: string) { return this.attrs[n] ?? null; }
  appendChild(n: FakeNode) { this.children.push(n); return n; }
  addEventListener(type: string, fn: (e: Record<string, unknown>) => void) { (this.listeners[type] ??= []).push(fn); }
  dispatchEvent(e: Record<string, unknown> & { type: string }) { (this.listeners[e.type] ?? []).slice().forEach((fn) => fn(e)); }
  remove() {}
  fire(type: string) { this.dispatchEvent({ type }); }
}

function installFakeDom() {
  (globalThis as Record<string, unknown>).document = { createElement: (tag: string) => new FakeNode(tag) };
}

function findByText(root: FakeNode, text: string): FakeNode | undefined {
  for (const c of root.children) {
    if (c.textContent === text || c.children.some((g) => g.textContent === text)) return c;
    const deep = findByText(c, text);
    if (deep) return deep;
  }
  return undefined;
}
function rowControl(root: FakeNode, label: string): FakeNode {
  const row = findRow(root, label)!;
  return row.children[1];
}
function findRow(node: FakeNode, label: string): FakeNode | undefined {
  if (node.className === 'mc-props-row' && node.children[0]?.textContent === label) return node;
  for (const c of node.children) {
    const f = findRow(c, label);
    if (f) return f;
  }
  return undefined;
}
function titleBtn(root: FakeNode): FakeNode {
  return root.children.find((c) => c.className === 'mc-props-title')!;
}

function io(doc: PlanDoc, selectedId: string | null): { io: PropsPanelIO; applied: Array<Record<string, unknown>> } {
  const applied: Array<Record<string, unknown>> = [];
  return {
    io: {
      apply: (op) => { applied.push(op as Record<string, unknown>); return { ok: true }; },
      snapshot: () => doc,
      selectedId: () => selectedId,
    },
    applied,
  };
}

const wall = (id: string): Wall => ({ id, a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 100 });
const door = (id: string, wallId: string): Opening => ({ id, kind: 'door', wallId, offset: 400, width: 900, swing: 'left' });
const fixture = (id: string): Fixture => ({ id, kind: 'chair', x: 0, y: 0, w: 400, d: 400, rotation: 0 });
const text = (id: string): Text => ({ id, x: 0, y: 0, text: 'hello', size: 200 });

describe('B-042 door swing flip button', () => {
  it('pinch-tap (click) on the Swing flip button fires set_swing, identical generic button path', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.openings.push(door('d1', 'w1'));
    doc.walls.push(wall('w1'));
    const { io: deps, applied } = io(doc, 'd1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const root = host as unknown as FakeNode;
    const flipBtn = rowControl(root, 'Swing');
    flipBtn.fire('click');
    expect(applied).toEqual([{ op: 'set_swing', target: 'd1' }]);
  });
});

describe('B-045 opening width resize via numInput', () => {
  it('pinch-drag-equivalent change event on the Width field fires set_width with the new value', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.openings.push(door('d1', 'w1'));
    doc.walls.push(wall('w1'));
    const { io: deps, applied } = io(doc, 'd1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const widthInput = rowControl(host as unknown as FakeNode, 'Width (mm)');
    widthInput.value = '1200';
    widthInput.fire('change');
    expect(applied).toEqual([{ op: 'set_width', target: 'd1', width: 1200 }]);
  });
});

describe('B-062 fixture rotation numeric stepper', () => {
  it('change event on Rotation fires rotate with a delta angle, not an absolute one', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.fixtures.push({ ...fixture('f1'), rotation: 30 });
    const { io: deps, applied } = io(doc, 'f1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const rot = rowControl(host as unknown as FakeNode, 'Rotation (°)');
    rot.value = '45';
    rot.fire('change');
    expect(applied).toEqual([{ op: 'rotate', target: 'f1', angle: 15 }]); // 45 - 30
  });
});

describe('B-064 fixture width/depth resize via numInput only (no on-canvas handle)', () => {
  it('Width and Depth fields each fire independent set_size ops', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1'));
    const { io: deps, applied } = io(doc, 'f1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const root = host as unknown as FakeNode;
    rowControl(root, 'Width (mm)').value = '600';
    rowControl(root, 'Width (mm)').fire('change');
    rowControl(root, 'Depth (mm)').value = '700';
    rowControl(root, 'Depth (mm)').fire('change');
    expect(applied).toEqual([
      { op: 'set_size', target: 'f1', w: 600 },
      { op: 'set_size', target: 'f1', d: 700 },
    ]);
  });
});

describe('B-069/B-070 text label: font-size numInput and text-content input', () => {
  it('B-069 font size change fires set_font', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.texts.push(text('t1'));
    const { io: deps, applied } = io(doc, 't1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const size = rowControl(host as unknown as FakeNode, 'Font size (mm)');
    size.value = '350';
    size.fire('change');
    expect(applied).toEqual([{ op: 'set_font', target: 't1', size: 350 }]);
  });

  it('B-070 editing the text field fires set_text, trimmed; empty text is ignored', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.texts.push(text('t1'));
    const { io: deps, applied } = io(doc, 't1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const field = rowControl(host as unknown as FakeNode, 'Text');
    field.value = '  new label  ';
    field.fire('change');
    field.value = '   ';
    field.fire('change');
    expect(applied).toEqual([{ op: 'set_text', target: 't1', text: 'new label' }]);
  });
});

describe('B-077 room name field', () => {
  it('editing the room Name field fires rename, trimmed', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.rooms.push({ id: 'r1', name: 'Room 1', wallIds: ['w1'] } as PlanDoc['rooms'][number]);
    doc.walls.push(wall('w1'));
    const { io: deps, applied } = io(doc, 'r1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const name = rowControl(host as unknown as FakeNode, 'Name');
    name.value = ' Kitchen ';
    name.fire('change');
    expect(applied).toEqual([{ op: 'rename', target: 'r1', name: 'Kitchen' }]);
  });
});

describe('B-075 expandable panel section: tap to expand/collapse', () => {
  it('pinch-tap on the title toggles is-expanded and aria-expanded', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.walls.push(wall('w1'));
    const { io: deps } = io(doc, 'w1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    const panel = createPropsPanel(host, deps);
    const root = (host as unknown as FakeNode).children[0]; // createPropsPanel appends its own .mc-props root
    const title = titleBtn(root);
    expect(title.getAttribute('aria-expanded')).toBe('false');
    expect(root.classList.contains('is-expanded')).toBe(false);
    title.fire('click');
    expect(title.getAttribute('aria-expanded')).toBe('true');
    expect(root.classList.contains('is-expanded')).toBe(true);
    panel.update(); // rebuild — state should persist across re-render
    const title2 = titleBtn(root);
    expect(title2.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('B-076 multi-selection batch edit', () => {
  it('a single Thickness change for 3 selected walls applies ONE batch op covering all three', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.walls.push(wall('w1'), wall('w2'), wall('w3'));
    doc.selectedIds = ['w1', 'w2', 'w3'];
    const { io: deps, applied } = io(doc, null);
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const thickness = rowControl(host as unknown as FakeNode, 'Thickness (mm)');
    thickness.value = '150';
    thickness.fire('change');
    expect(applied).toEqual([{
      op: 'batch',
      ops: [
        { op: 'set_thickness', target: 'w1', thickness: 150 },
        { op: 'set_thickness', target: 'w2', thickness: 150 },
        { op: 'set_thickness', target: 'w3', thickness: 150 },
      ],
    }]);
  });
});

describe('B-115 wall length resize via numInput (props panel)', () => {
  it('change event on Length fires set_length', () => {
    installFakeDom();
    const doc = emptyPlan();
    doc.walls.push(wall('w1'));
    const { io: deps, applied } = io(doc, 'w1');
    const host = new FakeNode('div') as unknown as HTMLElement;
    createPropsPanel(host, deps);
    const len = rowControl(host as unknown as FakeNode, 'Length (mm)');
    len.value = '2000';
    len.fire('change');
    expect(applied).toEqual([{ op: 'set_length', target: 'w1', length: 2000 }]);
  });
});

describe('B-071/B-068/B-070 on-screen keyboard auto-open for props-panel/text-tool fields', () => {
  it.skip('CAMERA-ONLY/untestable here: src/ui/onscreenKeyboard.ts gates its focusin handler on `el instanceof HTMLInputElement/HTMLTextAreaElement` (onscreenKeyboard.ts:42-48), which requires real DOM globals; this repo\'s vitest runs with environment "node" (no jsdom), so the hand-rolled FakeNode used elsewhere in this file is never `instanceof HTMLInputElement` and cannot exercise that integration', () => {});
});
