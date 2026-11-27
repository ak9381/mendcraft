import { describe, expect, it } from 'vitest';
import { recordedEngine } from '../helpers/recordedEngine';
import { buildSurfacePrompt, createCanvasHistory, GEMINI_TIMEOUT_MS, parseModelPlan, parsePartialPlan, runSurfaceTurn, withTimeoutRetry, type SurfaceEngine } from '../../src/canvas/aiTurn';
import { OFFLINE_MID_LINE } from '../../src/canvas/failLines';
import { focusOnInset } from '../../src/canvas/camera';
import { parseCanvasCommand } from '../../src/canvas/canvasCommands';
import { createReplayEngines } from '../../src/canvas/replayEngine';

const req = {
  utterance: 'connect everything in this room',
  frameTitle: 'Board 3',
  devices: [{ id: 'lamp-a', label: 'Desk lamp', kind: 'lamp', host: '192.168.1.40' }, { id: 'lamp-b', label: 'Ceiling light', kind: 'lamp', host: '192.168.1.41' }],
};
const PLAN = '{"kind":"room","title":"This room","tiles":[{"type":"lamp","deviceId":"lamp-a","label":"Desk lamp"},{"type":"lamp","deviceId":"lamp-b","label":"Ceiling light"}]}';

describe('what was sent', () => {
  it('Nano: the full prompt is shown, and nothing leaves the device', () => {
    const r = buildSurfacePrompt(req, 'nano');
    expect(r.prompt).toContain('connect everything in this room');
    expect(r.prompt).toContain('lamp-a');
    expect(r.prompt).toMatch(/LampTile|"lamp"/);
    expect(r.sent).toBeNull();
    expect(r.routeLine).toMatch(/on device/);
  });
  it('Gemini: a receipt names what left, and addresses never do', () => {
    const r = buildSurfacePrompt(req, 'gemini');
    expect(r.prompt).not.toContain('192.168');
    expect(r.sent).toMatch(/your words/i);
    expect(r.sent).toMatch(/2 device names/);
    expect(r.sent).toMatch(/no camera/i);
    expect(r.routeLine).toMatch(/online|cloud/i);
  });
});

describe('streaming ghost preview', () => {
  it('surfaces each tile as soon as its JSON object closes', () => {
    expect(parsePartialPlan('{"kind":"ro').tiles).toEqual([]);
    const half = PLAN.slice(0, PLAN.indexOf('lamp-b'));
    const p = parsePartialPlan(half);
    expect(p.title).toBe('This room');
    expect(p.tiles).toEqual([{ type: 'lamp', deviceId: 'lamp-a', label: 'Desk lamp' }]);
    expect(parsePartialPlan(PLAN).tiles).toHaveLength(2);
  });
  it('never ghosts a forged widget, and tolerates braces inside strings', () => {
    const p = parsePartialPlan('{"kind":"room","title":"A {b}","tiles":[{"type":"EvilScript","src":"x"},{"type":"lamp","deviceId":"lamp-a","label":"Lamp } {"}');
    expect(p.title).toBe('A {b}');
    expect(p.tiles).toEqual([{ type: 'lamp', deviceId: 'lamp-a', label: 'Lamp } {' }]);
    expect(p.rejected).toBe(1);
  });
});

