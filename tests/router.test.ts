// Visible hybrid router: pure decision logic (src/ai/router.ts) — exact-rule
// short circuit, on-device default, every cloud-escalation reason, honest
// badge/reason reconciliation, label formatting — plus the hybrid fuseIntent
// forceCloud escalation seam with mocked models.

import { afterEach, describe, expect, it } from 'vitest';
import {
  LOW_CONFIDENCE,
  badgeLabel,
  finalReason,
  formatLogEntry,
  isPointing,
  pickEscalated,
  planRoute,
  shouldEscalate,
  type RouteLogEntry,
  type RouterEnv,
} from '../src/ai/router';
import { fuseIntent, setModelsForTest, type FusionContext, type TextGenModel } from '../src/ai/hybrid';
import { setActiveMode } from '../src/core/modes';

const OP = { op: 'move', target: 'w1', dx: 100 };
const parseHit = (): object => OP;
const parseMiss = (): object => ({ clarify: 'What?' });

const BOTH: RouterEnv = { deviceReady: true, cloudReady: true };
const CLOUD_ONLY: RouterEnv = { deviceReady: false, cloudReady: true };
const DEVICE_ONLY: RouterEnv = { deviceReady: true, cloudReady: false };
const NONE: RouterEnv = { deviceReady: false, cloudReady: false };

describe('planRoute', () => {
  it('short-circuits to rules on an exact command (no model touched)', () => {
    const d = planRoute('move left 10', parseHit, false, BOTH);
    expect(d).toEqual({ path: 'rules', reason: 'exact', ruleResult: OP });
  });

  it('exact rules win even with no AI at all', () => {
    expect(planRoute('move left 10', parseHit, false, NONE)).toEqual({
      path: 'rules', reason: 'exact', ruleResult: OP,
    });
  });

  it('a clarify from the parser is NOT an exact match — goes on-device', () => {
    expect(planRoute('make it nicer', parseMiss, false, BOTH)).toEqual({
      path: 'on-device', reason: 'private',
    });
  });

  it('pointing commands skip the rule parser when a model can ground them', () => {
    // "window here" would rule-parse (greedy "window" match) but only fusion
    // knows where "here" is.
    expect(planRoute('put a window here', parseHit, false, BOTH).path).toBe('on-device');
    expect(planRoute('make that one wider', parseHit, false, CLOUD_ONLY).path).toBe('cloud');
  });

  it('pointing commands still use exact rules when no model exists', () => {
    expect(planRoute('put a window here', parseHit, false, NONE)).toEqual({
      path: 'rules', reason: 'exact', ruleResult: OP,
    });
  });

  it('escalates to cloud when on-device is unavailable', () => {
    expect(planRoute('make it nicer', parseMiss, false, CLOUD_ONLY)).toEqual({
      path: 'cloud', reason: 'no-device',
    });
  });

  it('escalates big jobs (whole-design generation) straight to the cloud', () => {
    expect(planRoute('design a two bedroom house', parseHit, true, BOTH)).toEqual({
      path: 'cloud', reason: 'big-job',
    });
  });

  it('big job with no cloud degrades honestly to rules · offline', () => {
    expect(planRoute('design a two bedroom house', parseHit, true, DEVICE_ONLY)).toEqual({
      path: 'rules', reason: 'offline',
    });
  });

  it('no model, no exact match → rules · offline', () => {
    expect(planRoute('make it nicer', parseMiss, false, NONE)).toEqual({
      path: 'rules', reason: 'offline',
    });
  });
});

describe('isPointing', () => {
  it('detects spatial deixis, not plain selection words', () => {
    expect(isPointing('put a door here')).toBe(true);
    expect(isPointing('move that one over there')).toBe(true);
    expect(isPointing('same as the other window')).toBe(true);
    expect(isPointing('move it left 10')).toBe(false); // "it" = selection, rules handle it
    expect(isPointing('add a window to the north wall')).toBe(false);
  });
});

describe('shouldEscalate (low-confidence re-ask)', () => {
  it('escalates an unsure on-device answer when the cloud is there', () => {
    expect(shouldEscalate('on-device', LOW_CONFIDENCE - 0.01, BOTH)).toBe(true);
  });
  it('does not escalate a confident on-device answer', () => {
    expect(shouldEscalate('on-device', LOW_CONFIDENCE, BOTH)).toBe(false);
    expect(shouldEscalate('on-device', 0.95, BOTH)).toBe(false);
  });
  it('never escalates without a cloud, or from non-device sources', () => {
    expect(shouldEscalate('on-device', 0.1, DEVICE_ONLY)).toBe(false);
    expect(shouldEscalate('cloud', 0.1, BOTH)).toBe(false);
    expect(shouldEscalate('rules', 0.1, BOTH)).toBe(false);
  });
});

