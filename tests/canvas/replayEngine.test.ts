import { describe, expect, it } from 'vitest';
import { createReplayEngines, missingReplyLine, NO_MODEL_LINE, recordingEngines, REPLAY_ROUTE, WRITTEN_ROUTE, replayKey, replayRouteIn } from '../../src/canvas/replayEngine';
import type { SurfaceEngine } from '../../src/canvas/aiTurn';

describe('replay engine', () => {
  it('keys replies by engine, turn kind and an optional turn number', () => {
    expect(replayKey('gemini', 'board')).toBe('gemini.board');
    expect(replayKey('nano', 'planEdit', 2)).toBe('nano.planEdit.2');
    expect(NO_MODEL_LINE).toBe('No model is available here. Nothing was generated.');
  });

  it('answers with the recorded reply, labelled as a replay', async () => {
    const e = createReplayEngines({ 'gemini.board': '{"a":1}' }, { recorded: ['gemini.board'] }).gemini!('board');
    expect(e.routeLine).toBe(REPLAY_ROUTE);
    expect(e.sim).toBe(true);
    const seen: string[] = [];
    expect(await e.stream('p', (t) => seen.push(t))).toBe('{"a":1}');
    expect(seen).toEqual(['{"a":1}']);
  });

  it('the nth turn of a kind takes <key>.<n> when recorded, else <key>', async () => {
    const f = createReplayEngines({ 'nano.board': 'base', 'nano.board.2': 'second' }).nano!;
    expect(await f('board').stream('p', () => {})).toBe('base');
    expect(await f('board').stream('p', () => {})).toBe('second');
    expect(await f('board').stream('p', () => {})).toBe('base');
  });

  it('a kind with no recorded reply fails loudly', async () => {
    const e = createReplayEngines({}).gemini!('pack');
    await expect(e.stream('p', () => {})).rejects.toThrow(missingReplyLine('gemini.pack'));
  });

  it('a hand-written reply (or one nothing says was recorded) is labelled a written example', async () => {
    expect(WRITTEN_ROUTE).toBe('Replay · written example');
    const f = createReplayEngines({ 'nano.board': 'base', 'nano.board.2': 'second', 'gemini.board': 'g' }, { recorded: ['nano.board.2'] });
    expect(f.gemini!('board').routeLine).toBe(WRITTEN_ROUTE);
    // The label follows the reply the turn really takes.
    const first = f.nano!('board');
    expect(first.routeLine).toBe(WRITTEN_ROUTE);
    await first.stream('p', () => {});
    expect(first.routeLine).toBe(WRITTEN_ROUTE);
    const second = f.nano!('board');
    expect(second.routeLine).toBe(REPLAY_ROUTE);
    expect(await second.stream('p', () => {})).toBe('second');
    expect(second.routeLine).toBe(REPLAY_ROUTE);
    expect(createReplayEngines({ 'gemini.board': 'g' }).gemini!('board').routeLine).toBe(WRITTEN_ROUTE);
  });

  it('the review chip names which kind of replay it was', () => {
    expect(replayRouteIn(`SIM · ${WRITTEN_ROUTE}`)).toBe(WRITTEN_ROUTE);
    expect(replayRouteIn(REPLAY_ROUTE)).toBe(REPLAY_ROUTE);
    expect(replayRouteIn('Gemini · cloud')).toBeNull();
    expect(replayRouteIn(undefined)).toBeNull();
  });
  it('a replay engine asked for a missing key rejects with "No recorded reply for <key>"', async () => {
    const e = createReplayEngines({ 'nano.board': 'x' }).nano!('steps');
    await expect(e.stream('p', () => {})).rejects.toThrow('No recorded reply for nano.steps');
  });

  it('a second ask for the same kind uses <key>.2 when it exists', async () => {
    const f = createReplayEngines({ 'gemini.devices': 'first', 'gemini.devices.2': 'second' }).gemini!;
    expect(await f('devices').stream('p', () => {})).toBe('first');
    expect(await f('devices').stream('p', () => {})).toBe('second');
  });
});

