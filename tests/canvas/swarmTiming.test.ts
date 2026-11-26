import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMixedSwarmPlan, createSwarmLayer, LINGER_MS, MIN_VISIBLE_MS } from '../../src/canvas/swarmAgents';

// A fake DOM that really tracks attach/detach and the cursor's label, plus a
// manual clock + timer queue, so the visibility rules can be asserted in
// milliseconds without a browser.
class El {
  hidden = false;
  parent: El | null = null;
  children: El[] = [];
  classSet = new Set<string>();
  attrs: Record<string, string> = {};
  textContent = '';
  title = '';
  html = '';
  style = { setProperty() {} } as unknown as CSSStyleDeclaration;
  set innerHTML(v: string) { this.html = v; }
  get innerHTML() { return this.html; }
  get classList() { return { add: (c: string) => this.classSet.add(c), toggle: (c: string, on: boolean) => { if (on) this.classSet.add(c); else this.classSet.delete(c); } }; }
  appendChild(e: El) { e.parent = this; this.children.push(e); return e; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
}
const doc = { createElement: () => new El() } as unknown as Document;

function rig(reducedMotion = false) {
  let t = 0;
  const queue: { at: number; cb: () => void; h: number }[] = [];
  let nextH = 1;
  const container = new El();
  const layer = createSwarmLayer(container as unknown as HTMLElement, {
    reducedMotion, doc, raf: undefined, caf: undefined, now: () => t,
    timer: (cb, ms) => { const h = nextH++; queue.push({ at: t + ms, cb, h }); return h; },
    clearTimer: (h) => { const i = queue.findIndex((q) => q.h === h); if (i >= 0) queue.splice(i, 1); },
  });
  const advance = (ms: number): void => {
    const end = t + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      if (!queue.length || queue[0].at > end) break;
      const q = queue.shift()!;
      t = Math.max(t, q.at);
      q.cb();
    }
    t = end;
  };
  /** Cursor elements currently on the layer (the pill is not a cursor). */
  const cursors = (): El[] => container.children.slice(1);
  return { layer, container, advance, cursors, now: () => t };
}

describe('swarm cursor lifetimes', () => {
  it('a tile cursor stays until its tile lands + LINGER_MS, then leaves', () => {
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    r.layer.setTiles(1, ['Lamp']);
    expect(r.cursors().length).toBe(2); // the call + tile 1
    r.advance(1400 + LINGER_MS - 1); // landed (1400) and still lingering
    expect(r.cursors().length).toBe(2);
    r.advance(1);
    expect(r.cursors().length).toBe(1); // only the call's cursor is left
  });

  it('every tile cursor is visible at least 1.2 s (glide + linger)', () => {
    expect(MIN_VISIBLE_MS).toBeGreaterThanOrEqual(1200);
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('gemini', 'dashboard'), 1);
    r.layer.setTiles(1, ['Music']);
    r.advance(1199);
    expect(r.cursors().length).toBe(2);
  });

  it('under reduced motion a tile cursor is already on its tile and leaves after LINGER_MS', () => {
    const r = rig(true);
    r.layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    r.layer.setTiles(1, ['Lamp']);
    r.advance(LINGER_MS - 1);
    expect(r.cursors().length).toBe(2);
    r.advance(1);
    expect(r.cursors().length).toBe(1);
  });

  it('a late tile gets its own full lifetime; earlier ones do not extend it', () => {
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    r.layer.setTiles(1, ['Lamp']);
    r.advance(1000);
    r.layer.setTiles(2, ['Lamp', 'Music']);
    r.advance(1200); // t=2200: tile 1 (born 0) is gone, tile 2 (born 1000) is not
    expect(r.cursors().length).toBe(2);
    r.advance(1000); // t=3200: tile 2 left at 1000 + 2200
    expect(r.cursors().length).toBe(1);
  });

  it('labels read "Engine · Tile" at 15 px or more (CSS) and never exceed the real units', () => {
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    r.layer.setTiles(3, ['Lamp', 'Lamp', 'Music']);
    r.layer.setTiles(3, ['Lamp', 'Lamp', 'Music']); // same chunk again: no extra cursor
    const labels = r.cursors().map((c) => /mc-swarm-label">([^<]*)</.exec(c.html)?.[1]);
    expect(labels).toEqual(['Nano · board draft', 'Nano · Lamp', 'Nano · Lamp', 'Nano · Music']);
    expect(r.cursors().length).toBe(1 /* one real call */ + 3 /* three real tiles */);
  });
});

describe('swarm finish()', () => {
  it('keeps the call cursor at least MIN_VISIBLE_MS after it appeared, even when the reply is instant', async () => {
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    let done = false;
    const p = r.layer.finish().then(() => { done = true; });
    r.advance(MIN_VISIBLE_MS - 1);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(r.cursors().length).toBe(1);
    r.advance(1);
    await p;
    expect(done).toBe(true);
    expect(r.container.hidden).toBe(true);
    expect(r.cursors().length).toBe(0);
  });

  it('waits for the last tile to land + linger before settling', async () => {
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('gemini', 'dashboard'), 1);
    r.advance(3000); // the call has been up a while
    r.layer.setTiles(1, ['Plan']); // last tile arrives just before the reply ends
    let done = false;
    const p = r.layer.finish().then(() => { done = true; });
    r.advance(MIN_VISIBLE_MS - 1);
    await Promise.resolve();
    expect(done).toBe(false); // the last tile has not landed + lingered yet
    expect(r.cursors().length).toBe(2);
    r.advance(1);
    await p;
    expect(done).toBe(true);
  });

  it('a slow reply is not held longer than its linger', async () => {
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('gemini', 'dashboard'), 1);
    r.advance(10_000);
    const p = r.layer.finish();
    r.advance(LINGER_MS);
    await p;
    expect(r.container.hidden).toBe(true);
  });

  it('a hard settle (error, cancel) ends it at once and resolves finish()', async () => {
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    r.layer.setTiles(2, ['Lamp', 'Lamp']);
    const p = r.layer.finish();
    r.layer.settle();
    await p;
    expect(r.container.hidden).toBe(true);
    expect(r.cursors().length).toBe(0);
  });

  it('no new tile cursors join once finishing, and finish() when idle resolves at once', async () => {
    const r = rig();
    await r.layer.finish(); // not running
    r.layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    void r.layer.finish();
    r.layer.setTiles(4, ['Lamp', 'Lamp', 'Music', 'Plan']);
    expect(r.cursors().length).toBe(1);
  });

  it('a new start() while finishing resolves the old finish and begins afresh', async () => {
    const r = rig();
    r.layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    const p = r.layer.finish();
    r.layer.start(buildMixedSwarmPlan('gemini', 'dashboard'), 1);
    await p;
    r.layer.setTiles(1, ['Lamp']); // the new run accepts tiles
    expect(r.cursors().length).toBe(2);
  });
});

describe('swarm CSS visibility rules', () => {
  const css = readFileSync(join(__dirname, '../../src/canvas/canvas.css'), 'utf8');
  it('an empty board hides the swarm only while no build is streaming into it', () => {
    const rule = css.split('\n').find((l) => /mc-empty:not\(\[hidden\]\)\).*\.mc-swarm \{/.test(l)) ?? '';
    expect(rule).toContain(':not(:has(.mc-ghost:not([hidden])))');
  });
  it('the cursor label is at least 15 px', () => {
    const m = /\.mc-swarm-label \{[^}]*font-size: (\d+)px/.exec(css);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(15);
  });
});
