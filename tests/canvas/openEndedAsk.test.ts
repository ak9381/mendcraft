import { describe, expect, it } from 'vitest';
import { scriptedEngine, type SurfaceEngine } from '../../src/canvas/aiTurn';
import { buildOpenEndedPrompt, openEndedAsk } from '../../src/canvas/openEndedAsk';

describe('openEndedAsk', () => {
  it('answers from Nano when Nano is here and well', async () => {
    const nano = scriptedEngine('nano', 'Hi — doing well, thanks.');
    const gemini = scriptedEngine('gemini', 'Hi from the cloud.');
    const r = await openEndedAsk('hi how are you', nano, gemini);
    expect(r.engineId).toBe('nano');
    expect(r.reply).toBe('Hi — doing well, thanks.');
  });

  it('falls through to Gemini when the Nano engine throws', async () => {
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { throw new Error('no model'); } };
    const gemini = scriptedEngine('gemini', 'Sure — what should we build?');
    const r = await openEndedAsk("let's build something", nano, gemini);
    expect(r.engineId).toBe('gemini');
    expect(r.reply).toBe('Sure — what should we build?');
  });

  it('tries a Nano engine’s own fallback before reaching for Gemini', async () => {
    const nanoSim = scriptedEngine('nano', 'Nano SIM reply');
    const nano: SurfaceEngine = { id: 'nano', sim: false, fallback: nanoSim, stream: async () => { throw new Error('no model'); } };
    const gemini = scriptedEngine('gemini', 'Gemini reply');
    const r = await openEndedAsk('hello', nano, gemini);
    expect(r.engineId).toBe('nano');
    expect(r.reply).toBe('Nano SIM reply');
  });

  it('reports via the engine that actually answered when Nano is already routed to Gemini (unavailable)', async () => {
    const nanoSlotRoutedToGemini = scriptedEngine('gemini', 'Deep drafted this — Nano is not here.');
    const gemini = scriptedEngine('gemini', 'Gemini reply');
    const r = await openEndedAsk('hi', nanoSlotRoutedToGemini, gemini);
    expect(r.engineId).toBe('gemini');
    expect(r.reply).toBe('Deep drafted this — Nano is not here.');
  });

  it('builds a short conversational prompt carrying the exact words said', () => {
    expect(buildOpenEndedPrompt('hi how are you')).toContain('hi how are you');
  });
});
