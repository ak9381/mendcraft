// A7-024: a request that fails mid-flight shows a 44px Retry next to the
// status line that re-sends the same request; any later status hides it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
const css = readFileSync('src/canvas/canvas.css', 'utf8');

describe('Retry after a mid-request failure (A7-024)', () => {
  it('the status row carries a hidden Retry button', () => {
    expect(src).toContain('<button class="mc-btn mc-retry" type="button" hidden aria-label="Retry the request that failed">Retry</button>');
  });
  it('a turn error offers Retry that re-runs the same turn', () => {
    const body = src.slice(src.indexOf('async function aiTurn('), src.indexOf('async function proposePlan('));
    expect(body).toContain('offerRetry(() => { void aiTurn(frameId, engineId, utterance, script, summary, status, task, goal); });');
  });
  it('any later status line hides it, and it is at least 44px tall', () => {
    expect(src).toContain('const say = (t: string) => { statusEl.textContent = t; hideRetry(); };');
    expect(css).toMatch(/\.mc-retry \{ min-height: 44px; min-width: 44px;/);
  });
});
