// A1-047 / A5-017: a hand user has no mouseover, so the canvas mirrors native
// `title` tooltips through handPointer's onTooltip as the cursor dwells.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandPointer } from '../../src/canvas/handPointer';
import { fakeDoc, fakeEl, installSelfCheckGlobals } from '../helpers/selfCheckDom';

beforeEach(() => { installSelfCheckGlobals(); });
afterEach(() => { /* globals are idempotent */ });

describe('canvas hand dwell tooltip (A1-047 / A5-017)', () => {
  it('emits the hovered control hint once (deduped), and null when the hand leaves', () => {
    const btn = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 }, { title: 'Undo last change' });
    const doc = fakeDoc([btn]);
    const seen: Array<string | null> = [];
    const hp = createHandPointer(doc, { onTooltip: (t) => seen.push(t) });
    hp.pointAt(30, 20);
    hp.pointAt(31, 21); // same control: no re-emit
    expect(seen).toEqual(['Undo last change']);
    hp.lost();
    expect(seen).toEqual(['Undo last change', null]);
    hp.destroy();
  });
  it('clears when the cursor moves from a hinted control to empty canvas', () => {
    const btn = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 }, { 'aria-label': 'Mic' });
    const doc = fakeDoc([btn]);
    const seen: Array<string | null> = [];
    const hp = createHandPointer(doc, { onTooltip: (t) => seen.push(t) });
    hp.pointAt(30, 20);
    hp.pointAt(700, 600);
    expect(seen).toEqual(['Mic', null]);
    hp.destroy();
  });
});

describe('canvas hand dwell tooltip — landmark names are not tooltips', () => {
  it('does not surface an aria-label region (e.g. "Smart canvas") as a tooltip when off any control', () => {
    const region = fakeEl('main', { left: 0, top: 0, width: 1000, height: 800 }, { 'aria-label': 'Smart canvas' });
    const doc = fakeDoc([]);
    doc.elementFromPoint = () => region;
    const seen: Array<string | null> = [];
    const hp = createHandPointer(doc, { onTooltip: (t) => seen.push(t) });
    hp.pointAt(500, 400);
    expect(seen.filter(Boolean)).toEqual([]);
    hp.destroy();
  });
});

describe('C114 a hand can tap a dismiss scrim (phone menu tap-away)', () => {
  it('targets [data-hand-dismiss] on a direct hit with no control in snap range, and clicks it', () => {
    const scrim = fakeEl('div', { left: 0, top: 0, width: 1000, height: 800 });
    scrim.closest = (sel: string) => (sel === '[data-hand-dismiss]' ? scrim : null);
    let clicks = 0; scrim.addEventListener('click', () => { clicks++; });
    const btn = fakeEl('button', { left: 10, top: 700, width: 40, height: 40 }, { 'aria-label': 'Save' });
    const doc = fakeDoc([btn]);
    doc.elementFromPoint = (x: number, y: number) => (x >= 10 && x <= 50 && y >= 700 && y <= 740 ? btn : scrim);
    const hp = createHandPointer(doc, {});
    expect(hp.pointAt(500, 100)).toBe(scrim);
    hp.pinch(true); hp.pinch(false);
    expect(clicks).toBe(1);
    // Near a control the snap wins over the scrim.
    expect(hp.pointAt(60, 720)).toBe(btn);
    hp.destroy();
  });
});

