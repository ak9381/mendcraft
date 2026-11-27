// @vitest-environment happy-dom
// "Offline" on screen is always the truth: the Demo toggle says "(simulated)"
// only when it is the one that turned the network off. Really offline (Wi-Fi
// off, at load or while open) never reads "simulated", in English or in a
// pack, and the toggle cannot pretend the network is back. The simulated
// state lives in memory, so a reload is online again (it never claims offline).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { KN_PACK } from '../helpers/knPack';
import { CANVAS_DOC_VERSION, type CanvasDoc } from '../../src/canvas/frames';

let handle: CanvasHandle | null = null;
let onLine = true;
beforeEach(() => {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  onLine = true;
  Object.defineProperty(navigator, 'onLine', { get: () => onLine, configurable: true });
});
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function mount(opts: Parameters<typeof mountCanvas>[1] = {}): { h: CanvasHandle; root: HTMLElement; btn: () => HTMLElement } {
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, ...opts });
  return { h: handle, root, btn: () => root.querySelector<HTMLElement>('[data-cmd=offline]')! };
}
const saidSimulated = (h: CanvasHandle) => h.statusSince(0).some((t) => /simulated/i.test(t));

describe('offline is never claimed falsely', () => {
  it('opened really offline: the toggle reads plainly "Offline", never "simulated"', () => {
    onLine = false;
    const { h, btn } = mount();
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(btn().textContent).toMatch(/offline/i);
    expect(btn().textContent).not.toMatch(/simulated/i);
    expect(saidSimulated(h)).toBe(false);
  });

  it('really offline with the Kannada pack: not the pack\'s "(simulated)" label', () => {
    onLine = false;
    const { btn } = mount({ doc: { version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], surfaces: {}, lang: 'kn', pack: KN_PACK } as CanvasDoc });
    expect(document.documentElement.lang).toBe('kn');
    expect(btn().textContent).not.toBe(KN_PACK.strings.offlineOn);
    expect(btn().textContent).not.toMatch(/simulated/i);
  });

  it('really offline: the toggle and "simulate offline" / "back online" do not pretend', () => {
    onLine = false;
    const { h, btn } = mount();
    btn().click();
    expect(btn().getAttribute('aria-pressed')).toBe('true'); // still offline: it is the network
    h.run('back online');
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    h.run('simulate offline');
    expect(saidSimulated(h)).toBe(false);
    expect(h.statusSince(0).some((t) => /network is off/i.test(t))).toBe(true);
  });

  it('Wi-Fi drops while open: the label is honest; it comes back on the online event', () => {
    const { btn } = mount();
    expect(btn().textContent).toBe('Simulate offline');
    onLine = false;
    window.dispatchEvent(new Event('offline'));
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(btn().textContent).not.toMatch(/simulated/i);
    onLine = true;
    window.dispatchEvent(new Event('online'));
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    expect(btn().textContent).toBe('Simulate offline');
  });

  it('the Demo toggle online: "(simulated)" only while it is the one holding the network off', () => {
    const { h, btn } = mount();
    btn().click();
    expect(btn().textContent).toBe('Offline (simulated)');
    h.run('simulate offline');
    expect(h.statusSince(0).some((t) => t.includes('Already offline (simulated).'))).toBe(true);
    btn().click();
    expect(btn().textContent).toBe('Simulate offline');
  });

  it('the simulated state does not survive a reload: the next mount is online and claims nothing', () => {
    let { btn } = mount();
    btn().click();
    handle!.destroy(); handle = null; document.body.innerHTML = '';
    ({ btn } = mount());
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    expect(btn().textContent).toBe('Simulate offline');
  });
});
