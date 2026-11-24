import { describe, expect, it, vi } from 'vitest';
import { isTypingTarget, mountZoomHud } from '../../src/canvas/zoomHud';

// Tiny fake DOM (the suite runs in node, no jsdom).
class El {
  tagName: string;
  className = '';
  textContent = '';
  attrs: Record<string, string> = {};
  children: El[] = [];
  listeners: Record<string, Array<() => void>> = {};
  ownerDocument: { createElement(t: string): El };
  constructor(tag: string, doc: { createElement(t: string): El }) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c: El) { this.children.push(c); return c; }
  addEventListener(t: string, fn: () => void) { (this.listeners[t] ??= []).push(fn); }
  click() { (this.listeners.click ?? []).forEach((f) => f()); }
  find(cls: string): El { return this.children.find((c) => c.className.split(' ').includes(cls))!; }
}
const doc = { createElement: (t: string) => new El(t, doc) };

function mount() {
  const api = { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(), fit: vi.fn() };
  const root = new El('div', doc);
  const hud = mountZoomHud(root as unknown as HTMLElement, api);
  return { api, hud, el: hud.el as unknown as El };
}

describe('zoom HUD', () => {
  it('+ calls zoomIn once', () => {
    const { api, el } = mount();
    el.find('mc-zoom-in').click();
    expect(api.zoomIn).toHaveBeenCalledTimes(1);
    expect(api.zoomOut).not.toHaveBeenCalled();
  });
  it('setZoom shows a rounded percent; clicking it resets', () => {
    const { api, hud, el } = mount();
    hud.setZoom(0.874);
    expect(el.find('mc-zoom-pct').textContent).toBe('87%');
    el.find('mc-zoom-pct').click();
    expect(api.reset).toHaveBeenCalledTimes(1);
  });
  it('out and fit are wired and every button is labelled', () => {
    const { api, el } = mount();
    el.find('mc-zoom-out').click(); el.find('mc-zoom-fit').click();
    expect(api.zoomOut).toHaveBeenCalledTimes(1);
    expect(api.fit).toHaveBeenCalledTimes(1);
    for (const b of el.children) expect(b.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('isTypingTarget', () => {
  const t = (tag: string, extra: Record<string, unknown> = {}) => ({ tagName: tag, ...extra }) as unknown as EventTarget;
  it('true for text fields and contenteditable', () => {
    expect(isTypingTarget(t('INPUT'))).toBe(true);
    expect(isTypingTarget(t('textarea'))).toBe(true);
    expect(isTypingTarget(t('SELECT'))).toBe(true);
    expect(isTypingTarget(t('DIV', { isContentEditable: true }))).toBe(true);
  });
  it('false for plain elements and null', () => {
    expect(isTypingTarget(t('DIV'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
