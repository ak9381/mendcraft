// @vitest-environment happy-dom
// A camera move cut short by the next one still resolves: `await focus()`
// never hangs when another focus (or overview) starts before it lands.
import { afterEach, describe, expect, it } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';

let handle: CanvasHandle | null = null;
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });

describe('flyTo', () => {
  it('a cancelled camera move resolves (focus, then focus again at once)', async () => {
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, { autoHands: false, reducedMotion: false, connector: { run: async () => ({}) } });
    handle.run('new board');
    handle.run('new board');
    const [a, b] = handle.frames().map((f) => f.id);
    let firstDone = false;
    const first = handle.focus(a).then(() => { firstDone = true; });
    const second = handle.focus(b); // cancels the first move mid-flight
    const timeout = new Promise<'hung'>((r) => setTimeout(() => r('hung'), 3000));
    expect(await Promise.race([first.then(() => 'done'), timeout])).toBe('done');
    expect(firstDone).toBe(true);
    expect(await Promise.race([second.then(() => 'done'), timeout])).toBe('done');
    expect(handle.snapshot().focusId).toBe(b);
  });
});
