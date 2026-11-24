import { describe, expect, it } from 'vitest';
import { createCanvasLedger, ledgerPanelLines } from '../../src/canvas/ledger';

describe('ledger: Spotify is counted apart from AI', () => {
  it('totals separate AI from Spotify and formatLine ignores Spotify', () => {
    const l = createCanvasLedger();
    l.record({ engine: 'gemini', sentText: 'x'.repeat(100) });
    l.record({ engine: 'nano', sentText: 'local' });
    l.record({ engine: 'spotify', sentText: 'GET /search?q=jazz' });
    l.record({ engine: 'spotify', sentText: 'PUT /me/player/play' });
    const t = l.totals();
    expect(t.aiBytes).toBe(100);
    expect(t.aiCount).toBe(2);
    expect(t.spotifyCount).toBe(2);
    expect(t.spotifyBytes).toBe(18 + 19);
    expect(l.formatLine()).toBe('100 B sent to Gemini');
    expect(l.formatSpotifyLine()).toBe('Also left this device: Spotify · 2 calls · 37 B (not AI)');
  });

  it('footer / engine-bar bytes (aiBytes) are unchanged by Spotify calls', () => {
    const l = createCanvasLedger();
    l.record({ engine: 'gemini', sentText: 'x'.repeat(100) });
    const before = l.totals().aiBytes;
    l.record({ engine: 'spotify', sentText: 'GET /search?q=jazz' });
    expect(l.totals().aiBytes).toBe(before);
    expect(l.totals().aiCount).toBe(1);
  });

  it('panel lines: AI line ignores Spotify; the Spotify line is separate and empty when unused', () => {
    const l = createCanvasLedger();
    expect(ledgerPanelLines(l)).toEqual({ ai: 'This session: 0 AI turns · 0 bytes left this device', spotify: '' });
    l.record({ engine: 'spotify', sentText: 'GET /me/player/devices' });
    const p = ledgerPanelLines(l);
    expect(p.ai).toBe('This session: 0 AI turns · 0 bytes left this device');
    expect(p.spotify).toMatch(/^Also left this device: Spotify · 1 call · \d+ B \(not AI\)$/);
    expect(p.spotify).not.toMatch(/token/i);
  });
});
