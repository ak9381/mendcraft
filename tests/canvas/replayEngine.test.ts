import { describe, expect, it } from 'vitest';
import { createReplayEngines, missingReplyLine, NO_MODEL_LINE, REPLAY_ROUTE, replayKey } from '../../src/canvas/replayEngine';

describe('replay engine', () => {
  it('keys replies by engine, turn kind and an optional turn number', () => {
    expect(replayKey('gemini', 'board')).toBe('gemini.board');
    expect(replayKey('nano', 'planEdit', 2)).toBe('nano.planEdit.2');
    expect(NO_MODEL_LINE).toBe('No model is available here. Nothing was generated.');
  });

  it('answers with the recorded reply, labelled as a replay', async () => {
    const e = createReplayEngines({ 'gemini.board': '{"a":1}' }).gemini!('board');
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
});
