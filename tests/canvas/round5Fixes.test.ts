// Round 5 hand walk (A7-015/A7-017, A7-008/A7-011, A7-007): regressions.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const canvasCss = readFileSync(new URL('../../src/canvas/canvas.css', import.meta.url), 'utf8');
const planCss = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');

describe('A7-017 hover grow never covers the Go button beside the say box', () => {
  it('canvas: .hand-hover grows only non-text controls', () => {
    expect(canvasCss).not.toMatch(/^\.hand-hover\s*\{\s*scale/m);
    expect(canvasCss).toMatch(/\.hand-hover:not\(input, textarea, select, \[data-hand-dismiss\]\)\s*\{\s*scale/);
  });
  it('plan: text fields under .hand-hover do not transform', () => {
    expect(planCss).toMatch(/input\.hand-hover, textarea\.hand-hover, select\.hand-hover \{ transform: none; \}/);
  });
});

describe('A7-008/A7-011/A7-007 Escape closes the aria-modal teach dialog and Register scan', () => {
  it('window Escape routes to teach close and scan Cancel before the input guard', () => {
    const kd = app.slice(app.indexOf('const onWindowKeydown'), app.indexOf('const onWindowResize'));
    const teach = kd.indexOf('teachPanel.isOpen()');
    const scan = kd.indexOf('scanPanel?.isOpen()');
    const guard = kd.indexOf("closest('input, textarea");
    expect(teach).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(-1);
    expect(teach).toBeLessThan(guard);
    expect(scan).toBeLessThan(guard);
  });
});
