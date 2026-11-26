import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const style = readFileSync(join(root, 'src/style.css'), 'utf8');
const landing = readFileSync(join(root, 'src/landing/landing.css'), 'utf8'); // main's landing

describe('design system tokens', () => {
  it('exposes a reusable tabular-nums class and applies it to measurements', () => {
    expect(style).toMatch(/\.mc-num[\s\S]*font-variant-numeric:\s*tabular-nums/);
    expect(style).toMatch(/#viewport text[\s\S]*font-variant-numeric:\s*tabular-nums/);
    // The legacy landing page (src/landing) is main's, not part of the canvas port.
  });

  it('respects prefers-reduced-motion by disabling animation and transition', () => {
    const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation(?:-duration)?:\s*(?:none|0\.001ms)/;
    expect(style).toMatch(re);
    expect(landing).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(landing).toMatch(/animation:\s*none\s*!important/);
  });

  it('keeps a shimmer skeleton for waits and a press-shrink on buttons', () => {
    expect(style).toMatch(/\.mc-skel/);
    expect(style).toMatch(/@keyframes\s+mc-shimmer/);
    expect(style).toMatch(/button:active:not\(:disabled\)\s*\{[\s\S]*transform:\s*scale\(0\.97\)/);
  });
});
