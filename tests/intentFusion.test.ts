// On-device intent fusion: pure prompt/context building + result parsing
// (src/ai/intentFusion.ts, no network) and the hybrid fuseIntent wiring with
// mocked models (src/ai/hybrid.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OP_CONFIDENCE,
  FUSION_GUIDE,
  MAX_NEARBY,
  buildFusionConstraint,
  buildFusionPrompt,
  exactRuleParse,
  isClarify,
  normalizeTranscript,
  parseFusionResult,
  ruleConfidence,
  serializeFusionContext,
  type FusionContext,
} from '../src/ai/intentFusion';
import { fuseIntent, setModelsForTest, type TextGenModel } from '../src/ai/hybrid';
import { partMode, planMode, setActiveMode } from '../src/core/modes';

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

/** Plan-mode pointer context: cursor over wall w2, wall w1 selected. */
const planCtx: FusionContext = {
  space: 'plan',
  unit: 'mm',
  cursor: { x: 2450.6, y: 1200.2 },
  hoverId: 'w2',
  selectedIds: ['w1'],
  nearby: [
    { id: 'd1', kind: 'door', dist: 800.4 },
    { id: 'w3', kind: 'wall', dist: 300 },
    { id: 'win1', kind: 'window', label: 'a very long window label that keeps going', dist: 1500 },
  ],
};

describe('normalizeTranscript (disfluent speech)', () => {
  it('strips fillers and immediate stutters', () => {
    expect(normalizeTranscript('uh move move it um left a bit')).toBe('move it left a bit');
  });

  it('strips phrase fillers and leftover punctuation tokens', () => {
    expect(normalizeTranscript('you know , put a door here')).toBe('put a door here');
  });

  it('leaves a clean command untouched', () => {
    expect(normalizeTranscript('make this wall 4 meters')).toBe('make this wall 4 meters');
  });

  it('collapses stutters case-insensitively', () => {
    expect(normalizeTranscript('Move move it left')).toBe('Move it left');
  });
});

describe('serializeFusionContext', () => {
  it('emits rounded cursor, hover, selection, and nearest-first nearby', () => {
    const payload = JSON.parse(serializeFusionContext(planCtx));
    expect(payload).toMatchObject({ space: 'plan', unit: 'mm' });
    expect(payload.cursor).toEqual({ x: 2451, y: 1200 });
    expect(payload.under_cursor).toBe('w2');
    expect(payload.selected).toEqual(['w1']);
    expect(payload.nearby.map((n: { id: string }) => n.id)).toEqual(['w3', 'd1', 'win1']);
    expect(payload.nearby[1].dist).toBe(800);
  });

  it('truncates long labels and caps the nearby list', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, kind: 'wall', dist: i }));
    const ctx: FusionContext = { ...planCtx, nearby: many };
    const payload = JSON.parse(serializeFusionContext(ctx));
    expect(payload.nearby).toHaveLength(MAX_NEARBY);

    const labelled = JSON.parse(serializeFusionContext(planCtx));
    expect(labelled.nearby[2].label.length).toBeLessThanOrEqual(24);
  });

  it('omits empty fields (no cursor, no hover, nothing selected)', () => {
    const payload = JSON.parse(
      serializeFusionContext({ space: 'ui', unit: 'px', cursor: null, hoverId: null, selectedIds: [], nearby: [] }),
    );
    expect(payload).toEqual({ space: 'ui', unit: 'px' });
  });
});

describe('buildFusionPrompt / buildFusionConstraint', () => {
  it('combines the mode intent prompt, deixis guide, context, and cleaned transcript', () => {
    const prompt = buildFusionPrompt(planMode.ai.intentPrompt, 'uh put a door door here', planCtx);
    expect(prompt).toContain(planMode.ai.intentPrompt.slice(0, 40));
    expect(prompt).toContain(FUSION_GUIDE);
    expect(prompt).toContain('"under_cursor":"w2"');
    expect(prompt).toContain('Transcript: "put a door here"');
  });

  it('adds a confidence property without mutating the mode constraint', () => {
    const fused = buildFusionConstraint(planMode.ai.opConstraint);
    const props = fused.properties as Record<string, unknown>;
    expect(props.confidence).toEqual({ type: 'number' });
    expect(props.op).toBeDefined();
    expect(
      (planMode.ai.opConstraint.properties as Record<string, unknown>).confidence,
    ).toBeUndefined();
  });
});

