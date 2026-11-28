import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createConversation, MODAL_PRIORITY, CANCELLED_LINE, answersPrompt, type Claim, type Modal, type ModalId } from '../../src/canvas/conversation';
import { hear } from '../../src/canvas/hearing';
import { createGimbalAsk } from '../../src/canvas/gimbalAsk';
import { createPairFirst } from '../../src/canvas/pairedRow';

function fake(id: ModalId, kind: 'blocking' | 'soft', o: { on?: boolean; claim?: (t: string) => Claim; endLine?: string; listens?: boolean } = {}) {
  const st = { on: o.on ?? true, seen: [] as string[], cancelled: 0 };
  const m: Modal = {
    id, kind, priority: MODAL_PRIORITY[id], endLine: o.endLine, listens: o.listens,
    active: () => st.on,
    claim: (h) => { st.seen.push(h.text); const c = o.claim ? o.claim(h.text) : 'pass'; if (c === 'end-and-pass') st.on = false; return c; },
    prompt: () => `${id}?`,
    cancel: () => { st.cancelled++; st.on = false; },
  };
  return { m, st };
}
const setup = (...ms: ReturnType<typeof fake>[]) => {
  const said: string[] = [];
  const c = createConversation({ say: (l) => said.push(l) });
  for (const f of ms) c.register(f.m);
  return { c, said };
};

describe('conversation: one owner for her next line', () => {
  it('precedence is explicit', () => {
    const order = (Object.keys(MODAL_PRIORITY) as ModalId[]).sort((a, b) => MODAL_PRIORITY[b] - MODAL_PRIORITY[a]);
    expect(order).toEqual(['review', 'intentChoices', 'intentAsk', 'gimbalAsk', 'morph', 'pairFirst', 'pointChoice']);
    const all = (Object.keys(MODAL_PRIORITY) as ModalId[]).map((id) => fake(id, 'soft'));
    const { c } = setup(...all);
    expect(c.current()).toBe('review');
    all[0]!.st.on = false;
    expect(c.current()).toBe('intentChoices');
  });
  it('one claimant per line: the first that answers; lower ones never see it', () => {
    const a = fake('morph', 'soft', { claim: () => 'answered' });
    const b = fake('pointChoice', 'soft', { claim: () => 'answered' });
    const { c } = setup(b, a);
    expect(c.handle(hear('make it blue'))).toEqual({ claimed: true, by: 'morph', claim: 'answered' });
    expect(b.st.seen).toEqual([]);
  });
  it('a soft modal that passes lets the next one have the line (pair-first asking, then "Lamp 2")', () => {
    const pf = fake('pairFirst', 'soft', { claim: () => 'end-and-pass', endLine: 'Left pairing.' });
    const pc = fake('pointChoice', 'soft', { claim: (t) => (t === 'lamp 2' ? 'answered' : 'pass') });
    const { c, said } = setup(pf, pc);
    expect(c.handle(hear('lamp 2')).by).toBe('pointChoice');
    expect(said).toEqual(['Left pairing.']);
  });
  it('soft end-and-pass: says so, and the line is routed', () => {
    const pf = fake('pairFirst', 'soft', { claim: () => 'end-and-pass', endLine: 'Left pairing.' });
    const { c, said } = setup(pf);
    expect(c.handle(hear('play music')).claimed).toBe(false);
    expect(said).toEqual(['Left pairing.']);
  });
  it('blocking: a non-answer is re-prompted, never routed', () => {
    const g = fake('gimbalAsk', 'blocking', { claim: () => 'reprompt' });
    const low = fake('pointChoice', 'soft', { claim: () => 'answered' });
    const { c, said } = setup(g, low);
    expect(c.handle(hear('play music'))).toEqual({ claimed: true, by: 'gimbalAsk', claim: 'reprompt' });
    expect(said).toEqual(['gimbalAsk?']);
    expect(low.st.seen).toEqual([]);
    expect(answersPrompt(['yes', 'no'])).toBe('Answer the question first: yes, no, or say cancel.');
  });
  it.each(Object.keys(MODAL_PRIORITY).filter((id) => id !== 'review') as ModalId[])('"cancel" closes %s with a spoken line', (id) => {
    for (const kind of ['blocking', 'soft'] as const) {
      for (const word of ['cancel', 'never mind', 'Stop.', 'forget it']) {
        const f = fake(id, kind, { claim: () => (kind === 'blocking' ? 'reprompt' : 'pass') });
        const { c, said } = setup(f);
        expect(c.handle(hear(word)).claimed).toBe(true);
        expect(f.st.cancelled).toBe(1);
        expect(said).toEqual([CANCELLED_LINE]);
      }
    }
  });
  it('"stop following" is not a cancel', () => {
    const f = fake('pairFirst', 'soft');
    const { c } = setup(f);
    expect(c.handle(hear('stop following')).claimed).toBe(false);
    expect(f.st.cancelled).toBe(0);
  });
  it('the review watches only: counted by busy(), never offered a line', () => {
    const r = fake('review', 'blocking', { listens: false, claim: () => 'reprompt' });
    const { c } = setup(r);
    expect(c.handle(hear('keep it')).claimed).toBe(false);
    expect(r.st.seen).toEqual([]);
    expect(c.busy()).toBe(true);
    expect(c.busy({ blockingOnly: true })).toBe(true);
  });
  it('busy(): any active modal; blockingOnly ignores the soft ones; waits() wins over active()', () => {
    const pf = fake('pairFirst', 'soft');
    const { c } = setup(pf);
    expect(c.busy()).toBe(true);
    expect(c.busy({ blockingOnly: true })).toBe(false);
    pf.st.on = false;
    expect(c.busy()).toBe(false);
    const m = fake('morph', 'soft');
    m.m.waits = () => false;
    const two = setup(m);
    expect(two.c.busy()).toBe(false);
    expect(two.c.current()).toBe('morph');
  });
  it('the real flows peek without acting', () => {
    const said: string[] = [];
    const g = createGimbalAsk({ say: (l) => said.push(l), standReported: () => true, proceed: () => undefined });
    expect(g.claims('yes')).toBe(false);
    g.start('add the gimbal');
    expect(g.claims('yes')).toBe(true);
    expect(g.claims('cancel')).toBe(true);
    expect(g.claims('play music')).toBe(false);
    expect(g.active()).toBe(true);
    const pf = createPairFirst({ say: () => undefined, buildDashboard: () => undefined, busy: () => false, changed: () => undefined } as never);
    expect(pf.claims('build the dashboard')).toBe(false);
  });
  it('run() has no hand-typed modal chain left', () => {
    const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    const body = src.slice(src.indexOf('function run(text: string): boolean {'), src.indexOf('// ---- input ----'));
    expect(body).toContain('if (conversation.handle(heard).claimed) return true;');
    expect(body).not.toMatch(/pairFirst\.handleSpeech|gimbalAsk\.handle|handlePointChoice\(|morphFlow\?\.handleSpeech|if \(intentChoices\)|if \(intentAsk\)/);
    expect(src).toContain('conversation.busy()');
    expect(src).toContain('conversation.busy({ blockingOnly: true })');
  });
});