describe('pickEscalated', () => {
  const unsureOp = { result: OP, confidence: 0.3, source: 'on-device' as const };
  const unsureClarify = { result: { clarify: 'Which wall?' }, confidence: 0.2, source: 'on-device' as const };

  it('a concrete cloud op beats an on-device clarify', () => {
    const cloud = { result: OP, confidence: 0.4, source: 'cloud' as const };
    expect(pickEscalated(unsureClarify, cloud)).toEqual({ outcome: cloud, escalated: true });
  });
  it('a more confident cloud op beats the unsure on-device op', () => {
    const cloud = { result: { op: 'resize' }, confidence: 0.9, source: 'cloud' as const };
    expect(pickEscalated(unsureOp, cloud)).toEqual({ outcome: cloud, escalated: true });
  });
  it('a less confident cloud op does not replace the on-device op', () => {
    const cloud = { result: { op: 'resize' }, confidence: 0.1, source: 'cloud' as const };
    expect(pickEscalated(unsureOp, cloud)).toEqual({ outcome: unsureOp, escalated: false });
  });
  it('a cloud clarify never replaces a concrete on-device op', () => {
    const cloud = { result: { clarify: 'Hm?' }, confidence: 0.9, source: 'cloud' as const };
    expect(pickEscalated(unsureOp, cloud)).toEqual({ outcome: unsureOp, escalated: false });
  });
  it('a failed escalation (null or rules floor) keeps the original', () => {
    expect(pickEscalated(unsureOp, null)).toEqual({ outcome: unsureOp, escalated: false });
    const floor = { result: OP, confidence: 1, source: 'rules' as const };
    expect(pickEscalated(unsureOp, floor)).toEqual({ outcome: unsureOp, escalated: false });
  });
});

describe('finalReason (badge honesty: planned vs actual)', () => {
  it('keeps the planned reason when the plan held', () => {
    expect(finalReason({ path: 'rules', reason: 'exact' }, 'rules', false)).toBe('exact');
    expect(finalReason({ path: 'rules', reason: 'offline' }, 'rules', false)).toBe('offline');
    expect(finalReason({ path: 'on-device', reason: 'private' }, 'on-device', false)).toBe('private');
    expect(finalReason({ path: 'cloud', reason: 'big-job' }, 'cloud', false)).toBe('big-job');
    expect(finalReason({ path: 'cloud', reason: 'no-device' }, 'cloud', false)).toBe('no-device');
  });
  it('an AI plan answered by rules is labelled fallback, never exact/private', () => {
    expect(finalReason({ path: 'on-device', reason: 'private' }, 'rules', false)).toBe('fallback');
    expect(finalReason({ path: 'cloud', reason: 'big-job' }, 'rules', false)).toBe('fallback');
  });
  it('an on-device plan silently run in the cloud is labelled no-device', () => {
    expect(finalReason({ path: 'on-device', reason: 'private' }, 'cloud', false)).toBe('no-device');
  });
  it('an escalated answer is labelled low confidence', () => {
    expect(finalReason({ path: 'on-device', reason: 'private' }, 'cloud', true)).toBe('low-confidence');
  });
});

describe('badgeLabel', () => {
  it('formats source · reason', () => {
    expect(badgeLabel('cloud', 'big-job')).toBe('Cloud · big job');
    expect(badgeLabel('on-device', 'private')).toBe('On-device · private');
    expect(badgeLabel('cloud', 'low-confidence')).toBe('Cloud · low confidence');
    expect(badgeLabel('cloud', 'no-device')).toBe('Cloud · no on-device AI');
    expect(badgeLabel('rules', 'exact')).toBe('Rules · exact command');
    expect(badgeLabel('rules', 'offline')).toBe('Rules · offline');
    expect(badgeLabel('rules', 'fallback')).toBe('Rules · fallback');
  });
});

describe('formatLogEntry (dev panel line)', () => {
  it('shows utterance, label, confidence, latency, escalation', () => {
    const e: RouteLogEntry = {
      utterance: 'put a door here',
      planned: 'on-device',
      source: 'cloud',
      reason: 'low-confidence',
      confidence: 0.812,
      escalated: true,
      ms: 41.6,
    };
    expect(formatLogEntry(e)).toBe('"put a door here" → Cloud · low confidence (0.81, 42 ms, escalated)');
  });
  it('flags a planned-vs-actual mismatch and truncates long utterances', () => {
    const e: RouteLogEntry = {
      utterance: 'x'.repeat(60),
      planned: 'cloud',
      source: 'rules',
      reason: 'fallback',
      escalated: false,
      ms: 12,
    };
    const line = formatLogEntry(e);
    expect(line).toContain('planned cloud →');
    expect(line).toContain('Rules · fallback (12 ms)');
    expect(line).toContain(`"${'x'.repeat(47)}…"`);
  });
});

// ─── fuseIntent forceCloud seam (mocked models, no network) ──────────────────

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

const ctx: FusionContext = {
  space: 'part', unit: 'mm', cursor: null, hoverId: null, selectedIds: [], nearby: [],
};

describe('fuseIntent forceCloud (escalation execution)', () => {
  afterEach(() => {
    setModelsForTest(null);
    setActiveMode('plan');
  });

  it('forceCloud uses the cloud-only fusion twin and reports cloud', async () => {
    setActiveMode('part');
    setModelsForTest({
      enabled: true,
      fusion: model('{"clarify":"should not be used","confidence":0.1}', 'on_device'),
      fusionCloud: model('{"op":"move","target":"selected","dx":-10,"dy":0,"dz":0,"confidence":0.9}'),
    });
    const r = await fuseIntent('move it a bit left', ctx, { forceCloud: true });
    expect(r.source).toBe('cloud');
    expect(r.confidence).toBe(0.9);
    expect(r.result).toEqual({ op: 'move', target: 'selected', dx: -10, dy: 0, dz: 0 });
  });

  it('forceCloud with no cloud model falls to the deterministic rules floor', async () => {
    setActiveMode('part');
    setModelsForTest({
      enabled: true,
      fusion: model('{"op":"move","target":"selected","dx":-10,"dy":0,"dz":0,"confidence":0.9}', 'on_device'),
    });
    const r = await fuseIntent('uh move move left 10', ctx, { forceCloud: true });
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ op: 'move', target: 'selected', dx: -10, dy: 0, dz: 0 });
  });
});
