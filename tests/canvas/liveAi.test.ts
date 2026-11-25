// The live AI path (no ?sim=1): one queued on-device prompt per turn, a real
// handoff to Gemini when the on-device model can't finish, an honest error
// when both fail, and words that come from the plan. Engines are fakes — the
// real Chrome check is scripts/live-probe.md.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNanoQueue, NanoQueueSkipped } from '../../src/ai/nanoQueue';
import { APP_CHECK_403_LINE, CloudCallError, cloudCallError, explainCloudFailure } from '../../src/ai/cloudErrors';
import { NEXT_STEPS_CONSTRAINT, WARM_CONSTRAINT, acceptCanvasReply, countingSends, ON_DEVICE_MAX_RUN_MS, onNanoBusyHandoff, queueOnDevice, setModelsForTest, streamCanvasPlanOrThrow, streamOnDevice, warmBoardOnDevice, type OnDeviceModelParams, type TextGenModel } from '../../src/ai/hybrid';
import { geminiFailLine, GHOST_EVERY_MS, runSurfaceTurn, scriptedEngine, type SentInfo, type StreamOptions, type SurfaceEngine, type SurfaceRequest } from '../../src/canvas/aiTurn';
import { createEngines, NO_NANO_NOTE, type OnDeviceStream } from '../../src/canvas/engines';
import { createCanvasLedger } from '../../src/canvas/ledger';
import { buildNanoPlanRequest, NANO_SYSTEM_PROMPT, nanoPlanConstraint, parseNanoPlan, partialNanoPlan, UNSUPPORTED_CONSTRAINT_KEYWORDS, unsupportedConstraintKeywords } from '../../src/canvas/nanoPlan';
import { installNanoTrace, resetNanoTrace } from '../../src/ai/nanoTrace';
import { betterSummary, draftSummary, dropUnbackedClaims, floorPlanSummary, isStatusClaim, tilesFilledLine } from '../../src/canvas/planTruth';
import { createDeviceIdSession } from '../../src/privacy/deviceRedact';
import { resolveAppCheckDebugToken } from '../../src/firebase/debugToken';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

const req: SurfaceRequest = {
  utterance: 'connect everything in this room',
  frameTitle: 'Board 3',
  frameId: 'b3',
  devices: [{ id: 'wiz-ceiling', label: 'Ceiling light', kind: 'lamp' }, { id: 'speaker-1', label: 'Speaker', kind: 'music' }],
};
/** What live Nano writes: only its decision (title + device ids). */
const NANO_OK = '{"t":"This room","d":["wiz-ceiling","speaker-1"]}';
/** A scripted (?sim=1) engine still plays a whole plan. */
const NANO_SCRIPT = '{"kind":"room","title":"This room","tiles":[{"type":"lamp","deviceId":"wiz-ceiling","label":"Ceiling light"},{"type":"music","deviceId":"speaker-1","label":"Speaker"}]}';
const GEMINI_OK = '{"kind":"room","title":"Living room","tiles":[{"type":"lamp","deviceId":"Device 1","label":"Main light"},{"type":"music","deviceId":"Device 2","label":"Speaker"}]}';
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

/** A fake Firebase AI Logic on-device model factory (what getGenerativeModel
 *  with mode ONLY_ON_DEVICE gives the app), recording every model it builds. */
function fakeSdk(reply = NANO_OK, o: { delayMs?: number; chunks?: number; source?: string; hang?: boolean } = {}) {
  const stats = { models: 0, prompts: 0, running: 0, peak: 0, aborted: 0, params: [] as OnDeviceModelParams[], inputs: [] as string[] };
  const source = o.source ?? 'on_device';
  const factory = (params: OnDeviceModelParams): TextGenModel => {
    stats.models++; stats.params.push(params);
    (params.createOptions.signal as AbortSignal | undefined)?.addEventListener('abort', () => { stats.aborted++; });
    return {
      generateContent: async (prompt) => { stats.prompts++; stats.inputs.push(prompt); return { response: { text: () => reply, inferenceSource: source } }; },
      generateContentStream: async (prompt) => {
        stats.prompts++; stats.inputs.push(prompt);
        const n = o.chunks ?? 4;
        const stream = (async function* () {
          stats.running++; stats.peak = Math.max(stats.peak, stats.running);
          try {
            if (o.hang) await never<void>();
            for (let i = 1; i <= n; i++) {
              if (o.delayMs) await tick(o.delayMs);
              const piece = reply.slice(Math.floor(((i - 1) * reply.length) / n), Math.floor((i * reply.length) / n));
              yield { text: () => piece, inferenceSource: source };
            }
          } finally { stats.running--; }
        })();
        return { stream, response: never<{ text: () => string }>() };
      },
    };
  };
  setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: factory });
  return { stats };
}
/** The adapter canvasMain gives the engines: every Nano prompt is a Firebase
 *  AI Logic on-device call. */
const nanoVia = (queue = createNanoQueue(1)): OnDeviceStream => (prompt, onText, o) => streamOnDevice({
  system: o?.system && o.user ? o.system : undefined,
  prompt: o?.system && o.user ? o.user : prompt,
  constraint: o?.constraint, signal: o?.signal, onChunk: onText, onStart: o?.onStart, queue,
});
const LM = {}; // Chrome's LanguageModel global: only its presence matters

afterEach(() => { setModelsForTest(null); resetNanoTrace(); vi.useRealTimers(); });

