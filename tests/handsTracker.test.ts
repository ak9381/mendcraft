// src/input/hands.ts has no call sites today (S16, dead code) but reproduces
// the same hidden-<video>-never-removed leak as presence.ts (S7) if it is
// ever wired up — fixed in lockstep. Same stubbing approach as presence.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeVideoElement() {
  return {
    style: {},
    remove: vi.fn(),
    set srcObject(_v: unknown) {},
    get srcObject() {
      return null;
    },
  };
}

function stubDocument() {
  const created: ReturnType<typeof fakeVideoElement>[] = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      if (tag !== 'video') throw new Error(`unexpected tag ${tag}`);
      const el = fakeVideoElement();
      created.push(el);
      return el;
    },
    body: { appendChild: vi.fn() },
  };
  (globalThis as Record<string, unknown>).cancelAnimationFrame = vi.fn();
  return { created };
}

describe('createHandTracker video element lifecycle', () => {
  let doc: ReturnType<typeof stubDocument>;

  beforeEach(() => {
    doc = stubDocument();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
    vi.resetModules();
  });

  it('removes the hidden video element on stop()', async () => {
    const { createHandTracker } = await import('../src/input/hands');
    const tracker = createHandTracker(() => {});
    expect(doc.created).toHaveLength(1);
    expect(doc.created[0]!.remove).not.toHaveBeenCalled();
    tracker.stop();
    expect(doc.created[0]!.remove).toHaveBeenCalledTimes(1);
  });
});
