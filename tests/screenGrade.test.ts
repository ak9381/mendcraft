// Unit tests for the pure screen-grader helpers (scripts/screenGrade.lib.mjs):
// caption derivation, prompt building, and the tolerant parsing of the `agy`
// CLI's JSON output. No child process or model is involved.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM helper module, no type declarations.
import {
  RUBRIC_AXES,
  buildPrompt,
  captionFor,
  extractJsonObject,
  humanizeCaption,
  normalizeGrade,
  parseAgyResult,
  summarize,
} from '../scripts/screenGrade.lib.mjs';

const GOOD = { legibility: 5, targetSize: 4, contrast: 5, clutter: 4, matchesCaption: 5, overall: 5, pass: true, summary: 'looks good' };

describe('captions', () => {
  it('humanizes numbered filenames', () => {
    expect(humanizeCaption('03-two-bedroom-plan.png')).toBe('two bedroom plan');
    expect(humanizeCaption('ui-02-login.png')).toBe('login');
    expect(humanizeCaption('palette-plan-01-empty.png')).toBe('empty');
  });

  it('prefers an explicit caption map over the filename', () => {
    const caps = { '03-two-bedroom-plan.png': 'Generated a two-bedroom plan (RULES)' };
    expect(captionFor('03-two-bedroom-plan.png', caps)).toBe('Generated a two-bedroom plan (RULES)');
    expect(captionFor('07-dxf-export.png', caps)).toBe('dxf export');
  });
});

describe('buildPrompt', () => {
  it('references the image path and the caption', () => {
    const p = buildPrompt({ imagePath: '/x/03.png', caption: 'two bedroom plan' });
    expect(p).toContain('/x/03.png');
    expect(p).toContain('two bedroom plan');
    expect(p.toLowerCase()).toContain('json');
  });
});

describe('normalizeGrade', () => {
  it('clamps out-of-range scores and coerces pass/summary', () => {
    const g = normalizeGrade({ legibility: 9, targetSize: 0, contrast: 3, clutter: -2, matchesCaption: 4, overall: 7, pass: 'true', summary: '  tight targets  ' });
    expect(g.legibility).toBe(5);
    expect(g.targetSize).toBe(1);
    expect(g.clutter).toBe(1);
    expect(g.overall).toBe(5);
    expect(g.pass).toBe(true);
    expect(g.summary).toBe('tight targets');
  });

  it('leaves missing axes null', () => {
    const g = normalizeGrade({ overall: 4 });
    expect(g.legibility).toBeNull();
    expect(g.pass).toBe(false);
  });
});

describe('extractJsonObject', () => {
  it('finds a balanced object inside prose and code fences', () => {
    const text = 'Here is the grade:\n```json\n{"overall": 4, "note": "has }{ braces"}\n```\nthanks';
    expect(extractJsonObject(text)).toEqual({ overall: 4, note: 'has }{ braces' });
  });
  it('returns null when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject(42 as unknown as string)).toBeNull();
  });
});

describe('parseAgyResult', () => {
  it('reads the rubric out of an agy json envelope (result key)', () => {
    const stdout = JSON.stringify({ type: 'result', result: JSON.stringify(GOOD) });
    const r = parseAgyResult(stdout);
    expect(r.ok).toBe(true);
    expect(r.grade.overall).toBe(5);
    expect(r.grade.pass).toBe(true);
  });

  it('accepts an envelope that is already the rubric', () => {
    const r = parseAgyResult(JSON.stringify(GOOD));
    expect(r.ok).toBe(true);
    expect(r.grade.contrast).toBe(5);
  });

  it('accepts a nested object under result', () => {
    const r = parseAgyResult(JSON.stringify({ result: GOOD }));
    expect(r.ok).toBe(true);
    expect(r.grade.legibility).toBe(5);
  });

  it('fails cleanly on empty or junk output', () => {
    expect(parseAgyResult('').ok).toBe(false);
    expect(parseAgyResult('totally not json').ok).toBe(false);
  });
});

describe('summarize', () => {
  it('averages scores and flags would-not-ship screens', () => {
    const graded = [
      { file: 'a.png', caption: 'a', grade: normalizeGrade({ ...GOOD }) },
      { file: 'b.png', caption: 'b', grade: normalizeGrade({ legibility: 2, targetSize: 2, contrast: 2, clutter: 2, matchesCaption: 2, overall: 2, pass: false, summary: 'tiny text' }) },
      { file: 'c.png', caption: 'c', grade: null, error: 'skipped' },
    ];
    const s = summarize(graded);
    expect(s.count).toBe(3);
    expect(s.scored).toBe(2);
    expect(s.averages.overall).toBeCloseTo(3.5, 5);
    expect(s.failing).toEqual(['b.png']);
    expect(s.worst[0].file).toBe('b.png');
    expect(RUBRIC_AXES.every((a) => a in s.averages)).toBe(true);
  });
});
