// "hi how are you" should answer fast: the model is warm before she asks, the
// reply is shown and read aloud as it is written, the reply is short, and the
// recognizer's words are used as soon as they are known. Fakes throughout —
// the live numbers come from ?nanoTrace=1 (scripts/live-probe.md).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createNanoQueue } from '../../src/ai/nanoQueue';
import { ON_DEVICE_LOAD_MAX_MS, STILL_LOADING, onOnDeviceUnloaded, onWarmState, setModelsForTest, streamOnDevice, warmBoardOnDevice, type TextGenModel, type WarmState } from '../../src/ai/hybrid';
import { createWarmKeeper, startWarmSchedule, WARM_AFTER_PAINT_MS, WARM_IDLE_TIMEOUT_MS } from '../../src/ai/nanoWarm';
import { createWarmBar, WARM_LINE_MS, WARM_LOADED_LINE } from '../../src/canvas/warmBar';
import { NANO_LOADING_LINE } from '../../src/canvas/aiTurn';
import { createReplyTrace } from '../../src/ai/replyTrace';
import { createSpeaker, type RawVoice, type UtteranceLike } from '../../src/ai/speaker';
import { createVoiceController, INTERIM_GRACE_MS } from '../../src/input/voice';
import { cleanReply, createSentenceFeed, REPLY_MAX_CHARS } from '../../src/canvas/liveReply';
import { buildOpenEndedPrompt, openEndedAsk } from '../../src/canvas/openEndedAsk';
import type { StreamOptions, SurfaceEngine } from '../../src/canvas/aiTurn';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
const read = (f: string): string => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const onDevice = (text: string) => ({ text: () => text, inferenceSource: 'on_device' });

afterEach(() => { setModelsForTest(null); vi.useRealTimers(); });

