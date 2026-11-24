import { describe, expect, it, vi } from 'vitest';
import { resolveLanguage } from '../../src/ai/language';
import { mountMicFab } from '../../src/canvas/micFab';

function mk() {
  const el = {
    type: '', className: '', innerHTML: '', attrs: {} as Record<string, string>, hidden: false, textContent: '',
    classList: { toggle: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    addEventListener() {},
    querySelector: () => ({ textContent: '' }),
    append() {},
    remove: vi.fn(),
  };
  const root = { ownerDocument: { createElement: () => el }, append: vi.fn(), querySelectorAll: () => [] } as unknown as HTMLElement;
  return mountMicFab(root, null, () => {});
}

describe('talk caption: heard line + English', () => {
  const kn = resolveLanguage('kn');
  it('Kannada with a translation shows both lines', () => {
    const fab = mk();
    fab.setHeard('ದೀಪ ಆನ್ ಮಾಡು', 'turn the lamp on', kn);
    expect(fab.captionEl.textContent).toBe('ದೀಪ ಆನ್ ಮಾಡು\n→ turn the lamp on');
    expect(fab.captionEl.hidden).toBe(false);
  });
  it('no translation shows the heard line only, never "undefined"', () => {
    const fab = mk();
    fab.setHeard('ದೀಪ ಆನ್ ಮಾಡು', undefined, kn);
    expect(fab.captionEl.textContent).toBe('ದೀಪ ಆನ್ ಮಾಡು');
    fab.setHeard('ದೀಪ ಆನ್ ಮಾಡು', null, kn);
    expect(fab.captionEl.textContent).not.toMatch(/undefined|null/);
  });
  it('English never shows a second line', () => {
    const fab = mk();
    fab.setHeard('new board', 'new board', resolveLanguage('en'));
    expect(fab.captionEl.textContent).toBe('new board');
  });
});
