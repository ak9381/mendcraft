import { describe, expect, it } from 'vitest';
import {
  clampMove, clampResize, computeBounds, terminalCutPx,
  loadFrameLayout, saveFrameLayout, clearFrameLayout,
  mountItemHandles, mountEditBoard, resizeToCorners, resizeByHandle,
  MIN_ITEM_SIZE, MAX_ITEM_SIZE,
  type EditEl, type EditItemRef, type ItemLayout, type Rect, type PointerLikeEvent,
} from '../../src/canvas/editBoard';

// Every corner and edge resizes (not just bottom-right); each keeps the
// OPPOSITE edge/corner anchored, same as any editor (A4-006..A4-012).
describe('resizeByHandle (A4-006..A4-012 all 8 handles)', () => {
  const bounds: Rect = { left: 0, top: 0, width: 1000, height: 1000 };
  const box: ItemLayout = { left: 300, top: 300, width: 300, height: 300 }; // 300..600

  it('se (bottom-right) grows width/height, top-left anchored — same as the old lone handle', () => {
    expect(resizeByHandle(box, 'se', 40, 50, bounds)).toEqual({ left: 300, top: 300, width: 340, height: 350 });
  });
  it('nw (top-left) moves the top-left corner, bottom-right anchored', () => {
    expect(resizeByHandle(box, 'nw', -40, -50, bounds)).toEqual({ left: 260, top: 250, width: 340, height: 350 });
  });
  it('ne (top-right) moves top + right, bottom-left anchored', () => {
    expect(resizeByHandle(box, 'ne', 40, -50, bounds)).toEqual({ left: 300, top: 250, width: 340, height: 350 });
  });
  it('sw (bottom-left) moves left + bottom, top-right anchored', () => {
    expect(resizeByHandle(box, 'sw', -40, 50, bounds)).toEqual({ left: 260, top: 300, width: 340, height: 350 });
  });
  it('n (top edge) moves top only, width untouched', () => {
    expect(resizeByHandle(box, 'n', 999, -60, bounds)).toEqual({ left: 300, top: 240, width: 300, height: 360 });
  });
  it('e (right edge) moves right only, height untouched', () => {
    expect(resizeByHandle(box, 'e', 60, 999, bounds)).toEqual({ left: 300, top: 300, width: 360, height: 300 });
  });
  it('w (left edge) moves left only, right anchored', () => {
    expect(resizeByHandle(box, 'w', -60, 0, bounds)).toEqual({ left: 240, top: 300, width: 360, height: 300 });
  });
  it('s (bottom edge) moves bottom only', () => {
    expect(resizeByHandle(box, 's', 0, 60, bounds)).toEqual({ left: 300, top: 300, width: 300, height: 360 });
  });
  it('a nw shrink past MIN keeps the bottom-right corner pinned (anchor respected)', () => {
    const r = resizeByHandle({ left: 300, top: 300, width: 300, height: 300 }, 'nw', 1000, 1000, bounds);
    expect(r.width).toBe(MIN_ITEM_SIZE.width);
    expect(r.height).toBe(MIN_ITEM_SIZE.height);
    expect(r.left + r.width).toBe(600); // right edge unmoved
    expect(r.top + r.height).toBe(600); // bottom edge unmoved
  });
  it('an e grow is capped by the board edge from the left', () => {
    const r = resizeByHandle({ left: 800, top: 300, width: 150, height: 150 }, 'e', 5000, 0, { left: 0, top: 0, width: 1000, height: 1000 });
    expect(r.left).toBe(800);
    expect(r.left + r.width).toBeLessThanOrEqual(1000);
  });
});

