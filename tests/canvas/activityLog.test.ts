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

describe('AI activity stays open', () => {
  it('is flagged always-open and the canvas markup starts visible', () => {
    expect(AI_PANEL_ALWAYS_OPEN).toBe(true);
    const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/<aside class="mc-ai" aria-label="AI activity">/);
    expect(src).not.toMatch(/<aside class="mc-ai" aria-label="AI activity" hidden>/);
    expect(src).toContain('mc-ai-live-log');
    expect(src).toContain('class="mc-ai-close" hidden');
  });
});