describe('Hand surface (floor-plan board): tap when still, drag once moved, finish on hand loss', () => {
  function setup() {
    const calls: string[] = [];
    const surfEl = fakeEl('div', { left: 0, top: 0, width: 800, height: 600 });
    const api = {
      hover: () => {},
      beginDrag: (x: number, y: number) => { calls.push(`begin ${x},${y}`); return true; },
      drag: (x: number, y: number) => { calls.push(`drag ${x},${y}`); },
      endDrag: () => { calls.push('end'); },
      tap: (x: number, y: number) => { calls.push(`tap ${x},${y}`); },
    };
    surfEl.closest = (sel: string) => (sel === '[data-hand-surface]' ? Object.assign(surfEl, { __mcHandSurface: api }) : null);
    const doc = fakeDoc([]);
    doc.elementFromPoint = () => surfEl;
    return { calls, hp: createHandPointer(doc, {}) };
  }
  it('a still pinch taps at the press point', () => {
    const { calls, hp } = setup();
    hp.pointAt(100, 100); hp.pinch(true); hp.pinch(false);
    expect(calls).toEqual(['tap 100,100']);
    hp.destroy();
  });
  it('a moving pinch begins at the press point, drags, then ends (no tap)', () => {
    const { calls, hp } = setup();
    hp.pointAt(100, 100); hp.pinch(true); hp.pointAt(103, 100); hp.pointAt(130, 100); hp.pinch(false);
    expect(calls).toEqual(['begin 100,100', 'drag 130,100', 'end']);
    hp.destroy();
  });
  it('losing the hand mid-drag ends the drag', () => {
    const { calls, hp } = setup();
    hp.pointAt(100, 100); hp.pinch(true); hp.pointAt(140, 100); hp.lost();
    expect(calls).toEqual(['begin 100,100', 'drag 140,100', 'end']);
    hp.destroy();
  });
});

describe('Hand surface drag keeps the canvas from panning underneath it', () => {
  it('consumedPinch stays true for the whole surface pinch, even past 700ms', () => {
    const surfEl = fakeEl('div', { left: 0, top: 0, width: 800, height: 600 });
    const api = { beginDrag: () => true, drag: () => {}, endDrag: () => {}, tap: () => {} };
    surfEl.closest = (sel: string) => (sel === '[data-hand-surface]' ? Object.assign(surfEl, { __mcHandSurface: api }) : null);
    const doc = fakeDoc([]);
    doc.elementFromPoint = () => surfEl;
    let t = 0;
    const realNow = performance.now.bind(performance);
    (performance as any).now = () => t;
    try {
      const hp = createHandPointer(doc, {});
      hp.pointAt(100, 100); hp.pinch(true);
      t = 5000; hp.pointAt(160, 100);
      expect(hp.consumedPinch()).toBe(true);
      hp.pinch(false);
      t = 10000;
      expect(hp.consumedPinch()).toBe(false);
      hp.destroy();
    } finally { (performance as any).now = realNow; }
  });
});

describe('Over the floor plan, drawing near a control draws (tight snap), like a mouse click there', () => {
  it('a pinch 30px from a palette button lands on the plan; 8px away still snaps to the button', () => {
    const calls: string[] = [];
    const surfEl = fakeEl('div', { left: 0, top: 0, width: 800, height: 600 });
    const api = { beginDrag: () => true, drag: () => {}, endDrag: () => {}, tap: (x: number) => { calls.push(`tap ${x}`); } };
    surfEl.closest = (sel: string) => (sel === '[data-hand-surface]' ? Object.assign(surfEl, { __mcHandSurface: api }) : null);
    const btn = fakeEl('button', { left: 100, top: 100, width: 40, height: 40 }, { 'aria-label': 'Wall' });
    let clicks = 0; btn.addEventListener('click', () => { clicks++; });
    const doc = fakeDoc([btn]);
    doc.elementFromPoint = (x: number, y: number) => (x >= 100 && x <= 140 && y >= 100 && y <= 140 ? btn : surfEl);
    const hp = createHandPointer(doc, {});
    expect(hp.pointAt(170, 120)).toBe(null);
    hp.pinch(true); hp.pinch(false);
    expect(calls).toEqual(['tap 170']);
    expect(hp.pointAt(148, 120)).toBe(btn);
    hp.pinch(true); hp.pinch(false);
    expect(clicks).toBe(1);
    hp.destroy();
  });
});