// Akash's natural two-hand model: each hand grabs the NEAREST corner of the
// tile and that corner tracks its finger. These are the pure-geometry proofs;
// the stateful hit-test/commit path is exercised under mountEditBoard below.
describe('resizeToCorners (A4-013/A4-014 two-hand anchored resize)', () => {
  const box: Rect = { left: 100, top: 100, width: 200, height: 200 }; // corners (100,100)..(300,300)
  const near = (a: number, b: number) => Math.abs(a - b) <= 2; // within 2px of the finger

  it('grab top-left + bottom-right, pull apart → both grabbed corners follow the fingers', () => {
    const r = resizeToCorners(box, { x: 100, y: 100 }, { x: 300, y: 300 }, { x: 80, y: 80 }, { x: 320, y: 320 });
    expect(near(r.left, 80)).toBe(true);
    expect(near(r.top, 80)).toBe(true);
    expect(near(r.left + r.width, 320)).toBe(true);
    expect(near(r.top + r.height, 320)).toBe(true);
  });

  it('grab top-right + bottom-left → the other diagonal tracks the fingers', () => {
    const r = resizeToCorners(box, { x: 300, y: 100 }, { x: 100, y: 300 }, { x: 320, y: 80 }, { x: 80, y: 320 });
    expect(near(r.left + r.width, 320)).toBe(true); // TR x
    expect(near(r.top, 80)).toBe(true);             // TR y
    expect(near(r.left, 80)).toBe(true);            // BL x
    expect(near(r.top + r.height, 320)).toBe(true); // BL y
  });

  it('one hand still → only the moving corner moves, the still corner stays pinned', () => {
    const r = resizeToCorners(box, { x: 100, y: 100 }, { x: 300, y: 300 }, { x: 70, y: 70 }, { x: 300, y: 300 });
    expect(near(r.left, 70)).toBe(true);
    expect(near(r.top, 70)).toBe(true);
    expect(near(r.left + r.width, 300)).toBe(true); // bottom-right unchanged
    expect(near(r.top + r.height, 300)).toBe(true);
  });

  it('both hands on the same (top) edge → that edge pair moves, width held', () => {
    const r = resizeToCorners(box, { x: 100, y: 100 }, { x: 300, y: 100 }, { x: 100, y: 70 }, { x: 300, y: 70 });
    expect(near(r.top, 70)).toBe(true);
    expect(near(r.left, 100)).toBe(true);
    expect(near(r.width, 200)).toBe(true);
    expect(near(r.top + r.height, 300)).toBe(true); // bottom unchanged
  });

  it('no finger movement → the box is unchanged (a resting two-hand hold does nothing)', () => {
    const r = resizeToCorners(box, { x: 100, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 100 }, { x: 300, y: 300 });
    expect(r).toEqual(box);
  });
});

describe('clampMove', () => {
  const bounds: Rect = { left: 12, top: 12, width: 776, height: 576 };
  it('leaves an in-bounds item alone', () => {
    expect(clampMove({ left: 100, top: 100, width: 300, height: 200 }, bounds)).toEqual({ left: 100, top: 100, width: 300, height: 200 });
  });
  it('pulls an item back onto the board from past any edge', () => {
    expect(clampMove({ left: -500, top: -500, width: 300, height: 200 }, bounds)).toEqual({ left: 12, top: 12, width: 300, height: 200 });
    expect(clampMove({ left: 5000, top: 5000, width: 300, height: 200 }, bounds)).toEqual({ left: 488, top: 388, width: 300, height: 200 });
  });
});

describe('clampResize', () => {
  const bounds: Rect = { left: 12, top: 12, width: 776, height: 576 };
  it('leaves an in-range size alone', () => {
    expect(clampResize({ left: 12, top: 12, width: 300, height: 220 }, bounds)).toEqual({ left: 12, top: 12, width: 300, height: 220 });
  });
  it('never shrinks below MIN_ITEM_SIZE — controls inside the tile stay usable', () => {
    expect(clampResize({ left: 12, top: 12, width: 50, height: 50 }, bounds)).toEqual({ left: 12, top: 12, ...MIN_ITEM_SIZE });
  });
  it('never grows past MAX_ITEM_SIZE', () => {
    expect(clampResize({ left: 12, top: 12, width: 5000, height: 5000 }, bounds)).toEqual({ left: 12, top: 12, ...MAX_ITEM_SIZE });
  });
  it('never grows past the board edge from the item’s own corner', () => {
    // right edge of bounds is at 788; an item at left:600 can only grow to 188 wide.
    expect(clampResize({ left: 600, top: 12, width: 300, height: 220 }, bounds).width).toBe(188);
  });
});

