import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/canvas/canvas.css'), 'utf8');

describe('viewport fit (CSS contract — live bbox check runs in Chrome via mac-cdp-check.mjs)', () => {
  it('the canvas shell fills the viewport and clips overflow', () => {
    expect(css).toMatch(/\.mc-canvas \{[^}]*width:\s*100vw/);
    expect(css).toMatch(/\.mc-canvas \{[^}]*height:\s*100vh/);
    expect(css).toMatch(/\.mc-canvas \{[^}]*overflow:\s*hidden/);
  });

  it('the AI drawer is capped at ~340px and stays inside the viewport', () => {
    expect(css).toMatch(/max-width:\s*min\(340px,\s*calc\(100vw - 24px\)\)/);
  });

  it('the mid-screen cluster is a vertically centred right-edge column that shifts left of the drawer', () => {
    expect(css).toMatch(/\.mc-hand-cluster \{[^}]*top:\s*50%/s);
    expect(css).toMatch(/translateY\(-50%\)/);
    expect(css).toMatch(/\.mc-canvas:has\(\.mc-ai:not\(\[hidden\]\)\) \.mc-hand-cluster \{[^}]*right:\s*min\(/s);
  });

  it('does not shove cluster children with leftover AI-open right offsets', () => {
    expect(css).not.toMatch(/\.mc-canvas:has\(\.mc-ai:not\(\[hidden\]\)\) \.mc-fab-mic \{[^}]*right:\s*calc\(var\(--mc-ai-w/s);
    expect(css).not.toMatch(/\.mc-canvas:has\(\.mc-ai:not\(\[hidden\]\)\) \.mc-tools-chip \{[^}]*right:\s*calc\(var\(--mc-ai-w/s);
  });

  it('hides flying swarm cursors over the empty-board copy (chips stay in the AI drawer)', () => {
    expect(css).toMatch(/\.mc-canvas:has\(\.mc-empty:not\(\[hidden\]\)\) \.mc-swarm/);
  });
});
