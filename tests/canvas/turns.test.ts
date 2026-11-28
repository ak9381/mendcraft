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

import { watchdogOutcome, DONE_CUE, NOTHING_DONE_LINE, doneLine, cantDoYetLine } from '../../src/canvas/turns';
describe('outcome contract', () => {
  it('settle is first-wins, and a child settles its root', () => {
    const turns = createTurns();
    const a = turns.begin('build me about');
    const child = turns.begin('show my devices', a);
    expect(child.settle({ kind: 'asked', line: 'Did you mean…' })).toBe(true);
    expect(a.settle({ kind: 'done', line: 'x' })).toBe(false);
    expect(a.outcome()).toEqual({ kind: 'asked', line: 'Did you mean…' });
  });
  it('watchdog: a route → Done: <route>; a shown line → the done cue; nothing → refused', () => {
    const turns = createTurns();
    const routed = turns.begin('show my devices');
    turns.begin('x', routed).ranRoute('showDevices');
    expect(watchdogOutcome(routed)).toEqual({ kind: 'done', line: doneLine('showDevices') });
    expect(doneLine('showDevices')).toBe('Done: status board. Say something else.');
    const said = turns.begin('hello');
    said.noteSaid();
    expect(watchdogOutcome(said)).toEqual({ kind: 'done', line: DONE_CUE });
    const chat = turns.begin('what is a gimbal');
    chat.settle({ kind: 'answered', line: 'A gimbal is…' });
    expect(watchdogOutcome(chat)?.line).toBe(DONE_CUE);
    const nothing = turns.begin('blorp');
    expect(watchdogOutcome(nothing)).toMatchObject({ kind: 'refused', line: NOTHING_DONE_LINE });
  });
  it('watchdog: asked, refused or done turns, and the boot turn, get nothing', () => {
    const turns = createTurns();
    expect(watchdogOutcome(turns.begin(''))).toBeNull();
    for (const kind of ['asked', 'refused', 'done'] as const) {
      const t = turns.begin('x'); t.ranRoute('device'); t.settle({ kind, line: '' });
      expect(watchdogOutcome(t), kind).toBeNull();
    }
  });
  it('the second miss names three phrases that work', () => {
    expect(cantDoYetLine()).toBe('I can’t do that yet. Try: “show my devices”, “build the dashboard”, “draw a floor plan”.');
  });
  it('canvasApp: one watchdog per turn; exits are tagged', () => {
    const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(src).toContain('if (!t.live() || cuedTurn === t.id) return;');
    expect(src).toContain("say(askLine(d.action), { speak: true, outcome: 'asked' });");
    expect(src).toContain("say(choicesSpoken(cs), { speak: true, outcome: 'asked' });");
    expect(src).toContain("if (++misses >= 2) { misses = 0; say(cantDoYetLine(), { speak: true, outcome: 'refused' });");
    expect(src).toContain("guarded.replaced ? { kind: 'refused', line: reply, reason: 'promise guard' }");
    expect(src).toContain("if (r.name !== 'openEnded') { turn.ranRoute(r.name); misses = 0; }");
  });
});
