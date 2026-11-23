import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HAND_TEXT_FOCUS } from '../../src/canvas/handKeyboard';

// The keyboard itself is a DOM module (browser-walked in e2e-review-2x/round6/
// handkb.mjs and handkb-connect.mjs, desktop + phone). These guard the seams.
const hp = readFileSync('src/canvas/handPointer.ts', 'utf8');
const kb = readFileSync('src/canvas/handKeyboard.ts', 'utf8');
const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');

describe('hand keyboard seams', () => {
  it('the hand pointer announces a hand focus of a text field (only there)', () => {
    expect(HAND_TEXT_FOCUS).toBe('mc-hand-text-focus');
    const i = hp.indexOf("new CustomEvent('mc-hand-text-focus'");
    expect(i).toBeGreaterThan(0);
    expect(hp.match(/mc-hand-text-focus/g)?.length).toBe(1);
    // It sits in the text-field branch, after focus() and before the click path.
    const branch = hp.lastIndexOf("el.matches('input:not([type=button])", i);
    expect(branch).toBeGreaterThan(0);
    expect(hp.slice(branch, i)).toContain('el.focus(');
    expect(hp.slice(i, i + 200)).toContain('return;');
  });
  it('mouse/keyboard focus never opens it (no auto-open on focusin)', () => {
    expect(kb).not.toMatch(/setAutoOpen\(true\)/);
    expect(kb).toContain('doc.addEventListener(HAND_TEXT_FOCUS');
  });
  it('keys stay reachable by hand while a modal scopes the pointer', () => {
    expect(kb).toContain("root.dataset.handAlways = ''");
    expect(hp).toContain("el.closest('[data-hand-always]')");
  });
  it('closes on Escape (without also closing what is behind), submit, blur and outside clicks', () => {
    expect(kb).toMatch(/e\.key !== 'Escape'/);
    expect(kb).toContain('e.stopPropagation()');
    expect(kb).toContain("addEventListener('submit', close)");
    expect(kb).toContain("doc.addEventListener('focusout', onFieldBlur, true)");
    expect(kb).toContain("doc.addEventListener('click', onOutside, true)");
  });
  it('an empty-space pinch blurs the focused field like a mouse press', () => {
    const i = hp.indexOf('else if (!target) {');
    expect(i).toBeGreaterThan(0);
    expect(hp.slice(i, i + 400)).toMatch(/a\.blur\(\)/);
  });
  it('the canvas mounts it', () => {
    expect(app).toContain('mountHandKeyboard(document)');
  });
});

describe('hand keyboard follows app focus after a hand pinch', () => {
  const kb2 = readFileSync('src/canvas/handKeyboard.ts', 'utf8');
  it('a field the app focuses within the follow window after a hand press opens the keys', () => {
    expect(kb2).toContain("doc.addEventListener('mc-hand-press', onHandPress, true)");
    expect(kb2).toMatch(/clock\(\) - lastHandPress < FOLLOW_FOCUS_MS/);
    expect(kb2).toMatch(/const FOLLOW_FOCUS_MS = \d+;/);
  });
});

describe('hand keyboard commits like native typing', () => {
  const kb3 = readFileSync('src/canvas/handKeyboard.ts', 'utf8');
  it("fires 'change' on Enter (no form) and when the keys close", () => {
    expect(kb3).toContain("field.dispatchEvent(new Event('change', { bubbles: true }))");
    expect(kb3).toMatch(/key === 'Enter' && field && !field\.form\) commit\(\)/);
    expect(kb3).toMatch(/function close\(\): void \{\n\s+commit\(\);/);
  });
});
