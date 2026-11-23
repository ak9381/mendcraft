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
