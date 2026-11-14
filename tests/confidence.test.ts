// Confidence states (sure / unsure / unknown), the "Did you mean…?" chooser
// (choice building + spoken replies, English and Kannada), and the destructive-
// op confirm gate — all pure logic in src/ai/confidence.ts.

import { describe, expect, it } from 'vitest';
import {
  SURE_AMBIGUOUS_DEIXIS,
  SURE_CONFIDENCE,
  buildChoices,
  choicePrompt,
  classifyConfidence,
  describeOp,
  isDestructiveOp,
  parseChoiceReply,
  suggestCommands,
  type Choice,
} from '../src/ai/confidence';

describe('classifyConfidence', () => {
  it('rules results are always sure (deterministic: match or clarify)', () => {
    expect(classifyConfidence({ valid: true, clarify: false, source: 'rules' })).toBe('sure');
  });

  it('a clarify is unknown regardless of source', () => {
    expect(classifyConfidence({ valid: false, clarify: true, source: 'on-device', confidence: 0.9 })).toBe('unknown');
    expect(classifyConfidence({ valid: true, clarify: true, source: 'cloud', confidence: 1 })).toBe('unknown');
  });

  it('an invalid (unvalidated) result is unknown', () => {
    expect(classifyConfidence({ valid: false, clarify: false, source: 'cloud', confidence: 0.99 })).toBe('unknown');
  });

  it('high model confidence is sure, low is unsure', () => {
    expect(classifyConfidence({ valid: true, clarify: false, source: 'on-device', confidence: SURE_CONFIDENCE })).toBe('sure');
    expect(classifyConfidence({ valid: true, clarify: false, source: 'on-device', confidence: 0.5 })).toBe('unsure');
    expect(classifyConfidence({ valid: true, clarify: false, source: 'cloud', confidence: 0.69 })).toBe('unsure');
  });

  it('missing confidence on a model answer is unsure, never sure', () => {
    expect(classifyConfidence({ valid: true, clarify: false, source: 'on-device' })).toBe('unsure');
  });

  it('rule agreement makes a low-confidence model op sure (two paths agree)', () => {
    expect(classifyConfidence({
      valid: true, clarify: false, source: 'on-device', confidence: 0.3, ruleAgrees: true,
    })).toBe('sure');
  });

  it('rule disagreement does NOT rescue a low-confidence op', () => {
    expect(classifyConfidence({
      valid: true, clarify: false, source: 'on-device', confidence: 0.5, ruleAgrees: false,
    })).toBe('unsure');
  });

  it('ambiguous deixis raises the bar', () => {
    const base = { valid: true, clarify: false, source: 'on-device' as const, deixisAmbiguous: true };
    expect(classifyConfidence({ ...base, confidence: 0.8 })).toBe('unsure');
    expect(classifyConfidence({ ...base, confidence: SURE_AMBIGUOUS_DEIXIS })).toBe('sure');
  });
});

describe('buildChoices', () => {
  const c = (op: Record<string, unknown>, source: Choice['source'] = 'on-device'): Choice => ({
    label: describeOp(op), result: op, source,
  });

  it('dedupes identical ops and keeps order', () => {
    const a = c({ op: 'move', target: 'w1', dx: 100 });
    const b = c({ op: 'move', target: 'w1', dx: 100 }, 'rules');
    const d = c({ op: 'delete', target: 'w1' });
    expect(buildChoices([a, b, d])).toEqual([a, d]);
  });

  it('drops nulls and clarify results, caps at 3', () => {
    const clarify = c({ clarify: 'which wall?' } as Record<string, unknown>);
    const many = [null, clarify, c({ op: 'a' }), undefined, c({ op: 'b' }), c({ op: 'c' }), c({ op: 'd' })];
    const out = buildChoices(many);
    expect(out.map((x) => x.result.op)).toEqual(['a', 'b', 'c']);
  });
});

