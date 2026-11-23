// A5 Connect sheet: hand-path tests against the real mountConnectSheet().
// mountConnectSheet() sets host.innerHTML to a markup string and then calls
// host.querySelector() to find/wire each control — unlike the existing
// connectSheet.test.ts (which only asserts on the innerHTML string), this
// host memoizes querySelector by selector so the SAME fake element mount
// wires a listener onto is the one a click is later fired on, letting us
// exercise the real generic-click hand path end to end.
import { describe, expect, it, vi } from 'vitest';
import { mountConnectSheet, type ConnectSheetCallbacks } from '../../src/canvas/connectSheet';

function fakeEl(tag = 'div') {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  return {
    tagName: tag.toUpperCase(),
    value: '',
    addEventListener(t: string, f: (e: unknown) => void) { (listeners[t] ??= []).push(f); },
    dispatchEvent(e: { type: string; preventDefault?: () => void }) { (listeners[t(e)] ?? []).forEach((f) => f(e)); },
    click() { this.dispatchEvent({ type: 'click' }); },
  };
  function t(e: { type: string }) { return e.type; }
}

function cachingHost() {
  const cache = new Map<string, ReturnType<typeof fakeEl>>();
  let html = '';
  return {
    get innerHTML() { return html; },
    set innerHTML(v: string) { html = v; cache.clear(); },
    querySelector(sel: string) {
      if (!cache.has(sel)) {
        const tag = sel.includes('form') ? 'form' : sel.includes('input') ? 'input' : 'button';
        cache.set(sel, fakeEl(tag));
      }
      return cache.get(sel);
    },
  };
}

describe('connect sheet hand path', () => {
  it('A5-013 pinch-release (click) on "Point at it" calls onPoint, via the real wired listener', () => {
    const host = cachingHost();
    const onPoint = vi.fn();
    mountConnectSheet(host as unknown as HTMLElement, { onPoint });
    const pointBtn = host.querySelector('.mc-connect-point')!;
    pointBtn.click();
    expect(onPoint).toHaveBeenCalledTimes(1);
  });

  it('A5-015 pinch-release (click) on "Join a phone" calls onJoinPhone', () => {
    const host = cachingHost();
    const onJoinPhone = vi.fn();
    mountConnectSheet(host as unknown as HTMLElement, { onJoinPhone });
    const phoneBtn = host.querySelector('.mc-connect-phone')!;
    phoneBtn.click();
    expect(onJoinPhone).toHaveBeenCalledTimes(1);
  });

  it('A5-016 pinch-release (click) on the close button calls onClose and unmounts the sheet', () => {
    const host = cachingHost();
    const onClose = vi.fn();
    mountConnectSheet(host as unknown as HTMLElement, { onClose });
    expect(host.innerHTML).toContain('Connect a device');
    const closeBtn = host.querySelector('.mc-connect-close')!;
    closeBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.innerHTML).toBe(''); // unmount() clears the host
  });
});
