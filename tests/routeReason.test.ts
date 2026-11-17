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