describe('A: on-device concurrency cap', () => {
  it('the queue never runs more than one job at once, however many are launched together', async () => {
    const q = createNanoQueue(1);
    let running = 0, peak = 0;
    const job = async (): Promise<number> => { running++; peak = Math.max(peak, running); await tick(1); running--; return 1; };
    const done = await Promise.all(Array.from({ length: 14 }, () => q.run(job)));
    expect(done).toHaveLength(14);
    expect(peak).toBe(1);
    expect(q.peak()).toBe(1);
    expect(q.idle()).toBe(true);
  });

  it('a board turn goes ahead of background picks, and a job that waited too long never starts', async () => {
    const q = createNanoQueue(1);
    const order: string[] = [];
    let release!: () => void;
    const first = q.run(() => new Promise<void>((r) => { release = r; }));
    const background = q.run(async () => { order.push('background'); });
    const board = q.run(async () => { order.push('board'); }, { priority: 10 });
    let started = false;
    const impatient = q.run(async () => { started = true; }, { maxWaitMs: 5 });
    await expect(impatient).rejects.toBeInstanceOf(NanoQueueSkipped);
    release();
    await Promise.all([first, background, board]);
    expect(order).toEqual(['board', 'background']);
    expect(started).toBe(false);
  });

  it('14 on-device calls launched at once reach the SDK one at a time', async () => {
    const { stats } = fakeSdk(NANO_OK, { delayMs: 1 });
    const queue = createNanoQueue(1);
    const out = await Promise.all(Array.from({ length: 14 }, () => streamOnDevice({ prompt: 'p', queue })));
    expect(out.every((t) => t === NANO_OK)).toBe(true);
    expect(stats.prompts).toBe(14);
    expect(stats.peak).toBe(1);
  });

  it('a live Nano board turn is ONE Firebase AI Logic on-device call — not a call per tile', async () => {
    const { stats } = fakeSdk();
    const engines = createEngines({ languageModel: LM, nanoStream: nanoVia(), cloud: async () => GEMINI_OK });
    const ghosts: number[] = [];
    const plan = await runSurfaceTurn(req, engines.nano!('{}'), { onGhost: (g) => ghosts.push(g.tiles.length) });
    expect(plan?.tiles.map((t) => t.type)).toEqual(['lamp', 'music']);
    expect(stats.models).toBe(1);
    expect(stats.prompts).toBe(1);
    expect(stats.peak).toBe(1);
    const params = stats.params[0];
    // the reply is constrained to a board plan whose device ids are the real ones
    const constraint = params.promptOptions?.responseConstraint as { properties: { d: { items: { enum: string[] } } } };
    expect(constraint.properties.d.items.enum).toEqual(['wiz-ceiling', 'speaker-1']);
    expect(unsupportedConstraintKeywords(constraint)).toEqual([]);
    // tiles, types and labels come from the device list, not from the model
    expect(plan?.tiles).toEqual([{ type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling light' }, { type: 'music', deviceId: 'speaker-1', label: 'Speaker' }]);
    // text in / text out English, and the fixed instructions ride in the session
    expect(params.createOptions.expectedInputs).toEqual([{ type: 'text', languages: ['en'] }]);
    expect(params.createOptions.initialPrompts).toEqual([{ role: 'system', content: [{ type: 'text', value: NANO_SYSTEM_PROMPT }] }]);
    expect(stats.inputs[0]).not.toContain(NANO_SYSTEM_PROMPT);
    expect(stats.inputs[0]).toContain('connect everything in this room');
    // streamed: the ghost saw tiles arrive
    expect(ghosts.at(-1)).toBe(2);
  });

  it('board prompts go through Firebase AI Logic in ONLY_ON_DEVICE mode — the canvas never prompts LanguageModel itself', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (f: string): string => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
    const hybrid = read('ai/hybrid.ts');
    const factory = hybrid.slice(hybrid.indexOf('onDeviceFactory = (onDeviceParams) =>'), hybrid.indexOf('onDeviceFactory = (onDeviceParams) =>') + 260);
    expect(factory).toContain('getGenerativeModel(ai, {');
    expect(factory).toContain('mode: InferenceMode.ONLY_ON_DEVICE');
    expect(hybrid).toContain("recordInference('on-device', 'board'");
    for (const f of ['canvas/engines.ts', 'canvas/canvasMain.ts', 'canvas/aiTurn.ts', 'canvas/canvasApp.ts', 'canvas/nanoPlan.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/\.promptStreaming\(|\.prompt\(|\.clone\(/);
      expect(src, f).not.toMatch(/(languageModel|LanguageModel|lm)\.create\(/);
    }
  });

  it('text that did not come from the on-device model is refused', async () => {
    fakeSdk(NANO_OK, { source: 'in_cloud' });
    await expect(streamOnDevice({ prompt: 'p', queue: createNanoQueue(1) })).rejects.toThrow('did not come from the on-device model');
  });

  it('without Firebase AI Logic there is no on-device call at all (never a direct one)', async () => {
    setModelsForTest({ enabled: false });
    await expect(streamOnDevice({ prompt: 'p', queue: createNanoQueue(1) })).rejects.toThrow(/Firebase AI Logic isn’t set up/);
  });

  it('Nano only decides: the reply schema has a title and device ids, nothing optional', () => {
    const r = buildNanoPlanRequest(req);
    expect(r.plan).toBe(false);
    expect(r.constraint).toEqual({
      type: 'object', additionalProperties: false, required: ['t', 'd'],
      properties: {
        t: { type: 'string', maxLength: 24 },
        d: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', enum: ['wiz-ceiling', 'speaker-1'] } },
      },
    });
    expect(JSON.stringify(r.constraint)).not.toMatch(/label|template|connect|kind|tiles/);
    expect(r.prompt.length).toBeLessThan(700);
    expect(r.system).not.toMatch(/chart|table|visual|split|tabs|connect|template/);
    // never more than four devices from one draft, however many the room has
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `lamp-${i}`, label: `Lamp ${i}`, kind: 'lamp' }));
    const c = nanoPlanConstraint(many) as { properties: { d: { maxItems: number } } };
    expect(c.properties.d.maxItems).toBe(4);
  });

  it('the longest reply the schema allows is short: at about 20 chars a second, well inside the budget', () => {
    // four devices with 40-character ids (the id limit) and a full-length title
    const ids = Array.from({ length: 4 }, (_, i) => `${'x'.repeat(38)}-${i}`);
    const worst = JSON.stringify({ t: 'T'.repeat(24), d: ids });
    expect(worst.length).toBeLessThanOrEqual(220);
    // the canvas's own devices: the reply the live run should produce
    const typical = JSON.stringify({ t: 'Living room', d: ['wiz-desk', 'wiz-ceiling', 'speaker-1'] });
    expect(typical.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify({ p: 'twoBedroom' }).length).toBeLessThanOrEqual(20);
  });

  it('a floor-plan turn asks Nano for a template and nothing else', () => {
    const planReq = { ...req, utterance: 'draw the floor plan', want: 'plan' as const };
    const r = buildNanoPlanRequest(planReq);
    expect(r.plan).toBe(true);
    expect(r.constraint).toEqual({ type: 'object', additionalProperties: false, required: ['p'], properties: { p: { type: 'string', enum: ['studio', 'oneRoom', 'twoBedroom'] } } });
    expect(r.user).not.toContain('wiz-ceiling'); // the device list is not even sent
    const got = parseNanoPlan('{"p":"twoBedroom"}', planReq);
    expect(got).toEqual({ ok: true, value: { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'b3-cad', template: 'twoBedroom' }] } });
    // her own words win over the model's pick
    expect(parseNanoPlan('{"p":"oneRoom"}', { ...planReq, utterance: 'a floor plan with two bedrooms' })).toMatchObject({ ok: true, value: { tiles: [{ template: 'twoBedroom' }] } });
    // the words decide when the caller did not say
    expect(buildNanoPlanRequest({ ...req, utterance: 'start a floor plan' }).plan).toBe(true);
    expect(buildNanoPlanRequest(req).plan).toBe(false);
    expect(parseNanoPlan('{"t":"x","d":["wiz-ceiling"]}', planReq).ok).toBe(false);
  });

  it('a made-up device in Nano’s reply is dropped; labels and types are the devices’ own', () => {
    const got = parseNanoPlan('{"t":"Room","d":["lamp-2","wiz-ceiling","wiz-ceiling"]}', req);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value).toEqual({ kind: 'room', title: 'Room', tiles: [{ type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling light' }] });
    expect(got.notes?.join(' ')).toMatch(/not in this room/);
    // only made-up ids: refused (and repaired / handed off by the turn)
    expect(parseNanoPlan('{"t":"Room","d":["lamp-2"]}', req)).toEqual({ ok: false, error: 'no device from this room was chosen' });
    // no Connect tile ever comes from Nano; an empty room gets one locally
    expect(parseNanoPlan('{"t":"Empty"}', { ...req, devices: [] })).toMatchObject({ ok: true, value: { tiles: [{ type: 'connect', label: 'Connect a device' }] } });
    // a rambling title is cut to four words
    expect(parseNanoPlan('{"t":"The very large open living room","d":["speaker-1"]}', req)).toMatchObject({ ok: true, value: { title: 'The very large open' } });
  });

  it('ghost tiles appear as each device id streams in, before the reply closes', async () => {
    expect(partialNanoPlan('{"t":"Li', req).tiles).toEqual([]);
    expect(partialNanoPlan('{"t":"Living room","d":["wiz-cei', req)).toMatchObject({ title: 'Living room', tiles: [] });
    expect(partialNanoPlan('{"t":"Living room","d":["wiz-ceiling"', req).tiles).toEqual([{ type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling light' }]);
    expect(partialNanoPlan('{"t":"Living room","d":["wiz-ceiling","speaker-1', req).tiles).toHaveLength(1);
    expect(partialNanoPlan('{"t":"Living room","d":["wiz-ceiling","speaker-1"', req).tiles).toHaveLength(2);
    expect(partialNanoPlan('{"p":"twoB', { ...req, want: 'plan' }).tiles).toEqual([]);
    expect(partialNanoPlan('{"p":"twoBedroom"', { ...req, want: 'plan' }).tiles).toEqual([{ type: 'plan', boardId: 'b3-cad', template: 'twoBedroom' }]);
    // through a live turn: one ghost update per id, in order, not one at the end
    const seen: Array<{ at: number; tiles: number }> = [];
    let chars = 0;
    const nano: SurfaceEngine = { id: 'nano', sim: false, async stream(_p, onText, so) {
      so?.onStart?.();
      for (let i = 1; i <= NANO_OK.length; i++) { chars = i; onText(NANO_OK.slice(0, i)); }
      return NANO_OK;
    } };
    await runSurfaceTurn(req, nano, { onGhost: (g) => seen.push({ at: chars, tiles: g.tiles.length }) });
    const first = seen.find((g) => g.tiles === 1)!;
    const second = seen.find((g) => g.tiles === 2)!;
    expect(first.at).toBe(NANO_OK.indexOf('"wiz-ceiling"') + '"wiz-ceiling"'.length);
    expect(second.at).toBe(NANO_OK.indexOf('"speaker-1"') + '"speaker-1"'.length);
    expect(second.at).toBeLessThan(NANO_OK.length);
  });

  it('a live stream re-parses its ghost preview on a timer, not on every token', async () => {
    // 400 one-character-ish chunks, 1 ms apart: the ghost may only be looked
    // at every GHOST_EVERY_MS, so a tile that closes mid-interval shows late —
    // and the final text is always parsed.
    let t = 0;
    const seenAt: number[] = [];
    const chunks = 400;
    const live: SurfaceEngine = {
      id: 'gemini', sim: false,
      async stream(_p, onText) { for (let i = 1; i <= chunks; i++) { t += 1; onText(GEMINI_OK.slice(0, Math.ceil((i * GEMINI_OK.length) / chunks))); } return GEMINI_OK; },
    };
    let texts = 0;
    const plan = await runSurfaceTurn(req, live, { onText: () => { texts++; }, onGhost: () => { seenAt.push(t); } }, { now: () => t, deviceIdSession: createDeviceIdSession() });
    expect(plan?.tiles).toHaveLength(2);
    expect(texts).toBe(chunks);
    // every mid-stream ghost landed on a parse tick (t = 1, 121, 241, 361)
    for (const at of seenAt.filter((x) => x < chunks)) expect((at - 1) % GHOST_EVERY_MS).toBe(0);
  });

  it('a burst of buffered chunks hands the page a frame instead of holding it', async () => {
    fakeSdk(NANO_OK, { chunks: 50 });
    let yields = 0;
    let clock = 0;
    expect(await streamOnDevice({ prompt: 'p', queue: createNanoQueue(1), now: () => (clock += 10), yieldToPage: async () => { yields++; } })).toBe(NANO_OK);
    expect(yields).toBeGreaterThan(5);
  });

  it('stopping a call that never settles ends the wait, destroys its session and frees the model', async () => {
    const { stats } = fakeSdk(NANO_OK, { hang: true });
    const q = createNanoQueue(1);
    const ctl = new AbortController();
    const stuck = streamOnDevice({ prompt: 'p', queue: q, signal: ctl.signal });
    await tick(5);
    expect(q.active()).toBe(1);
    ctl.abort();
    await expect(stuck).rejects.toThrow('stopped');
    expect(stats.aborted).toBe(1); // the signal given to the session's create()
    expect(q.idle()).toBe(true);
    fakeSdk(NANO_OK);
    expect(await streamOnDevice({ prompt: 'p', queue: q })).toBe(NANO_OK);
  });

  it('a call Chrome never settles gives the slot back after the max run', async () => {
    vi.useFakeTimers();
    const { stats } = fakeSdk(NANO_OK, { hang: true });
    const q = createNanoQueue(1);
    const settled = streamOnDevice({ prompt: 'p', queue: q }).then(() => 'ok', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(ON_DEVICE_MAX_RUN_MS + 10);
    expect(await settled).toBe('took longer than 20 s');
    expect(stats.aborted).toBe(1);
    expect(q.idle()).toBe(true);
  });

  it('I4: the warm-up steps aside the moment a real request arrives', async () => {
    const q = createNanoQueue(1);
    const order: string[] = [];
    let warmSignal: AbortSignal | null = null;
    const warm = q.run((ctx) => { warmSignal = ctx.signal; order.push('warm starts'); return never<void>(); }, { priority: -1, preemptible: true });
    const warmEnd = warm.then(() => 'done', (e: Error) => e.name);
    const turn = q.run(async () => { order.push('turn starts'); return 'plan'; }, { priority: 10 });
    expect(await turn).toBe('plan'); // it did not wait for the warm-up to finish
    expect(await warmEnd).toBe('NanoQueueSkipped');
    expect(warmSignal!.aborted).toBe(true); // the warm-up's session is told to stop
    expect(order).toEqual(['warm starts', 'turn starts']);
    expect(q.idle()).toBe(true);
    // an ordinary (non-preemptible) job is never pushed aside
    let release!: () => void;
    const plain = q.run(() => new Promise<string>((r) => { release = () => r('kept'); }));
    const later = q.run(async () => 'later', { priority: 10 });
    await tick(2);
    expect(q.active()).toBe(1);
    release();
    expect(await plain).toBe('kept');
    expect(await later).toBe('later');
  });

  it('I4: the real warm-up is the lowest job, pre-emptible, and never waits in line', async () => {
    const { stats } = fakeSdk('{"ok":true}');
    const q = createNanoQueue(1);
    expect(await warmBoardOnDevice(q)).toBe(true);
    expect(stats.prompts).toBe(1);
    expect(stats.params[0].createOptions.initialPrompts).toBeUndefined();
    // busy model: the warm-up gives up at once instead of queueing behind it
    setModelsForTest(null);
    fakeSdk('{"ok":true}');
    const hold = q.run(() => tick(20));
    expect(await warmBoardOnDevice(q)).toBe(false);
    await hold;
  });

  it('SDK on-device models share the queue too (one at a time; busy means skipped)', async () => {
    const q = createNanoQueue(1);
    let running = 0, peak = 0;
    const model = queueOnDevice({ generateContent: async () => { running++; peak = Math.max(peak, running); await tick(2); running--; return { response: { text: () => 'ok' } }; } }, q, 1000);
    await Promise.all([model.generateContent(), model.generateContent(), model.generateContent()]);
    expect(peak).toBe(1);
    const hold = q.run(() => tick(30));
    const impatient = queueOnDevice({ generateContent: async () => 'x' }, q, 5);
    await expect(impatient.generateContent()).rejects.toBeInstanceOf(NanoQueueSkipped);
    await hold;
  });
});

describe('B: Nano fails → Gemini takes over, and says so', () => {
  function turn(nano: SurfaceEngine, o: { nanoTimeoutMs?: number; nanoQueueWaitMs?: number; sleep?: (ms: number) => Promise<void>; canHandoff?: () => boolean } = {}) {
    const log: { sent: SentInfo[]; handoff: Array<{ s: SentInfo; why: string }>; errors: Array<{ why: string; engine?: string }>; fallback: number; notes: string[]; sends: string[] } = { sent: [], handoff: [], errors: [], fallback: 0, notes: [], sends: [] };
    const session = createDeviceIdSession();
    const p = runSurfaceTurn(req, nano, {
      onSent: (s) => log.sent.push(s),
      onHandoff: (s, why) => log.handoff.push({ s, why }),
      onCloudSend: (s) => log.sends.push(s.engine),
      onFallback: () => { log.fallback++; },
      onError: (why, engine) => log.errors.push({ why, engine }),
      onNote: (n) => log.notes.push(n),
    }, { deviceIdSession: session, ...o });
    return { p, log };
  }
  const geminiOk = (seen: string[] = []): SurfaceEngine => ({ id: 'gemini', sim: false, stream: async (prompt, onText, so) => { seen.push(prompt); so?.onCloudSend?.(); onText(GEMINI_OK); return GEMINI_OK; } });

  it('an error on device hands off to Gemini with the redacted cloud prompt', async () => {
    const seen: string[] = [];
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { throw new Error('the model crashed'); }, handoff: geminiOk(seen) };
    const { p, log } = turn(nano);
    const plan = await p;
    expect(plan?.title).toBe('Living room');
    // real device ids came back on this device…
    expect(plan?.tiles[0]).toMatchObject({ type: 'lamp', deviceId: 'wiz-ceiling' });
    // …and never left it
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain('wiz-ceiling');
    expect(seen[0]).toContain('Device 1');
    expect(log.handoff).toHaveLength(1);
    expect(log.handoff[0].s.engine).toBe('gemini');
    expect(log.handoff[0].s.sent).toMatch(/your words/);
    expect(log.handoff[0].s.routeLine).toBe('Gemini · cloud — Nano couldn’t finish (the model crashed), so Gemini made this');
    expect(log.errors).toEqual([]);
    expect(log.fallback).toBe(0);
  });

  it('a Nano that takes too long is stopped and Gemini takes over', async () => {
    let signal: AbortSignal | undefined;
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: (_p, _on, so?: StreamOptions) => { signal = so?.signal; so?.onStart?.(); return never<string>(); }, handoff: geminiOk() };
    // the turn's clock: the Nano budget elapses at once; nothing else does
    const { p, log } = turn(nano, { nanoTimeoutMs: 20_000, sleep: (ms) => (ms === 20_000 ? Promise.resolve() : never<void>()) });
    expect((await p)?.title).toBe('Living room');
    expect(signal?.aborted).toBe(true); // the model itself was told to stop
    expect(log.handoff[0].why).toBe('took longer than 20 s');
    expect(log.handoff[0].s.routeLine).toContain('Nano couldn’t finish (took longer than 20 s), so Gemini made this');
    expect(log.sends).toEqual(['gemini']);
  });

  it('I4: the 20 s clock starts when the model takes the call — waiting in line is not counted', async () => {
    vi.useFakeTimers();
    let start!: () => void;
    let finish!: (text: string) => void;
    // the model is busy for 30 s before this call gets its turn, then answers in 5 s
    const nano: SurfaceEngine = { id: 'nano', sim: false, handoff: geminiOk(), stream: (_p, _on, so?: StreamOptions) => new Promise<string>((resolve) => { start = () => so?.onStart?.(); finish = resolve; }) };
    const { p, log } = turn(nano, { nanoTimeoutMs: 20_000, nanoQueueWaitMs: 60_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(log.handoff).toEqual([]); // 30 s in the queue did not use up the budget
    start();
    await vi.advanceTimersByTimeAsync(5_000);
    finish(NANO_OK);
    expect((await p)?.tiles).toHaveLength(2);
    expect(log.handoff).toEqual([]);
    expect(log.sends).toEqual([]);
  });

  it('I4: once the model has the call, 20 s is all it gets', async () => {
    vi.useFakeTimers();
    const nano: SurfaceEngine = { id: 'nano', sim: false, handoff: geminiOk(), stream: (_p, _on, so?: StreamOptions) => { setTimeout(() => so?.onStart?.(), 10_000); return never<string>(); } };
    const { p, log } = turn(nano, { nanoTimeoutMs: 20_000, nanoQueueWaitMs: 60_000 });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(log.handoff).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await p)?.title).toBe('Living room');
    expect(log.handoff[0].why).toBe('took longer than 20 s');
  });

  it('an invalid plan gets one repair try; a good second reply stays on device', async () => {
    const replies = ['not json at all', NANO_OK];
    const prompts: string[] = [];
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async (prompt) => { prompts.push(prompt); return replies.shift()!; }, handoff: geminiOk() };
    const { p, log } = turn(nano);
    expect((await p)?.tiles).toHaveLength(2);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/refused/);
    expect(log.handoff).toEqual([]);
  });

  it('an invalid plan twice hands off to Gemini', async () => {
    let calls = 0;
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { calls++; return '{"kind":"room","title":"x","tiles":[]}'; }, handoff: geminiOk() };
    const { p, log } = turn(nano);
    expect((await p)?.title).toBe('Living room');
    expect(calls).toBe(2); // first try + exactly one repair
    expect(log.handoff[0].why).toMatch(/not a valid board/);
  });

  it('offline: no handoff is attempted, and the line says so', async () => {
    const seen: string[] = [];
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { throw new Error('the model crashed'); }, handoff: geminiOk(seen) };
    const { p, log } = turn(nano, { canHandoff: () => false });
    expect(await p).toBeNull();
    expect(seen).toEqual([]);
    expect(log.errors[0]).toEqual({ why: 'Nano couldn’t finish (the model crashed). You’re offline, so Gemini can’t take over. Nothing was sent.', engine: 'nano' });
    expect(log.sends).toEqual([]);
  });

  it('both fail: one honest error with both reasons, no draft, nothing labelled SIM', async () => {
    const blocked = new CloudCallError(explainCloudFailure('AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/models/m:streamGenerateContent?alt=sse: AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.'));
    let geminiCalls = 0;
    const gemini: SurfaceEngine = { id: 'gemini', sim: false, stream: async () => { geminiCalls++; throw blocked; } };
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { throw new Error('the model crashed'); }, handoff: gemini };
    const { p, log } = turn(nano);
    expect(await p).toBeNull();
    expect(log.errors).toEqual([{ why: `Nano couldn’t finish (the model crashed). ${APP_CHECK_403_LINE}. Nothing was sent.`, engine: 'gemini' }]);
    expect(log.sends).toEqual([]); // refused before it left: no bytes booked
    expect(geminiCalls).toBe(1); // a 403 is not retried: the same call cannot pass
    expect(log.fallback).toBe(0);
    const everything = JSON.stringify(log);
    expect(everything).not.toMatch(/SIM|prepared draft|didn’t answer, so/);
  });

  it('Gemini alone failing is an honest error too (App Check 403, plainly)', async () => {
    const gemini: SurfaceEngine = { id: 'gemini', sim: false, stream: async () => { throw new Error('AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.'); } };
    const errors: string[] = [];
    expect(await runSurfaceTurn(req, gemini, { onError: (w) => errors.push(w) }, { sleep: () => never<void>() })).toBeNull();
    expect(errors).toEqual(['Gemini blocked: App Check 403 (this address isn’t registered). Nothing was sent.']);
  });
});