describe('runSurfaceTurn', () => {
  it('reports sent -> ghost -> ready in order and returns a validated plan', async () => {
    const seen: string[] = [];
    const plan = await runSurfaceTurn(req, recordedEngine('nano', PLAN, { chunk: 25, delayMs: 0 }), {
      onSent: (s) => seen.push(`sent:${s.engine}`),
      onText: () => { if (seen.at(-1) !== 'text') seen.push('text'); },
      onGhost: (g) => seen.push(`ghost:${g.tiles.length}`),
    });
    expect(plan?.tiles).toHaveLength(2);
    expect(seen[0]).toBe('sent:nano');
    expect(seen).toContain('ghost:1');
    expect(seen.at(-1)).toBe('ghost:2');
  });
  it('returns null (and says why) on junk or a forged final plan', async () => {
    let why = '';
    const bad: SurfaceEngine = { id: 'gemini', sim: true, stream: async (_p, on) => { on('{"kind":"room","title":"x","tiles":[{"type":"EvilScript"}]}'); return '{"kind":"room","title":"x","tiles":[{"type":"EvilScript"}]}'; } };
    expect(await runSurfaceTurn(req, bad, { onError: (e) => { why = e; } })).toBeNull();
    expect(why).toMatch(/tile/i);
  });
  it('a failing engine is an error, not a crash', async () => {
    let why = '';
    const boom: SurfaceEngine = { id: 'gemini', sim: false, stream: async () => { throw new Error('offline'); } };
    expect(await runSurfaceTurn(req, boom, { onError: (e) => { why = e; } })).toBeNull();
    // a live Gemini failure is named plainly (no raw error text, no draft)
    expect(why).toBe('Gemini couldn’t be reached: no connection');
  });
  it('scripted engines say SIM on their route line', () => {
    expect(recordedEngine('nano', PLAN).sim).toBe(true);
    expect(buildSurfacePrompt(req, 'nano', { sim: true }).routeLine).toMatch(/^SIM · /);
  });
  it('aborts a mid-stream cloud turn when cancelled, with no plan and no fallback', async () => {
    let why = '';
    let cancelled = false;
    const engine = recordedEngine('gemini', PLAN, { chunk: 20, delayMs: 15 });
    const task = runSurfaceTurn(req, engine, { onError: (e) => { why = e; }, onGhost: () => { cancelled = true; } }, { isCancelled: () => cancelled });
    const plan = await task;
    expect(plan).toBeNull();
    expect(why).toBe(OFFLINE_MID_LINE);
  });
});

describe('history (human in the loop)', () => {
  it('undo restores the board as it was before the kept change', () => {
    const h = createCanvasHistory();
    const a = { kind: 'room' as const, title: 'A', tiles: [] };
    h.push({ frameId: 'f1', before: null, after: a, by: 'nano', summary: 'draft' });
    h.push({ frameId: 'f1', before: a, after: { ...a, title: 'B' }, by: 'gemini', summary: 'upgrade' });
    expect(h.undo()).toMatchObject({ before: a, summary: 'upgrade' });
    expect(h.undo()).toMatchObject({ before: null });
    expect(h.undo()).toBeNull();
    expect(h.list()).toHaveLength(2);
    expect(h.list().every((e) => e.undone)).toBe(true);
  });

  it('caps unbounded growth by dropping the oldest entries once the cap is exceeded', () => {
    const h = createCanvasHistory();
    for (let i = 0; i < 250; i++) {
      h.push({ frameId: 'f1', before: null, after: null, by: 'nano', summary: `change ${i}` });
    }
    const list = h.list();
    expect(list.length).toBeLessThanOrEqual(200);
    expect(list[list.length - 1].summary).toBe('change 249');
    expect(list[0].summary).not.toBe('change 0');
  });
});

describe('approval words', () => {
  it.each([['keep', 'keep'], ['keep it', 'keep'], ['yes keep that', 'keep'], ['drop', 'drop'], ['no drop it', 'drop'], ['reject', 'drop'], ['undo', 'undo'], ['undo that', 'undo']])('%s', (t, type) => {
    expect(parseCanvasCommand(t)).toEqual({ type });
  });
});

describe('focus below the command bar', () => {
  it('centres the board in the space under the bar at 1:1', () => {
    const c = focusOnInset({ x: 0, y: 0, w: 1200, h: 700 }, { w: 1440, h: 900 }, 120);
    expect(c.z).toBe(1);
    expect(-c.y).toBe(120 + Math.round((900 - 120 - 700) / 2));
  });
});

