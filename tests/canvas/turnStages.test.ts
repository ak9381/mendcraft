// @vitest-environment happy-dom
// One rules-lane line per stage, kept on each turn's record in window.__mcTurns:
// heard → fixed → modal / route / nano / chat → outcome. One line per tier.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { createTurnLog, type TurnRecord } from '../../src/canvas/turns';
import { cantDoYetLine } from '../../src/canvas/turns';

let handle: CanvasHandle | null = null;
function mount(): CanvasHandle {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) } });
  return handle;
}
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });
const turns = (): TurnRecord[] => (window as unknown as { __mcTurns: TurnRecord[] }).__mcTurns;
const last = (): TurnRecord => turns().at(-1)!;

describe('turn stages (window.__mcTurns)', () => {
  it('fixed tier: heard → fixed → route', () => {
    mount();
    handle!.run('new board');
    handle!.run('connect the gymbo');
    const r = last();
    expect(r).toMatchObject({ raw: 'connect the gymbo', text: 'connect the gimbal', fixes: ['connect the gymbo→connect the gimbal'], tier: 'fixed' });
    expect(r.stages.slice(0, 3)).toEqual(['heard "connect the gymbo"', 'fixed connect the gymbo→connect the gimbal', 'route connectRoom (fixed)']);
  });
  it('clarify tier, then the modal tier answers it, then a second miss is refused', async () => {
    const h = mount();
    h.run('build me a thing for the stuff');
    const ask = last();
    expect(ask.tier).toBe('clarify');
    expect(ask.outcome).toBe('asked');
    expect(ask.stages[0]).toBe('heard "build me a thing for the stuff"');
    expect(ask.stages).toContain('no Nano → choices');
    expect(ask.stages.some((l) => /^outcome asked /.test(l))).toBe(true);
    // her pick answers the card: the modal claims it and the picked route runs
    h.run('the first one');
    const pick = last();
    expect(pick).toMatchObject({ tier: 'modal', modal: 'intentChoices' });
    expect(pick.stages).toEqual(expect.arrayContaining(['modal intentChoices: answered', 'route showDevices (picked)']));
    expect(pick.stages.indexOf('modal intentChoices: answered')).toBeGreaterThan(pick.stages.indexOf('route showDevices (picked)'));
    // a miss, "something else", a second miss: it names what works instead of another card
    const mark = h.statusMark();
    h.run('make a widget for my things');
    expect(last().outcome).toBe('asked');
    h.run('build the doohickey'); // the card is up: re-prompted, not routed
    expect(last()).toMatchObject({ modal: 'intentChoices', outcome: 'asked' });
    h.run('something else');
    h.run('build the doohickey');
    expect(last()).toMatchObject({ tier: 'clarify', outcome: 'refused' });
    expect(h.statusSince(mark)).toContain(cantDoYetLine());
  });
  it('chat tier: not a command goes to chat', async () => {
    mount();
    handle!.run('hello there');
    await vi.waitFor(() => expect(last().tier).toBe('chat'));
    expect(last().stages[0]).toBe('heard "hello there"');
  });
  it('the log keeps the last 50', () => {
    const log = createTurnLog();
    for (let i = 1; i <= 60; i++) log.begin(i, `l${i}`, `l${i}`, []);
    expect(log.entries()).toHaveLength(50);
    expect(log.entries()[0]!.id).toBe(11);
    log.tier(60, 'nano'); log.tier(60, 'chat');
    expect(log.entries().at(-1)!.tier).toBe('nano');
  });
});
