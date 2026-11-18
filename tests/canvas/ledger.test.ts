import { describe, expect, it } from 'vitest';
import {
  createCanvasLedger,
  formatLedgerLine,
  utf8ByteLength,
  type LedgerEntry,
} from '../../src/canvas/ledger';

describe('Part 4: src/canvas/ledger.ts', () => {
  it('computes utf-8 byte length accurately', () => {
    expect(utf8ByteLength('hello')).toBe(5);
    expect(utf8ByteLength('ಕನ್ನಡ')).toBe(15); // non-ASCII UTF-8 (5 code points * 3 bytes)
    expect(utf8ByteLength('')).toBe(0);
  });

  it('records entry with 0 bytes for nano', () => {
    const ledger = createCanvasLedger();
    const entry = ledger.record({
      engine: 'nano',
      sentText: 'A prompt with many characters that stay on device',
      at: 1000,
    });

    expect(entry).toEqual({
      engine: 'nano',
      bytes: 0,
      at: 1000,
    });
    expect(ledger.totals().totalBytes).toBe(0);
  });

  it('records UTF-8 bytes for Gemini and external engines', () => {
    const ledger = createCanvasLedger();
    // 1229 bytes ~ 1.2 KB
    const text = 'A'.repeat(1229);
    const entry = ledger.record({
      engine: 'gemini',
      sentText: text,
      at: 2000,
    });

    expect(entry.engine).toBe('gemini');
    expect(entry.bytes).toBe(1229);
    expect(entry.at).toBe(2000);
    expect(ledger.totals().totalBytes).toBe(1229);
  });

  it('formats ledger line correctly', () => {
    const ledger = createCanvasLedger();

    // 0 bytes initially
    expect(ledger.formatLine()).toBe('0 bytes left this device');

    // Only nano calls
    ledger.record({ engine: 'nano', sentText: 'Local turn' });
    expect(ledger.formatLine()).toBe('0 bytes left this device');

    // Gemini call with ~1.2 KB
    ledger.record({ engine: 'gemini', sentText: 'A'.repeat(1229) });
    expect(ledger.formatLine()).toBe('1.2 KB sent to Gemini');
  });

  it('provides totals breakdown and list of entries', () => {
    const ledger = createCanvasLedger();
    ledger.record({ engine: 'nano', sentText: 'prompt' });
    ledger.record({ engine: 'gemini', sentText: 'Hello' }); // 5 bytes

    const t = ledger.totals();
    expect(t.totalBytes).toBe(5);
    expect(t.byEngine.nano).toBe(0);
    expect(t.byEngine.gemini).toBe(5);
    expect(ledger.entries()).toHaveLength(2);
  });

  it('formatLedgerLine helper formats standalone values', () => {
    expect(formatLedgerLine({ bytes: 0 })).toBe('0 bytes left this device');
    expect(formatLedgerLine({ bytes: 1229, engine: 'gemini' })).toBe('1.2 KB sent to Gemini');
    expect(formatLedgerLine({ bytes: 50, engine: 'gemini' })).toBe('50 B sent to Gemini');
  });
});
