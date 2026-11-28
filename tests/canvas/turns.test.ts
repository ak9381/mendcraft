import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTurns } from '../../src/canvas/turns';
import { INTENT_WAIT_MS } from '../../src/canvas/intentRouter';

describe('turns', () => {
  it('a new line aborts the old signal', () => {
    const turns = createTurns();
    const a = turns.begin('build me about');
    expect(a.live()).toBe(true);
    const b = turns.begin('show my devices');
    expect(a.signal.aborted).toBe(true);
    expect(a.live()).toBe(false);
    expect(b.live()).toBe(true);
    expect(turns.current()).toBe(b);
    expect(b.id).toBeGreaterThan(a.id);
  });
  it('a child turn lives as long as its line, and aborts nothing', () => {
    const turns = createTurns();
    const a = turns.begin('make a board to keep track');
    const child = turns.begin('show my devices', a);
    expect(child.live()).toBe(true);
    expect(a.live()).toBe(true);
    expect(child.signal).toBe(a.signal);
    const grand = turns.begin('again', child);
    expect(grand.live()).toBe(true);
    turns.begin('something new');
    expect(child.live()).toBe(false);
    expect(grand.live()).toBe(false);
  });
  it('Nano gives up at 10 s', () => { expect(INTENT_WAIT_MS).toBe(10_000); });
  it('canvasApp checks the turn, not a line counter', () => {
    const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(src).not.toMatch(/lineSeq/);
    const intent = src.slice(src.indexOf('async function intentTurn('), src.indexOf('const gimbalAsk = createGimbalAsk({'));
    expect(intent).toContain('if (!t.live() ||');
    expect(intent).toContain('say(INTENT_STILL_LINE)');
    const chat = src.slice(src.indexOf('async function openEndedTurn('), src.indexOf('// ---- commands ----'));
    expect(chat).toContain("text: 'dropped: stale'");
  });
});
