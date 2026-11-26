// @vitest-environment happy-dom
// The canvas boots empty: no frames, no surfaces, no devices — nothing seeded.
// A turn with no engine says so and proposes nothing. A joined document opens
// its boards, and saves go to onPersist (the caller stores layout + artifacts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { createReplayEngines, NO_MODEL_LINE } from '../../src/canvas/replayEngine';
import { joinCanvasDoc } from '../../src/canvas/canvasPersistence';
import type { CanvasDoc } from '../../src/canvas/frames';
import { board } from '../artifacts/sample';

let handle: CanvasHandle | null = null;
function mount(opts: Parameters<typeof mountCanvas>[1] = {}): { h: CanvasHandle; root: HTMLElement } {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, ...opts });
  return { h: handle, root };
}
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });

describe('empty boot', () => {
  it('mounts with no frames, no surfaces and no devices', () => {
    const { h } = mount();
    expect(h.frames()).toEqual([]);
    expect(h.snapshot().surfaces).toEqual({});
    expect(h.store.all()).toEqual({});
  });

  it('a turn with no engine says the no-model line and proposes nothing', async () => {
    const { h, root } = mount();
    h.run('new board');
    const id = h.frames()[0]?.id;
    expect(id).toBeTruthy();
    h.run('connect everything in this room');
    await vi.waitFor(() => expect(root.textContent).toContain(NO_MODEL_LINE));
    expect(h.snapshot().surfaces).toEqual({});
    expect(root.querySelector('.mc-review-title')?.textContent ?? '').toBe('');
  });

  it('mounts the boards of a joined doc and calls onPersist after a rename', async () => {
    const doc = joinCanvasDoc(null, [board('f1', { title: 'Desk' })]) as CanvasDoc;
    const saved: CanvasDoc[] = [];
    // An inline recorded reply renames the board when she approves it.
    const study = JSON.stringify({ kind: 'room', title: 'Study', tiles: [{ type: 'stat', label: 'Temperature', value: '21 °C' }] });
    const engines = createReplayEngines({ 'nano.board': study, 'gemini.boardBetter': study });
    const { h, root } = mount({ doc, onPersist: (d) => saved.push(d), engines });
    expect(h.frames().map((f) => [f.id, f.title])).toEqual([['f1', 'Desk']]);
    expect(Object.keys(h.snapshot().surfaces)).toEqual(['f1']);
    await h.focus('f1');
    h.run('connect everything in this room');
    await vi.waitFor(() => expect(root.querySelector('.mc-review-title')?.textContent ?? '').not.toBe(''), { timeout: 8000 });
    expect(saved.some((d) => d.frames[0]?.title === 'Study')).toBe(false); // nothing applied before Approve
    h.keep();
    await vi.waitFor(() => expect(saved.at(-1)?.frames[0]?.title).toBe('Study'), { timeout: 3000 });
    expect(saved.at(-1)?.surfaces.f1?.title).toBe('Study');
  });

  it('says once what failed its check at boot, and that storage is memory only', () => {
    const { root } = mount({ dropped: [{ id: 'board-bad', why: 'the board failed its check' }], storeNote: "This browser can't keep boards. They last until you close the tab." });
    expect(root.textContent).toContain('1 stored item failed its check and was not loaded.');
    expect(root.textContent).toContain("This browser can't keep boards.");
    expect(root.textContent).toContain('not loaded: board-bad');
  });

  it('with stored boards kept closed, a new board takes a fresh id and is saved', async () => {
    const saved: CanvasDoc[] = [];
    const { h } = mount({ onPersist: (d) => saved.push(d), reservedFrameIds: ['f1', 'f2'] });
    h.run('new board');
    expect(h.frames().map((f) => f.id)).toEqual(['f3']);
    h.save();
    await vi.waitFor(() => expect(saved.at(-1)?.frames.map((f) => f.id)).toEqual(['f3']));
  });
});
