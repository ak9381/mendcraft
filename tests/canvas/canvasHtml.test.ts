import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('the canvas page ships a real favicon', () => {
  it('public/favicon.ico is a real ICO, not an HTML fallback', () => {
    const ico = readFileSync(join(root, 'public/favicon.ico'));
    // ICO file header: reserved 0, type 1 (icon)
    expect(ico[0]).toBe(0);
    expect(ico[1]).toBe(0);
    expect(ico[2]).toBe(1);
    expect(ico[3]).toBe(0);
    expect(ico.length).toBeGreaterThan(100);
  });

  // Only the canvas page is ported; index.html is the legacy studio's.
  for (const file of ['canvas.html']) {
    it(`${file} links the SVG and ICO favicons`, () => {
      const html = readFileSync(join(root, file), 'utf8');
      expect(html).toMatch(/rel="icon"[^>]+href="\/favicon\.svg"/);
      expect(html).toMatch(/rel="icon"[^>]+href="\/favicon\.ico"/);
      expect(existsSync(join(root, 'public/favicon.svg'))).toBe(true);
    });
  }
});
