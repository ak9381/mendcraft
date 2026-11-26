import { describe, expect, it } from 'vitest';
import { createReplayEngines, missingReplyLine, NO_MODEL_LINE, REPLAY_ROUTE, WRITTEN_ROUTE, replayKey, replayRouteIn } from '../../src/canvas/replayEngine';

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
});
