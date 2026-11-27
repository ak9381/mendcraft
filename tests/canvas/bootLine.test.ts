import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Review sim-2 §6: with an unreadable saved doc, boot says "Couldn't open your
// saved boards…" (or "…won't be saved"); the boot overview's hint ("Let's
// build something fun…") said after its fly must not write over it, and the
// line does not fade on its own.
const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');

describe('the boot status line stays', () => {
  it('the boot overview is quiet when a boot line is said', () => {
    expect(src).toMatch(/\} else if \(!stored\) \{[^}]*void overview\(\{ quiet: !!loadLine\(loaded\) \}\);/);
    const ov = src.slice(src.indexOf('async function overview('), src.indexOf('function newBoard('));
    expect(ov.indexOf('if (o.quiet) return;')).toBeGreaterThan(-1);
    expect(ov.indexOf('if (o.quiet) return;')).toBeLessThan(ov.indexOf("Let's build something fun"));
  });

  it('the unreadable / unsaved line does not fade away', () => {
    expect(src).toMatch(/t === UNREADABLE_LINE \|\| t === UNSAVED_LINE\) \{ fadeStatus\(t\); return; \}/);
  });
});
