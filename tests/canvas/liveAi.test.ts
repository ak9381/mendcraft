// The live AI path (no ?sim=1): one queued on-device prompt per turn, a real
// handoff to Gemini when the on-device model can't finish, an honest error
// when both fail, and words that come from the plan. Engines are fakes — the
// real Chrome check is scripts/live-probe.md.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNanoQueue, NanoQueueSkipped } from '../../src/ai/nanoQueue';
import { APP_CHECK_403_LINE, CloudCallError, cloudCallError, explainCloudFailure } from '../../src/ai/cloudErrors';
import { acceptCanvasReply, queueOnDevice, setModelsForTest, streamCanvasPlanOrThrow, type TextGenModel } from '../../src/ai/hybrid';
import { GHOST_EVERY_MS, runSurfaceTurn, scriptedEngine, type SentInfo, type StreamOptions, type SurfaceEngine, type SurfaceRequest } from '../../src/canvas/aiTurn';
import { createEngines, createNanoRunner, NANO_DEFAULT_TIMEOUT_MS, type PromptApi, type PromptSession } from '../../src/canvas/engines';
import { buildNanoPlanRequest, NANO_SYSTEM_PROMPT, nanoPlanConstraint, parseNanoPlan } from '../../src/canvas/nanoPlan';
import { betterSummary, draftSummary, dropUnbackedClaims, floorPlanSummary, tilesFilledLine } from '../../src/canvas/planTruth';
import { createDeviceIdSession } from '../../src/privacy/deviceRedact';
import { resolveAppCheckDebugToken } from '../../src/firebase/debugToken';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

const req: SurfaceRequest = {
  utterance: 'connect everything in this room',
  frameTitle: 'Board 3',
  frameId: 'b3',
  devices: [{ id: 'wiz-ceiling', label: 'Ceiling light', kind: 'lamp' }, { id: 'speaker-1', label: 'Speaker', kind: 'music' }],
};
const NANO_OK = '{"kind":"room","title":"This room","tiles":[{"type":"lamp","deviceId":"wiz-ceiling","label":"Ceiling light"},{"type":"music","deviceId":"speaker-1","label":"Speaker"}]}';
const GEMINI_OK = '{"kind":"room","title":"Living room","tiles":[{"type":"lamp","deviceId":"Device 1","label":"Main light"},{"type":"music","deviceId":"Device 2","label":"Speaker"}]}';
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

/** A fake Chrome LanguageModel that records how many prompts run at once. */
function fakeLm(reply = NANO_OK, o: { delayMs?: number; chunks?: number } = {}) {
  const stats = { created: 0, cloned: 0, prompts: 0, running: 0, peak: 0, destroyed: 0, lastOptions: null as Record<string, unknown> | null, lastInput: '' };
  const session = (): PromptSession => ({
    promptStreaming(input: string, options?: unknown) {
      stats.prompts++; stats.lastOptions = (options ?? null) as Record<string, unknown> | null; stats.lastInput = input;
      const n = o.chunks ?? 4;
      return (async function* () {
        stats.running++; stats.peak = Math.max(stats.peak, stats.running);
        try {
          for (let i = 1; i <= n; i++) {
            if (o.delayMs) await tick(o.delayMs);
            yield reply.slice(Math.floor(((i - 1) * reply.length) / n), Math.floor((i * reply.length) / n));
          }
        } finally { stats.running--; }
      })();
    },
    async clone() { stats.cloned++; return session(); },
    destroy() { stats.destroyed++; },
  });
  const lm: PromptApi = { async create() { stats.created++; return session(); } };
  return { lm, stats };
}

