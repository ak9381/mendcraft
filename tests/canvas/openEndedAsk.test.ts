import { describe, expect, it } from 'vitest';
import { scriptedEngine, type SurfaceEngine } from '../../src/canvas/aiTurn';
import { buildOpenEndedPrompt, CHAT_CANT_ACT, CHAT_CANT_ACT_GENERIC, CHAT_CANT_ACT_OUTSIDE, guardSafePrefix, openEndedAsk, promiseGuard, promisesAction } from '../../src/canvas/openEndedAsk';

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

  it('tells the model it never calls, messages, orders, books or reminds', () => {
    const p = buildOpenEndedPrompt('call my daughter');
    for (const w of ['call', 'message', 'order', 'book', 'remind']) expect(p).toContain(w);
    expect(p).toMatch(/never say you will/);
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
    // Was a pass as a figure of speech, but chat has no kettle: it is still a
    // claim of an action the app can't take, so it is replaced (honesty wins).
    'I’ll put the kettle on and we can talk.',
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
    // "Okay," opens a reply that may agree to act: held with its sentence;
    // "I’ll add" is a promise on its own now (any action verb after "I’ll").
    expect(guardSafePrefix('Okay, I’ll ex')).toBe('');
    expect(guardSafePrefix('Okay, I’ll add, ')).toBe(null);
    expect(guardSafePrefix('Okay, I’ll explain, um, the study, ')).toBe(''); // still held: its sentence hasn't ended
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

describe('inverted guard: any first-person action claim is a promise unless it is conversation', () => {
  const caught = [
    'Yes, I can. I will call your daughter right away.', // the live Nano reply
    'I will call your daughter.',
    "I'll call her now.",
    'I’ll text your son for you.',
    'I will send her a message.',
    "I'll email the doctor.",
    "I'll order some groceries for you.",
    'I’ll book a table for two.',
    "I'll remind you at five.",
    'I will set an alarm for seven.',
    "I'll schedule the appointment.",
    "I'll buy more milk.",
    "I'll play some jazz.",
    "I'm going to ring her.",
    'Let me call her for you.',
    'Let me check on that for you.',
    "I'd be happy to!",
    "I'd be happy to call her.",
    "I'm calling your daughter now.",
    "I'm sending it right away.",
    'Calling your daughter right away.',
    'Sure — ordering it now.',
    'Right away!',
    'Yes, I can.',
    'Sure, I can do that for you.',
    'Sure, I can call her.',
    'Of course, I will.',
    'On it!',
    'Consider it done.',
    'I can call your daughter.',
    "I'll remember that.",
    "I'll keep that in mind.",
    "I'll be sure to remind her.",
    "I'll go ahead and dial her number.",
    'I’ll just open the door.',
    "I'll see what I can do.",
    "I'll help you call her.",
  ];
  for (const c of caught) {
    it(`replaces: ${c}`, () => expect(promisesAction(c)).toBe(true));
  }
  const passes = [
    "I'll be happy to explain.",
    "I'll explain how the plan works.",
    'Let me think about that.',
    'Let me explain.',
    'Let me know what you need.',
    'Let me see… a study is a quiet room.',
    "I'd suggest resting a bit.",
    "I'll tell you a story.",
    "I'd recommend a warm drink.",
    "I'll say it again: rest.",
    'I can help with that question.',
    "I'm happy to chat.",
    "I'm thinking of you right now.",
    'You should rest right away if you feel dizzy.',
    'Nothing new for you today.',
    'Good morning! How are you now?',
    "I won't call anyone — I can only chat.",
    'I will not call her; I can only chat.',
    "I'd love to hear more.",
    "I'll keep it short: rest.",
    "I'll give you a tip: drink water.",
    'Sure, I can explain that.',
    'Yes, I can tell you about the board.',
    "I'm doing well right now, thanks.",
    'Let me start with the basics.',
  ];
  for (const c of passes) {
    it(`passes: ${c}`, () => expect(promisesAction(c)).toBe(false));
  }
  it('a non-app action gets the honest "boards and devices" line', () => {
    expect(CHAT_CANT_ACT_OUTSIDE).toBe('I can’t do that — I can only change things here on your boards and devices.');
    expect(promiseGuard('Yes, I can. I will call your daughter right away.', 'can you call my daughter').reply).toBe(CHAT_CANT_ACT_OUTSIDE);
    expect(promiseGuard('I’ll order milk.', 'order some milk').reply).toBe(CHAT_CANT_ACT_OUTSIDE);
  });
  it('streaming: the live Nano reply never shows a word of its promise', () => {
    const reply = 'Yes, I can. I will call your daughter right away.';
    for (let n = 1; n <= reply.length; n++) {
      const safe = guardSafePrefix(reply.slice(0, n));
      if (safe === null) { expect(n).toBeLessThanOrEqual(reply.indexOf('.') + 1); return; }
      expect(safe).toBe('');
    }
    throw new Error('never caught');
  });
  it('streaming: a half-written word is not judged ("I will b…" → "be happy")', () => {
    expect(guardSafePrefix('Hi. I will b')).toBe('Hi.');
    expect(guardSafePrefix('Hi. I will be happy to explain. And')).toBe('Hi. I will be happy to explain.');
  });
});
