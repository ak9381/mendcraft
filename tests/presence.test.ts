// stop() must detach the hidden <video> it created — otherwise repeated
// Camera/Hands on-off cycles accumulate orphaned elements in the DOM for the
// life of the page (S7/S16). Stub just enough of `document` to exercise
// stop() without a real browser: this module only touches the DOM inside
// function bodies, never at module load time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeVideoElement() {
  return {
    style: {},
    remove: vi.fn(),
    play: vi.fn(async () => undefined),
    set srcObject(_v: unknown) {},
    get srcObject() {
      return null;
    },
  };
}

function stubDocument() {
  const created: ReturnType<typeof fakeVideoElement>[] = [];
  const appendChild = vi.fn();
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      if (tag !== 'video') throw new Error(`unexpected tag ${tag}`);
      const el = fakeVideoElement();
      created.push(el);
      return el;
    },
    body: { appendChild },
  };
  (globalThis as Record<string, unknown>).cancelAnimationFrame = vi.fn();
  (globalThis as Record<string, unknown>).requestAnimationFrame = vi.fn(() => 1);
  return { created, appendChild };
}

describe('createPresenceTracker video element lifecycle', () => {
  let doc: ReturnType<typeof stubDocument>;

  beforeEach(() => {
    doc = stubDocument();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
    vi.resetModules();
  });

  it('appends one hidden video on creation and removes it on stop()', async () => {
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {});
    expect(doc.appendChild).toHaveBeenCalledTimes(1);
    expect(doc.created).toHaveLength(1);
    expect(doc.created[0]!.remove).not.toHaveBeenCalled();

    tracker.stop();
    expect(doc.created[0]!.remove).toHaveBeenCalledTimes(1);
  });

  it('stop() is safe to call twice (video.remove is idempotent)', async () => {
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {});
    tracker.stop();
    expect(() => tracker.stop()).not.toThrow();
    expect(doc.created[0]!.remove).toHaveBeenCalledTimes(2);
  });

  it('a fresh tracker created after stop() does not reuse the old video element', async () => {
    const { createPresenceTracker } = await import('../src/input/presence');
    const first = createPresenceTracker(() => {});
    first.stop();
    createPresenceTracker(() => {});
    expect(doc.created).toHaveLength(2);
    expect(doc.appendChild).toHaveBeenCalledTimes(2);
  });
});
