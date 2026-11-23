import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HAND_PRESS } from '../../src/canvas/handPointer';

// Browser-walked in e2e-review-2x/round6/dockchip.mjs (hand + mouse).
describe('hand press stands in for pointerdown (click-away dismissers)', () => {
  const hp = readFileSync('src/canvas/handPointer.ts', 'utf8');
  const dock = readFileSync('src/canvas/swarmDock.ts', 'utf8');
  it('the hand pointer announces every real press, not in dry runs', () => {
    expect(HAND_PRESS).toBe('mc-hand-press');
    const i = hp.indexOf('new CustomEvent(HAND_PRESS');
    expect(i).toBeGreaterThan(0);
    expect(hp.slice(i - 300, i)).toContain('if (!dryRun)');
  });
  it("swarmDock's mini terminal closes on a hand press outside, like a mouse press", () => {
    expect(dock).toContain("doc.addEventListener('mc-hand-press', onDocPointerDown, true)");
    expect(dock).toContain("doc.removeEventListener('mc-hand-press', onDocPointerDown, true)");
  });
});

describe('phone menu swipe-down by hand (C115)', () => {
  const pm = readFileSync('src/canvas/phoneMenu.ts', 'utf8');
  it('the grabber is a hand drag handle (pinch-drag = swipe) and a tap closes', () => {
    expect(pm).toMatch(/class="mc-menu-grabber"[^>]*data-mc-drag-handle/);
    expect(pm).toContain("sheet.querySelector('.mc-menu-grabber')?.addEventListener('click', () => close())");
  });
});