describe('recording engines', () => {
  const live = (id: 'nano' | 'gemini', replies: string[]): (kind: string) => SurfaceEngine => {
    let i = 0;
    return () => ({
      id, sim: false, routeLine: `${id} live`,
      async stream(_p, onText) { const r = replies[i++] ?? ''; onText(r.slice(0, 2)); onText(r); return r; },
    });
  };
  const sinkOf = () => {
    const got: { key: string; reply: string; meta: { engine: string; model: string; turnKind: string; promptSha: string } }[] = [];
    return { got, sink: (key: string, reply: string, meta: { engine: 'nano' | 'gemini'; model: string; turnKind: string; promptSha: string }) => { got.push({ key, reply, meta }); } };
  };

  it('recordingEngines passes the live reply through unchanged and reports it once', async () => {
    const { got, sink } = sinkOf();
    const rec = recordingEngines({ gemini: live('gemini', ['```json\n{"kind":"room"}\n```']) }, sink, { modelOf: () => 'gemini-test' });
    const e = rec.gemini!('board')!;
    const seen: string[] = [];
    const out = await e.stream('the prompt', (t) => seen.push(t));
    expect(out).toBe('```json\n{"kind":"room"}\n```');
    expect(seen).toEqual(['``', '```json\n{"kind":"room"}\n```']);
    expect(got).toHaveLength(1);
    expect(got[0].key).toBe('gemini.board');
    expect(got[0].reply).toBe(out);
    expect(got[0].meta.engine).toBe('gemini');
    expect(got[0].meta.model).toBe('gemini-test');
    expect(got[0].meta.turnKind).toBe('board');
    expect(got[0].meta.promptSha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records under the keys a replay looks up: <key>, then <key>.<n>, and <key>.<sub> for a pack', async () => {
    const { got, sink } = sinkOf();
    const rec = recordingEngines({ nano: live('nano', ['a', 'b', 'c']), gemini: live('gemini', ['kn', 'kn2']) }, sink);
    for (let i = 0; i < 3; i += 1) await rec.nano!('board')!.stream('p', () => {});
    await rec.gemini!('pack', 'kn')!.stream('p', () => {});
    await rec.gemini!('pack', 'kn')!.stream('p', () => {});
    expect(got.map((g) => g.key)).toEqual(['nano.board', 'nano.board.2', 'nano.board.3', 'gemini.pack.kn', 'gemini.pack.kn.2']);
    // And the replay engines answer each turn from exactly those keys.
    const book = Object.fromEntries(got.map((g) => [g.key, g.reply]));
    const replay = createReplayEngines(book);
    expect([await replay.nano!('board').stream('p', () => {}), await replay.nano!('board').stream('p', () => {}), await replay.nano!('board').stream('p', () => {})]).toEqual(['a', 'b', 'c']);
    expect([await replay.gemini!('pack', 'kn').stream('p', () => {}), await replay.gemini!('pack', 'kn').stream('p', () => {})]).toEqual(['kn', 'kn2']);
  });

  it('a live turn that fails reports nothing and fails the same way', async () => {
    const { got, sink } = sinkOf();
    const failing = () => ({ id: 'gemini' as const, sim: false, stream: () => Promise.reject(new Error('App Check 403')) });
    const rec = recordingEngines({ gemini: failing }, sink);
    await expect(rec.gemini!('plan')!.stream('p', () => {})).rejects.toThrow('App Check 403');
    expect(got).toEqual([]);
  });

  it('no live engine for a step stays no engine (the turn says no model)', () => {
    const { sink } = sinkOf();
    const rec = recordingEngines({ nano: () => undefined }, sink);
    expect(rec.nano!('board')).toBeUndefined();
    expect(rec.gemini).toBeUndefined();
  });

  it('a recorded turn stays live: the production path runs, with its route line', () => {
    const { sink } = sinkOf();
    const rec = recordingEngines({ nano: live('nano', ['x']) }, sink);
    const e = rec.nano!('board')!;
    expect(e.sim).toBe(false);
    expect(e.routeLine).toBe('nano live');
  });

  it('a failed turn still counts toward n: the next one is <key>.2, and a replay meets the same gap', async () => {
    const { got, sink } = sinkOf();
    let calls = 0;
    const flaky = () => ({ id: 'nano' as const, sim: false, stream: async () => { calls += 1; if (calls === 1) throw new Error('took too long'); return '{"t":"Lamp","d":["wiz-lamp-1"]}'; } });
    const rec = recordingEngines({ nano: flaky }, sink);
    await expect(rec.nano!('board')!.stream('p', () => {})).rejects.toThrow('took too long');
    await rec.nano!('board')!.stream('p', () => {});
    expect(got.map((g) => g.key)).toEqual(['nano.board.2']);
    const replay = createReplayEngines(Object.fromEntries(got.map((g) => [g.key, g.reply])), { recorded: ['nano.board.2'] });
    await expect(replay.nano!('board').stream('p', () => {})).rejects.toThrow('No recorded reply for nano.board');
    expect(await replay.nano!('board').stream('p', () => {})).toBe('{"t":"Lamp","d":["wiz-lamp-1"]}');
  });

  it('a replay of a live recording runs the live path (liveShape); a written example does not unless it says so', () => {
    const f = createReplayEngines({ 'nano.board': '{"t":"L","d":[]}', 'gemini.board': '{}', 'nano.devices': '{}' }, { recorded: ['nano.board'], liveShape: ['nano.devices'] });
    expect(f.nano!('board').liveShape).toBe(true);
    expect(f.gemini!('board').liveShape).toBe(false);
    expect(f.nano!('devices').liveShape).toBe(true);
  });
});
