import { describe, expect, it } from 'vitest';
import { recordedEngine } from '../helpers/recordedEngine';
import { type SurfaceEngine } from '../../src/canvas/aiTurn';
import { buildOpenEndedPrompt, CHAT_CANT_ACT, CHAT_CANT_ACT_GENERIC, CHAT_CANT_ACT_OUTSIDE, guardSafePrefix, openEndedAsk, promiseGuard, promisesAction } from '../../src/canvas/openEndedAsk';

describe('openEndedAsk', () => {
  it('answers from Nano when Nano is here and well', async () => {
    const nano = recordedEngine('nano', 'Hi — doing well, thanks.');
    const gemini = recordedEngine('gemini', 'Hi from the cloud.');
    const r = await openEndedAsk('hi how are you', nano, gemini);
    expect(r.engineId).toBe('nano');
    expect(r.reply).toBe('Hi — doing well, thanks.');
  });

  it('falls through to Gemini when the Nano engine throws', async () => {
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { throw new Error('no model'); } };
    const gemini = recordedEngine('gemini', 'Sure — what should we build?');
    const r = await openEndedAsk("let's build something", nano, gemini);
    expect(r.engineId).toBe('gemini');
    expect(r.reply).toBe('Sure — what should we build?');
  });

  it('tries a Nano engine’s own fallback before reaching for Gemini', async () => {
    const nanoSim = recordedEngine('nano', 'Nano SIM reply');
    const nano: SurfaceEngine = { id: 'nano', sim: false, fallback: nanoSim, stream: async () => { throw new Error('no model'); } };
    const gemini = recordedEngine('gemini', 'Gemini reply');
    const r = await openEndedAsk('hello', nano, gemini);
    expect(r.engineId).toBe('nano');
    expect(r.reply).toBe('Nano SIM reply');
  });

  it('reports via the engine that actually answered when Nano is already routed to Gemini (unavailable)', async () => {
    const nanoSlotRoutedToGemini = recordedEngine('gemini', 'Deep drafted this — Nano is not here.');
    const gemini = recordedEngine('gemini', 'Gemini reply');
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
    'I’ll put the kettle on and we can talk.', // a figure of speech: no app or outside verb
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

// The probe set: everyday small talk Nano writes (must pass) and action
// claims it must never get away with (must be replaced). Targets: at most 2
// false positives and 3 misses; each one left is listed with its reason.
describe('probe set: small talk passes, action claims are replaced', () => {
  const smallTalk = [
    "I'm doing well, thanks! How are you?",
    'Hi there! Nice to hear from you.',
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
    "I'll keep you company.",
    "I'll do my best.",
    "Okay, I'll try.",
    "I'll try my best to answer.",
    "I'll leave that up to you.",
    "I'll take that as a yes!",
    "I'll get back to the topic.",
    "I'll go with whatever you like.",
    "I'll pass on that joke.",
    "I'll stop rambling now.",
    "I'll hope for sunshine.",
    "I'll miss chatting with you!",
    'Let me check: did you mean the kitchen lamp?',
    "I can turn the lamp on for you if you say 'turn on the lamp'.",
    'I’ll put the kettle on and we can talk.',
    "I'll be here whenever you want to talk.",
    "I'll think about it.",
    "I'll admit, that's a good question.",
    "I'd say a nap sounds lovely.",
    "That sounds like a lovely day.",
    "I'm sorry to hear that. Is there anything else on your mind?",
    "I'll be right here.",
    "I'll listen — go on.",
    "I'll answer as best I can.",
    "Let me put it this way: rest.",
    "I'll wait for you.",
    "Let me make a suggestion: rest.",
    "I have turned the page on that.",
    "I'm turning 80 next year!",
    "Sure, I'd be happy to chat.",
    "I can tell you about the floor plan board.",
    "Your daughter sounds lovely.",
    "I'll start by saying hello!",
  ];
  const claims = [
    'Yes, I can. I will call your daughter right away.',
    'I will call your daughter.',
    "I'll text your son for you.",
    'I will send her a message.',
    "I'll email the doctor.",
    "I'll order some groceries for you.",
    'I’ll book a table for two.',
    "I'll remind you at five.",
    'I will set an alarm for seven.',
    "I'm going to ring her.",
    'Let me call her for you.',
    'Let me check on that for you.',
    "I'd be happy to!",
    "I'm calling your daughter now.",
    'Calling your daughter right away.',
    'Sure — ordering it now.',
    'Yes, I can.',
    'On it!',
    'Consider it done.',
    'I can call your daughter.',
    "I'll remember that.",
    "I'll keep that in mind.",
    "I'll see what I can do.",
    "I've sent the message.",
    "I've let your son know.",
    'Your daughter has been notified.',
    'Got it, the fan is off.',
    "I'm setting a timer for ten minutes.",
    "I'll tell her you called.",
    "I'll play some jazz.",
    "Sure, I'll turn on the lights.",
    "I've booked it for Tuesday.",
    // the known misses found live after the probe set was agreed
    "I'll ping your son.",
    "I've pinged your son.",
    "I'll inform your daughter.",
    "I'll warm up the room for you.",
    "I'll cool the room down.",
    'Let me warm the kitchen up.',
  ];
  it('the sets are the agreed size', () => {
    expect(smallTalk.length).toBe(60);
    expect(claims.length).toBe(38);
  });
  for (const c of smallTalk) it(`passes: ${c}`, () => expect(promisesAction(c)).toBe(false));
  for (const c of claims) it(`replaces: ${c}`, () => expect(promisesAction(c)).toBe(true));
  it('a non-app action gets the honest "boards and devices" line', () => {
    expect(CHAT_CANT_ACT_OUTSIDE).toBe('I can’t do that — I can only change things here on your boards and devices.');
    expect(promiseGuard('Yes, I can. I will call your daughter right away.', 'can you call my daughter').reply).toBe(CHAT_CANT_ACT_OUTSIDE);
    expect(promiseGuard('I’ll order milk.', 'order some milk').reply).toBe(CHAT_CANT_ACT_OUTSIDE);
    expect(promiseGuard("I'll ping your son.", 'ping my son').reply).toBe(CHAT_CANT_ACT_OUTSIDE);
    expect(promiseGuard("I'll warm up the room for you.", 'it is cold').reply).toBe(CHAT_CANT_ACT_OUTSIDE);
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
  it('streaming: a verb whose verdict needs the next word is not judged before it ("I will b…", "I’ll tell ")', () => {
    expect(guardSafePrefix('Hi. I will b')).toBe('Hi.');
    expect(guardSafePrefix('Hi. I will be happy to explain. And')).toBe('Hi. I will be happy to explain.');
    for (const s of ['Hi. I’ll tell ', 'Hi. I’ll walk ', 'Hi. Let me start ', 'Hi. Sure, I can try ', 'Hi. I’ll stop ']) expect(guardSafePrefix(s)).toBe('Hi.');
    expect(guardSafePrefix('Hi. I’ll tell you a story. Once')).toBe('Hi. I’ll tell you a story.');
  });
});