afterEach(() => { setModelsForTest(null); vi.useRealTimers(); });

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

  it('14 prompts launched at once reach Chrome one at a time, through one runner', async () => {
    const { lm, stats } = fakeLm(NANO_OK, { delayMs: 1 });
    const runner = createNanoRunner(lm, { queue: createNanoQueue(1) });
    const out = await Promise.all(Array.from({ length: 14 }, () => runner.stream('p', () => undefined)));
    expect(out.every((t) => t === NANO_OK)).toBe(true);
    expect(stats.prompts).toBe(14);
    expect(stats.peak).toBe(1);
  });

  it('a live Nano board turn is ONE structured prompt — not a session per tile', async () => {
    const { lm, stats } = fakeLm();
    const engines = createEngines({ languageModel: lm, nanoRunner: createNanoRunner(lm, { queue: createNanoQueue(1) }), cloud: async () => GEMINI_OK });
    const nano = engines.nano!('{}');
    const plan = await runSurfaceTurn(req, nano);
    expect(plan?.tiles.map((t) => t.type)).toEqual(['lamp', 'music']);
    expect(stats.prompts).toBe(1);
    expect(stats.peak).toBe(1);
    // the reply is constrained to a board plan whose device ids are the real ones
    const constraint = stats.lastOptions?.responseConstraint as { properties: { tiles: { items: { properties: { deviceId: { enum: string[] } } } } } };
    expect(constraint.properties.tiles.items.properties.deviceId.enum).toEqual(['wiz-ceiling', 'speaker-1']);
    // not warmed yet: the whole prompt goes to a fresh session, still one call
    expect(stats.cloned).toBe(0);
    expect(stats.lastInput).toContain(NANO_SYSTEM_PROMPT);
    // once warm, the session that already holds the instructions is cloned
    // and only this turn is sent
    const runner = createNanoRunner(lm, { queue: createNanoQueue(1) });
    expect(await runner.warm()).toBe(true);
    await runSurfaceTurn(req, createEngines({ languageModel: lm, nanoRunner: runner, cloud: async () => GEMINI_OK }).nano!('{}'));
    expect(stats.cloned).toBe(1);
    expect(stats.lastInput).not.toContain(NANO_SYSTEM_PROMPT);
    expect(stats.lastInput).toContain('connect everything in this room');
  });

  it('the Nano prompt is short and flat (no nested dashboard grammar)', () => {
    const r = buildNanoPlanRequest(req);
    expect(r.prompt.length).toBeLessThan(1400);
    expect(r.prompt).not.toMatch(/chart|table|visual|split|tabs/);
    expect(JSON.stringify(nanoPlanConstraint(req.devices))).toContain('"maxItems":6');
  });

  it('a made-up device in Nano’s reply is dropped, not shown', () => {
    const got = parseNanoPlan('{"kind":"room","title":"Room","tiles":[{"type":"lamp","deviceId":"lamp-2","label":"Desk lamp"},{"type":"lamp","deviceId":"wiz-ceiling","label":"Ceiling"}]}', req);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.tiles).toEqual([{ type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling' }]);
    expect(got.notes?.join(' ')).toMatch(/not in this room/);
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
    let yields = 0;
    let clock = 0;
    const { lm } = fakeLm(NANO_OK, { chunks: 50 });
    const runner = createNanoRunner(lm, { queue: createNanoQueue(1), now: () => (clock += 10), yieldToPage: async () => { yields++; } });
    expect(await runner.stream('p', () => undefined)).toBe(NANO_OK);
    expect(yields).toBeGreaterThan(5);
  });

  it('a prompt with no deadline of its own is stopped by the runner’s', async () => {
    vi.useFakeTimers();
    let destroyed = 0;
    const stuck: PromptApi = { async create() { return { promptStreaming: () => (async function* () { await never<void>(); yield ''; })(), destroy() { destroyed++; } }; } };
    const runner = createNanoRunner(stuck, { queue: createNanoQueue(1) });
    const p = runner.stream('p', () => undefined);
    const settled = p.then(() => 'ok', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(NANO_DEFAULT_TIMEOUT_MS + 10);
    expect(destroyed).toBeGreaterThan(0); // the session was torn down, not just abandoned
    expect(await settled).toBe('took longer than 20 s');
  });

  it('stopping a prompt that never settles still frees the model for the next one', async () => {
    const q = createNanoQueue(1);
    let n = 0;
    const lm: PromptApi = { async create() {
      const mine = ++n;
      return { promptStreaming: () => (mine === 1 ? new ReadableStream<string>({}) : (async function* () { yield NANO_OK; })()), destroy() { /* a stuck session ignores this */ } };
    } };
    const runner = createNanoRunner(lm, { queue: q });
    const ctl = new AbortController();
    const stuck = runner.stream('p', () => undefined, { signal: ctl.signal });
    const next = runner.stream('p', () => undefined);
    await tick(5);
    expect(q.active()).toBe(1);
    ctl.abort();
    await expect(stuck).rejects.toThrow('stopped');
    expect(await next).toBe(NANO_OK);
    expect(q.idle()).toBe(true);
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
  function turn(nano: SurfaceEngine, o: { nanoTimeoutMs?: number; sleep?: (ms: number) => Promise<void>; canHandoff?: () => boolean } = {}) {
    const log: { sent: SentInfo[]; handoff: Array<{ s: SentInfo; why: string }>; errors: Array<{ why: string; engine?: string }>; fallback: number; notes: string[] } = { sent: [], handoff: [], errors: [], fallback: 0, notes: [] };
    const session = createDeviceIdSession();
    const p = runSurfaceTurn(req, nano, {
      onSent: (s) => log.sent.push(s),
      onHandoff: (s, why) => log.handoff.push({ s, why }),
      onFallback: () => { log.fallback++; },
      onError: (why, engine) => log.errors.push({ why, engine }),
      onNote: (n) => log.notes.push(n),
    }, { deviceIdSession: session, ...o });
    return { p, log };
  }
  const geminiOk = (seen: string[] = []): SurfaceEngine => ({ id: 'gemini', sim: false, stream: async (prompt, onText) => { seen.push(prompt); onText(GEMINI_OK); return GEMINI_OK; } });

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
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: (_p, _on, so?: StreamOptions) => { signal = so?.signal; return never<string>(); }, handoff: geminiOk() };
    // the turn's clock: the Nano budget elapses at once; Gemini's never does
    const { p, log } = turn(nano, { nanoTimeoutMs: 20_000, sleep: (ms) => (ms === 20_000 ? Promise.resolve() : never<void>()) });
    expect((await p)?.title).toBe('Living room');
    expect(signal?.aborted).toBe(true); // the model itself was told to stop
    expect(log.handoff[0].why).toBe('took longer than 20 s');
    expect(log.handoff[0].s.routeLine).toContain('Nano couldn’t finish (took longer than 20 s), so Gemini made this');
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
    expect(log.errors[0]).toEqual({ why: 'Nano couldn’t finish (the model crashed). You’re offline, so Gemini can’t take over.', engine: 'nano' });
  });

  it('both fail: one honest error with both reasons, no draft, nothing labelled SIM', async () => {
    const blocked = new CloudCallError(explainCloudFailure('AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/models/m:streamGenerateContent?alt=sse: AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.'));
    let geminiCalls = 0;
    const gemini: SurfaceEngine = { id: 'gemini', sim: false, stream: async () => { geminiCalls++; throw blocked; } };
    const nano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { throw new Error('the model crashed'); }, handoff: gemini };
    const { p, log } = turn(nano);
    expect(await p).toBeNull();
    expect(log.errors).toEqual([{ why: `Nano couldn’t finish (the model crashed). ${APP_CHECK_403_LINE}`, engine: 'gemini' }]);
    expect(geminiCalls).toBe(1); // a 403 is not retried: the same call cannot pass
    expect(log.fallback).toBe(0);
    const everything = JSON.stringify(log);
    expect(everything).not.toMatch(/SIM|prepared draft|didn’t answer, so/);
  });

  it('Gemini alone failing is an honest error too (App Check 403, plainly)', async () => {
    const gemini: SurfaceEngine = { id: 'gemini', sim: false, stream: async () => { throw new Error('AppCheck: Fetch server returned an HTTP error status. HTTP status: 403.'); } };
    const errors: string[] = [];
    expect(await runSurfaceTurn(req, gemini, { onError: (w) => errors.push(w) }, { sleep: () => never<void>() })).toBeNull();
    expect(errors).toEqual(['Gemini blocked: App Check 403 (this address isn’t registered)']);
  });
});

describe('B: no SIM wording without ?sim=1', () => {
  const cloud = async (): Promise<string> => GEMINI_OK;
  it('live engines carry no scripted stand-in, on either slot', () => {
    const { lm } = fakeLm();
    for (const rt of [
      { languageModel: lm, cloud },
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
    const { lm } = fakeLm();
    expect(createEngines({ languageModel: lm, cloud }).nano!('{}').handoff?.id).toBe('gemini');
    const sim = createEngines({ languageModel: lm, cloud, sim: true }).nano!(NANO_OK);
    expect(sim.sim).toBe(true);
    expect(sim.handoff).toBeUndefined();
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
    const plan = await runSurfaceTurn(req, scriptedEngine('nano', NANO_OK, { delayMs: 0 }), { onSent: (s) => lines.push(s.routeLine) });
    expect(plan?.tiles).toHaveLength(2);
    expect(lines[0]).toMatch(/^SIM · /);
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
