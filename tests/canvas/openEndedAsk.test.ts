import { describe, expect, it } from 'vitest';
import { scriptedEngine, type SurfaceEngine } from '../../src/canvas/aiTurn';
import { buildOpenEndedPrompt, CHAT_CANT_ACT, CHAT_CANT_ACT_GENERIC, guardSafePrefix, openEndedAsk, promiseGuard, promisesAction } from '../../src/canvas/openEndedAsk';

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

  it('tells the model it can only chat', () => {
    expect(buildOpenEndedPrompt('add a study')).toMatch(/only chat.*never change boards, devices or plans/);
  });
});

describe('promise guard: chat never claims an action', () => {
  const promises = [
    'Okay, I can do that! I’ll add a study next to bedroom two for you.',
    "I'll add a study next to bedroom 2.",
    'I will add it now.',
    'Sure, I can do that.',
    'Done!',
    'All done.',
    "I've added a study for you.",
    'I have turned on the lamp.',
    "I'm adding a study now.",
    'Let me add that for you.',
    "Sure! I'll go ahead and turn the lights off.",
    'I’m going to move the kitchen.',
    'Consider it done.',
    'Adding a study now.',
    'Sure! The study is now next to bedroom 2.',
    'Your study has been added.',
    'No problem, I’ve got it.',
    'I’d be glad to make it bigger.',
    'One moment while I add it.',
    'I’ll get that sorted.',
  ];
  for (const p of promises) {
    it(`replaces: ${p}`, () => {
      expect(promisesAction(p)).toBe(true);
      expect(promiseGuard(p).replaced).toBe(true);
    });
  }
  const chat = [
    "I'm doing well, thanks.",
    "I'm doing well, thanks! How are you?",
    'Hi! I’ll be happy to chat.',
    'I can tell you about the floor plan board.',
    'A study is a quiet room for reading and work.',
    "I'm listening — tell me what to build, or ask me anything.",
    'You can say “draw the floor plan” to start one.',
    "I'm not sure what you mean.",
    "That's done by the board's buttons.",
    'I’m turning 80 next year!',
    'I have turned the page on that.',
    'Let me make a suggestion: rest.',
    'I’ll put the kettle on and we can talk.',
    'I can turn this around for you.',
  ];
  for (const c of chat) {
    it(`passes: ${c}`, () => {
      expect(promisesAction(c)).toBe(false);
      expect(promiseGuard(c)).toEqual({ reply: c, replaced: false });
    });
  }
  it('the honest line names what does work, and only suggests the floor plan for a plan ask', () => {
    expect(CHAT_CANT_ACT).toBe('I can’t do that from chat — try “draw the floor plan” or use the board’s buttons.');
    expect(promiseGuard('I’ll add a study.', 'add a study next to bedroom 2').reply).toBe(CHAT_CANT_ACT);
    expect(promiseGuard('I’ll turn on the lamp.', 'turn the lamp on please').reply).toBe(CHAT_CANT_ACT_GENERIC);
    expect(CHAT_CANT_ACT_GENERIC).not.toMatch(/floor plan/);
  });
});

describe('guardSafePrefix: a promise is never partly shown or spoken', () => {
  it('releases whole safe clauses as they complete', () => {
    expect(guardSafePrefix('Hi there, nice to')).toBe('Hi there,');
    expect(guardSafePrefix('Hi there, nice to see you. How')).toBe('Hi there, nice to see you.');
  });
  it('holds a clause that could turn into a promise until its sentence ends', () => {
    expect(guardSafePrefix('Okay, I’ll add, ')).toBe('Okay,');
    expect(guardSafePrefix('Okay, I’ll add, um, the study, ')).toBe('Okay,'); // still held: its sentence hasn't ended
    expect(guardSafePrefix('Sure, I’ll be happy to chat. What')).toBe('Sure, I’ll be happy to chat.');
  });
  it('stops at the first sign of a promise, streamed chunk by chunk', () => {
    const reply = 'Okay, I can do that! I’ll add a study next to bedroom two for you.';
    const shown: string[] = [];
    for (let n = 1; n <= reply.length; n++) {
      const safe = guardSafePrefix(reply.slice(0, n));
      if (safe === null) break;
      if (safe) shown.push(safe);
    }
    expect(shown.every((t) => !/can do|add/i.test(t))).toBe(true);
    expect(guardSafePrefix(reply)).toBe(null);
  });
});