describe('parseModelPlan (real-shaped model output)', () => {
  it('accepts fenced JSON with leading prose', () => {
    const r = parseModelPlan('Sure, here is the board:\n```json\n' + PLAN + '\n```');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe('room');
      expect(r.value.tiles).toHaveLength(2);
      expect(r.value.tiles[0].type).toBe('lamp');
    }
  });

  it('refuses malformed JSON', () => {
    const r = parseModelPlan('{"kind":"room","title":"Living","tiles":[');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a board plan/i);
  });

  it('defaults a missing kind when tiles are present, and unwraps a {plan: ...} envelope', () => {
    const loose = parseModelPlan('Sure. {"title":"Living room","tiles":[{"type":"lamp","deviceId":"lamp-a","label":"Desk lamp"}]}');
    expect(loose.ok).toBe(true);
    if (loose.ok) {
      expect(loose.value.kind).toBe('room');
      expect(loose.value.title).toBe('Living room');
    }
    const wrapped = parseModelPlan('{"plan":{"kind":"room","title":"Wrapped","tiles":[{"type":"lamp","deviceId":"lamp-a","label":"Desk lamp"}]}}');
    expect(wrapped.ok).toBe(true);
    if (wrapped.ok) expect(wrapped.value.title).toBe('Wrapped');
  });

  it('drops unknown widgets with a note and keeps the valid tiles', () => {
    const r = parseModelPlan('```json\n{"kind":"room","title":"Living","tiles":[{"type":"script","src":"alert(1)"},{"type":"lamp","deviceId":"lamp-a","label":"Desk lamp"}]}\n```');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tiles).toHaveLength(1);
    expect(r.value.tiles[0].type).toBe('lamp');
    expect(r.notes?.some((n) => /script/i.test(n))).toBe(true);
  });
});

describe('runSurfaceTurn SIM fallback', () => {
  it('streams the prepared draft and relabels SIM when the real engine fails', async () => {
    const lines: string[] = [];
    const boom: SurfaceEngine = {
      id: 'gemini',
      sim: false,
      stream: async () => { throw new Error('timed out'); },
      fallback: recordedEngine('gemini', PLAN, { delayMs: 0 }),
    };
    let sends = 0;
    const plan = await runSurfaceTurn(req, boom, {
      onSent: (s) => { sends++; lines.push(s.routeLine); },
      onFallback: (s) => lines.push(s.routeLine),
    });
    expect(plan?.tiles).toHaveLength(2);
    expect(lines.at(-1)).toMatch(/^SIM · /);
    expect(lines.at(-1)).toMatch(/didn’t answer|prepared draft/i);
    // The real send is booked once; the scripted draft is not a second send.
    expect(sends).toBe(1);
  });
});

describe('redaction covers nested surface plans', () => {
  it('redacts a device id nested inside a Card/Row even though the plan is now a tree', async () => {
    const { createDeviceIdSession } = await import('../../src/privacy/deviceRedact');
    const session = createDeviceIdSession();
    const nestedReq = {
      utterance: 'build a dashboard',
      frameTitle: 'Board 9',
      devices: [{ id: 'lamp-a', label: 'Desk lamp', kind: 'lamp' }],
      current: {
        kind: 'room' as const,
        title: 'Energy',
        tiles: [{ type: 'card' as const, title: 'Lighting', children: [{ type: 'lamp' as const, deviceId: 'lamp-a', label: 'Desk lamp' }] }],
      },
    };
    const r = buildSurfacePrompt(nestedReq, 'gemini', { deviceIdSession: session });
    expect(r.prompt).not.toContain('lamp-a');
    expect(r.prompt).toContain('Device 1');
  });

  it('round-trips a nested plan with a redacted device id back to the real id', async () => {
    const { createDeviceIdSession } = await import('../../src/privacy/deviceRedact');
    const session = createDeviceIdSession();
    session.tokenFor('lamp-a'); // seed the mapping, as buildSurfacePrompt would have
    const modelReply = '{"kind":"room","title":"Energy","tiles":[{"type":"card","title":"Lighting","children":[{"type":"lamp","deviceId":"Device 1","label":"Desk lamp"}]}]}';
    const parsed = parseModelPlan(modelReply, session);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const card = parsed.value.tiles[0];
    if (card.type !== 'card') throw new Error('expected card');
    const lamp = card.children[0];
    if (lamp.type !== 'lamp') throw new Error('expected lamp');
    expect(lamp.deviceId).toBe('lamp-a');
  });
});


