import { describe, expect, it } from 'vitest';
import { ACTIVITY_LOG_CAP, AI_PANEL_ALWAYS_OPEN, createActivityLog, formatActivityLine } from '../../src/canvas/activityLog';
import { readFileSync } from 'node:fs';

describe('activity log', () => {
  it('prepends newest first and caps the list', () => {
    const log = createActivityLog(null, 3);
    log.push({ kind: 'ai', text: 'Quick · build a board', at: 1 });
    log.push({ kind: 'click', text: 'Click · Talk', target: 'Talk', at: 2 });
    log.push({ kind: 'grab', text: 'Grab · Review', target: 'Review', at: 3 });
    const list = log.list();
    expect(list).toHaveLength(3);
    expect(list[0]!.kind).toBe('grab');
    expect(list[1]!.kind).toBe('click');
    expect(list[2]!.kind).toBe('ai');
    expect(ACTIVITY_LOG_CAP).toBe(40);
  });

  it('formats dwell clicks with the target', () => {
    expect(formatActivityLine({ kind: 'click', text: '', target: 'Approve', at: 0 })).toBe('Click · Approve');
    expect(formatActivityLine({ kind: 'click', text: '', at: 0 })).toBe('Click');
    expect(formatActivityLine({ kind: 'grab', text: 'Grab', target: 'Review', at: 0 })).toBe('Grab · Review');
  });

  it('paints newest-first into a list element', () => {
    const list = { innerHTML: '' } as unknown as HTMLElement;
    const log = createActivityLog(list, 10);
    log.push({ kind: 'ai', text: 'Deep · plan', at: 1 });
    log.push({ kind: 'click', text: 'Click · Tools', target: 'Tools', at: 2 });
    expect(list.innerHTML).toContain('data-kind="click"');
    expect(list.innerHTML.indexOf('Tools')).toBeLessThan(list.innerHTML.indexOf('data-kind="ai"'));
  });
});

describe('AI activity opens only while a model works', () => {
  it('is not pinned open: the panel starts hidden and its close button is visible', () => {
    expect(AI_PANEL_ALWAYS_OPEN).toBe(false);
    const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/<aside class="mc-ai" aria-label="AI activity" hidden>/);
    expect(src).toContain('mc-ai-live-log');
    expect(src).toMatch(/class="mc-ai-close" aria-label="Close AI activity"/);
    expect(src).not.toContain('class="mc-ai-close" hidden');
  });

  it('auto-hides ~3 s after a turn, re-checking review/failure state when the timer fires', () => {
    const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(src).toContain('const AI_HIDE_MS = 3000');
    expect(src).toMatch(/if \(reviewBusy\(\) \|\| aiHold\.size > 0 \|\| !aiAuto\) return;/);
  });

  it('an auto-opened panel overlays (vp() ignores it), but every open/close re-fits the board: the cluster moves with it (L1)', () => {
    const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/aiPanel\.hidden \|\| aiAuto \? 0 :/);
    expect(src).toContain('if (shownBefore !== on && focusId)');
  });
});

describe('AI panel holds', () => {
  const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
  it('failed and queued engines hold the panel per engine; the timer checks the holds', () => {
    expect(src).toContain('const aiHold = new Set<EngineId>()');
    expect(src).toMatch(/state === 'failed' \|\| state === 'queued'\) \{ aiHold\.add\(engine\)/);
    expect(src).toContain('aiHold.size > 0');
    expect(src).toContain("aiHold.add('gemini')");
  });
  it('the edge-docked cluster steps left of any open drawer (it would sit on the panel otherwise)', () => {
    expect(src).toContain("root.classList.toggle('is-ai-pinned', on && !aiAuto)");
    const css = readFileSync(new URL('../../src/canvas/canvas.css', import.meta.url), 'utf8');
    expect(css).toMatch(/has\(\.mc-ai:not\(\[hidden\]\)\) \.mc-hand-cluster/);
  });
});