describe('describeOp', () => {
  it('names the op and its scalar fields', () => {
    expect(describeOp({ op: 'set_thickness', target: 'w3', mm: 200 })).toBe('set thickness (target w3, mm 200)');
  });
  it('summarizes batches by step count', () => {
    expect(describeOp({ op: 'batch', ops: [{ op: 'a' }, { op: 'b' }] })).toBe('batch of 2 steps');
  });
  it('truncates long descriptions', () => {
    const s = describeOp({ op: 'rename', target: 'x'.repeat(100) });
    expect(s.length).toBeLessThanOrEqual(64);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('parseChoiceReply', () => {
  it('matches English ordinals, digits, and phrasing', () => {
    expect(parseChoiceReply('first', 3)).toEqual({ kind: 'pick', index: 0 });
    expect(parseChoiceReply('the second one', 3)).toEqual({ kind: 'pick', index: 1 });
    expect(parseChoiceReply('2', 3)).toEqual({ kind: 'pick', index: 1 });
    expect(parseChoiceReply('Third!', 3)).toEqual({ kind: 'pick', index: 2 });
  });

  it('matches Kannada ordinals and cancel words (marks preserved)', () => {
    expect(parseChoiceReply('ಮೊದಲನೇ', 2)).toEqual({ kind: 'pick', index: 0 });
    expect(parseChoiceReply('ಎರಡನೇ', 2)).toEqual({ kind: 'pick', index: 1 });
    expect(parseChoiceReply('ಬೇಡ', 2)).toEqual({ kind: 'cancel' });
    expect(parseChoiceReply('ರದ್ದು', 1)).toEqual({ kind: 'cancel' });
  });

  it('cancel wins: "no, cancel"', () => {
    expect(parseChoiceReply('no, cancel', 3)).toEqual({ kind: 'cancel' });
    expect(parseChoiceReply('never mind', 2)).toEqual({ kind: 'cancel' });
  });

  it('apply/yes confirms only a single-choice preview', () => {
    expect(parseChoiceReply('apply', 1)).toEqual({ kind: 'pick', index: 0 });
    expect(parseChoiceReply('ಸರಿ', 1)).toEqual({ kind: 'pick', index: 0 });
    expect(parseChoiceReply('apply', 2)).toBeNull();
  });

  it('out-of-range ordinals and long utterances are not replies', () => {
    expect(parseChoiceReply('third', 2)).toBeNull();
    expect(parseChoiceReply('move the first wall to the left', 2)).toBeNull();
    expect(parseChoiceReply('', 2)).toBeNull();
  });
});

describe('choicePrompt / suggestCommands', () => {
  it('speaks Kannada for kn and English otherwise', () => {
    expect(choicePrompt('kn', 2)).toMatch(/ಮೊದಲನೇ/);
    expect(choicePrompt('kn', 1)).toMatch(/ಸರಿ/);
    expect(choicePrompt('en', 2)).toMatch(/first/);
    expect(choicePrompt('en', 1)).toMatch(/apply/);
  });
  it('suggests three runnable commands per mode', () => {
    for (const m of ['plan', 'ui', 'part']) expect(suggestCommands(m)).toHaveLength(3);
    expect(suggestCommands('ui')[0]).toMatch(/button/);
  });
});

describe('isDestructiveOp', () => {
  it('single targeted delete is NOT gated (one undo away)', () => {
    expect(isDestructiveOp({ op: 'delete', target: 'w1' })).toBe(false);
  });
  it('delete of a multi-selection or many ids is destructive', () => {
    expect(isDestructiveOp({ op: 'delete', target: 'selected' }, 3)).toBe(true);
    expect(isDestructiveOp({ op: 'delete', target: 'selected' }, 1)).toBe(false);
    expect(isDestructiveOp({ op: 'delete', ids: ['a', 'b'] })).toBe(true);
  });
  it('clear / reset / overwrite are destructive', () => {
    expect(isDestructiveOp({ op: 'clear' })).toBe(true);
    expect(isDestructiveOp({ op: 'reset' })).toBe(true);
    expect(isDestructiveOp({ op: 'overwrite' })).toBe(true);
  });
  it('a batch with two deletes is destructive; one delete + moves is not', () => {
    expect(isDestructiveOp({ op: 'batch', ops: [{ op: 'delete', target: 'a' }, { op: 'delete', target: 'b' }] })).toBe(true);
    expect(isDestructiveOp({ op: 'batch', ops: [{ op: 'delete', target: 'a' }, { op: 'move', target: 'b' }] })).toBe(false);
  });
  it('ordinary edits are not destructive', () => {
    expect(isDestructiveOp({ op: 'move', target: 'w1', dx: 10 })).toBe(false);
    expect(isDestructiveOp({ op: 'set_thickness', target: 'w1', mm: 150 })).toBe(false);
  });
});