describe('Gemini tile-agent timeout and retry', () => {
  const PLAN = '{"kind":"room","title":"Studio","tiles":[{"type":"lamp","deviceId":"wiz-1","label":"Desk lamp"},{"type":"plan","boardId":"plan-1","template":"blank"}]}';
  const req = { utterance: 'connect everything', frameTitle: 'Studio', devices: [] as { id: string; label: string; kind: string }[] };
  const instant = async (_ms: number) => { /* expire immediately */ };

  it('a live Gemini stream that finishes is a plan, not an infinite start', async () => {
    const plan = await runSurfaceTurn(req, recordedEngine('gemini', PLAN, { chunk: 80, delayMs: 0 }), {}, { timeoutMs: 20_000, sleep: instant });
    // scripted engines are sim:true so they skip the timeout wrapper; use a live-like engine:
    let text = '';
    const live: SurfaceEngine = {
      id: 'gemini', sim: false,
      stream: async (_p, on) => { on(PLAN); text = PLAN; return PLAN; },
    };
    const got = await runSurfaceTurn(req, live, {}, { timeoutMs: GEMINI_TIMEOUT_MS, sleep: async () => new Promise(() => { /* never fires */ }) });
    expect(got?.tiles.length).toBeGreaterThan(0);
    expect(text).toBe(PLAN);
  });

  it('retries once after a ~20s timeout and streams to done', async () => {
    let attempts = 0;
    const live: SurfaceEngine = {
      id: 'gemini', sim: false,
      stream: async (_p, on) => {
        attempts += 1;
        if (attempts === 1) return new Promise(() => { /* hang */ });
        on(PLAN);
        return PLAN;
      },
    };
    let sleeps = 0;
    const sleep = async () => {
      sleeps += 1;
      if (sleeps === 1) return; // first attempt times out immediately
      await new Promise(() => { /* second attempt is allowed to finish */ });
    };
    const plan = await runSurfaceTurn(req, live, {}, { timeoutMs: 5, sleep });
    expect(attempts).toBe(2);
    expect(plan?.tiles.length).toBeGreaterThan(0);
  });

  it('after a timeout and a failed retry, reports an error instead of hanging at start', async () => {
    let why = '';
    const live: SurfaceEngine = { id: 'gemini', sim: false, stream: async () => new Promise(() => { /* hang */ }) };
    const plan = await runSurfaceTurn(req, live, { onError: (e) => { why = e; } }, { timeoutMs: 5, sleep: instant });
    expect(plan).toBeNull();
    expect(why).toMatch(/timed out/i);
  });

  it('withTimeoutRetry resolves on the second attempt', async () => {
    let n = 0;
    const v = await withTimeoutRetry(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return 7;
    }, { timeoutMs: 5, retries: 1, sleep: instant });
    expect(v).toBe(7);
    expect(n).toBe(2);
  });
});

describe('a replay of a live Nano recording', () => {
  it('runs the live Nano path: the {t,d} prompt with its constraint, and the reply parsed as a decision', async () => {
    const prompts: { prompt: string; constraint?: unknown }[] = [];
    const f = createReplayEngines({ 'nano.board': '{"t":"Desk","d":["lamp-a"]}' }, { recorded: ['nano.board'] });
    const e = f.nano!('board');
    const inner = e.stream.bind(e);
    const spy: SurfaceEngine = { ...e, stream: (p, on, o) => { prompts.push({ prompt: p, constraint: o?.constraint }); return inner(p, on, o); } };
    const plan = await runSurfaceTurn(req, spy, {}, { nanoQueueWaitMs: 0 });
    expect(plan?.title).toBe('Desk');
    expect(plan?.tiles).toEqual([expect.objectContaining({ type: 'lamp', deviceId: 'lamp-a' })]);
    expect(prompts[0].prompt).toContain('"t": title');
    expect(prompts[0].constraint).toBeTruthy();
  });
  it('a written example in the board shape still runs the replay path', async () => {
    const f = createReplayEngines({ 'nano.board': PLAN });
    const plan = await runSurfaceTurn(req, f.nano!('board'));
    expect(plan?.tiles).toHaveLength(2);
  });
});