describe('B: no SIM wording without ?sim=1', () => {
  const cloud = async (): Promise<string> => GEMINI_OK;
  it('live engines carry no scripted stand-in, on either slot', () => {
    for (const rt of [
      { languageModel: LM, nanoStream: nanoVia(), cloud },
      { cloud },
      { cloud, isPhone: true, appleOnDevice: true, onDeviceGenerate: cloud },
    ]) {
      const engines = createEngines(rt);
      for (const id of ['nano', 'gemini'] as const) {
        const e = engines[id]!('{"kind":"room","title":"SCRIPT","tiles":[]}');
        expect(e.sim).toBe(false);
        expect(e.fallback).toBeUndefined();
        expect(e.handoff?.fallback).toBeUndefined();
        expect(e.handoff?.sim ?? false).toBe(false);
        expect(e.routeLine ?? '').not.toMatch(/SIM/);
      }
    }
  });

  it('a live on-device engine hands off to the real cloud engine; ?sim=1 stays scripted', () => {
    const live = createEngines({ languageModel: LM, nanoStream: nanoVia(), cloud }).nano!('{}');
    expect(live.id).toBe('nano');
    expect(live.handoff?.id).toBe('gemini');
    const sim = createEngines({ languageModel: LM, nanoStream: nanoVia(), cloud, sim: true }).nano!(NANO_SCRIPT);
    expect(sim.sim).toBe(true);
    expect(sim.handoff).toBeUndefined();
  });

  it('nanoStream null means Nano is OFF: the step is Gemini’s and says so (no hidden direct path)', () => {
    for (const nanoStream of [null, undefined]) {
      const e = createEngines({ languageModel: LM, nanoStream, cloud }).nano!('{}');
      expect(e.id).toBe('gemini');
      expect(e.routeLine).toBe(NO_NANO_NOTE);
    }
  });

  it('a failed live turn never streams a script, and no line says SIM or “prepared draft”', async () => {
    const script = '{"kind":"room","title":"SCRIPTED","tiles":[{"type":"connect","label":"Connect a device"}]}';
    const engines = createEngines({ cloud: async () => { throw new Error('Failed to fetch'); } });
    const lines: string[] = [];
    const plan = await runSurfaceTurn(req, engines.gemini!(script), {
      onSent: (s) => lines.push(s.routeLine), onFallback: (s) => lines.push(`FALLBACK ${s.routeLine}`), onError: (w) => lines.push(w),
    }, { sleep: () => never<void>() });
    expect(plan).toBeNull();
    expect(lines.join('\n')).not.toMatch(/SIM|prepared|FALLBACK|SCRIPTED/);
    // the request was issued and the network failed: no claim that nothing left
    expect(lines.at(-1)).toBe('Gemini couldn’t be reached: no connection');
  });

  it('the canvas source no longer builds a prepared draft outside a scripted fallback', async () => {
    const { readFileSync } = await import('node:fs');
    const engines = readFileSync(new URL('../../src/canvas/engines.ts', import.meta.url), 'utf8');
    expect(engines).not.toMatch(/fallback:\s*scripted/);
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    expect(main).toContain('streamCanvasPlanOrThrow');
    expect(main).not.toContain("'cloud unavailable'");
  });

  it('under ?sim=1 the scripted engine still works and is labelled SIM', async () => {
    const lines: string[] = [];
    const plan = await runSurfaceTurn(req, scriptedEngine('nano', NANO_SCRIPT, { delayMs: 0 }), { onSent: (s) => lines.push(s.routeLine) });
    expect(plan?.tiles).toHaveLength(2);
    expect(lines[0]).toMatch(/^SIM · /);
  });
});

