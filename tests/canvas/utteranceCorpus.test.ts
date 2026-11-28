import { describe, expect, it } from 'vitest';
import { hear } from '../../src/canvas/hearing';
import { askFirst, decideIntent, isCommand } from '../../src/canvas/intentRouter';
import { routeLine } from '../../src/canvas/routeLine';
import { BASE_WORLD, CORPUS } from './utteranceCorpus.data';

describe('utterance corpus: every line lands where it must', () => {
  it.each(CORPUS.map((r) => [r.heard, r] as const))('%s', (_h, row) => {
    const h = hear(row.heard);
    const r = routeLine(h.text, { ...BASE_WORLD, ...row.world });
    if (row.tier === 'fixed') { expect(r.name).toBe(row.route); return; }
    // No fixed phrase: Nano, the choices card or chat decides.
    expect(r.name).toBe('openEnded');
    if (row.tier === 'chat') { expect(isCommand(h.text)).toBe(false); return; }
    if (row.tier === 'clarify') { expect(isCommand(h.text)).toBe(true); return; }
    // nano: whatever board Nano names, her purpose words decide it.
    for (const guess of ['showDevices', 'buildDashboard', 'floorPlan']) {
      const d = askFirst(decideIntent({ intent: guess, confidence: 0.95 }), h.text);
      if (guess === row.intent || (guess === 'buildDashboard' && row.intent === 'showDevices')) expect(d.kind !== 'chat' && d.action.id, guess).toBe(row.intent);
    }
  });
  it('covers the three boards, word and purpose, and every action', () => {
    const fixed = CORPUS.filter((r) => r.tier === 'fixed').map((r) => r.route);
    for (const route of ['showDevices', 'connectRoom', 'floorPlan']) expect(fixed).toContain(route);
    expect(CORPUS.filter((r) => r.tier === 'nano').map((r) => r.intent).sort()).toEqual(['buildDashboard', 'floorPlan', 'showDevices']);
  });
});
