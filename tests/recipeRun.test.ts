// Recipes part 2: the browser step interpreter + confirm gate, the lamp/music
// device interpreter, and the relay run/runStatus/runControl messages. All pure.

import { describe, expect, it } from 'vitest';
import {
  buildBrowserPlan,
  describeBrowserStep,
  interpretBrowserStep,
  isAllowedUrl,
  isSameOrigin,
  labelNeedsConfirm,
  stepNeedsConfirm,
  type BrowserStep,
} from '../src/recipes/browser';
import {
  buildDeviceActions,
  interpretLampStep,
  interpretMusicStep,
  resolveTrackIndex,
} from '../src/recipes/deviceRun';
import type { Track } from '../src/music/player';
import {
  validateMessage,
  validateRunControl,
  validateRunRequest,
  validateRunStatus,
} from '../src/relay/protocol';

const step = (op: Record<string, unknown>) => ({ op });

// ---------------------------------------------------------------------------
describe('browser step interpreter', () => {
  it('parses each allowed step kind', () => {
    expect(interpretBrowserStep({ op: 'open', url: 'https://mail.example.com' })).toEqual({
      op: 'open', url: 'https://mail.example.com',
    });
    expect(interpretBrowserStep({ op: 'find', by: 'label', value: 'To' })).toEqual({
      op: 'find', by: 'label', value: 'To',
    });
    expect(interpretBrowserStep({ op: 'type', slot: 'message' })).toEqual({ op: 'type', slot: 'message' });
    expect(interpretBrowserStep({ op: 'click', by: 'button', text: 'Compose' })).toEqual({
      op: 'click', by: 'button', text: 'Compose',
    });
    expect(interpretBrowserStep({ op: 'scroll' })).toEqual({ op: 'scroll', dir: 'down', amount: 400 });
    expect(interpretBrowserStep({ op: 'wait_for', text: 'Sent' })).toEqual({ op: 'wait_for', text: 'Sent' });
  });

  it('rejects unknown kinds and missing fields', () => {
    expect(typeof interpretBrowserStep({ op: 'eval', code: 'x' })).toBe('string');
    expect(typeof interpretBrowserStep({ op: 'open' })).toBe('string');
    expect(typeof interpretBrowserStep({ op: 'find', by: 'xpath', value: 'a' })).toBe('string');
    expect(typeof interpretBrowserStep({ op: 'type' })).toBe('string');
    expect(typeof interpretBrowserStep({ op: 'click', by: 'button' })).toBe('string');
  });

  it('clamps scroll amount and normalizes direction', () => {
    expect(interpretBrowserStep({ op: 'scroll', dir: 'up', amount: 999999 })).toEqual({
      op: 'scroll', dir: 'up', amount: 5000,
    });
    expect(interpretBrowserStep({ op: 'scroll', dir: 'sideways', amount: -10 })).toEqual({
      op: 'scroll', dir: 'down', amount: 50,
    });
  });
});

describe('confirm gate detection', () => {
  it('flags send/submit/pay/buy/delete/post labels (word boundary)', () => {
    for (const w of ['Send', 'Submit order', 'Pay now', 'Buy', 'Delete draft', 'Post reply', 'Place order']) {
      expect(labelNeedsConfirm(w)).toBe(true);
    }
  });

  it('does not flag innocent labels', () => {
    for (const w of ['Compose', 'Save draft', 'Postcode', 'Buyer guide notes', 'Add row']) {
      expect(labelNeedsConfirm(w)).toBe(false);
    }
  });

  it('only click steps gate, and a form submit gates even with a safe label', () => {
    const click: BrowserStep = { op: 'click', by: 'button', text: 'Next' };
    const typing: BrowserStep = { op: 'type', text: 'send money' };
    expect(stepNeedsConfirm(click)).toBe(false);
    expect(stepNeedsConfirm(click, { submitsForm: true })).toBe(true);
    expect(stepNeedsConfirm({ op: 'click', by: 'button', text: 'Send' })).toBe(true);
    // Typing text that merely contains a scary word never gates.
    expect(stepNeedsConfirm(typing)).toBe(false);
  });
});

describe('url allowlist', () => {
  const hosts = ['example.com', 'mail.google.com'];
  it('allows https host and subdomains on the list', () => {
    expect(isAllowedUrl('https://example.com/a', hosts)).toBe(true);
    expect(isAllowedUrl('https://shop.example.com', hosts)).toBe(true);
    expect(isAllowedUrl('http://mail.google.com/compose', hosts)).toBe(true);
  });
  it('rejects off-list hosts and non-http schemes', () => {
    expect(isAllowedUrl('https://evil.com', hosts)).toBe(false);
    expect(isAllowedUrl('javascript:alert(1)', hosts)).toBe(false);
    expect(isAllowedUrl('data:text/html,x', hosts)).toBe(false);
    expect(isAllowedUrl('not a url', hosts)).toBe(false);
  });
  it('isSameOrigin compares full origin', () => {
    expect(isSameOrigin('https://app.local/p', 'https://app.local')).toBe(true);
    expect(isSameOrigin('https://other.com/p', 'https://app.local')).toBe(false);
  });
});