describe('I3: bytes are booked when a call really leaves', () => {
  const RUN1 = 'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/models/m:streamGenerateContent?alt=sse: AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.';
  const ok = (text: string): TextGenModel => ({ generateContent: async () => ({ response: { text: () => text } }) });

  it('a call counts once its request is out: when it resolves, or when its stream starts', async () => {
    let sends = 0;
    await countingSends(ok('{}'), () => { sends++; }).generateContent('p');
    expect(sends).toBe(1);
    const streamed: TextGenModel = {
      generateContent: async () => ({ response: { text: () => '' } }),
      generateContentStream: async () => ({ stream: (async function* () { yield { text: () => 'a' }; yield { text: () => 'b' }; })(), response: Promise.resolve({ text: () => 'ab' }) }),
    };
    sends = 0;
    const started = await countingSends(streamed, () => { sends++; }).generateContentStream!('p');
    for await (const chunk of started.stream) void chunk;
    await started.response;
    expect(sends).toBe(1); // a started stream, two chunks and a final response are still one send
  });

  it('F2: only a failure before the fetch is not a send — every error after it counts', async () => {
    const failing = (msg: string): TextGenModel => ({ generateContent: async () => { throw new Error(msg); } });
    const ENDPOINT_403 = 'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/models/m:streamGenerateContent?alt=sse: [403 ] Firebase App Check token is invalid. (AI/fetch-error)';
    for (const [msg, expected] of [
      [RUN1, 0],                                                   // no App Check token: the SDK never fetched
      ['AppCheck: Fetch failed to connect to a network. (appCheck/fetch-network-error).', 0],
      [ENDPOINT_403, 1],                                           // the Gemini endpoint itself refused: it got the request
      ['Failed to fetch', 1],                                      // the request was issued; the network dropped it
      ['429 RESOURCE_EXHAUSTED', 1], ['503 Service Unavailable', 1], ['400 Bad Request', 1], ['canvas plan timed out after 20000 ms', 1],
    ] as const) {
      let sends = 0;
      await countingSends(failing(msg), () => { sends++; }).generateContent('p').catch(() => undefined);
      expect(sends, msg).toBe(expected);
    }
    // and the words match: a 403 from the endpoint never says "Nothing was sent"
    expect(geminiFailLine(new Error(ENDPOINT_403))).toBe('Gemini refused the request (403)');
    expect(geminiFailLine(new Error(RUN1))).toBe('Gemini blocked: App Check 403 (this address isn’t registered). Nothing was sent.');
    expect(geminiFailLine(new Error('Failed to fetch'))).toBe('Gemini couldn’t be reached: no connection');
    expect(explainCloudFailure(new Error(ENDPOINT_403))).toMatchObject({ kind: 'forbidden', nothingSent: false });
  });

  it('F2: a call still waiting counts as sent (a timeout, a cancelled hedge); a late pre-fetch failure takes it back', async () => {
    vi.useFakeTimers();
    let sends = 0, retracts = 0;
    let fail!: (e: Error) => void;
    const hanging: TextGenModel = { generateContent: () => new Promise((_, reject) => { fail = reject; }) };
    const call = countingSends(hanging, () => { sends++; }, () => { retracts++; }, 2500).generateContent('p').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2400);
    expect(sends).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(sends).toBe(1); // nothing came back, no token failure: its request is out
    fail(new Error(RUN1)); // …but then App Check says the token was refused after all
    await call;
    expect(retracts).toBe(1);
    // a call that times out or errors after the request went out is never taken back
    sends = 0; retracts = 0;
    const call2 = countingSends(hanging, () => { sends++; }, () => { retracts++; }, 2500).generateContent('p').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(3000);
    fail(new Error('503 Service Unavailable'));
    await call2;
    expect({ sends, retracts }).toEqual({ sends: 1, retracts: 0 });
  });

  it('App Check 403 through the cloud seam: the line says nothing was sent, and nothing is counted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setModelsForTest({ enabled: true, appCheck: 'ready', canvasCloud: { generateContent: async () => { throw new Error(RUN1); } } });
    let sends = 0;
    const err = await streamCanvasPlanOrThrow('build a board', undefined, 'board', { onSend: () => { sends++; } }).catch((e: unknown) => e);
    expect(geminiFailLine(err)).toBe('Gemini blocked: App Check 403 (this address isn’t registered). Nothing was sent.');
    expect(sends).toBe(0);
    warn.mockRestore();
  });

  it('not set up and App Check failing to start also say nothing was sent', async () => {
    setModelsForTest({ enabled: false });
    expect(geminiFailLine(await streamCanvasPlanOrThrow('p').catch((e: unknown) => e))).toBe('Gemini isn’t set up in this build (no Firebase config). Nothing was sent.');
    setModelsForTest({ enabled: true, appCheck: 'failed' });
    expect(geminiFailLine(await streamCanvasPlanOrThrow('p').catch((e: unknown) => e))).toMatch(/App Check.*Nothing was sent\.$/);
    // a failure after the request left makes no such claim
    expect(geminiFailLine(new Error('429 RESOURCE_EXHAUSTED'))).toBe('Gemini couldn’t answer: the quota is used up (429)');
  });

  it('a success is one send; a retry after a bad reply is a second send', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let sends = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', canvasCloud: ok(GEMINI_OK) });
    await streamCanvasPlanOrThrow('p', undefined, 'board', { onSend: () => { sends++; } });
    expect(sends).toBe(1);
    const replies = ['sorry, no', GEMINI_OK];
    sends = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', canvasCloud: { generateContent: async () => ({ response: { text: () => replies.shift()! } }) } });
    await streamCanvasPlanOrThrow('p', undefined, 'board', { onSend: () => { sends++; } });
    expect(sends).toBe(2);
    info.mockRestore(); warn.mockRestore();
  });

  it('the ledger opens a cloud turn at 0 bytes and adds only what left', () => {
    const ledger = createCanvasLedger();
    const entry = ledger.record({ engine: 'gemini' });
    expect(ledger.totals()).toMatchObject({ aiCount: 1, aiBytes: 0 });
    ledger.addBytes(entry, 1200);
    ledger.addBytes(entry, 1200); // the hedge left too
    expect(ledger.totals()).toMatchObject({ aiCount: 1, aiBytes: 2400 });
    const sim = ledger.record({ engine: 'gemini', sentText: 'x', sim: true });
    ledger.addBytes(sim, 500);
    expect(ledger.totals().aiBytes).toBe(2400); // a SIM turn never gains real bytes
  });

  it('two overlapping cloud calls each report their own failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let n = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', canvasCloud: { generateContent: async () => {
      const mine = ++n;
      await tick(mine === 1 ? 15 : 1);
      throw new Error(mine === 1 ? RUN1 : 'Failed to fetch');
    } } });
    const [a, b] = await Promise.all([
      streamCanvasPlanOrThrow('first').catch((e: Error) => e.message),
      streamCanvasPlanOrThrow('second').catch((e: Error) => e.message),
    ]);
    expect(a).toBe(APP_CHECK_403_LINE);
    expect(b).toBe('Gemini couldn’t be reached: no connection');
    warn.mockRestore();
  });

  it('the canvas books on the send, not on the start, and skips the second Gemini pass after a handoff', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    const aiSent = src.slice(src.indexOf('function aiSent('), src.indexOf('function aiFellBack('));
    expect(aiSent).toContain("if (ctx.defer && !s.sim && s.engine === 'gemini' && s.sent) openCloudTurn(");
    expect(src).toContain('onCloudSend: cloudSent,');
    const room = src.slice(src.indexOf('async function connectRoom('), src.indexOf('function floorPlan('));
    expect(room).toMatch(/if \(lastTurnHandedOff\) \{[\s\S]*?return;\s*\}\s*panels\.showHandoff/);
    // connect by name / scan run the same turn as a board build
    const connect = src.slice(src.indexOf('async function connectTurn('), src.indexOf('// ---- point-to-connect'));
    expect(connect).toContain('runSurfaceTurn({ ...turn.request, frameId }, engine,');
    expect(connect).toContain('offerRetry(() => { void connectTurn(');
  });
});