describe('1. the model is warm before she asks', () => {
  it('the warm-up says it is loading the model and when it has (the engine bar shows it)', async () => {
    let finishWarm!: () => void;
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: () => ({ chromeAdapter: {}, generateContent: () => new Promise((r) => { finishWarm = () => r({ response: onDevice('{"ok":true}') }); }) }) as unknown as TextGenModel });
    const states: WarmState[] = [];
    const off = onWarmState((s) => states.push(s));
    const warm = warmBoardOnDevice(createNanoQueue(1));
    await tick(2);
    expect(states).toEqual(['loading']);
    finishWarm();
    expect(await warm).toBe(true);
    expect(states).toEqual(['loading', 'loaded']);
    off();
  });

  it('a request during a warm-up that is still loading: "loading" at once, the 20 s clock never starts, and at the 45 s ceiling (wait included) the honest still-loading — no second create', async () => {
    vi.useFakeTimers();
    let creates = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: () => { creates++; return { chromeAdapter: {}, generateContent: () => never() } as unknown as TextGenModel; } });
    const q = createNanoQueue(1);
    void warmBoardOnDevice(q, { createMaxMs: 10 * 60_000 });
    await vi.advanceTimersByTimeAsync(5);
    const loading: string[] = [];
    let started = 0;
    const request = streamOnDevice({ prompt: 'p', queue: q, onStart: () => { started++; }, onLoading: (s) => loading.push(s) }).then(() => 'answered', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toBe(1);
    expect(loading).toEqual(['loading']);
    await vi.advanceTimersByTimeAsync(ON_DEVICE_LOAD_MAX_MS);
    expect(await request).toBe(STILL_LOADING);
    expect(loading).toEqual(['loading', 'gave-up']);
    expect(creates).toBe(1); // only the warm-up's create
  });

  it('while warming, the engine bar shows "Nano is loading the model…"; "loaded" clears by itself; a turn owns the card', () => {
    vi.useFakeTimers();
    const sets: Array<[string, string, string | undefined]> = [];
    let busy = false, ended = 0;
    const bar = { set: (e: string, st: string, line?: string) => { sets.push([e, st, line]); } };
    const warmBar = createWarmBar({ bar: bar as never, busy: () => busy, lastTurnEndedAt: () => ended });
    warmBar('loading');
    expect(sets.at(-1)).toEqual(['nano', 'working', NANO_LOADING_LINE]);
    warmBar('loaded');
    expect(sets.at(-1)).toEqual(['nano', 'idle', WARM_LOADED_LINE]);
    vi.advanceTimersByTime(WARM_LINE_MS);
    expect(sets.at(-1)).toEqual(['nano', 'idle', '']);
    // a turn that ran meanwhile keeps its own line
    sets.length = 0;
    warmBar('loading'); warmBar('loaded');
    ended = Date.now() + 1;
    vi.advanceTimersByTime(WARM_LINE_MS);
    expect(sets.at(-1)).toEqual(['nano', 'idle', WARM_LOADED_LINE]);
    // a turn already running: the warm-up writes nothing
    sets.length = 0; busy = true;
    warmBar('loading'); warmBar('loaded');
    expect(sets).toEqual([]);
  });

  it('the page schedule: after first paint, then at the first idle moment (with a deadline), it asks for Nano and keeps polling; stop() cancels everything', async () => {
    vi.useFakeTimers();
    const rafs: Array<() => void> = [];
    const idles: Array<{ cb: () => void; timeout: number }> = [];
    let refreshes = 0, unsubscribed = 0, cancelledIdle = 0;
    const states: string[] = [];
    let emit!: (s: 'loading' | 'loaded' | 'failed') => void;
    const sched = startWarmSchedule({
      refresh: async () => { refreshes++; return false; },
      available: () => false,
      subscribe: (cb) => { emit = cb; return () => { unsubscribed++; }; },
      onState: (s) => states.push(s),
      raf: (cb) => { rafs.push(cb); return rafs.length; },
      cancelRaf: () => undefined,
      idle: (cb, o) => { idles.push({ cb, timeout: o.timeout }); return idles.length; },
      cancelIdle: () => { cancelledIdle++; },
    });
    expect(refreshes).toBe(0); // nothing before first paint
    rafs[0]();
    await vi.advanceTimersByTimeAsync(WARM_AFTER_PAINT_MS);
    expect(idles).toHaveLength(1);
    expect(idles[0].timeout).toBe(WARM_IDLE_TIMEOUT_MS);
    idles[0].cb();
    expect(refreshes).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshes).toBe(2);
    emit('loading');
    expect(states).toEqual(['loading']);
    sched.stop();
    expect(unsubscribed).toBe(1);
    emit('loaded');
    expect(states).toEqual(['loading']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshes).toBe(2);
    // stopped before the idle moment: that callback is cancelled
    const s2 = startWarmSchedule({ refresh: async () => { refreshes++; return false; }, available: () => false, idle: (cb) => { idles.push({ cb, timeout: 0 }); return 9; }, cancelIdle: () => { cancelledIdle++; } });
    await vi.advanceTimersByTimeAsync(WARM_AFTER_PAINT_MS);
    s2.stop();
    expect(cancelledIdle).toBe(1);
  });

  it('a request while the warm-up is only QUEUED (not loading) goes through the queue at once — no waiting on it, no "loading"', async () => {
    let creates = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: () => { creates++; return { generateContent: async () => ({ response: onDevice(creates === 1 ? 'Hello there.' : '{"ok":true}') }) } as unknown as TextGenModel; } });
    const q = createNanoQueue(1);
    let release!: () => void;
    const hold = q.run(() => new Promise<void>((r) => { release = r; })); // something holds the model
    const warm = warmBoardOnDevice(q); // queued behind it, not loading
    await tick(2);
    const loading: string[] = [];
    const request = streamOnDevice({ prompt: 'hi', queue: q, onLoading: (s) => loading.push(s) });
    await tick(5);
    release();
    await hold;
    expect(await request).toBe('Hello there.'); // the request ran first (higher priority)
    expect(loading).toEqual([]);
    expect(await warm).toBe(true);
  });

  it('the warm-up never calls the cloud', () => {
    const hybrid = read('src/ai/hybrid.ts');
    const warm = hybrid.slice(hybrid.indexOf('export function warmBoardOnDevice('), hybrid.indexOf('export const warmUpInFlight'));
    expect(warm).toContain('onDeviceModelFor(');
    expect(warm).not.toMatch(/streamCanvasPlan|cloudModel|PREFER_IN_CLOUD|ONLY_IN_CLOUD|generateWithBudget/);
  });

  it('a request that arrives during the warm-up waits for it — the load is never aborted, no second create starts', async () => {
    let finishWarm!: () => void;
    let aborted = 0, creates = 0;
    const order: string[] = [];
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: (params) => {
      creates++;
      (params.createOptions.signal as AbortSignal).addEventListener('abort', () => { aborted++; });
      if (creates === 1) return { chromeAdapter: {}, generateContent: () => new Promise((r) => { finishWarm = () => { order.push('warm-up answered'); r({ response: onDevice('{"ok":true}') }); }; }) } as unknown as TextGenModel;
      return { generateContent: async () => { order.push('request ran'); return { response: onDevice('Hello there.') }; } } as unknown as TextGenModel;
    } });
    const q = createNanoQueue(1);
    const warm = warmBoardOnDevice(q);
    await tick(2);
    const request = streamOnDevice({ prompt: 'hi how are you', queue: q });
    await tick(10);
    expect({ aborted, creates, order }).toEqual({ aborted: 0, creates: 1, order: [] });
    finishWarm();
    expect(await warm).toBe(true);
    expect(await request).toBe('Hello there.');
    expect(order).toEqual(['warm-up answered', 'request ran']);
  });

  it('the warm-up is not pre-emptible any more (the live trace showed a 19 s create thrown away)', () => {
    const hybrid = read('src/ai/hybrid.ts');
    const warm = hybrid.slice(hybrid.indexOf('export function warmBoardOnDevice('), hybrid.indexOf('export const warmUpInFlight'));
    expect(warm).not.toMatch(/preemptible|stepped aside/);
    expect(warm).toContain('{ priority: -1, maxWaitMs: WARM_QUEUE_WAIT_MS }');
    expect(hybrid).toContain("nanoTrace('on-device call: waiting for the warm-up that is loading the model');");
  });

  it('the warm-up runs a real tiny prompt, and the page wires the warm schedule', () => {
    const hybrid = read('src/ai/hybrid.ts');
    expect(hybrid).toContain("model.generateContent('Reply with JSON only: {\"ok\":true}')");
    const main = read('src/canvas/canvasMain.ts');
    // the page runs the schedule tested above, with the real warm state, and stops it on teardown
    expect(main).toContain('subscribe: onWarmState,');
    expect(main).toContain("addEventListener('pagehide', () => warmSchedule.stop());");
    expect(main).toContain('if (nanoAvailable && !was) warmKeeper.kick();');
  });

  it('an evicted model is warmed again: a call that fails as if the session died asks for it; a stop or a refusal does not', async () => {
    let fail: Error | null = null;
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: () => ({ generateContent: async () => { if (fail) throw fail; return { response: onDevice('ok') }; } }) as unknown as TextGenModel });
    let unloaded = 0;
    const off = onOnDeviceUnloaded(() => { unloaded++; });
    const q = createNanoQueue(1);
    await streamOnDevice({ prompt: 'p', queue: q }); // the model is loaded
    expect(unloaded).toBe(0);
    fail = Object.assign(new Error('The request is invalid'), { name: 'NotSupportedError' }); // Chrome refused the request: not an eviction
    await streamOnDevice({ prompt: 'p', queue: q }).catch(() => undefined);
    expect(unloaded).toBe(0);
    fail = new Error('The session has been destroyed.');
    await streamOnDevice({ prompt: 'p', queue: q }).catch(() => undefined);
    expect(unloaded).toBe(1);
    await streamOnDevice({ prompt: 'p', queue: q }).catch(() => undefined);
    expect(unloaded).toBe(1); // told once, until it is loaded again
    off();
    // the page's reaction: forget "warm", warm again
    vi.useFakeTimers();
    let warms = 0;
    const keeper = createWarmKeeper({ warm: async () => { warms++; return true; }, idle: () => true });
    keeper.kick();
    await vi.advanceTimersByTimeAsync(1);
    keeper.kick();
    await vi.advanceTimersByTimeAsync(1);
    expect(warms).toBe(1); // already warm: nothing
    keeper.reset(); keeper.kick();
    await vi.advanceTimersByTimeAsync(1);
    expect(warms).toBe(2);
    expect(read('src/canvas/canvasMain.ts')).toContain('onOnDeviceUnloaded(() => { warmKeeper.reset(); warmKeeper.kick(); });');
  });
});

