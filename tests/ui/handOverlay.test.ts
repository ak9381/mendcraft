// Node-env fakes for document/window (no jsdom) — same trick
// handPointerPipeline.test.ts and others in this repo use. Proves: low-poly
// is the DEFAULT overlay path (no triangle-free skeleton drawing), and the
// bold skeleton only comes back via opts.lowpoly===false or ?skeletonHands=1.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandOverlay } from '../../src/ui/handOverlay';
import type { HandFrame } from '../../src/input/handLogic';

function fakeCtx() {
  const calls: string[] = [];
  const ctx: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'canvas') return {};
        return (...args: unknown[]) => { calls.push(String(prop)); return undefined; };
      },
      set() { return true; },
    },
  );
  return { ctx, calls };
}

function fakeDomEl() {
  const classes = new Set<string>();
  return {
    className: '',
    hidden: false,
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), toggle: () => {}, contains: (c: string) => classes.has(c) },
    setAttribute: () => {},
    remove: () => {},
  };
}

function handFrame(): HandFrame {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  return {
    slot: 0,
    points,
    pinching: false,
    owner: false,
    pinchPoint: { x: 0.5, y: 0.5 },
    aim: { x: 0.5, y: 0.5 },
    pinchRatio: 1,
    pinchStrength: 0,
    color: '#38bdf8',
  };
}

describe('createHandOverlay default overlay path', () => {
  let container: any;
  let calls: string[];
  let restoreGlobals: () => void;

  beforeEach(() => {
    const { ctx, calls: c } = fakeCtx();
    calls = c;
    const canvasEl = { ...fakeDomEl(), getContext: () => ctx };
    const hadDocument = 'document' in globalThis;
    const hadWindow = 'window' in globalThis;
    const prevDocument = (globalThis as any).document;
    const prevWindow = (globalThis as any).window;
    (globalThis as any).document = { createElement: (tag: string) => (tag === 'canvas' ? canvasEl : fakeDomEl()) };
    (globalThis as any).window = { devicePixelRatio: 1 };
    container = { appendChild: () => {}, getBoundingClientRect: () => ({ width: 800, height: 600 }) };
    restoreGlobals = () => {
      if (hadDocument) (globalThis as any).document = prevDocument; else delete (globalThis as any).document;
      if (hadWindow) (globalThis as any).window = prevWindow; else delete (globalThis as any).window;
      delete (globalThis as any).location;
    };
  });
  afterEach(() => restoreGlobals());

  it('draws the low-poly mesh (no skeleton arcs) with no options at all', () => {
    const overlay = createHandOverlay(container);
    overlay.draw([handFrame()], 1000);
    expect(calls).toContain('fill');
    expect(calls).not.toContain('arc');
  });

  it('falls back to the bold skeleton when opts.lowpoly is explicitly false', () => {
    const overlay = createHandOverlay(container, { lowpoly: false });
    overlay.draw([handFrame()], 1000);
    expect(calls).toContain('arc');
  });

  it('falls back to the bold skeleton behind ?skeletonHands=1', () => {
    (globalThis as any).location = { search: '?skeletonHands=1' };
    const overlay = createHandOverlay(container);
    overlay.draw([handFrame()], 1000);
    expect(calls).toContain('arc');
  });
});