describe('minors: stale streams stay silent; a busy Nano is said out loud', () => {
  it('after a timeout retry, the first attempt’s late chunks draw nothing', async () => {
    const firstCalls: Array<(full: string) => void> = [];
    let call = 0;
    const gemini: SurfaceEngine = { id: 'gemini', sim: false, stream: (_p, onText) => {
      if (++call === 1) { firstCalls.push(onText); return never<string>(); }
      onText(GEMINI_OK);
      return Promise.resolve(GEMINI_OK);
    } };
    let wakes = 0;
    const texts: string[] = [];
    const ghosts: number[] = [];
    // the first attempt times out at once; the retry's timer never fires
    const plan = runSurfaceTurn(req, gemini, { onText: (t) => texts.push(t), onGhost: (g) => ghosts.push(g.tiles.length) }, { deviceIdSession: createDeviceIdSession(), sleep: () => (++wakes === 1 ? Promise.resolve() : never<void>()) });
    expect((await plan)?.title).toBe('Living room');
    const before = { texts: texts.length, ghosts: ghosts.length };
    firstCalls[0]('{"kind":"room","title":"STALE","tiles":[{"type":"connect","label":"x"},{"type":"plan","boardId":"a","template":"studio"},{"type":"connect"}]}');
    expect({ texts: texts.length, ghosts: ghosts.length }).toEqual(before);
    expect(texts.join('')).not.toContain('STALE');
  });

  it('an on-device job that goes to its cloud twin because Nano is busy tells its listeners', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const heard: string[] = [];
    const off = onNanoBusyHandoff((label) => heard.push(label));
    const { compileCommand } = await import('../../src/ai/hybrid');
    const busy: TextGenModel = { generateContent: async () => { throw new NanoQueueSkipped('the on-device model was busy'); } };
    const cloud: TextGenModel = { generateContent: async () => ({ response: { text: () => '{}' } }) };
    setModelsForTest({ enabled: true, appCheck: 'ready', deviceModel: 'ready', intent: busy, intentCloud: cloud });
    await compileCommand('make the kitchen bigger', { planNames: [] } as never).catch(() => undefined);
    off();
    expect(heard.length).toBeGreaterThan(0);
    warn.mockRestore();
  });
});

describe('round 2: the next-step pick keeps away from a turn; ?nanoTrace=1', () => {
  it('the pick is skipped during a turn, its review, any model stream, and for 10 s after a turn', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    const ready = src.slice(src.indexOf('idle: { delayMs: NANO_PICK_IDLE_MS, ready: () =>'), src.indexOf('idle: { delayMs: NANO_PICK_IDLE_MS, ready: () =>') + 320);
    for (const gate of ['!turnBusy', '!reviewBusy()', 'streamsOut === 0', 'Date.now() - lastTurnEndedAt >= NEXT_PICK_COOLDOWN_MS', 'nanoQueue.idle()']) expect(ready).toContain(gate);
    expect(src).toContain('const NEXT_PICK_COOLDOWN_MS = 10_000;');
    expect(src.match(/lastTurnEndedAt = Date\.now\(\)/g)!.length).toBeGreaterThanOrEqual(2);
  });

  /** A fake LanguageModel whose stream is driven by the test. */
  function steppedLm(clock: { t: number }, createMs = 2600) {
    const ctl: { push: (text: string) => void; end: () => void; fail: (e: Error) => void } = { push: () => undefined, end: () => undefined, fail: () => undefined };
    const lm = {
      async create(_options?: unknown) {
        clock.t += createMs;
        return {
          destroy() { /* a real session would stop here; the fake keeps going unless the test ends it */ },
          promptStreaming(_input: unknown, _options?: unknown) {
            return new ReadableStream<string>({ start(c) { ctl.push = (text) => c.enqueue(text); ctl.end = () => c.close(); ctl.fail = (e) => c.error(e); } });
          },
        };
      },
    };
    return { lm, ctl };
  }
  const drain = async (stream: unknown, into: string[] = []): Promise<string[]> => {
    const reader = (stream as ReadableStream<string>).getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; into.push(value); } } catch { /* an aborted stream errors */ }
    return into;
  };

  it('?nanoTrace=1 logs create and prompt timings and sizes — never content', async () => {
    const lines: string[] = [];
    const clock = { t: 0 };
    const SECRET_PROMPT = 'She said: "floor plan for Mrs Sharma"';
    const SECRET_REPLY = '{"t":"Sharma flat","d":["wiz-desk"]}';
    const { lm, ctl } = steppedLm(clock);
    expect(installNanoTrace(lm, { log: (l) => lines.push(l), now: () => clock.t })).toBe(true);
    expect(installNanoTrace(lm, { log: (l) => lines.push(l), now: () => clock.t })).toBe(false); // once
    const session = await lm.create({ initialPrompts: [{ role: 'system', content: [{ type: 'text', value: 'x'.repeat(318) }] }] });
    const stream = session.promptStreaming([{ role: 'user', content: [{ type: 'text', value: SECRET_PROMPT }] }], { responseConstraint: { type: 'object' } });
    const got: string[] = [];
    const reading = drain(stream, got);
    clock.t += 900; ctl.push(SECRET_REPLY.slice(0, 10)); await tick();
    clock.t += 800; ctl.push(SECRET_REPLY.slice(10)); ctl.end();
    await reading;
    expect(got.join('')).toBe(SECRET_REPLY); // the trace does not change what flows through
    const all = lines.join('\n');
    expect(all).toContain('[nano-trace] create #1: 2600 ms (initialPrompts 318 chars)');
    expect(all).toContain(`prompt #1 (session #1): input ${SECRET_PROMPT.length} chars, constraint 17 chars — first chunk 900 ms, done in 1700 ms, output ${SECRET_REPLY.length} chars`);
    expect(all).not.toMatch(/Sharma|wiz-desk|floor plan/);
  });

  it('F6: the trace says whether a create-signal abort really stopped generation', async () => {
    // (a) Chrome stops: the stream errors 40 ms after the abort, nothing more arrives
    let lines: string[] = [];
    let clock = { t: 0 };
    let { lm, ctl } = steppedLm(clock);
    installNanoTrace(lm, { log: (l) => lines.push(l), now: () => clock.t });
    let abort = new AbortController();
    let session = await lm.create({ signal: abort.signal });
    let reading = drain(session.promptStreaming('p'));
    ctl.push('0123456789'); await tick();
    clock.t += 5000; abort.abort();
    clock.t += 40; ctl.fail(new Error('AbortError'));
    await reading;
    let all = lines.join('\n');
    expect(all).toContain('session #1: create-signal abort while prompt #1 was streaming (10 chars so far)');
    expect(all).toContain('session #1: after create-signal abort, prompt #1 ended 40 ms later with 0 more chars (0 chunks) — generation stopped');

    // (b) Chrome does NOT stop: text keeps arriving, and 5 s later it is still going
    resetNanoTrace();
    vi.useFakeTimers();
    lines = []; clock = { t: 0 };
    ({ lm, ctl } = steppedLm(clock));
    installNanoTrace(lm, { log: (l) => lines.push(l), now: () => clock.t, stillRunningMs: 5000 });
    abort = new AbortController();
    session = await lm.create({ signal: abort.signal });
    reading = drain(session.promptStreaming('p'));
    ctl.push('0123456789'); await vi.advanceTimersByTimeAsync(1);
    abort.abort();
    ctl.push('more text after the abort'); await vi.advanceTimersByTimeAsync(1);
    clock.t += 5000; await vi.advanceTimersByTimeAsync(5000);
    all = lines.join('\n');
    expect(all).toContain('session #1: create-signal abort did NOT stop prompt #1 — still generating 5 s later (25 more chars, 1 chunks since)');
    clock.t += 2400; ctl.end(); await vi.advanceTimersByTimeAsync(1);
    await reading;
    expect(lines.join('\n')).toContain('session #1: after create-signal abort, prompt #1 ended 7400 ms later with 25 more chars (1 chunks) — it kept generating until then');
    expect(lines.join('\n')).not.toMatch(/more text|0123456789/);
  });

  it('F6: a destroy() is traced the same way', async () => {
    const lines: string[] = [];
    const clock = { t: 0 };
    const { lm, ctl } = steppedLm(clock);
    installNanoTrace(lm, { log: (l) => lines.push(l), now: () => clock.t });
    const session = await lm.create({});
    const reading = drain(session.promptStreaming('p'));
    ctl.push('abc'); await tick();
    session.destroy();
    clock.t += 15; ctl.fail(new Error('destroyed'));
    await reading;
    expect(lines.join('\n')).toContain('session #1: after destroy(), prompt #1 ended 15 ms later with 0 more chars (0 chunks) — generation stopped');
  });

  it('the trace is off (and LanguageModel untouched) unless the flag asked for it', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    expect(main).toContain("if (params.get('nanoTrace') === '1' && languageModel) installNanoTrace(languageModel);");
    expect(main.match(/installNanoTrace\(/g)).toHaveLength(1);
  });
});