describe('terminalCutPx', () => {
  it('is zero when there is no AI panel or they do not overlap', () => {
    expect(terminalCutPx({ left: 0, top: 0, width: 800, height: 600 }, null)).toBe(0);
    expect(terminalCutPx({ left: 0, top: 0, width: 800, height: 600 }, { left: 900, top: 0, width: 400, height: 600 })).toBe(0);
  });
  it('is the overlap in px when the board runs under the reserved terminal column', () => {
    // board right edge at 800, ai panel starts at 700 → 100px overlap.
    expect(terminalCutPx({ left: 0, top: 0, width: 800, height: 600 }, { left: 700, top: 0, width: 400, height: 600 })).toBe(100);
  });
});

describe('computeBounds', () => {
  it('pads all sides and shrinks the right edge by the terminal cut', () => {
    expect(computeBounds({ width: 800, height: 600 }, 100, 12)).toEqual({ left: 12, top: 12, width: 676, height: 576 });
  });
  it('never goes negative on a board smaller than the padding', () => {
    expect(computeBounds({ width: 10, height: 10 }, 0, 12)).toEqual({ left: 12, top: 12, width: 0, height: 0 });
  });
});

describe('frame layout persistence', () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
      clear: () => m.clear(), key: () => null, length: 0,
    } as Storage;
  }
  it('round-trips a saved layout, scoped per frame', () => {
    const s = memoryStorage();
    expect(loadFrameLayout(s, 'f1')).toBeNull();
    const map = { 'lamp-wiz-desk': { left: 10, top: 20, width: 300, height: 200 } };
    saveFrameLayout(s, 'f1', map);
    expect(loadFrameLayout(s, 'f1')).toEqual(map);
    expect(loadFrameLayout(s, 'f2')).toBeNull();
    clearFrameLayout(s, 'f1');
    expect(loadFrameLayout(s, 'f1')).toBeNull();
  });
  it('treats a corrupt stored value as absent rather than throwing', () => {
    const s = memoryStorage();
    s.setItem('mc.editLayout.f1', 'not json');
    expect(loadFrameLayout(s, 'f1')).toBeNull();
  });
  it('a storage that throws (private mode) never breaks the caller', () => {
    const angry: Storage = {
      getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); }, clear: () => {}, key: () => null, length: 0,
    } as Storage;
    expect(() => saveFrameLayout(angry, 'f1', {})).not.toThrow();
    expect(loadFrameLayout(angry, 'f1')).toBeNull();
    expect(() => clearFrameLayout(angry, 'f1')).not.toThrow();
  });
});

