import { describe, expect, it, vi } from 'vitest';
import {
  createSpeculativeEngine,
  guessesAgree,
  looksReadyToGuess,
  transcriptChangedMaterially,
} from '../src/cad/speculative';

describe('speculative helpers', () => {
  it('waits for enough words before guessing', () => {
    expect(looksReadyToGuess('should we')).toBe(false);
    expect(looksReadyToGuess('should we take down the wall')).toBe(true);
    expect(looksReadyToGuess('is this ok?')).toBe(true);
  });

  it('treats a longer, more specific final as a material change', () => {
    expect(transcriptChangedMaterially(
      'should we take down the wall',
      'should we take down the wall between the kitchen and the living room',
    )).toBe(true);
    expect(transcriptChangedMaterially('should we take down the wall', 'should we take down the wall please')).toBe(false);
  });

  it('agrees when the tools match or the answers overlap', () => {
    expect(guessesAgree({ tool: 'delete' }, { answer: 'x', calls: [{ tool: 'delete', args: {} }] })).toBe(true);
    expect(guessesAgree(
      { answer: 'Check whether the wall is load bearing before taking it down.' },
      { answer: 'Verify load-bearing requirements before demolition.', calls: [] },
    )).toBe(true);
    expect(guessesAgree({ tool: 'delete' }, { answer: 'Leave it.', calls: [] })).toBe(false);
  });
});

describe('createSpeculativeEngine', () => {
  it('shows a Nano guess after the debounce and does not auto-apply it', async () => {
    const cloud = vi.fn();
    const engine = createSpeculativeEngine({
      debounceMs: 20,
      online: () => true,
      isHard: () => true,
      isJudgement: () => true,
      pickNano: async () => ({ call: { tool: 'delete', args: { id: 'w2' } }, confidence: 0.8 }),
      askCloud: cloud,
    });
    engine.onInterim('Should we take down the wall between');
    await new Promise((r) => setTimeout(r, 30));
    const d = engine.getDraft();
    expect(d?.state).toBe('draft');
    expect(d?.tool).toBe('delete');
    expect(cloud).toHaveBeenCalledTimes(1);
  });

  it('fires Gemini only once early, and again on a material final change', async () => {
    const cloud = vi.fn(async (s: string) => ({ answer: `about ${s.slice(-12)}`, calls: [] }));
    const engine = createSpeculativeEngine({
      debounceMs: 10,
      online: () => true,
      isHard: () => true,
      isJudgement: () => true,
      pickNano: async () => ({ call: { tool: 'ask_gemini', args: {} }, confidence: 0.7, answer: 'Maybe take it down.' }),
      askCloud: cloud,
    });
    engine.onInterim('Should we take down the wall');
    await new Promise((r) => setTimeout(r, 20));
    expect(cloud).toHaveBeenCalledTimes(1);
    engine.onInterim('Should we take down the wall between the');
    await new Promise((r) => setTimeout(r, 20));
    expect(cloud).toHaveBeenCalledTimes(1); // still one early call
    const r = await engine.onFinal('Should we take down the wall between the kitchen and the living room?');
    expect(cloud).toHaveBeenCalledTimes(2);
    expect(r.handled).toBe(true);
    expect(r.draft?.state === 'confirmed' || r.draft?.state === 'corrected' || r.draft?.state === 'withdrawn').toBe(true);
  });

  it('records agreement rate and seconds saved when Gemini confirms a guess', async () => {
    let t = 1000;
    const engine = createSpeculativeEngine({
      now: () => t,
      debounceMs: 5,
      online: () => true,
      isHard: () => true,
      pickNano: async () => ({ call: { tool: 'ask_gemini', args: {} }, confidence: 0.8, answer: 'Leave the load-bearing wall up.' }),
      askCloud: async () => {
        t += 800;
        return { answer: 'Leave the load-bearing wall in place until a structural check.', calls: [] };
      },
    });
    engine.onInterim('Should we take down this wall');
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.getDraft()?.state).toBe('draft');
    const r = await engine.onFinal('Should we take down this wall');
    expect(r.draft?.state).toBe('confirmed');
    const s = engine.stats();
    expect(s.compared).toBe(1);
    expect(s.agreed).toBe(1);
    expect(s.secondsSaved).toBeGreaterThan(0);
  });

  it('skips the early cloud call when offline', async () => {
    const cloud = vi.fn();
    const engine = createSpeculativeEngine({
      debounceMs: 5,
      online: () => false,
      isHard: () => true,
      pickNano: async () => ({ call: { tool: 'ask_gemini', args: {} }, confidence: 0.7, answer: 'Saved for later.' }),
      askCloud: cloud,
    });
    engine.onInterim('Should we take down this wall');
    await new Promise((r) => setTimeout(r, 10));
    await engine.onFinal('Should we take down this wall');
    expect(cloud).not.toHaveBeenCalled();
    expect(engine.getDraft()?.answer).toMatch(/Saved/);
  });
});
