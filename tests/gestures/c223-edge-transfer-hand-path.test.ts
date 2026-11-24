// C223–C229 cross-device tile pick-and-drop, HAND path. A pinch grabs a tile's
// move handle (handPointer forwards the pinch as synthetic pointer events, same
// as connect-sheet-hand-path / plan-tools-move), and dragging it past the
// laptop viewport's left/right edge transfers it to the phone on that side.
// Drives the REAL editBoard.onItemDrag → edgeTransfer controller, so the dwell /
// tremor guard and the "two hands don't transfer" rule are exercised, not faked.
import { describe, expect, it } from 'vitest';
import {
  mountEditBoard, type EditEl, type EditItemRef, type ItemLayout, type Rect, type PointerLikeEvent,
} from '../../src/canvas/editBoard';
import { createEdgeTransferController, createPhoneExitController, type EdgeGlow } from '../../src/canvas/edgeTransfer';
import type { ScreenLayout } from '../../src/canvas/screenLayout';
import type { TileTransfer } from '../../src/canvas/tileTransfer';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

class FakeEl implements EditEl {
  tag: string;
  classes = new Set<string>();
  style: Record<string, string> = {};
  parentElement: FakeEl | null = null;
  clientWidth = 2000; clientHeight = 2000; hidden = false; disabled = false; textContent = '';
  attrs: Record<string, string> = {};
  rect: Rect = { left: 0, top: 0, width: 300, height: 200 };
  listeners: Record<string, Array<(e: PointerLikeEvent) => void>> = {};
  constructor(tag: string) { this.tag = tag; }
  classList = {
    add: (c: string) => this.classes.add(c), remove: (c: string) => this.classes.delete(c),
    toggle: (c: string, on?: boolean) => { const n = on ?? !this.classes.has(c); n ? this.classes.add(c) : this.classes.delete(c); return n; },
    contains: (c: string) => this.classes.has(c),
  };
  getBoundingClientRect(): Rect { return this.rect; }
  append(...nodes: FakeEl[]): void { for (const n of nodes) n.parentElement = this; }
  remove(): void { this.parentElement = null; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  setPointerCapture(): void {}
  addEventListener(t: string, fn: (e: PointerLikeEvent) => void): void { (this.listeners[t] ??= []).push(fn); }
  removeEventListener(t: string, fn: (e: PointerLikeEvent) => void): void { this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn); }
  fire(t: string, e?: Partial<PointerLikeEvent>): void { this.listeners[t]?.forEach((fn) => fn((e ?? {}) as PointerLikeEvent)); }
}

