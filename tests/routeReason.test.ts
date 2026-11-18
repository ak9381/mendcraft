import { describe, expect, it } from 'vitest';
import { NANO_ROUTE_TIMEOUT_MS, raceHardQuestion, type NanoPick } from '../src/cad/hardRace';
import {
  becauseFromSpecWhy,
  capRouteReason,
  formatRouteLine,
  routeGemini,
  routeNanoCanvas,
  routeOffline,
  routePlanData,
  routeSpeculative,
  sanitizeRoute,
  wonByFromModel,
} from '../src/cad/routeReason';

const nanoTool = (tool: string): NanoPick => ({
  call: { tool, args: {} }, confidence: 0.9, source: 'on-device', ms: 8,
});

describe('formatRouteLine for each tier', () => {
  it('formats a rules plan-data answer', () => {
    expect(formatRouteLine(routePlanData())).toBe(
      'Plan data · on device — answered straight from the drawing, no AI needed',
    );
  });

  it('formats a local Nano canvas action', () => {
    expect(formatRouteLine(routeNanoCanvas())).toBe(
      'Nano · on device — a canvas action, handled locally',
    );
  });

  it('formats Gemini judgment, writing and guideline reasons', () => {
    expect(formatRouteLine(routeGemini({ kind: 'judgment' }))).toBe(
      'Gemini · cloud — needs structural judgment',
    );
    expect(formatRouteLine(routeGemini({ kind: 'email' }))).toBe(
      'Gemini · cloud — needs writing (client email)',
    );
    expect(formatRouteLine(routeGemini({ kind: 'guideline' }))).toBe(
      'Gemini · cloud — needs a guideline explanation',
    );
  });

  it('formats a timeout winner and an unsure Nano hand-off', () => {
    expect(formatRouteLine(routeGemini({ nano: 'late', nanoTimeoutMs: NANO_ROUTE_TIMEOUT_MS }))).toBe(
      'Gemini won — Nano took over 2 s',
    );
    expect(formatRouteLine(routeGemini({ nano: 'unsure' }))).toBe(
      'Nano unsure, Gemini answer used',
    );
  });

  it('formats offline and speculative confirm/correct lines', () => {
    expect(formatRouteLine(routeOffline())).toBe('Offline — kept on device');
    expect(formatRouteLine(routeSpeculative({ state: 'confirmed', because: 'the answers overlapped' }))).toBe(
      "Nano's guess — Gemini confirmed because the answers overlapped",
    );
    expect(formatRouteLine(routeSpeculative({ state: 'corrected', because: 'the wall needs a structural check' }))).toBe(
      "Nano's guess — Gemini corrected because the wall needs a structural check",
    );
  });

  it('does not treat a source badge as a speculative because-clause', () => {
    expect(becauseFromSpecWhy('Gemini · cloud')).toBeUndefined();
    expect(formatRouteLine(routeSpeculative({ state: 'confirmed', because: 'Gemini · cloud' }))).toBe(
      "Nano's guess — Gemini confirmed this guess",
    );
    expect(formatRouteLine(routeGemini({ kind: 'judgment' }))).toBe(
      'Gemini · cloud — needs structural judgment',
    );
  });

  // Real-Nano remeasure bug (18 Nov): the engine concatenates the draft why and
  // the canned confirm sentence, so the on-screen line read "Gemini confirmed
  // because Nano's guess while you were still speaking. Gemini confirmed this
  // guess." The canned sentences must be stripped wherever they appear.
  it('drops canned speculative sentences even when they are concatenated', () => {
    const canned = "Nano's guess while you were still speaking. Gemini confirmed this guess.";
    expect(becauseFromSpecWhy(canned)).toBeUndefined();
    expect(formatRouteLine(routeSpeculative({ state: 'confirmed', because: canned }))).toBe(
      "Nano's guess — Gemini confirmed this guess",
    );
    expect(becauseFromSpecWhy(
      'The user is asking about the hallway. Gemini confirmed this guess. both answers give 900 mm',
    )).toBe('both answers give 900 mm');
    expect(formatRouteLine(routeSpeculative({
      state: 'withdrawn',
      because: "Withdrawn: Gemini disagreed with Nano's guess. The door is on a load-bearing wall.",
    }))).toBe("Nano's guess — Gemini withdrew this guess because The door is on a load-bearing wall.");
    expect(becauseFromSpecWhy('Gemini updated the answer. ')).toBeUndefined();
  });

  it('appends the condensed-words suffix only when Nano condensed on device', () => {
    expect(formatRouteLine(routeGemini({ kind: 'judgment', condensed: { from: 41, to: 8 } }))).toBe(
      'Gemini · cloud — needs structural judgment · Nano condensed 41 → 8 words on device',
    );
    expect(formatRouteLine(routeGemini({ kind: 'judgment' }))).toBe(
      'Gemini · cloud — needs structural judgment',
    );
    const capped = routeGemini({ why: 'y'.repeat(200), condensed: { from: 41, to: 8 } });
    expect(capped.reason.length).toBeLessThanOrEqual(140);
  });

  it('appends the kept-on-device suffix only when something was redacted', () => {
    expect(formatRouteLine(routeGemini({ kind: 'judgment', redacted: { names: 1, details: 0 } }))).toBe(
      'Gemini · cloud — needs structural judgment · 1 name kept on device',
    );
    expect(routeGemini({ kind: 'hard', redacted: { names: 2, details: 0 } }).reason).toContain('2 names kept on device');
    expect(routeGemini({ kind: 'hard', redacted: { names: 0, details: 1 } }).reason).toContain('1 private detail kept on device');
    expect(routeGemini({ kind: 'judgment', redacted: { names: 0, details: 0 } }).reason).toBe('needs structural judgment');
  });

  it('marks an offline answer that queued a Gemini check', () => {
    expect(formatRouteLine(routeOffline({ refineQueued: true }))).toBe(
      "Offline — answered from the drawing; Gemini will check when you're back online",
    );
    expect(formatRouteLine(routeOffline())).toBe('Offline — kept on device');
  });

  it('uses Gemini\'s own short why on the hard tier when the race has no Nano note', () => {
    const line = formatRouteLine(routeGemini({ kind: 'hard', why: '  Check if the wall is load-bearing before taking it down.  ' }));
    expect(line).toBe('Gemini · cloud — Check if the wall is load-bearing before taking it down.');
  });

  it('caps a long Gemini why and keeps sanitize strict', () => {
    const long = 'x'.repeat(200);
    expect(capRouteReason(long).endsWith('…')).toBe(true);
    expect(capRouteReason(long).length).toBeLessThanOrEqual(140);
    expect(sanitizeRoute({ tier: 'gemini', engine: 'gemini', reason: long })?.reason.endsWith('…')).toBe(true);
    expect(sanitizeRoute({ tier: 'magic', engine: 'gemini', reason: 'no' })).toBeUndefined();
    expect(wonByFromModel('gemini-3.1-flash-lite')).toBe('hedge-backup');
    expect(wonByFromModel('gemini-3.5-flash-lite')).toBe('hedge-primary');
  });
});

