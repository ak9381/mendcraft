// Open-ended speech ("hi how are you", "let's build something") must reach
// openEndedTurn/openEndedAsk, never the old dead-end string — while "let's
// build the next thing" still takes the known buildNext branch.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCanvasCommand } from '../../src/canvas/canvasCommands';

const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');

describe('canvasApp.run() open-ended fallback', () => {
  it('the old dead-end string is gone', () => {
    expect(src).not.toContain("isn’t a canvas command yet");
    expect(src).not.toContain("isn't a canvas command yet");
  });

  it('run() hands anything unmatched to openEndedTurn, not a dead end', () => {
    const body = src.slice(src.indexOf('function run(text: string): boolean {'), src.indexOf('// ---- input ----'));
    expect(body).toMatch(/void openEndedTurn\(text\);\s*\n\s*return true;\s*\n\s*}\s*$/);
  });

  it('openEndedTurn tries Nano then Gemini and reports on the matching panel', () => {
    const body = src.slice(src.indexOf('async function openEndedTurn('), src.indexOf('// ---- commands ----'));
    expect(body).toContain("engineFor('nano'");
    expect(body).toContain("engineFor('gemini'");
    expect(body).toContain('openEndedAsk(text, nano, gemini');
    expect(body).toContain('panels.forEngine(r.engineId).log(');
    // the reply is shown and spoken as it streams, then booked once at the end
    expect(body).toContain('live.update(full);');
    expect(body).toContain("aiPanel.querySelector('.mc-ai-state')!.textContent = cleanReply(reply);");
    expect(body).toContain('live.end(reply);');
  });

  it('a cloud engine (incl. "Nano" on a device without Nano) gets the redacted prompt and is ledgered', () => {
    const body = src.slice(src.indexOf('async function openEndedTurn('), src.indexOf('// ---- commands ----'));
    expect(body).toContain("eng.id === 'gemini'");
    expect(body).toContain('protectTurn(text, prompt).promptText');
    expect(body).toMatch(/aiSent\(text, \{/);
    expect(body).toContain('fillVisible(r.reply)');
  });

  it("'hi how are you' and \"let's build something\" don't match any known command", () => {
    expect(parseCanvasCommand('hi how are you')).toBeNull();
    expect(parseCanvasCommand("let's build something")).toBeNull();
  });

  it("'let's build the next thing' still takes the known buildNext branch", () => {
    expect(parseCanvasCommand("let's build the next thing")).toEqual({ type: 'buildNext' });
  });
});
