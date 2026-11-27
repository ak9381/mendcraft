// Final review M6: what a chat call really sends includes the JSON reply
// line the cloud adapter adds; the ledger books those bytes too.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT_REPLY_SUFFIX } from '../../src/ai/hybrid';

describe('chat bytes include the reply-format line', () => {
  it('the suffix is one named constant, used where the call is made', () => {
    expect(TEXT_REPLY_SUFFIX).toBe('\nReply as JSON: {"reply": string}');
    const hybrid = readFileSync(new URL('../../src/ai/hybrid.ts', import.meta.url), 'utf8');
    expect(hybrid).toContain("shape === 'text' ? `${prompt}${TEXT_REPLY_SUFFIX}` : prompt");
  });
  it('a cloud chat turn books the suffix with each send', () => {
    const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    const turn = app.slice(app.indexOf('async function openEndedTurn('), app.indexOf('async function breakTurn('));
    expect(turn).toContain('aiSent(text, si, { swarm: false, defer: true, ...(cloud ? { extraBytes: utf8ByteLength(TEXT_REPLY_SUFFIX) } : {}) });');
  });
});
