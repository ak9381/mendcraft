// Laptop layout rules behind scripts/e2e-laptop-layout.mjs: the hover name
// bubble sits beside its button (never on it or a neighbour), a too-tall room
// board tries a wider width, and the hand cluster's DOM order.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nearRects, placeBubble } from '../../src/canvas/palmHighlight';
import { roomWidenWidth, ROOM_WIDE_MAX_W } from '../../src/canvas/canvasApp';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const hit = (a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) =>
  Math.min(a.left + a.width, b.left + b.width) > Math.max(a.left, b.left) && Math.min(a.top + a.height, b.top + b.height) > Math.max(a.top, b.top);

describe('hover name bubble placement', () => {
  const vp = { w: 1550, h: 700 };
  // The right-edge hand cluster: 168×52 buttons, 24 px apart.
  const col = [0, 1, 2, 3, 4, 5].map((i) => ({ left: 1358, top: 136 + i * 76, width: 168, height: 52 }));
  const size = { w: 140, h: 34 };

  it('a cluster button: goes to the LEFT (above would cover the neighbour)', () => {
    const t = col[2];
    const at = placeBubble(t, size, nearRects(t, col), vp);
    expect(at.side).toBe('left');
    const b = { left: at.left, top: at.top, width: size.w, height: size.h };
    for (const r of col) expect(hit(b, r)).toBe(false);
  });

  it('a lone button with room above: above, centred', () => {
    const t = { left: 600, top: 300, width: 120, height: 52 };
    const at = placeBubble(t, size, [], vp);
    expect(at.side).toBe('above');
    expect(at.top + size.h).toBeLessThanOrEqual(t.top);
  });

  it('flips to stay on screen (top-left corner button)', () => {
    const t = { left: 4, top: 4, width: 80, height: 44 };
    const at = placeBubble(t, size, [], vp);
    expect(at.left).toBeGreaterThanOrEqual(8);
    expect(at.top).toBeGreaterThanOrEqual(8);
    expect(hit({ left: at.left, top: at.top, width: size.w, height: size.h }, t)).toBe(false);
  });

  it('the bubble is compact glass, one line, ≥ 15 px, with a solid fallback', () => {
    const css = read('src/canvas/canvas.css');
    expect(css).toMatch(/\.mc-highlight-label \{[^}]*max-width: 220px;[^}]*font-size: 15px; white-space: nowrap;/);
    expect(css).toMatch(/\.mc-highlight-name \{[^}]*text-overflow: ellipsis;[^}]*font: 650 15px/);
    expect(css).toContain('backdrop-filter: blur(12px) saturate(1.4)');
    expect(css).toMatch(/prefers-reduced-transparency: reduce\) \{\s*\.mc-highlight-label, \.mc-hand-tooltip \{ --mc-glass-bg: #FFFFFF;/);
  });
});

describe('room board widening', () => {
  it('only a board too tall for the screen tries wider, up to free/minZ and ROOM_WIDE_MAX_W', () => {
    expect(roomWidenWidth({ w: 1280, h: 600, free: 1300, freeH: 640, minZ: 0.8 })).toBeNull();
    expect(roomWidenWidth({ w: 1280, h: 900, free: 1300, freeH: 520, minZ: 0.8 })).toBe(1625);
    expect(roomWidenWidth({ w: 1280, h: 900, free: 1700, freeH: 520, minZ: 0.8 })).toBe(ROOM_WIDE_MAX_W);
    expect(roomWidenWidth({ w: 800, h: 900, free: 740, freeH: 520, minZ: 0.8 })).toBe(925);
    expect(roomWidenWidth({ w: 1280, h: 900, free: 1040, freeH: 520, minZ: 0.8 })).toBeNull(); // no real gain
  });
});

describe('re-framing the focused board', () => {
  it('a window resize re-fits the board at its shown size (a toast never moves it)', () => {
    const src = read('src/canvas/canvasApp.ts');
    expect(src).toContain('camera = focusCam(fitBoardWidth(f)); applyCamera();');
    expect(src).not.toContain('barRefit');
  });
});

describe('hand cluster order', () => {
  it('Register, Tools, Talk, Read aloud, Undo, Edit (Reset joins Edit)', () => {
    expect(read('src/canvas/canvasApp.ts')).toContain('for (const node of [registerBtn, toolsChip, talk, readBtn, undoBtn, editBtn, resetBtn]) {');
  });
});