function memStore(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

const BOARD: SurfacePlan = {
  kind: 'room', title: 'Room',
  tiles: [
    { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' },
    { type: 'music', deviceId: 'speaker-1', label: 'Speaker' },
  ],
};
const VW = 1000;

function setup(layout: ScreenLayout, clock: { t: number }) {
  const created: FakeEl[] = [];
  const createElement = (tag: string): EditEl => { const el = new FakeEl(tag); created.push(el); return el; };
  const root = new FakeEl('div');
  const aiPanel = new FakeEl('aside'); aiPanel.hidden = true; aiPanel.rect = { left: 1800, top: 0, width: 200, height: 900 };
  const col = new FakeEl('col');
  const lamp = new FakeEl('lamp'); lamp.rect = { left: 20, top: 60, width: 300, height: 180 }; lamp.parentElement = col;
  const music = new FakeEl('music'); music.rect = { left: 20, top: 260, width: 300, height: 180 }; music.parentElement = col;
  const items: EditItemRef[] = [
    { key: 'lamp-wiz-desk', el: lamp as unknown as EditEl, label: 'Desk lamp' },
    { key: 'music-speaker-1', el: music as unknown as EditEl, label: 'Speaker' },
  ];
  const glows: EdgeGlow[] = [];
  const commits: TileTransfer[] = [];
  const controller = createEdgeTransferController({
    getViewportWidth: () => VW,
    getLayout: () => layout,
    getBoard: () => BOARD,
    onGlow: (g) => glows.push(g),
    onCommit: (t) => commits.push(t),
    now: () => clock.t,
    dwellMs: 220,
  });
  const ctl = mountEditBoard(root as unknown as EditEl, {
    storage: memStore(), createElement, getAiPanelEl: () => aiPanel as unknown as EditEl,
    getItems: () => items,
    onItemDrag: (ev) => controller.handleItemDrag(ev),
  });
  ctl.setFocus('f1', true);
  const byClass = (c: string) => created.filter((e) => e.classes.has(c));
  byClass('mc-edit-toggle')[0].fire('click'); // enter Edit
  const moveHandle = (label: string) => byClass('mc-edit-move').find((h) => h.attrs['aria-label']?.includes(label))!;
  return { moveHandle, glows, commits, ctl, controller };
}

describe('C223 pinch-drag a tile past a viewport edge → that phone', () => {
  it('past the LEFT edge sends the tile to the left phone', () => {
    const clock = { t: 0 };
    const { moveHandle, commits } = setup({ left: 'android', right: 'ios' }, clock);
    const h = moveHandle('Desk lamp');
    h.fire('pointerdown', { clientX: 500, clientY: 100, pointerId: 1 });
    h.fire('pointermove', { clientX: -40, clientY: 100, pointerId: 1 }); // pushed clear past the left edge
    h.fire('pointerup', { clientX: -40, clientY: 100, pointerId: 1 });
    expect(commits).toHaveLength(1);
    expect(commits[0].to).toBe('left');
    expect(commits[0].componentId).toBe('lamp-wiz-desk');
    expect(commits[0].enterEdge).toBe('right'); // enters the phone from its right
  });

  it('past the RIGHT edge sends the tile to the right phone', () => {
    const clock = { t: 0 };
    const { moveHandle, commits } = setup({ left: 'android', right: 'ios' }, clock);
    const h = moveHandle('Speaker');
    h.fire('pointerdown', { clientX: 500, clientY: 100, pointerId: 1 });
    h.fire('pointermove', { clientX: VW + 40, clientY: 100, pointerId: 1 });
    h.fire('pointerup', { clientX: VW + 40, clientY: 100, pointerId: 1 });
    expect(commits).toHaveLength(1);
    expect(commits[0].to).toBe('right');
    expect(commits[0].enterEdge).toBe('left');
  });
});

describe('C224 edge glow only toward a paired edge', () => {
  it('glows near a paired left edge, no glow near an unpaired right edge', () => {
    const clock = { t: 0 };
    const { moveHandle, glows } = setup({ left: 'android', right: null }, clock);
    const h = moveHandle('Desk lamp');
    h.fire('pointerdown', { clientX: 500, clientY: 100, pointerId: 1 });
    h.fire('pointermove', { clientX: 20, clientY: 100, pointerId: 1 }); // near paired left edge
    expect(glows.some((g) => g.side === 'left' && g.glow > 0.5)).toBe(true);
    // Now toward the UNPAIRED right edge — never a glow with a side.
    h.fire('pointermove', { clientX: VW - 10, clientY: 100, pointerId: 1 });
    const last = glows.at(-1)!;
    expect(last.side).toBeNull();
    h.fire('pointercancel', { clientX: VW - 10, clientY: 100, pointerId: 1 });
  });
});

describe('C227 two hands together do NOT transfer', () => {
  it('a two-hand pinch-resize never fires onItemDrag, so nothing transfers', () => {
    const clock = { t: 0 };
    const { ctl, commits, glows } = setup({ left: 'android', right: 'ios' }, clock);
    // Two-hand anchored resize straddling the left edge — the "together" path.
    ctl.pinchResize('start', { x: -100, y: 100 }, { x: 300, y: 300 });
    ctl.pinchResize('move', { x: -200, y: 100 }, { x: 400, y: 320 });
    ctl.pinchResize('end');
    expect(commits).toHaveLength(0);
    expect(glows).toHaveLength(0); // move handle never engaged
  });
});

describe('C228 tremor near an edge does not transfer; a deliberate hold does', () => {
  it('jitter ± a few px across the threshold under the debounce does NOT commit', () => {
    const clock = { t: 0 };
    const { moveHandle, commits } = setup({ left: 'android', right: 'ios' }, clock);
    const h = moveHandle('Desk lamp');
    h.fire('pointerdown', { clientX: 500, clientY: 100, pointerId: 1 });
    // Shake across the zone boundary (~zonePx=56 in, out, in...) faster than the
    // 220ms dwell — each exit resets the dwell clock, so it never fires.
    const shake = [[8, 0], [90, 40], [10, 80], [85, 120], [12, 160]] as const;
    for (const [x, t] of shake) { clock.t = t; h.fire('pointermove', { clientX: x, clientY: 100, pointerId: 1 }); }
    expect(commits).toHaveLength(0);
    h.fire('pointercancel', { clientX: 12, clientY: 100, pointerId: 1 });
  });

  it('a deliberate hold in the edge zone past the dwell DOES commit', () => {
    const clock = { t: 0 };
    const { moveHandle, commits } = setup({ left: 'android', right: 'ios' }, clock);
    const h = moveHandle('Desk lamp');
    h.fire('pointerdown', { clientX: 500, clientY: 100, pointerId: 1 });
    // Held steadily just inside the left zone (not past the edge), clock advances.
    clock.t = 0; h.fire('pointermove', { clientX: 8, clientY: 100, pointerId: 1 });
    clock.t = 120; h.fire('pointermove', { clientX: 8, clientY: 100, pointerId: 1 });
    clock.t = 260; h.fire('pointermove', { clientX: 8, clientY: 100, pointerId: 1 });
    expect(commits).toHaveLength(1);
    expect(commits[0].to).toBe('left');
  });

  it('a lost hand mid-drag (pointercancel) commits nothing — no fling', () => {
    const clock = { t: 0 };
    const { moveHandle, commits } = setup({ left: 'android', right: 'ios' }, clock);
    const h = moveHandle('Desk lamp');
    h.fire('pointerdown', { clientX: 500, clientY: 100, pointerId: 1 });
    clock.t = 0; h.fire('pointermove', { clientX: 8, clientY: 100, pointerId: 1 });
    h.fire('pointercancel', { clientX: 8, clientY: 100, pointerId: 1 }); // hand lost before dwell
    clock.t = 400;
    expect(commits).toHaveLength(0);
  });
});

describe('C226 phone sends a tile back off its inner edge', () => {
  it('phone on the LEFT: dragging off the RIGHT (inner) edge returns it to the laptop', () => {
    const commits: TileTransfer[] = [];
    const clock = { t: 0 };
    const controller = createPhoneExitController({
      getViewportWidth: () => 400,
      getSide: () => 'left',
      getBoard: () => BOARD,
      hasOtherPhone: () => false,
      onGlow: () => {},
      onCommit: (t) => commits.push(t),
      now: () => clock.t,
    });
    controller.handleItemDrag({ frameId: 'f', key: 'lamp-wiz-desk', phase: 'move', clientX: 440, clientY: 50 });
    controller.handleItemDrag({ frameId: 'f', key: 'lamp-wiz-desk', phase: 'end', clientX: 440, clientY: 50 });
    expect(commits).toHaveLength(1);
    expect(commits[0].from).toBe('left');
    expect(commits[0].to).toBe('laptop');
  });
});