describe('live fix: what Chrome’s Prompt API accepts', () => {
  it('no on-device responseConstraint uses a keyword Chrome rejects (uniqueItems, pattern, format, $ref)', async () => {
    expect([...UNSUPPORTED_CONSTRAINT_KEYWORDS]).toEqual(['uniqueItems', 'pattern', 'format', '$ref']);
    const { PLAN_OP_CONSTRAINT, PLAN_VERIFY_CONSTRAINT } = await import('../../src/plan/ai');
    const { buildFusionConstraint } = await import('../../src/ai/intentFusion');
    const { DEIXIS_CONSTRAINT } = await import('../../src/ai/deixis');
    const { CONDENSE_CONSTRAINT } = await import('../../src/ai/condense');
    const { PROFILE_CONSTRAINT } = await import('../../src/input/handProfile');
    const { CAD_TOOL_CONSTRAINT } = await import('../../src/cad/tools');
    const { IDENTIFY_CONSTRAINT, EFFECT_CONSTRAINT } = await import('../../src/devices/identify');
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `lamp-${i}`, label: `Lamp ${i}`, kind: 'lamp' }));
    // every schema hybrid.ts hands to an ONLY_ON_DEVICE / PREFER_ON_DEVICE model
    const onDevice: Record<string, unknown> = {
      'board (room)': nanoPlanConstraint(req.devices),
      'board (room, many devices)': nanoPlanConstraint(many),
      'board (room, no devices)': nanoPlanConstraint([]),
      'board (floor plan)': nanoPlanConstraint(req.devices, true),
      'board as built for a turn': buildNanoPlanRequest(req).constraint,
      'warm-up': WARM_CONSTRAINT,
      'next steps': NEXT_STEPS_CONSTRAINT,
      intent: PLAN_OP_CONSTRAINT,
      verify: PLAN_VERIFY_CONSTRAINT,
      fusion: buildFusionConstraint(PLAN_OP_CONSTRAINT),
      deixis: DEIXIS_CONSTRAINT,
      condense: CONDENSE_CONSTRAINT,
      'hand profile': PROFILE_CONSTRAINT,
      'cad tool': CAD_TOOL_CONSTRAINT,
      identify: IDENTIFY_CONSTRAINT,
      effect: EFFECT_CONSTRAINT,
    };
    for (const [name, schema] of Object.entries(onDevice)) expect(unsupportedConstraintKeywords(schema), name).toEqual([]);
    // and hybrid.ts passes no other schema to an on-device model
    const { readFileSync } = await import('node:fs');
    const hybrid = readFileSync(new URL('../../src/ai/hybrid.ts', import.meta.url), 'utf8');
    const used = new Set([...hybrid.matchAll(/responseConstraint: ([A-Za-z_.]+)/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(['CAD_TOOL_CONSTRAINT', 'CONDENSE_CONSTRAINT', 'DEIXIS_CONSTRAINT', 'EFFECT_CONSTRAINT', 'IDENTIFY_CONSTRAINT', 'NEXT_STEPS_CONSTRAINT', 'PROFILE_CONSTRAINT', 'WARM_CONSTRAINT', 'fusionConstraint', 'modeAi.opConstraint', 'modeAi.verifyConstraint', 'req.constraint'].sort());
  });

  it('the checker finds a keyword at any depth, but not a field that merely has that name', () => {
    expect(unsupportedConstraintKeywords({ type: 'array', uniqueItems: true })).toEqual(['$.uniqueItems']);
    expect(unsupportedConstraintKeywords({ type: 'object', properties: { d: { type: 'array', items: { type: 'string', pattern: '^a' } } } })).toEqual(['$.properties.d.items.pattern']);
    expect(unsupportedConstraintKeywords({ anyOf: [{ $ref: '#/x' }, { type: 'string', format: 'date' }] })).toEqual(['$.anyOf[0].$ref', '$.anyOf[1].format']);
    expect(unsupportedConstraintKeywords({ type: 'object', properties: { format: { type: 'string' }, pattern: { type: 'string' } } })).toEqual([]);
  });

  it('a repeated device id is dropped locally (the schema can no longer forbid it)', () => {
    expect(parseNanoPlan('{"t":"Room","d":["speaker-1","speaker-1","wiz-ceiling","speaker-1"]}', req)).toMatchObject({ ok: true, value: { tiles: [{ deviceId: 'speaker-1' }, { deviceId: 'wiz-ceiling' }] } });
    expect(partialNanoPlan('{"t":"Room","d":["speaker-1","speaker-1"', req).tiles).toHaveLength(1);
  });

  it('Chrome’s NotSupportedError reads “Nano couldn’t run this request”, never its raw text', async () => {
    const refused = Object.assign(new Error('The request is invalid - the input or options could not be processed.'), { name: 'NotSupportedError' });
    const errors: string[] = [];
    const handoffs: string[] = [];
    const cloud: SurfaceEngine = { id: 'gemini', sim: false, stream: async (_p, onText) => { onText(GEMINI_OK); return GEMINI_OK; } };
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { throw refused; }, handoff: cloud };
    const plan = await runSurfaceTurn(req, nano, { onHandoff: (s) => handoffs.push(s.routeLine), onError: (w) => errors.push(w) }, { deviceIdSession: createDeviceIdSession() });
    expect(plan?.title).toBe('Living room');
    expect(handoffs).toEqual(['Gemini · cloud — Nano couldn’t run this request, so Gemini made this']);
    // with Gemini failing too, and with no Gemini at all
    const down: SurfaceEngine = { id: 'gemini', sim: false, stream: async () => { throw new Error('503 Service Unavailable'); } };
    await runSurfaceTurn(req, { ...nano, handoff: down }, { onError: (w) => errors.push(w) }, { sleep: () => never<void>() });
    await runSurfaceTurn(req, { ...nano, handoff: undefined }, { onError: (w) => errors.push(w) });
    // the SDK may wrap it: the name survives only in the message
    await runSurfaceTurn(req, { ...nano, handoff: undefined, stream: async () => { throw new Error('AI: NotSupportedError: The request is invalid'); } }, { onError: (w) => errors.push(w) });
    expect(errors).toEqual([
      'Nano couldn’t run this request. Gemini couldn’t answer: the service is busy (5xx)',
      'Nano couldn’t run this request. Gemini isn’t available here to take over.',
      'Nano couldn’t run this request. Gemini isn’t available here to take over.',
    ]);
    expect(errors.join(' ') + handoffs.join(' ')).not.toMatch(/request is invalid|could not be processed|NotSupportedError/);
  });

  it('a warm-up still creating its session steps aside; once its session exists it is left to finish', async () => {
    // (a) past create: the SDK has its session, only a tiny reply is left
    let finishWarm!: () => void;
    let aborted = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: (params) => {
      (params.createOptions.signal as AbortSignal).addEventListener('abort', () => { aborted++; });
      const model = { chromeAdapter: { oldSession: {} as unknown }, generateContent: () => new Promise<{ response: { text: () => string } }>((r) => { finishWarm = () => { order.push('warm replied'); r({ response: { text: () => '{"ok":true}' } }); }; }) };
      return model as unknown as TextGenModel;
    } });
    const q = createNanoQueue(1);
    const order: string[] = [];
    const warm = warmBoardOnDevice(q);
    await tick(2);
    const turn = q.run(async () => { order.push('turn starts'); return 'plan'; }, { priority: 10 });
    await tick(5);
    expect(order).toEqual([]); // the turn waits; the warm-up was not thrown away
    expect(aborted).toBe(0);
    finishWarm();
    expect(await warm).toBe(true);
    expect(await turn).toBe('plan');
    expect(order).toEqual(['warm replied', 'turn starts']);

    // (b) still in create(): no session yet, so it steps aside at once
    setModelsForTest(null);
    aborted = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: (params) => {
      (params.createOptions.signal as AbortSignal).addEventListener('abort', () => { aborted++; });
      return { chromeAdapter: {}, generateContent: () => never() } as unknown as TextGenModel;
    } });
    const q2 = createNanoQueue(1);
    const warm2 = warmBoardOnDevice(q2);
    await tick(2);
    expect(await q2.run(async () => 'plan', { priority: 10 })).toBe('plan');
    expect(await warm2).toBe(false);
    expect(aborted).toBe(1);
  });

  it('the warm-up starts soon after load, with a deadline rather than "whenever idle"', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    expect(main).toContain('afterFirstPaint(() => { if (ric) ric(warm, { timeout: 1200 }); else setTimeout(warm, 600); });');
    expect(main).toContain('if (await refreshNanoAvailable()) await warmBoardOnDevice();');
  });
});

