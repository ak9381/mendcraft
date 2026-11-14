import { describe, it, expect } from 'vitest';
import {
  effectiveRole,
  matchesFind,
  matchesClick,
  recordClickStep,
  recordTypeSteps,
  remainingStepsSummary,
  type ElementDescriptor,
} from '../src/recipes/browserDriver';
import { buildBrowserPlan } from '../src/recipes/browser';
import type { RecipeStep } from '../src/recipes/model';

const d = (over: Partial<ElementDescriptor> = {}): ElementDescriptor => ({ tag: 'div', text: '', ...over });

describe('effectiveRole', () => {
  it('uses the explicit role attribute when present', () => {
    expect(effectiveRole(d({ tag: 'div', role: 'button' }))).toBe('button');
  });
  it('maps implicit roles by tag/type', () => {
    expect(effectiveRole(d({ tag: 'a' }))).toBe('link');
    expect(effectiveRole(d({ tag: 'button' }))).toBe('button');
    expect(effectiveRole(d({ tag: 'input', type: 'text' }))).toBe('textbox');
    expect(effectiveRole(d({ tag: 'input', type: 'submit' }))).toBe('button');
    expect(effectiveRole(d({ tag: 'textarea' }))).toBe('textbox');
    expect(effectiveRole(d({ tag: 'input' }))).toBe('textbox');
  });
});

describe('matchesFind', () => {
  it('matches by associated label text (case-insensitive, substring)', () => {
    expect(matchesFind(d({ tag: 'input', labelText: 'Your name' }), 'label', 'name')).toBe(true);
    expect(matchesFind(d({ tag: 'input', labelText: 'Your name' }), 'label', 'email')).toBe(false);
  });
  it('matches label via aria-label fallback', () => {
    expect(matchesFind(d({ tag: 'input', ariaLabel: 'Search parts' }), 'label', 'search')).toBe(true);
  });
  it('matches by placeholder', () => {
    expect(matchesFind(d({ tag: 'input', placeholder: 'Message' }), 'placeholder', 'message')).toBe(true);
    expect(matchesFind(d({ tag: 'input', placeholder: 'Message' }), 'label', 'message')).toBe(false);
  });
  it('matches by exact effective role', () => {
    expect(matchesFind(d({ tag: 'textarea' }), 'role', 'textbox')).toBe(true);
    expect(matchesFind(d({ tag: 'textarea' }), 'role', 'button')).toBe(false);
  });
  it('rejects an empty query', () => {
    expect(matchesFind(d({ tag: 'input', placeholder: 'x' }), 'placeholder', '   ')).toBe(false);
  });
});

describe('matchesClick', () => {
  it('matches a link by visible text', () => {
    expect(matchesClick(d({ tag: 'a', text: 'Open docs' }), 'link', 'docs')).toBe(true);
    expect(matchesClick(d({ tag: 'button', text: 'Open docs' }), 'link', 'docs')).toBe(false);
  });
  it('matches a button element by text', () => {
    expect(matchesClick(d({ tag: 'button', text: 'Send message' }), 'button', 'send')).toBe(true);
  });
  it('matches input-type buttons and role=button', () => {
    expect(matchesClick(d({ tag: 'input', type: 'submit', value: 'Search' }), 'button', 'search')).toBe(true);
    expect(matchesClick(d({ tag: 'div', role: 'button', text: 'Play' }), 'button', 'play')).toBe(true);
  });
  it('does not treat a plain div as a button', () => {
    expect(matchesClick(d({ tag: 'div', text: 'Send' }), 'button', 'send')).toBe(false);
  });
});

describe('teach-by-recording converters', () => {
  it('records a link click as a click step', () => {
    expect(recordClickStep(d({ tag: 'a', text: 'Help' }))).toEqual({ op: 'click', by: 'link', text: 'Help' });
  });
  it('records a button click as a click step', () => {
    expect(recordClickStep(d({ tag: 'button', text: 'Send message' }))).toEqual({
      op: 'click', by: 'button', text: 'Send message',
    });
  });
  it('returns null for an unclickable / unlabeled element', () => {
    expect(recordClickStep(d({ tag: 'div', text: 'hello' }))).toBeNull();
    expect(recordClickStep(d({ tag: 'button', text: '' }))).toBeNull();
  });
  it('records typing as a find (by label) + type pair', () => {
    expect(recordTypeSteps(d({ tag: 'input', labelText: 'Your name' }), 'Amma')).toEqual([
      { op: 'find', by: 'label', value: 'Your name' },
      { op: 'type', text: 'Amma' },
    ]);
  });
  it('falls back to placeholder when there is no label', () => {
    expect(recordTypeSteps(d({ tag: 'input', placeholder: 'Message' }), 'Hi')).toEqual([
      { op: 'find', by: 'placeholder', value: 'Message' },
      { op: 'type', text: 'Hi' },
    ]);
  });
  it('skips (never guesses) a field it cannot relocate', () => {
    expect(recordTypeSteps(d({ tag: 'input' }), 'x')).toEqual([]);
  });
});

describe('remainingStepsSummary (cross-origin fallback)', () => {
  const steps: RecipeStep[] = [
    { op: { op: 'open', url: 'https://example.com/a' } },
    { op: { op: 'find', by: 'placeholder', value: 'Search parts' } },
    { op: { op: 'type', text: 'bolt' } },
    { op: { op: 'click', by: 'button', text: 'Send' } },
  ];
  const plan = buildBrowserPlan(steps, { allowedHosts: ['example.com'] });

  it('lists the steps from the fallback point onward', () => {
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const lines = remainingStepsSummary(plan.steps, 1);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Search parts');
    expect(lines[2]).toContain('Send');
  });
  it('clamps a negative index to the whole list', () => {
    if (!plan.ok) return;
    expect(remainingStepsSummary(plan.steps, -5)).toHaveLength(4);
  });
});
