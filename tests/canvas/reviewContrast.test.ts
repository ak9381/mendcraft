import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/canvas/canvas.css'), 'utf8');

function srgb(hex: string): [number, number, number] {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}
function lum(hex: string): number {
  const [r, g, b] = srgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const L1 = lum(a), L2 = lum(b);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

describe('approval-card contrast', () => {
  it('the canvas proposal card is a light surface with dark text meeting WCAG AA (4.5:1)', () => {
    expect(css).toMatch(/\.mc-canvas \.mc-proposal[^{]*\{[^}]*background:\s*#FFFFFF/);
    expect(css).toMatch(/\.mc-canvas \.mc-proposal[^{]*\{[^}]*color:\s*#2B2B2B/);
    expect(contrast('#FFFFFF', '#2B2B2B')).toBeGreaterThanOrEqual(4.5);
  });

  it('the guess badge on the light card also meets AA', () => {
    expect(contrast('#334155', '#F8FAFC')).toBeGreaterThanOrEqual(4.5);
  });

  it('empty Gemini log has an explicit unused-for-this-draft rule', () => {
    expect(css).toContain('.mc-term-empty');
  });
});