describe('parseFusionResult', () => {
  const coerce = partMode.coerce;

  it('splits confidence off a valid op and validates the rest', () => {
    const parsed = parseFusionResult({ op: 'select', target: 'p3', confidence: 0.8 }, coerce, 'select p3');
    expect(parsed).not.toBeNull();
    expect(parsed!.result).toEqual({ op: 'select', target: 'p3' });
    expect(parsed!.confidence).toBe(0.8);
    expect('confidence' in parsed!.result).toBe(false);
  });

  it('accepts percent-style and string confidences, clamped to [0,1]', () => {
    const pct = parseFusionResult({ op: 'undo', confidence: 85 }, coerce, 'undo');
    expect(pct!.confidence).toBe(0.85);
    const str = parseFusionResult({ op: 'undo', confidence: '0.4' }, coerce, 'undo');
    expect(str!.confidence).toBe(0.4);
    const neg = parseFusionResult({ op: 'undo', confidence: -2 }, coerce, 'undo');
    expect(neg!.confidence).toBe(0);
    // A non-integer overshoot is a clamp, NOT a percent (1.5 => 1, not 0.015).
    const over = parseFusionResult({ op: 'undo', confidence: 1.5 }, coerce, 'undo');
    expect(over!.confidence).toBe(1);
  });

  it('defaults a missing confidence: ops medium, clarifies zero', () => {
    expect(parseFusionResult({ op: 'undo' }, coerce, 'undo')!.confidence).toBe(DEFAULT_OP_CONFIDENCE);
    const clar = parseFusionResult({ clarify: 'Which part?' }, coerce, 'move it');
    expect(clar!.result).toEqual({ clarify: 'Which part?' });
    expect(clar!.confidence).toBe(0);
  });

  it('rejects invalid ops and non-objects', () => {
    expect(parseFusionResult({ op: 'explode', target: 'all' }, coerce, 'explode')).toBeNull();
    expect(parseFusionResult('not an object', coerce, 'x')).toBeNull();
    expect(parseFusionResult([1, 2], coerce, 'x')).toBeNull();
    expect(parseFusionResult(null, coerce, 'x')).toBeNull();
  });
});

describe('exactRuleParse (router short-circuit seam)', () => {
  it('returns the deterministic op for an exact command, even with fillers', () => {
    const r = exactRuleParse(planMode.parse, 'uh make make this wall 4 meters');
    expect(r).toMatchObject({ op: 'set_length', target: 'selected', nums: { length: 4 }, unit: 'm' });
    expect(ruleConfidence(r!)).toBe(1);
  });

  it('returns null when rules can only ask a clarify (→ fusion runs)', () => {
    const r = exactRuleParse(planMode.parse, 'move this a bit left');
    expect(r).toBeNull();
    expect(isClarify(planMode.parse('move this a bit left'))).toBe(true);
  });
});

describe('hybrid fuseIntent', () => {
  beforeEach(() => setActiveMode('plan'));
  afterEach(() => {
    setModelsForTest(null);
    setActiveMode('plan');
  });

  it('resolves a deictic command via the fusion model and keeps its confidence', async () => {
    let seenPrompt = '';
    setModelsForTest({
      enabled: true,
      fusion: {
        generateContent: async (prompt: string) => {
          seenPrompt = prompt;
          return {
            response: {
              text: () => '{"op":"add_door","target":"w2","confidence":0.9}',
              inferenceSource: 'on_device',
            },
          };
        },
      },
    });
    const r = await fuseIntent('uh put a door door here', planCtx);
    expect(r.source).toBe('on-device');
    expect(r.confidence).toBe(0.9);
    expect(r.result).toMatchObject({ op: 'add_door', target: 'w2' });
    expect(seenPrompt).toContain('"under_cursor":"w2"');
    expect(seenPrompt).toContain('Transcript: "put a door here"');
  });

  it('passes a model clarify through with its (zero) confidence', async () => {
    setModelsForTest({
      enabled: true,
      fusion: model('{"clarify":"Which wall?","confidence":0}', 'in_cloud'),
    });
    const r = await fuseIntent('make that one wider', planCtx);
    expect(r.source).toBe('cloud');
    expect(r.result).toEqual({ clarify: 'Which wall?' });
    expect(r.confidence).toBe(0);
  });

  it('retries on the cloud twin when the on-device call throws', async () => {
    setModelsForTest({
      enabled: true,
      fusion: { generateContent: async () => { throw new Error('nano crashed'); } },
      fusionCloud: model('{"op":"delete","target":"w2","confidence":0.7}'),
    });
    const r = await fuseIntent('remove that', planCtx);
    expect(r.source).toBe('cloud');
    expect(r.result).toEqual({ op: 'delete', target: 'w2' });
    expect(r.confidence).toBe(0.7);
  });

  it('falls back to rules on a cleaned transcript when disabled', async () => {
    setModelsForTest({ enabled: false });
    const r = await fuseIntent('uh make make this wall 4 meters', planCtx);
    expect(r.source).toBe('rules');
    expect(r.result).toMatchObject({ op: 'set_length', nums: { length: 4 } });
    expect(r.confidence).toBe(1);
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('falls back to rules when the model emits junk; clarifies score 0', async () => {
    setModelsForTest({ enabled: true, fusion: model('total garbage') });
    const r = await fuseIntent('add a door', planCtx);
    expect(r.source).toBe('rules');
    expect(r.result).toMatchObject({ op: 'add_door', target: 'selected' });
    expect(r.confidence).toBe(1);

    setModelsForTest({ enabled: true, fusion: model('{"op":"explode"}') });
    const r2 = await fuseIntent('move this a bit left', planCtx);
    expect(r2.source).toBe('rules');
    expect(isClarify(r2.result)).toBe(true);
    expect(r2.confidence).toBe(0);
  });
});