describe('hard-race notes that feed the reason', () => {
  it('marks a late Nano when the timeout fires and the cloud wins', async () => {
    const res = await raceHardQuestion({
      judgement: false, hard: true, online: true, deviceReady: true,
      nanoTimeoutMs: 20,
      pickNano: () => new Promise((resolve) => setTimeout(() => resolve(nanoTool('add_door')), 80)),
      askCloud: () => new Promise((resolve) => setTimeout(() => resolve({ answer: 'from cloud', calls: [], why: '', source: 'cloud', ms: 40 }), 40)),
    });
    expect(res.kind).toBe('cloud');
    if (res.kind === 'cloud') expect(res.nano).toBe('late');
  });

  it('marks Nano unsure when it returns ask_gemini or low confidence', async () => {
    const res = await raceHardQuestion({
      judgement: false, hard: true, online: true, deviceReady: true,
      pickNano: async () => ({ call: { tool: 'ask_gemini', args: {} }, confidence: 0.2, source: 'on-device', ms: 4 }),
      askCloud: async () => ({ answer: 'cloud', calls: [], why: 'structural check', source: 'cloud', ms: 4 }),
    });
    expect(res.kind).toBe('cloud');
    if (res.kind === 'cloud') expect(res.nano).toBe('unsure');
  });

  it('marks offline judgement questions and ignored Nano on judgement', async () => {
    const off = await raceHardQuestion({
      judgement: true, hard: true, online: false, deviceReady: true,
      pickNano: async () => nanoTool('delete'),
    });
    expect(off.kind).toBe('offline');
    if (off.kind === 'offline') expect(off.nano).toBe('ignored-judgement');

    const cloud = await raceHardQuestion({
      judgement: true, hard: true, online: true, deviceReady: true,
      pickNano: async () => nanoTool('delete'),
      askCloud: async () => ({ answer: 'Advice only.', calls: [], why: '', source: 'cloud', ms: 5 }),
    });
    expect(cloud.kind).toBe('cloud');
    if (cloud.kind === 'cloud') expect(cloud.nano).toBe('ignored-judgement');
  });
});