describe('buildBrowserPlan', () => {
  const hosts = ['mail.example.com'];
  it('resolves slots, counts confirms, and labels steps', () => {
    const plan = buildBrowserPlan(
      [
        step({ op: 'open', url: 'https://mail.example.com/compose' }),
        step({ op: 'find', by: 'label', value: 'Message' }),
        step({ op: 'type', slot: 'body' }),
        step({ op: 'click', by: 'button', text: 'Send' }),
      ],
      { allowedHosts: hosts, slots: { body: 'I am well, amma' } },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.confirmCount).toBe(1);
    expect(plan.steps[2].step).toEqual({ op: 'type', text: 'I am well, amma' });
    expect(plan.steps[3].needsConfirm).toBe(true);
    expect(plan.steps[0].label).toContain('Open');
  });

  it('fails a disallowed url and a missing slot', () => {
    const bad = buildBrowserPlan([step({ op: 'open', url: 'https://evil.com' })], { allowedHosts: hosts });
    expect(bad.ok).toBe(false);
    const miss = buildBrowserPlan([step({ op: 'type', slot: 'nope' })], { allowedHosts: hosts, slots: {} });
    expect(miss.ok).toBe(false);
  });

  it('describeBrowserStep is human-readable', () => {
    expect(describeBrowserStep({ op: 'click', by: 'link', text: 'Inbox' })).toBe('Click the link “Inbox”');
  });
});

// ---------------------------------------------------------------------------
describe('lamp interpreter', () => {
  it('maps and clamps lamp ops', () => {
    expect(interpretLampStep({ op: 'lamp_power', on: true })).toEqual({ kind: 'power', on: true });
    expect(interpretLampStep({ op: 'lamp_power' })).toEqual({ kind: 'power', on: true });
    expect(interpretLampStep({ op: 'lamp_dim', dimming: 999 })).toEqual({ kind: 'dim', dimming: 100 });
    expect(interpretLampStep({ op: 'lamp_temp', preset: 'warm' })).toEqual({ kind: 'temp', temp: 2700 });
    expect(interpretLampStep({ op: 'lamp_color', rgb: { r: 300, g: -5, b: 60 } })).toEqual({
      kind: 'color', rgb: { r: 255, g: 0, b: 60 },
    });
  });
  it('rejects bad lamp ops', () => {
    expect(typeof interpretLampStep({ op: 'lamp_dim' })).toBe('string');
    expect(typeof interpretLampStep({ op: 'nope' })).toBe('string');
  });
});

describe('music interpreter', () => {
  const tracks: Track[] = [
    { title: 'Morning Bhajans', artist: 'Various', src: 'a' } as Track,
    { title: 'Evening Raga', src: 'b' } as Track,
  ];
  it('resolves a play query to a select+play', () => {
    expect(resolveTrackIndex(tracks, 'bhajan')).toBe(0);
    expect(interpretMusicStep({ op: 'music_play', query: 'bhajan' }, tracks)).toEqual([
      { type: 'select', index: 0 },
      { type: 'play' },
    ]);
  });
  it('plays without a query and clamps volume', () => {
    expect(interpretMusicStep({ op: 'music_play' })).toEqual([{ type: 'play' }]);
    expect(interpretMusicStep({ op: 'music_volume', volume: 2 })).toEqual([{ type: 'setVolume', volume: 1 }]);
  });
  it('rejects bad music ops', () => {
    expect(typeof interpretMusicStep({ op: 'music_volume' })).toBe('string');
    expect(typeof interpretMusicStep({ op: 'nope' })).toBe('string');
  });
});

describe('buildDeviceActions', () => {
  it('builds a "lamp warm and play bhajans" sequence', () => {
    const tracks: Track[] = [{ title: 'Bhajans', src: 'x' } as Track];
    const lamp = buildDeviceActions('lamp', [
      step({ op: 'lamp_power', on: true }),
      step({ op: 'lamp_temp', preset: 'warm' }),
    ]);
    const music = buildDeviceActions('music', [step({ op: 'music_play', query: 'bhajan' })], tracks);
    expect(lamp.ok && lamp.actions.length).toBe(2);
    expect(music.ok && music.actions.length).toBe(2);
  });
  it('fails on an unknown step', () => {
    expect(buildDeviceActions('lamp', [step({ op: 'music_play' })]).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('relay run messages', () => {
  it('validates a run request and round-trips through validateMessage', () => {
    const run = { runId: 'run-1', recipeId: 'rcp-2', device: 'browser', by: 'Aunty' };
    expect(validateRunRequest(run)).toEqual(run);
    const msg = validateMessage({ v: 1, from: 'control', type: 'run', run });
    expect(msg?.type).toBe('run');
  });

  it('rejects an unknown device or missing ids', () => {
    expect(validateRunRequest({ runId: 'r', recipeId: 'x', device: 'toaster' })).toBeNull();
    expect(validateRunRequest({ recipeId: 'x', device: 'lamp' })).toBeNull();
  });

  it('validates run status including the awaiting-confirm state', () => {
    const runStatus = { runId: 'run-1', recipeId: 'rcp-2', status: 'awaiting-confirm', step: 4, total: 6 };
    expect(validateRunStatus(runStatus)).toEqual(runStatus);
    expect(validateRunStatus({ runId: 'r', recipeId: 'x', status: 'exploded' })).toBeNull();
    const msg = validateMessage({ v: 1, from: 'host', type: 'runStatus', runStatus });
    expect(msg?.type).toBe('runStatus');
  });

  it('validates run control (confirm/cancel) and rejects junk decisions', () => {
    expect(validateRunControl({ runId: 'run-1', decision: 'confirm', step: 4 })).toEqual({
      runId: 'run-1', decision: 'confirm', step: 4,
    });
    expect(validateRunControl({ runId: 'run-1', decision: 'maybe' })).toBeNull();
    const msg = validateMessage({ v: 1, from: 'control', type: 'runControl', runControl: { runId: 'r', decision: 'cancel' } });
    expect(msg?.type).toBe('runControl');
  });
});
