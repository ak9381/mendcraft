// Fix wave (final review 1): relay / phone paths on the laptop canvas. The
// canvas is not mounted in unit tests, so the wiring is checked in the source
// and the pure pieces are exercised directly.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeTransport } from '../../src/relay/transport';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
const joinPhoneSrc = app.slice(app.indexOf('async function joinPhone('), app.indexOf('// Keep / drop act on the waiting board Proposal'));

describe('C2: a new pairing opens a new room', () => {
  it('a fresh pairing never resumes the stored room token, and forgets it', () => {
    expect(joinPhoneSrc).not.toContain('loadHostToken(');
    expect(joinPhoneSrc).toContain('clearHostToken(storage)');
    expect(app).not.toContain('saveHostToken(');
  });

  it('phones already paired in the open room keep it: one more phone re-opens a window on the same session', () => {
    expect(joinPhoneSrc).toMatch(/if \(pairingStop && hostSession && relayKept\(\)\) \{[\s\S]*?await session\.admitMore\(\)/);
  });

  it('two fresh pairings get two rooms and two codes, none derived from the other', async () => {
    const t = createFakeTransport();
    const a = await startPhoneJoin({ transport: t, chime: () => undefined });
    const b = await startPhoneJoin({ transport: t, chime: () => undefined });
    if ('error' in a || 'error' in b) throw new Error('host');
    expect(a.token).not.toBe(b.token);
    expect(a.rawCode).not.toBe(b.rawCode);
    expect(a.token.startsWith(a.rawCode)).toBe(false);
    await a.stop();
    await b.stop();
  });
});
