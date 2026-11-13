import { describe, expect, it } from 'vitest';
import {
  ASSIST_ALLOWLIST,
  AUTO_SCROLL_MIN_INTERVAL_MS,
  autoScrollTickAllowed,
  canDraftReply,
  canScroll,
  capabilitiesFor,
  initialAutoScroll,
  initialDraft,
  isAllowedPackage,
  manualScrollAllowed,
  pauseAutoScroll,
  reduceDraft,
  setAutoScrollEnabled,
  setAutoScrollInterval,
  type DraftEvent,
  type DraftState,
} from '../src/assist/policy';

describe('assist allowlist', () => {
  it('allows exactly Instagram, Pinterest, WhatsApp and WhatsApp Business', () => {
    expect([...ASSIST_ALLOWLIST].sort()).toEqual(
      ['com.instagram.android', 'com.pinterest', 'com.whatsapp', 'com.whatsapp.w4b'].sort(),
    );
    for (const pkg of ASSIST_ALLOWLIST) expect(isAllowedPackage(pkg)).toBe(true);
  });

  it('rejects everything else, including lookalikes and system apps', () => {
    for (const pkg of [
      'com.android.settings',
      'com.google.android.gm',
      'com.instagram.android.evil',
      'com.whatsappx',
      'com.facebook.katana',
      '',
    ]) {
      expect(isAllowedPackage(pkg)).toBe(false);
      expect(capabilitiesFor(pkg)).toEqual([]);
      expect(canScroll(pkg)).toBe(false);
      expect(canDraftReply(pkg)).toBe(false);
      expect(manualScrollAllowed(pkg)).toBe(false);
    }
  });

  it('only WhatsApp variants may receive reply drafts', () => {
    expect(canDraftReply('com.whatsapp')).toBe(true);
    expect(canDraftReply('com.whatsapp.w4b')).toBe(true);
    expect(canDraftReply('com.instagram.android')).toBe(false);
    expect(canDraftReply('com.pinterest')).toBe(false);
  });

  it('feeds may scroll', () => {
    expect(canScroll('com.instagram.android')).toBe(true);
    expect(canScroll('com.pinterest')).toBe(true);
  });
});

describe('auto-scroll policy', () => {
  it('is OFF by default', () => {
    const s = initialAutoScroll();
    expect(s.enabled).toBe(false);
    expect(autoScrollTickAllowed(s, 'com.instagram.android')).toBe(false);
  });

  it('ticks only when enabled, un-paused, and in a scrollable allowlisted app', () => {
    const on = setAutoScrollEnabled(initialAutoScroll(), true);
    expect(autoScrollTickAllowed(on, 'com.pinterest')).toBe(true);
    expect(autoScrollTickAllowed(on, 'com.android.chrome')).toBe(false);
  });

  it('pause takes effect immediately and re-enable clears the pause', () => {
    let s = setAutoScrollEnabled(initialAutoScroll(), true);
    s = pauseAutoScroll(s);
    expect(autoScrollTickAllowed(s, 'com.instagram.android')).toBe(false);
    s = setAutoScrollEnabled(s, true);
    expect(autoScrollTickAllowed(s, 'com.instagram.android')).toBe(true);
  });

  it('clamps the interval so auto-scroll stays slow', () => {
    const s = setAutoScrollInterval(initialAutoScroll(), 10);
    expect(s.intervalMs).toBe(AUTO_SCROLL_MIN_INTERVAL_MS);
    expect(setAutoScrollInterval(initialAutoScroll(), 5000).intervalMs).toBe(5000);
  });
});

describe('draft → confirm → send state machine', () => {
  const stageWA: DraftEvent = { type: 'stage', text: 'On my way!', pkg: 'com.whatsapp' };

  function run(events: DraftEvent[], from: DraftState = initialDraft()) {
    let state = from;
    let sends = 0;
    for (const e of events) {
      const step = reduceDraft(state, e);
      state = step.state;
      if (step.performSend) sends++;
    }
    return { state, sends };
  }

  it('happy path: stage → placed → explicit confirm sends exactly once', () => {
    const { state, sends } = run([stageWA, { type: 'placed' }, { type: 'confirm', source: 'pinch' }]);
    expect(state.phase).toBe('sent');
    expect(sends).toBe(1);
  });

  it('a big on-screen button confirm works like a pinch', () => {
    const { sends } = run([stageWA, { type: 'placed' }, { type: 'confirm', source: 'button' }]);
    expect(sends).toBe(1);
  });

  it('NEVER sends on timers or because the compose field filled', () => {
    const { state, sends } = run([
      stageWA,
      { type: 'placed' },
      { type: 'timer' },
      { type: 'compose-filled' },
      { type: 'timer' },
    ]);
    expect(sends).toBe(0);
    expect(state.phase).toBe('placed'); // still waiting for the human
  });

  it('confirm before the draft is visible does nothing', () => {
    expect(run([{ type: 'confirm', source: 'pinch' }]).sends).toBe(0);
    expect(run([stageWA, { type: 'confirm', source: 'pinch' }]).sends).toBe(0);
  });

  it('confirming twice sends only once', () => {
    const { sends } = run([
      stageWA,
      { type: 'placed' },
      { type: 'confirm', source: 'pinch' },
      { type: 'confirm', source: 'pinch' },
    ]);
    expect(sends).toBe(1);
  });

  it('cancel is always available and wipes the draft', () => {
    const { state, sends } = run([stageWA, { type: 'placed' }, { type: 'cancel' }, { type: 'confirm', source: 'pinch' }]);
    expect(sends).toBe(0);
    expect(state).toEqual(initialDraft());
  });

  it('refuses drafts for non-WhatsApp packages and empty text', () => {
    expect(run([{ type: 'stage', text: 'hi', pkg: 'com.instagram.android' }]).state.phase).toBe('idle');
    expect(run([{ type: 'stage', text: '   ', pkg: 'com.whatsapp' }]).state.phase).toBe('idle');
  });

  it('placed without a staged draft is ignored', () => {
    const { state, sends } = run([{ type: 'placed' }, { type: 'confirm', source: 'button' }]);
    expect(state.phase).toBe('idle');
    expect(sends).toBe(0);
  });
});