describe('re-review fixes', () => {
  it('F1: a prepared receipt for one engine is rebuilt when the other engine really runs the step', async () => {
    // a by-name connect on a machine without Nano: the "nano" step is Gemini
    const prepared: SentInfo = { engine: 'nano', prompt: 'p', sent: null, routeLine: 'Nano · on device — nothing left this device', sim: false };
    const gemini: SurfaceEngine = { id: 'gemini', sim: false, routeLine: NO_NANO_NOTE, stream: async (_p, onText, so) => { so?.onCloudSend?.(); onText(GEMINI_OK); return GEMINI_OK; } };
    const opened: SentInfo[] = [];
    const sends: SentInfo[] = [];
    const plan = await runSurfaceTurn(req, gemini, { onSent: (s) => opened.push(s), onCloudSend: (s) => sends.push(s) }, { sent: prepared, deviceIdSession: createDeviceIdSession() });
    expect(plan?.title).toBe('Living room');
    expect(opened).toHaveLength(1);
    expect(opened[0]).not.toBe(prepared);
    expect(opened[0].engine).toBe('gemini');
    expect(opened[0].sent).toMatch(/your words/); // it says what left
    expect(opened[0].routeLine).toBe(NO_NANO_NOTE);
    expect(opened[0].routeLine).not.toMatch(/nothing left/);
    expect(sends).toEqual([opened[0]]);
    // a receipt written for the engine that runs is used as it is
    const mine: SentInfo = { engine: 'gemini', prompt: 'custom prompt', sent: 'the name you said', routeLine: 'Gemini · cloud — the name you said', sim: false };
    const seen: string[] = [];
    await runSurfaceTurn(req, { ...gemini, stream: async (prompt) => { seen.push(prompt); return GEMINI_OK; } }, { onSent: (s) => opened.push(s) }, { sent: mine, deviceIdSession: createDeviceIdSession() });
    expect(opened.at(-1)).toBe(mine);
    expect(seen).toEqual(['custom prompt']);
  });

  it('F3/F4: a next-step pick and a warm-up that run out of time stop their own sessions', async () => {
    const { readFileSync } = await import('node:fs');
    const hybrid = readFileSync(new URL('../../src/ai/hybrid.ts', import.meta.url), 'utf8');
    const pick = hybrid.slice(hybrid.indexOf('export async function pickNextStepsOnDevice('), hybrid.indexOf('// ADD A DEVICE'));
    expect(pick).toContain('own = onDeviceModelFor({'); // a per-call model, not the shared one
    expect(pick).toMatch(/createOptions: \{ \.\.\.ON_DEVICE_CREATE_OPTIONS, \.\.\.\(session \? \{ signal: session\.signal \}/);
    expect(pick).toMatch(/finally \{[\s\S]*session\?\.abort\(\); destroySdkSession\(own\);/);
    expect(pick).toContain('{ maxWaitMs: 0 }');
    // the warm-up, behaviourally: a model that never answers is aborted at its timeout
    vi.useFakeTimers();
    let aborted = 0;
    setModelsForTest({ enabled: true, appCheck: 'ready', onDeviceModel: (params) => {
      (params.createOptions.signal as AbortSignal).addEventListener('abort', () => { aborted++; });
      return { generateContent: () => never() };
    } });
    const q = createNanoQueue(1);
    const warm = warmBoardOnDevice(q);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await warm).toBe(false);
    expect(aborted).toBe(1);
    expect(q.idle()).toBe(true);
  });

  it('F5: Nano is chosen for a turn only while Chrome reports it available', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    expect(main).toContain("nanoAvailable = (await lm.availability(NANO_CREATE_OPTIONS)) === 'available';");
    expect(main).toContain('get nanoStream() { return nanoAvailable ? nanoStream : null; },');
    // and what that getter means to the engines: not available → the step is Gemini's, and says so
    let available = false;
    const rt = { languageModel: LM, cloud: async () => GEMINI_OK, get nanoStream() { return available ? nanoVia() : null; } };
    const engines = createEngines(rt);
    expect(engines.nano!('{}')).toMatchObject({ id: 'gemini', routeLine: NO_NANO_NOTE });
    available = true; // the download finished: the very next turn is Nano's
    expect(engines.nano!('{}').id).toBe('nano');
  });
});

describe('C: App Check 403 is named plainly', () => {
  const RUN1 = 'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/mendcraft/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse: AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.';

  it('the exact console error from the live run becomes one plain line + what to do', () => {
    const f = explainCloudFailure(new Error(RUN1));
    expect(f.kind).toBe('app-check-403');
    expect(f.line).toBe('Gemini blocked: App Check 403 (this address isn’t registered)');
    expect(f.hint).toMatch(/Manage debug tokens/);
    expect(f.line).not.toMatch(/https?:/);
  });

  it('other failures get their own words', () => {
    expect(explainCloudFailure(new Error('Failed to fetch')).line).toBe('Gemini couldn’t be reached: no connection');
    expect(explainCloudFailure('canvas plan: 429: RESOURCE_EXHAUSTED').kind).toBe('quota');
    expect(explainCloudFailure('canvas plan timed out after 20000 ms').kind).toBe('timeout');
    expect(explainCloudFailure(new Error('something odd')).line).toBe('Gemini couldn’t be reached: something odd');
  });

  it('when the SDK error is vague, App Check itself is asked', async () => {
    const e = await cloudCallError('canvas plan: other: request failed', async () => new Error('Fetch server returned an HTTP error status. HTTP status: 403.'));
    expect(e).toBeInstanceOf(CloudCallError);
    expect(e.kind).toBe('app-check-403');
    expect(e.message).toBe(APP_CHECK_403_LINE);
    const fine = await cloudCallError('canvas plan: other: request failed', async () => null);
    expect(fine.kind).toBe('unknown');
  });

  it('the cloud seam throws that line instead of returning nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const blocked: TextGenModel = { generateContent: async () => { throw new Error(RUN1); } } as unknown as TextGenModel;
    setModelsForTest({ enabled: true, appCheck: 'ready', canvasCloud: blocked });
    await expect(streamCanvasPlanOrThrow('build a board')).rejects.toMatchObject({ name: 'CloudCallError', kind: 'app-check-403', message: APP_CHECK_403_LINE });
    warn.mockRestore();
  });

  it('one stable debug token: process env, then .env files, then the secrets file; never a non-UUID', () => {
    const T1 = '11111111-2222-4333-8444-555555555555';
    const T2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const files: Record<string, string> = { '/home/.secrets/mendcraft-appcheck-debug': `${T2}\n` };
    const readFile = (p: string): string => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };
    const paths = ['/home/.secrets/mendcraft-appcheck-debug'];
    expect(resolveAppCheckDebugToken({ envs: [{ APPCHECK_DEBUG_TOKEN: T1 }, {}], files: paths, readFile })).toMatchObject({ token: T1, source: 'APPCHECK_DEBUG_TOKEN' });
    expect(resolveAppCheckDebugToken({ envs: [{}, { VITE_APPCHECK_DEBUG_TOKEN: T1 }], files: paths, readFile })).toMatchObject({ token: T1, source: 'VITE_APPCHECK_DEBUG_TOKEN' });
    expect(resolveAppCheckDebugToken({ envs: [{}, {}], files: paths, readFile })).toMatchObject({ token: T2, source: paths[0] });
    const bad = resolveAppCheckDebugToken({ envs: [{ APPCHECK_DEBUG_TOKEN: 'true' }], files: ['/nope'], readFile });
    expect(bad.token).toBeNull();
    expect(bad.rejected).toEqual(['APPCHECK_DEBUG_TOKEN']);
  });

  it('the dev page uses the stable env token rather than a per-origin generated one', async () => {
    const { applyAppCheckDebugToken, appCheckDebugKind } = await import('../../src/firebase/appCheck');
    const g = globalThis as Record<string, unknown>;
    const target = (g.self as Record<string, unknown> | undefined) ?? g;
    delete target.FIREBASE_APPCHECK_DEBUG_TOKEN;
    const T = '11111111-2222-4333-8444-555555555555';
    expect(applyAppCheckDebugToken({ dev: true, envToken: T })).toBe(true);
    expect(target.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(T);
    expect(appCheckDebugKind()).toBe('stable');
    delete target.FIREBASE_APPCHECK_DEBUG_TOKEN;
    // production never takes it, with or without the env value
    expect(applyAppCheckDebugToken({ dev: false, hostname: 'mendcraft.web.app', search: '', envToken: T })).toBe(false);
    expect(target.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });
});

describe('cloud replies that are not boards (language pack, one tile, a short answer)', () => {
  it('accepts each shape for what it is', () => {
    expect(acceptCanvasReply({ lang: 'kn', strings: { save: 'ಉಳಿಸಿ' } }, 'board')).toBeNull();
    expect(acceptCanvasReply({ lang: 'kn', strings: { save: 'ಉಳಿಸಿ' } }, 'json')).toEqual({ lang: 'kn', strings: { save: 'ಉಳಿಸಿ' } });
    expect(acceptCanvasReply({}, 'json')).toBeNull();
    expect(acceptCanvasReply({ reply: ' Hello there. ' }, 'text')).toBe('Hello there.');
    expect(acceptCanvasReply('Hello', 'text')).toBe('Hello');
    expect(acceptCanvasReply({ kind: 'room', tiles: [] }, 'board')).not.toBeNull();
  });

  it('a live language-pack reply comes back through the cloud seam instead of failing as “not a board”', async () => {
    const pack = '{"lang":"kn","strings":{"save":"ಉಳಿಸಿ"}}';
    const model = { generateContent: async () => ({ response: { text: () => pack } }) } as unknown as TextGenModel;
    setModelsForTest({ enabled: true, appCheck: 'ready', canvasCloud: model });
    expect(JSON.parse(await streamCanvasPlanOrThrow('make a Kannada pack', undefined, 'json'))).toEqual(JSON.parse(pack));
  });
});

describe('D: titles and counts come from the plan', () => {
  const lightAndSpeaker: SurfacePlan = { kind: 'room', title: 'This room', tiles: [{ type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling Light' }, { type: 'music', deviceId: 'speaker-1', label: 'Speaker' }] };

  it('the draft title counts the tiles that exist (the live run said “2 lamps” over one light and a speaker)', () => {
    expect(draftSummary(lightAndSpeaker)).toBe('Draft: 1 lamp and 1 speaker found in this room');
    expect(draftSummary({ kind: 'room', title: 'r', tiles: [{ type: 'lamp', deviceId: 'a', label: 'A' }, { type: 'lamp', deviceId: 'b', label: 'B' }] })).toBe('Draft: 2 lamps found in this room');
    expect(draftSummary({ kind: 'room', title: 'r', tiles: [{ type: 'connect', label: 'Connect a device' }] })).toBe('Draft: no devices found yet — a Connect tile is ready');
  });

  it('never says “lamps” unless lamp tiles exist, and the number is theirs', () => {
    for (const plan of [lightAndSpeaker, { kind: 'room', title: 'r', tiles: [{ type: 'music', deviceId: 's', label: 'S' }] } as SurfacePlan]) {
      const m = /(\d+) lamps?/.exec(draftSummary(plan));
      const lamps = plan.tiles.filter((t) => t.type === 'lamp').length;
      if (lamps) expect(Number(m?.[1])).toBe(lamps); else expect(m).toBeNull();
    }
  });

  it('“grouped” and “a room plan” are only said when the plan has them', () => {
    expect(betterSummary(lightAndSpeaker)).toBe('Better: 1 lamp and 1 speaker');
    const grouped: SurfacePlan = { kind: 'room', title: 'r', tiles: [
      { type: 'card', title: 'Lights', children: [{ type: 'lamp', deviceId: 'a', label: 'A' }, { type: 'lamp', deviceId: 'b', label: 'B' }] },
      { type: 'plan', boardId: 'room-plan', template: 'oneRoom' },
      { type: 'connect', label: 'Connect a device' },
    ] };
    expect(betterSummary(grouped)).toBe('Better: 2 lamps, grouped + a room plan');
  });

  it('the floor-plan title names the template that was really drawn', () => {
    expect(floorPlanSummary({ kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'b3-cad', template: 'twoBedroom' }] })).toBe('Floor plan: two bedrooms');
    expect(floorPlanSummary({ kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'b3-cad', template: 'studio' }] })).toBe('Floor plan: a studio');
  });

  it('“tiles filled” counts every tile she will see, through the groups', () => {
    expect(tilesFilledLine(lightAndSpeaker)).toBe('2 tiles filled');
    const nested: SurfacePlan = { kind: 'room', title: 'r', tiles: [
      { type: 'row', children: [{ type: 'stat', label: 'Power', value: '120 W' }, { type: 'stat', label: 'Today', value: '2 kWh' }] },
      { type: 'card', title: 'Lights', children: [{ type: 'lamp', deviceId: 'a', label: 'A' }, { type: 'lamp', deviceId: 'b', label: 'B' }] },
      { type: 'tabs', tabs: [{ label: 'One', children: [{ type: 'music', deviceId: 's', label: 'S' }] }] },
      { type: 'connect', label: 'Connect a device' },
    ] };
    expect(tilesFilledLine(nested)).toBe('6 tiles filled in 4 groups');
    expect(tilesFilledLine({ kind: 'room', title: 'r', tiles: [{ type: 'connect' }] })).toBe('1 tile filled');
  });

  it('a made-up status tile and a Connect button that reads as a status are removed', () => {
    const plan: SurfacePlan = { kind: 'room', title: 'r', tiles: [
      { type: 'row', children: [{ type: 'stat', label: 'Device Status', value: 'Connected', delta: '0' }, { type: 'stat', label: 'Power', value: '120 W' }] },
      { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling Light' },
      { type: 'connect', label: 'All Connected' },
    ] };
    const out = dropUnbackedClaims(plan);
    expect(JSON.stringify(out.plan)).not.toMatch(/Device Status|All Connected/);
    expect(out.plan.tiles).toEqual([
      { type: 'row', children: [{ type: 'stat', label: 'Power', value: '120 W' }] },
      { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling Light' },
      { type: 'connect', label: 'Connect a device' },
    ]);
    expect(out.notes).toHaveLength(2);
    // an honest plan is returned untouched
    expect(dropUnbackedClaims(lightAndSpeaker).plan).toBe(lightAndSpeaker);
  });

  it('I2: every made-up status shape is caught, and real readings are left alone', () => {
    for (const [label, value] of [
      ['Desk Lamp Status', 'on'], ['Lamp Status', 'On'], ['Speaker Status', 'playing'], ['Devices', '3'],
      ['Device Status', 'Connected'], ['Status', 'OK'], ['Desk lamp', 'On'], ['Speaker', 'Paused'], ['Devices found', '2'],
      ['Room', '3 devices'], ['Network', 'Online'], ['Lamp', 'off'],
    ]) expect(isStatusClaim(label, value), `${label} / ${value}`).toBe(true);
    for (const [label, value] of [
      ['Power', '120 W'], ['Today', '2 kWh'], ['Brightness', '70%'], ['Temperature', '21°C'], ['Monthly cost', '£14'], ['Volume', '40'], ['Standby power', '3 W'],
    ]) expect(isStatusClaim(label, value), `${label} / ${value}`).toBe(false);
    const plan: SurfacePlan = { kind: 'room', title: 'r', tiles: [
      { type: 'stat', label: 'Desk Lamp Status', value: 'on' },
      { type: 'stat', label: 'Lamp Status', value: 'On' },
      { type: 'card', title: 'Now', children: [{ type: 'stat', label: 'Speaker Status', value: 'playing' }, { type: 'stat', label: 'Devices', value: '3' }] },
      { type: 'stat', label: 'Power', value: '120 W' },
      { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling Light' },
    ] };
    const out = dropUnbackedClaims(plan);
    expect(out.plan.tiles).toEqual([{ type: 'stat', label: 'Power', value: '120 W' }, { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling Light' }]);
    expect(out.notes).toHaveLength(4);
  });

  it('a live Gemini plan is cleaned before she reviews it; the model is told not to invent status', async () => {
    const reply = '{"kind":"room","title":"Room","tiles":[{"type":"stat","label":"Device Status","value":"Connected","delta":"0"},{"type":"lamp","deviceId":"Device 1","label":"Ceiling Light"},{"type":"connect","label":"All Connected"}]}';
    const prompts: string[] = [];
    const gemini: SurfaceEngine = { id: 'gemini', sim: false, stream: async (p) => { prompts.push(p); return reply; } };
    const notes: string[] = [];
    const plan = await runSurfaceTurn(req, gemini, { onNote: (n) => notes.push(n) }, { deviceIdSession: createDeviceIdSession() });
    expect(plan?.tiles).toEqual([{ type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling Light' }, { type: 'connect', label: 'Connect a device' }]);
    expect(notes.join(' ')).toMatch(/made-up status/);
    expect(prompts[0]).toMatch(/Never invent a device, a device count or a connection status/);
  });

  it('the canvas computes its review titles from the plan (no fixed headline left)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/2 lamps found|'Better: grouped lights|'Floor plan: two bedrooms'/);
    expect(src).toMatch(/SCRIPTS\.nanoRoom, draftSummary,/);
    expect(src).toContain('tilesFilledLine(plan)');
  });
});