describe('2. the reply is shown and spoken as it arrives', () => {
  it('sentences are handed out the moment each is complete — not at the end of the reply', () => {
    const feed = createSentenceFeed();
    const reply = "I'm doing well, thank you! How can I help you today?";
    const spoken: Array<{ at: number; text: string }> = [];
    for (let i = 1; i <= reply.length; i++) for (const s of feed.push(reply.slice(0, i))) spoken.push({ at: i, text: s });
    expect(spoken).toEqual([{ at: reply.indexOf('!') + 2, text: "I'm doing well, thank you!" }]); // spoken while the second sentence is still being written
    expect(feed.flush(reply)).toBe('How can I help you today?');
    expect(feed.flush(reply)).toBeNull();
  });

  it('the first thing said may end at a clause, so the voice starts most of a second sooner', () => {
    const feed = createSentenceFeed({ firstAtClause: true });
    const reply = "I'm doing well, thank you! How can I help you today?";
    const spoken: Array<{ at: number; text: string }> = [];
    for (let i = 1; i <= reply.length; i++) for (const s of feed.push(reply.slice(0, i))) spoken.push({ at: i, text: s });
    expect(spoken[0]).toEqual({ at: 16, text: "I'm doing well," }); // 16 characters in, not 27
    expect(feed.flush(reply)).not.toBeNull();
    const all = createSentenceFeed({ firstAtClause: true });
    const parts = [...all.push(`${reply} `), all.flush(reply) ?? ''].filter(Boolean);
    expect(parts.join(' ')).toBe(reply); // nothing lost, nothing said twice
    // only the first: later commas do not chop the speech up
    const later = createSentenceFeed({ firstAtClause: true });
    expect(later.push('Sure thing, I can help. First, tell me the room, then the lamp. ')).toEqual(['Sure thing, I can help.', 'First, tell me the room, then the lamp.']);
    // a comma inside a number, or a too-short opener, is not a place to start
    expect(createSentenceFeed({ firstAtClause: true }).push('It costs 1,200 rupees in')).toEqual([]);
    expect(createSentenceFeed({ firstAtClause: true }).push('Hi, I am fine')).toEqual([]);
  });

  it('a sentence is only cut at a real end: not inside 3.5, not at a full stop still waiting for its next word', () => {
    const feed = createSentenceFeed();
    expect(feed.push('It is 3.5 metres wide')).toEqual([]);
    expect(feed.push('It is 3.5 metres wide.')).toEqual([]); // nothing after it yet: could still be "wide.5"
    expect(feed.push('It is 3.5 metres wide. The')).toEqual(['It is 3.5 metres wide.']);
    // a very short opener waits for the next sentence, so the voice does not stop-start
    const short = createSentenceFeed();
    expect(short.push('Hi! I am doing well. And')).toEqual(['Hi! I am doing well.']);
    // other ends
    expect(createSentenceFeed().push('Is the lamp on? I can check… ')).toEqual(['Is the lamp on?', 'I can check…']);
  });

  it('what is shown and spoken has no emoji and no markdown', () => {
    expect(cleanReply("I'm great! 😊  How can I **help** you today? 👋🏽")).toBe("I'm great! How can I help you today?");
    expect(cleanReply('  Hello  there .  ')).toBe('Hello there.');
    expect(cleanReply('ದೀಪ ಆನ್ ಆಗಿದೆ.')).toBe('ದೀಪ ಆನ್ ಆಗಿದೆ.'); // other scripts are untouched
  });

  it('the speaker queues sentences behind each other, and a new line still cuts in', () => {
    const voices: RawVoice[] = [{ voiceURI: 'samantha', name: 'Samantha', lang: 'en-US', localService: true }];
    const log: string[] = [];
    const spoken: UtteranceLike[] = [];
    const synth = { getVoices: () => voices, cancel: () => { log.push('cancel'); }, speak: (u: UtteranceLike) => { log.push(`speak:${u.text}`); spoken.push(u); } };
    const speaker = createSpeaker({ synth, makeUtterance: (text) => ({ text, rate: 1, pitch: 1, lang: '', voice: null }) });
    let started = 0;
    expect(speaker.speak('First sentence.', { onStart: () => { started++; } })).toBe(true);
    expect(speaker.enqueue('Second sentence.')).toBe(true);
    expect(log).toEqual(['cancel', 'speak:First sentence.', 'speak:Second sentence.']); // the second did NOT cancel the first
    spoken[0].onstart?.();
    expect(started).toBe(1); // the trace hears the voice start
    // on-device voices only, for queued sentences too
    expect(spoken.every((u) => u.voice?.localService === true)).toBe(true);
    speaker.speak('Something new.');
    expect(log.slice(-2)).toEqual(['cancel', 'speak:Something new.']);
    // no named on-device voice → silence, queued or not
    const cloudOnly = createSpeaker({ synth: { getVoices: () => [{ voiceURI: 'g', name: 'Google US English', lang: 'en-US', localService: false }], cancel() {}, speak() { throw new Error('must not speak'); } }, makeUtterance: (text) => ({ text, rate: 1, pitch: 1, lang: '', voice: null }) });
    expect(cloudOnly.enqueue('Hello.')).toBe(false);
  });

  it('the canvas streams the reply into the status line and the phone toast, and new input stops the voice', () => {
    const src = read('src/canvas/canvasApp.ts');
    const live = src.slice(src.indexOf('function liveSay():'), src.indexOf("/** Gimbal body language: nod 'yes'"));
    expect(live).toContain('statusEl.textContent = t;');
    expect(live).toContain('showPhoneSay(t);');
    expect(live).toContain('for (const sentence of feed.push(t)) speakNext(sentence);');
    expect(live).toContain('createSentenceFeed({ firstAtClause: true })');
    expect(live).toContain('const ok = readAloudLines.sentence(sentence, !spokeAny, { onStart: () => replyTrace.spoken() });');
    expect(live).toContain('statusLog.push(t);'); // the final line is booked once, like say()
    const turn = src.slice(src.indexOf('async function openEndedTurn('), src.indexOf('// ---- commands ----'));
    expect(turn).toContain('live.update(safe);'); // only guard-cleared clauses (openEndedAsk.guardSafePrefix)
    expect(turn).toContain('live.end(reply);');
    expect(turn).not.toContain('say(reply)'); // never spoken a second time, whole
    expect(src).toMatch(/function run\(text: string\): boolean \{\s*\/\/ New input: whatever was still being read aloud stops now\.\s*speaker\.stop\(\);/);
  });
});

describe('3. replies are short, so Nano finishes fast', () => {
  it('the instruction is one short line asking for one or two short sentences and no emoji', () => {
    const p = buildOpenEndedPrompt('hi how are you');
    expect(p).toBe('You can only chat; you never change boards, devices or plans, or call, message, order, book or remind anyone, so never say you will or did, nor what state a device is in. Reply in English: one or two short, friendly sentences, no emoji.\nShe said: "hi how are you"');
    // every character is read before the first is written (the "chat only"
    // clause is the one addition: a reply must never promise an action —
    // nor a call, message, order, booking or reminder, which Nano did claim)
    // and "in English": the promise guard can only read English (final review C1).
    expect(p.length).toBeLessThan(270); // + "nor what state a device is in" (final review 4)
  });

  it('the chat call carries an output cap, and an on-device call that reaches it stops and frees the model', async () => {
    const seen: StreamOptions[] = [];
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async (_p, onText, so) => { seen.push(so ?? {}); onText('Hello.'); return 'Hello.'; } };
    await openEndedAsk('hi', nano, nano);
    expect(seen[0].maxChars).toBe(REPLY_MAX_CHARS);
    expect(seen[0].shape).toBe('text');
    // a model that would write on for ever is cut at the cap
    let aborted = 0, pulled = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: (params) => {
      (params.createOptions.signal as AbortSignal).addEventListener('abort', () => { aborted++; });
      return {
        generateContent: async () => ({ response: onDevice('') }),
        generateContentStream: async () => ({ stream: (async function* () { for (;;) { pulled++; yield onDevice('word '); await tick(); } })(), response: never() }),
      } as unknown as TextGenModel;
    } });
    const q = createNanoQueue(1);
    const text = await streamOnDevice({ prompt: 'p', queue: q, maxChars: 40 });
    expect(text.length).toBeGreaterThanOrEqual(40);
    expect(text.length).toBeLessThan(60);
    expect(pulled).toBeLessThan(14);
    expect(aborted).toBe(1); // its session was stopped: the model is free
    expect(q.idle()).toBe(true);
  });
});