describe('mountItemHandles', () => {
  function makeHandle() {
    const listeners: Record<string, Array<(e: PointerLikeEvent) => void>> = {};
    return {
      addEventListener(type: string, fn: (e: PointerLikeEvent) => void) { (listeners[type] ??= []).push(fn); },
      removeEventListener(type: string, fn: (e: PointerLikeEvent) => void) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
      fire(type: string, e: PointerLikeEvent) { listeners[type]?.forEach((fn) => fn(e)); },
    };
  }
  const bounds: Rect = { left: 0, top: 0, width: 1000, height: 1000 };
  const initial: ItemLayout = { left: 100, top: 100, width: 300, height: 220 };

  it('drags: pointerdown then pointermove by a delta moves the item by that delta', () => {
    const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
    const move = makeHandle(); const resize = makeHandle();
    mountItemHandles(item, move, resize, initial, { getBounds: () => bounds });
    move.fire('pointerdown', { clientX: 100, clientY: 100 });
    move.fire('pointermove', { clientX: 150, clientY: 130 });
    expect(item.style.left).toBe('150px');
    expect(item.style.top).toBe('130px');
    expect(item.style.width).toBe('300px'); // move never touches size
  });

  it('resizes: pointerdown then pointermove by a delta grows width/height by that delta, position unchanged', () => {
    const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
    const move = makeHandle(); const resize = makeHandle();
    mountItemHandles(item, move, resize, initial, { getBounds: () => bounds });
    resize.fire('pointerdown', { clientX: 400, clientY: 320 }); // bottom-right corner of the 300x220 box at (100,100)
    resize.fire('pointermove', { clientX: 450, clientY: 370 }); // +50,+50
    expect(item.style.width).toBe('350px');
    expect(item.style.height).toBe('270px');
    expect(item.style.left).toBe('100px');
    expect(item.style.top).toBe('100px');
  });

  it('clamps a resize against live bounds (re-read every move, e.g. the terminal column opening mid-drag)', () => {
    const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
    const move = makeHandle(); const resize = makeHandle();
    let liveBounds: Rect = bounds;
    mountItemHandles(item, move, resize, initial, { getBounds: () => liveBounds });
    resize.fire('pointerdown', { clientX: 400, clientY: 320 });
    liveBounds = { left: 0, top: 0, width: 420, height: 1000 }; // the AI panel just opened, narrowing the board
    resize.fire('pointermove', { clientX: 2000, clientY: 320 }); // tries to grow way past the new edge
    expect(Number.parseFloat(item.style.width!)).toBeLessThanOrEqual(420 - 100); // can't pass the new right edge from left:100
  });

  it('commits the final layout on pointerup, not on every move', () => {
    const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
    const move = makeHandle(); const resize = makeHandle();
    const commits: ItemLayout[] = [];
    mountItemHandles(item, move, resize, initial, { getBounds: () => bounds, onCommit: (l) => commits.push(l) });
    move.fire('pointerdown', { clientX: 100, clientY: 100 });
    move.fire('pointermove', { clientX: 120, clientY: 100 });
    move.fire('pointermove', { clientX: 140, clientY: 100 });
    expect(commits).toHaveLength(0);
    move.fire('pointerup', { clientX: 140, clientY: 100 });
    expect(commits).toEqual([{ left: 140, top: 100, width: 300, height: 220 }]);
  });

  it('A4-018: a sub-slop brush/tremor never moves or commits the tile (accidental-touch guard)', () => {
    const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
    const move = makeHandle(); const resize = makeHandle();
    const commits: ItemLayout[] = [];
    mountItemHandles(item, move, resize, initial, { getBounds: () => bounds, onCommit: (l) => commits.push(l) });
    move.fire('pointerdown', { clientX: 100, clientY: 100 });
    move.fire('pointermove', { clientX: 103, clientY: 102 }); // 3.6px — below the engage slop
    expect(item.style.left).toBe('100px'); // unchanged: a tremor/brush is ignored
    expect(item.style.top).toBe('100px');
    move.fire('pointerup', { clientX: 103, clientY: 102 });
    expect(commits).toHaveLength(0); // never engaged → nothing to commit

    // a deliberate move past the slop engages and then tracks the full delta
    move.fire('pointerdown', { clientX: 100, clientY: 100 });
    move.fire('pointermove', { clientX: 120, clientY: 100 }); // 20px — past slop
    expect(item.style.left).toBe('120px');
    move.fire('pointerup', { clientX: 120, clientY: 100 });
    expect(commits).toEqual([{ left: 120, top: 100, width: 300, height: 220 }]);
  });

  it('A4-018: a sub-slop resize nudge never changes the size', () => {
    const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
    const move = makeHandle(); const resize = makeHandle();
    mountItemHandles(item, move, resize, initial, { getBounds: () => bounds });
    resize.fire('pointerdown', { clientX: 400, clientY: 320 });
    resize.fire('pointermove', { clientX: 404, clientY: 322 }); // ~4.5px — below slop
    expect(item.style.width).toBe('300px');
    expect(item.style.height).toBe('220px');
    resize.fire('pointermove', { clientX: 450, clientY: 370 }); // past slop → full delta
    expect(item.style.width).toBe('350px');
    expect(item.style.height).toBe('270px');
  });

  it('a pointercancel ends the drag like pointerup (no stuck drag state)', () => {
    const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
    const move = makeHandle(); const resize = makeHandle();
    mountItemHandles(item, move, resize, initial, { getBounds: () => bounds });
    move.fire('pointerdown', { clientX: 100, clientY: 100 });
    move.fire('pointermove', { clientX: 120, clientY: 100 });
    move.fire('pointercancel', { clientX: 120, clientY: 100 });
    const before = item.style.left;
    move.fire('pointermove', { clientX: 900, clientY: 900 }); // ignored: no drag in progress
    expect(item.style.left).toBe(before);
  });

  it('A3-006: a pointercancel (hand lost mid-drag) puts the tile back and commits nothing', () => {
    const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
    const move = makeHandle(); const resize = makeHandle();
    const commits: ItemLayout[] = [];
    mountItemHandles(item, move, resize, initial, { getBounds: () => bounds, onCommit: (l) => commits.push(l) });
    move.fire('pointerdown', { clientX: 100, clientY: 100 });
    move.fire('pointermove', { clientX: 300, clientY: 250 });
    expect(item.style.left).toBe('300px');
    move.fire('pointercancel', { clientX: 300, clientY: 250 });
    expect(item.style.left).toBe('100px');
    expect(item.style.top).toBe('100px');
    resize.fire('pointerdown', { clientX: 400, clientY: 320 });
    resize.fire('pointermove', { clientX: 500, clientY: 420 });
    expect(item.style.width).toBe('400px');
    resize.fire('pointercancel', { clientX: 500, clientY: 420 });
    expect(item.style.width).toBe('300px');
    expect(item.style.height).toBe('220px');
    expect(commits).toHaveLength(0);
  });

  it('A3-006: Escape mid-drag aborts the same way (mouse/keyboard parity)', () => {
    const keyListeners: Array<(e: { key: string; preventDefault(): void; stopPropagation(): void }) => void> = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const had = { add: g.addEventListener, rm: g.removeEventListener };
    g.addEventListener = (_t: string, fn: (typeof keyListeners)[number]) => keyListeners.push(fn);
    g.removeEventListener = (_t: string, fn: (typeof keyListeners)[number]) => { const i = keyListeners.indexOf(fn); if (i >= 0) keyListeners.splice(i, 1); };
    try {
      const item = { style: {} as { left?: string; top?: string; width?: string; height?: string } };
      const move = makeHandle(); const resize = makeHandle();
      const commits: ItemLayout[] = [];
      mountItemHandles(item, move, resize, initial, { getBounds: () => bounds, onCommit: (l) => commits.push(l) });
      move.fire('pointerdown', { clientX: 100, clientY: 100 });
      move.fire('pointermove', { clientX: 300, clientY: 250 });
      expect(keyListeners).toHaveLength(1);
      keyListeners[0]({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
      expect(item.style.left).toBe('100px');
      expect(keyListeners).toHaveLength(0);
      move.fire('pointerup', { clientX: 300, clientY: 250 });
      expect(commits).toHaveLength(0);
    } finally { g.addEventListener = had.add; g.removeEventListener = had.rm; }
  });
});

// ---------------------------------------------------------- mountEditBoard

/** Minimal hand-rolled fake DOM, in the same style the rest of this suite
 *  uses for DOM modules under Vitest's node environment (no jsdom). */
class FakeEl implements EditEl {
  tag: string;
  classes = new Set<string>();
  style: { left?: string; top?: string; width?: string; height?: string; minHeight?: string; position?: string } = {};
  parentElement: FakeEl | null = null;
  clientWidth = 2000;
  clientHeight = 2000;
  hidden = false;
  disabled = false;
  textContent = '';
  attrs: Record<string, string> = {};
  rect: Rect = { left: 0, top: 0, width: 300, height: 200 };
  listeners: Record<string, Array<(e: PointerLikeEvent) => void>> = {};
  constructor(tag: string) { this.tag = tag; }
  classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
    toggle: (c: string, on?: boolean) => { const next = on ?? !this.classes.has(c); if (next) this.classes.add(c); else this.classes.delete(c); return next; },
    contains: (c: string) => this.classes.has(c),
  };
  getBoundingClientRect(): Rect { return this.rect; }
  append(...nodes: FakeEl[]): void { for (const n of nodes) n.parentElement = this; }
  remove(): void { this.parentElement = null; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(type: string, fn: (e: PointerLikeEvent) => void): void { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: PointerLikeEvent) => void): void { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  fire(type: string, e?: Partial<PointerLikeEvent>): void { this.listeners[type]?.forEach((fn) => fn((e ?? {}) as PointerLikeEvent)); }
  click(): void { this.fire('click'); }
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0,
  } as Storage;
}

function setup(onItemCommit?: (frameId: string, key: string) => void) {
  const created: FakeEl[] = [];
  const createElement = (tag: string): EditEl => { const el = new FakeEl(tag); created.push(el); return el; };
  const root = new FakeEl('div');
  const aiPanel = new FakeEl('aside'); aiPanel.hidden = true; aiPanel.rect = { left: 1200, top: 0, width: 400, height: 900 };

  const columnF1 = new FakeEl('a2ui-basic-column');
  const lamp = new FakeEl('mc-lamp-tile'); lamp.rect = { left: 20, top: 60, width: 300, height: 180 }; lamp.parentElement = columnF1;
  const music = new FakeEl('mc-music-tile'); music.rect = { left: 20, top: 260, width: 300, height: 180 }; music.parentElement = columnF1;

  const itemsByFrame: Record<string, EditItemRef[]> = {
    f1: [
      { key: 'lamp-wiz-desk', el: lamp, label: 'Desk lamp' },
      { key: 'music-speaker-1', el: music, label: 'Speaker' },
    ],
  };

  const storage = memoryStorage();
  const ctl = mountEditBoard(root as unknown as EditEl, {
    storage, createElement, getAiPanelEl: () => aiPanel,
    getItems: (frameId) => itemsByFrame[frameId] ?? [],
    onItemCommit,
  });
  const byClass = (cls: string) => created.filter((e) => e.classes.has(cls));
  const editBtn = byClass('mc-edit-toggle')[0];
  const resetBtn = byClass('mc-edit-reset')[0];
  return { created, root, aiPanel, columnF1, lamp, music, storage, ctl, byClass, editBtn, resetBtn };
}

describe('mountEditBoard', () => {
  it('disables Edit with no focused board, enables it once one has tiles', () => {
    const { ctl, editBtn } = setup();
    expect(editBtn.disabled).toBe(true);
    ctl.setFocus(null, false);
    expect(editBtn.disabled).toBe(true);
    ctl.setFocus('f1', true);
    expect(editBtn.disabled).toBe(false);
    expect(ctl.editing).toBe(false);
  });

  it('does nothing to an un-edited board (no wrapping, tiles stay in their normal flow)', () => {
    const { ctl, columnF1, lamp, byClass } = setup();
    ctl.setFocus('f1', true);
    expect(lamp.parentElement).toBe(columnF1); // never touched
    expect(byClass('mc-edit-canvas')).toHaveLength(0);
  });

  it('Edit wraps every tile, measures its current box, and persists the layout', () => {
    const { ctl, editBtn, lamp, music, storage, byClass } = setup();
    ctl.setFocus('f1', true);
    editBtn.click();
    expect(ctl.editing).toBe(true);

    const lampWrapper = lamp.parentElement!;
    expect(lampWrapper.classes.has('mc-edit-item')).toBe(true);
    const canvasEl = lampWrapper.parentElement!;
    expect(canvasEl.classes.has('mc-edit-canvas')).toBe(true);
    expect(canvasEl.classes.has('mc-editing')).toBe(true);
    // lamp and music share a left edge (natural rect left:20 for both) →
    // the padding (12px) becomes their left after clamping off the origin.
    expect(lampWrapper.style.left).toBe('12px');
    expect(lampWrapper.style.top).toBe('12px');
    // natural height (180) is below MIN_ITEM_SIZE.height (200) — grown to stay usable.
    expect(lampWrapper.style.height).toBe('200px');
    const musicWrapper = music.parentElement!;
    expect(musicWrapper.style.top).toBe('200px'); // natural gap preserved (260-60=200)

    const saved = loadFrameLayout(storage, 'f1')!;
    expect(saved['lamp-wiz-desk']).toEqual({ left: 12, top: 12, width: 300, height: 200 });
    expect(saved['music-speaker-1']).toEqual({ left: 12, top: 200, width: 300, height: 200 });

    const moveHandles = byClass('mc-edit-move');
    const lampMove = moveHandles.find((h) => h.attrs['aria-label']?.includes('Desk lamp'))!;
    expect(lampMove.attrs['data-mc-drag-handle']).toBe('');
    const resizeHandles = byClass('mc-edit-resize');
    // All 8 corners/edges now carry a resize handle (A4-006..A4-012), each a
    // DRAG_HANDLE target and tagged with its direction.
    const lampResizes = resizeHandles.filter((h) => h.attrs['aria-label']?.includes('Desk lamp'));
    expect(lampResizes).toHaveLength(8);
    const dirs = lampResizes.map((h) => h.attrs['data-mc-resize-handle']).sort();
    expect(dirs).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });

  it('Done (Edit off) keeps the positioned layout and only hides the chrome', () => {
    const { ctl, editBtn, lamp, byClass } = setup();
    ctl.setFocus('f1', true);
    editBtn.click(); // on
    const firstWrapperLeft = lamp.parentElement!.style.left;
    editBtn.click(); // off
    expect(ctl.editing).toBe(false);
    const canvasEl = byClass('mc-edit-canvas').at(-1)!;
    expect(canvasEl.classes.has('mc-editing')).toBe(false);
    expect(lamp.parentElement!.classes.has('mc-edit-item')).toBe(true); // still positioned
    expect(lamp.parentElement!.style.left).toBe(firstWrapperLeft); // same spot
  });

  it('a saved layout from an earlier session is re-applied even while Edit is off', () => {
    const { ctl, storage, lamp, music } = setup();
    saveFrameLayout(storage, 'f1', {
      'lamp-wiz-desk': { left: 999, top: 50, width: 260, height: 210 },
      'music-speaker-1': { left: 40, top: 300, width: 280, height: 220 },
    });
    ctl.setFocus('f1', true); // editing stays off
    expect(ctl.editing).toBe(false);
    expect(lamp.parentElement!.style.left).toBe('999px');
    expect(lamp.parentElement!.style.height).toBe('210px');
    expect(music.parentElement!.style.top).toBe('300px');
  });

  it('Reset layout clears a saved layout and remeasures the natural flow', () => {
    const { ctl, editBtn, resetBtn, storage, lamp } = setup();
    saveFrameLayout(storage, 'f1', { 'lamp-wiz-desk': { left: 999, top: 999, width: 300, height: 300 }, 'music-speaker-1': { left: 5, top: 5, width: 250, height: 250 } });
    ctl.setFocus('f1', true);
    editBtn.click(); // on — still shows the stale saved spot
    expect(lamp.parentElement!.style.left).toBe('999px');

    resetBtn.click();
    expect(loadFrameLayout(storage, 'f1')).not.toBeNull();
    // natural measurement (origin-subtracted, clamped) is back to {12,12,300,200} as in the fresh-board test.
    expect(lamp.parentElement!.style.left).toBe('12px');
    expect(lamp.parentElement!.style.top).toBe('12px');
    expect(resetBtn.hidden).toBe(false); // reset stays in edit mode, ready to re-customize
  });

  it('switching to a different (or no) focused board hides chrome on the one left behind', () => {
    const { ctl, editBtn, byClass } = setup();
    ctl.setFocus('f1', true);
    editBtn.click();
    expect(byClass('mc-edit-canvas').at(-1)!.classes.has('mc-editing')).toBe(true);

    ctl.setFocus('f2', false); // a board with no items known to getItems()
    expect(ctl.editing).toBe(false);
    // hiding chrome on the way out rebuilds the wrapper (unwrap+rewrap, same
    // as any other applyFrame pass) — the latest one is the one that matters.
    expect(byClass('mc-edit-canvas').at(-1)!.classes.has('mc-editing')).toBe(false);
    expect(editBtn.disabled).toBe(true);
  });

  it('clamps the board clear of the reserved terminal column when the AI panel is open', () => {
    const { ctl, editBtn, aiPanel, byClass } = setup();
    ctl.setFocus('f1', true);
    editBtn.click();
    const canvasEl = byClass('mc-edit-canvas').at(-1)!;
    canvasEl.rect = { left: 0, top: 0, width: 1300, height: 900 }; // board runs right up to the AI panel
    canvasEl.clientWidth = 1300;
    aiPanel.hidden = false; // the AI panel is open and overlaps the board's right edge
    const lampResize = byClass('mc-edit-resize').find((h) => h.attrs['aria-label']?.includes('Desk lamp') && h.attrs['data-mc-resize-handle'] === 'se')!;
    const lampWrapper = lampResize.parentElement!;
    lampWrapper.style.left = '12px'; lampWrapper.style.top = '12px'; lampWrapper.style.width = '300px'; lampWrapper.style.height = '200px';
    lampResize.fire('pointerdown', { clientX: 312, clientY: 212 });
    lampResize.fire('pointermove', { clientX: 5000, clientY: 212 }); // tries to grow far past the terminal column
    // aiPanel.left (1200) minus the item's left (12) is the hard ceiling.
    expect(Number.parseFloat(lampWrapper.style.width!)).toBeLessThanOrEqual(1200 - 12);
  });

  it('fires onItemCommit with the frame id and the tile key once a drag ends (self-check re-check hook)', () => {
    const commits: Array<[string, string]> = [];
    const { ctl, editBtn, byClass } = setup((frameId, key) => commits.push([frameId, key]));
    ctl.setFocus('f1', true);
    editBtn.click();
    const lampMove = byClass('mc-edit-move').find((h) => h.attrs['aria-label']?.includes('Desk lamp'))!;
    lampMove.fire('pointerdown', { clientX: 100, clientY: 100 });
    expect(commits).toHaveLength(0); // no commit mid-drag
    lampMove.fire('pointermove', { clientX: 140, clientY: 120 });
    expect(commits).toHaveLength(0);
    lampMove.fire('pointerup');
    expect(commits).toEqual([['f1', 'lamp-wiz-desk']]);
  });

  it('A4-013: two-hand pinch grabs the tile under the midpoint, tracks corners, commits once', () => {
    const commits: Array<[string, string]> = [];
    const { ctl, editBtn, lamp, music } = setup((frameId, key) => commits.push([frameId, key]));
    ctl.setFocus('f1', true);
    // not editing yet -> refuses to grab
    expect(ctl.pinchResize('start', { x: 100, y: 100 }, { x: 110, y: 110 })).toBe(false);
    editBtn.click();
    // give the two wrappers distinct screen rects to hit-test against
    const lampWrapper = lamp.parentElement!; lampWrapper.rect = { left: 0, top: 0, width: 300, height: 200 };
    const musicWrapper = music.parentElement!; musicWrapper.rect = { left: 0, top: 400, width: 300, height: 200 };

    // a pinch whose MIDPOINT lands over empty space (between the tiles) grabs nothing
    expect(ctl.pinchResize('start', { x: 150, y: 300 }, { x: 150, y: 340 })).toBe(false);

    // grab the music tile at its top-left (0,400) and bottom-right (300,600)
    // corners, then pull them apart by 40px on each axis.
    expect(ctl.pinchResize('start', { x: 0, y: 400 }, { x: 300, y: 600 })).toBe(true);
    const w0 = Number.parseFloat(musicWrapper.style.width!);
    const h0 = Number.parseFloat(musicWrapper.style.height!);
    ctl.pinchResize('move', { x: -40, y: 360 }, { x: 340, y: 640 });
    // both corners moved out 40px → width/height grow by 80 each (clamped to MAX).
    expect(Number.parseFloat(musicWrapper.style.width!)).toBeCloseTo(Math.min(MAX_ITEM_SIZE.width, w0 + 80), 3);
    expect(Number.parseFloat(musicWrapper.style.height!)).toBeCloseTo(Math.min(MAX_ITEM_SIZE.height, h0 + 80), 3);
    expect(commits).toHaveLength(0); // no commit mid-gesture
    ctl.pinchResize('end');
    expect(commits).toEqual([['f1', 'music-speaker-1']]);
  });

  it('A4-013: one still hand holds its corner while the other corner tracks its finger', () => {
    const { ctl, editBtn, music } = setup();
    ctl.setFocus('f1', true);
    editBtn.click();
    const musicWrapper = music.parentElement!; musicWrapper.rect = { left: 0, top: 400, width: 300, height: 200 };
    // grab TL(0,400) and BR(300,600); keep TL still, drag BR out to (340,640)
    expect(ctl.pinchResize('start', { x: 0, y: 400 }, { x: 300, y: 600 })).toBe(true);
    const w0 = Number.parseFloat(musicWrapper.style.width!);
    const left0 = musicWrapper.style.left, top0 = musicWrapper.style.top;
    ctl.pinchResize('move', { x: 0, y: 400 }, { x: 340, y: 640 });
    // only the bottom-right corner moved out → grows by 40 on each axis from that corner
    expect(Number.parseFloat(musicWrapper.style.width!)).toBeCloseTo(w0 + 40, 3);
    expect(musicWrapper.style.left).toBe(left0); // top-left corner stayed pinned
    expect(musicWrapper.style.top).toBe(top0);
  });
});

describe('Edit chrome survives a board re-render (A3-006 follow-up)', () => {
  it('renderSurface re-applies Edit mode once the new tiles have laid out', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    const body = src.slice(src.indexOf('function renderSurface('), src.indexOf('// ---- pinned-board dock'));
    expect(body).toMatch(/if \(id === focusId\) waitForLayout\(\(\) => \{ if \(focusId === id && surfaces\[id\]\) editBoard\.setFocus\(id/);
  });
});
