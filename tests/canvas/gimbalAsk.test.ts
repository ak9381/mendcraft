import { describe, expect, it } from 'vitest';
import { createGimbalAsk, GIMBAL_ASK_CANCEL, GIMBAL_ASK_DOCK, GIMBAL_ASK_DOCKED, GIMBAL_ASK_NOT_DOCKED, GIMBAL_ASK_ON, GIMBAL_ASK_WAIT } from '../../src/canvas/gimbalAsk';

function setup(docked = false) {
  const said: string[] = [];
  const ran: string[] = [];
  const s = { docked };
  const ask = createGimbalAsk({ say: (l) => said.push(l), standReported: () => s.docked, proceed: (t) => ran.push(t) });
  return { ask, said, ran, s };
}

describe('gimbalAsk', () => {
  it('asks on, then dock, then proceeds once the stand is reported', () => {
    const { ask, said, ran, s } = setup();
    ask.start('add the gimbal');
    expect(said).toEqual([GIMBAL_ASK_ON]);
    expect(ask.handle('yes')).toBe(true);
    expect(said.at(-1)).toBe(GIMBAL_ASK_DOCK);
    s.docked = true;
    expect(ask.handle('Yes.')).toBe(true);
    expect(said.at(-1)).toBe(GIMBAL_ASK_DOCKED);
    expect(ran).toEqual(['add the gimbal']);
    expect(ask.active()).toBe(false);
  });

  it('does not take her word: no stand reported keeps asking', () => {
    const { ask, said, ran } = setup(false);
    ask.start('add the gimbal');
    ask.handle('yeah');
    expect(ask.handle('yes it is')).toBe(true);
    expect(said.at(-1)).toBe(GIMBAL_ASK_NOT_DOCKED);
    expect(ran).toEqual([]);
    expect(ask.active()).toBe(true);
  });

  it('accepts natural yeses', () => {
    for (const y of ['yes', 'Yeah.', 'okay', 'yes please', "it's on", 'it is on', 'done', 'yep, it’s on', 'switched on']) {
      const { ask, said } = setup();
      ask.start('add the gimbal');
      expect(ask.handle(y), y).toBe(true);
      expect(said.at(-1), y).toBe(GIMBAL_ASK_DOCK);
    }
  });

  it('no cancels; not yet waits', () => {
    const a = setup();
    a.ask.start('add the gimbal');
    expect(a.ask.handle('not yet')).toBe(true);
    expect(a.said.at(-1)).toBe(GIMBAL_ASK_WAIT);
    expect(a.ask.active()).toBe(true);
    expect(a.ask.handle('no')).toBe(true);
    expect(a.said.at(-1)).toBe(GIMBAL_ASK_CANCEL);
    expect(a.ask.active()).toBe(false);
  });

  it('any other line ends the ask and runs normally', () => {
    const { ask, ran } = setup(true);
    ask.start('add the gimbal');
    expect(ask.handle('turn on the lamp')).toBe(false);
    expect(ask.active()).toBe(false);
    expect(ask.handle('yes')).toBe(false);
    expect(ran).toEqual([]);
  });
});