describe('4. her words are used as soon as they are known', () => {
  /** A fake SpeechRecognition the test drives. */
  function fakeRecognizer() {
    const calls: string[] = [];
    let instance: { onresult: ((e: Event) => void) | null; onend: ((e: Event) => void) | null; onerror: ((e: Event) => void) | null; continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void } | null = null;
    const Ctor = function (this: NonNullable<typeof instance>) {
      this.onresult = null; this.onend = null; this.onerror = null; this.continuous = false; this.interimResults = false; this.lang = '';
      this.start = () => { calls.push('start'); };
      this.stop = () => { calls.push('stop'); };
      instance = this;
    } as unknown as new () => SpeechRecognition;
    const result = (text: string, isFinal: boolean): void => instance!.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal })] } as unknown as Event);
    return { Ctor, calls, result, end: () => instance!.onend?.({} as Event), get: () => instance! };
  }

  it('interim results are shown at once, and a final result is acted on without waiting for the recognizer to end', () => {
    const rec = fakeRecognizer();
    const shown: string[] = [], commands: string[] = [];
    const heard: Array<{ sinceStopMs: number | null; from: string }> = [];
    const voice = createVoiceController((t) => commands.push(t), { recognitionCtor: rec.Ctor, onInterim: (t) => shown.push(t), onHeard: (i) => heard.push(i), now: () => 0 });
    expect(rec.get().interimResults).toBe(true);
    voice.setAlwaysOn(true);
    rec.result('hi how', false);
    rec.result('hi how are you', false);
    expect(shown).toEqual(['hi how', 'hi how are you']); // on screen while she is still talking
    expect(commands).toEqual([]);
    rec.result('hi how are you', true);
    expect(commands).toEqual(['hi how are you']); // acted on: no onend needed
    expect(heard).toEqual([{ sinceStopMs: null, from: 'final' }]);
  });

  it('after the mic is released, a slow final is not waited for: the last interim is used after a short grace', () => {
    vi.useFakeTimers();
    let t = 1000;
    const rec = fakeRecognizer();
    const commands: string[] = [];
    const heard: Array<{ sinceStopMs: number | null; from: string }> = [];
    const voice = createVoiceController((c) => commands.push(c), { recognitionCtor: rec.Ctor, onHeard: (i) => heard.push(i), now: () => t });
    voice.pushToTalkStart();
    rec.result('hi how are you', false);
    voice.pushToTalkStop(); // she lets go
    t += INTERIM_GRACE_MS - 50; vi.advanceTimersByTime(INTERIM_GRACE_MS - 50);
    expect(commands).toEqual([]); // the final may still be a moment away
    t += 60; vi.advanceTimersByTime(60);
    expect(commands).toEqual(['hi how are you']); // not waiting a second or more for the recognizer
    expect(heard).toEqual([{ sinceStopMs: INTERIM_GRACE_MS + 10, from: 'interim' }]);
    // the recognizer's late final and its end do not run the command again
    rec.result('hi how are you', true);
    rec.end();
    expect(commands).toEqual(['hi how are you']);
    // a fast final wins, and the grace timer then does nothing
    voice.pushToTalkStart();
    rec.result('turn on the lamp', false);
    voice.pushToTalkStop();
    t += 120; vi.advanceTimersByTime(120);
    rec.result('turn on the lamp', true);
    vi.advanceTimersByTime(1000);
    rec.end();
    expect(commands).toEqual(['hi how are you', 'turn on the lamp']);
    expect(heard.at(-1)).toEqual({ sinceStopMs: 120, from: 'final' });
    expect(INTERIM_GRACE_MS).toBe(350);
  });

  it('?nanoTrace=1 logs mic stop → final, asked → first chunk, first chunk → first spoken word (timings only)', () => {
    let t = 0;
    const lines: string[] = [];
    const trace = createReplyTrace({ now: () => t, log: (l) => lines.push(l) });
    trace.heard(310, 'final');
    t += 5; trace.asked();
    t += 820; trace.firstChunk();
    t += 300; trace.firstChunk(); // only the first counts
    t += 340; trace.spoken();
    t += 1400; trace.done();
    expect(lines).toEqual([
      'voice: mic stop → final 310 ms (final result)',
      'reply: asked (voice) → first chunk 820 ms',
      'reply: first chunk → first spoken word 640 ms',
      'reply: asked → first spoken word 1460 ms; whole reply 2860 ms',
    ]);
    // a typed turn says so
    lines.length = 0;
    t += 60_000; trace.asked(); t += 700; trace.firstChunk(); trace.done();
    expect(lines[0]).toBe('reply: asked (typed) → first chunk 700 ms');
    expect(lines[1]).toBe('reply: asked → first spoken word not spoken; whole reply 700 ms');
    const main = read('src/canvas/canvasMain.ts');
    expect(main).toContain('onHeard: (info) => replyTrace.heard(info.sinceStopMs, info.from),');
  });
});

describe('5. the voice list is loaded at startup', () => {
  it('the speaker asks for the voices when it is created, so the first reply is not held back', () => {
    let asked = 0;
    let voices: RawVoice[] = [];
    const speaker = createSpeaker({ synth: { getVoices: () => { asked++; return voices; }, cancel() {}, speak() {} }, makeUtterance: (text) => ({ text, rate: 1, pitch: 1, lang: '', voice: null }) });
    expect(asked).toBeGreaterThan(0); // Chrome starts loading the list on this first call
    expect(speaker.voicesReady()).toBe(false);
    voices = [{ voiceURI: 'samantha', name: 'Samantha', lang: 'en-US', localService: true }];
    expect(speaker.voicesReady()).toBe(true);
    expect(speaker.speak('Hello.')).toBe(true); // spoken at once: no 3 s wait
  });

  it('the canvas makes its speaker at mount, before any reply', () => {
    const src = read('src/canvas/canvasApp.ts');
    expect(src.indexOf('const speaker = createSpeaker({ storage: voiceStore });')).toBeGreaterThan(0);
    expect(src.indexOf('const speaker = createSpeaker({ storage: voiceStore });')).toBeLessThan(src.indexOf('async function openEndedTurn('));
  });
});
