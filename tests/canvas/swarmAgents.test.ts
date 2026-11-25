import { describe, expect, it } from 'vitest';
import {
  assignSwarmColor,
  buildMixedSwarmPlan,
  buildSwarmAgents,
  createSwarmLayer,
  honestyNote,
  MAX_TILE_CURSORS,
  poseAt,
  REAL_CALL_CAP,
  swarmPillText,
  type SwarmAgentSpec,
  type SwarmTask,
} from '../../src/canvas/swarmAgents';

describe('assignSwarmColor', () => {
  it('nano is always the warm-paper green', () => {
    expect(assignSwarmColor('nano', 0)).toBe('#6B8F71');
    expect(assignSwarmColor('nano', 5)).toBe('#6B8F71');
  });
  it('gemini alternates between two blue shades (no purple)', () => {
    expect(assignSwarmColor('gemini', 0)).toBe('#5A7BA6');
    expect(assignSwarmColor('gemini', 1)).toBe('#7B9BC2');
    expect(assignSwarmColor('gemini', 2)).toBe('#5A7BA6');
  });
});

describe('buildSwarmAgents — cursor count/colour assignment', () => {
  it('assigns colours per kind in order, independent across kinds', () => {
    const agents = buildSwarmAgents({
      calls: [{ kind: 'gemini', label: 'planner' }],
      subSteps: [{ kind: 'gemini', label: 'tile 2' }, { kind: 'nano', label: 'labels' }, { kind: 'gemini', label: 'tile 3' }],
    });
    expect(agents.map((a) => a.color)).toEqual(['#5A7BA6', '#7B9BC2', '#6B8F71', '#5A7BA6']);
  });

  it('never marks more than REAL_CALL_CAP agents real, even with more calls', () => {
    const agents = buildSwarmAgents({
      calls: [
        { kind: 'nano', label: 'a' }, { kind: 'gemini', label: 'b' }, { kind: 'gemini', label: 'c' },
        { kind: 'nano', label: 'd' }, { kind: 'gemini', label: 'e' },
      ],
      subSteps: [],
    });
    expect(agents.filter((a) => a.real).length).toBe(REAL_CALL_CAP);
    expect(agents.length).toBe(REAL_CALL_CAP);
  });

  it('sub-steps are flagged not real', () => {
    const agents = buildSwarmAgents({ calls: [{ kind: 'nano', label: 'a' }], subSteps: [{ kind: 'nano', label: 'b' }] });
    expect(agents.find((a) => a.id === 'real-0')!.real).toBe(true);
    expect(agents.find((a) => a.id === 'sub-0')!.real).toBe(false);
  });
});

describe('buildMixedSwarmPlan — cursors only for what really runs', () => {
  const tasks: SwarmTask[] = ['dashboard', 'floorplan', 'kannada', 'generic'];

  it('a turn starts as ONE cursor: the one real model call', () => {
    for (const task of tasks) {
      for (const real of ['gemini', 'nano'] as const) {
        const agents = buildSwarmAgents(buildMixedSwarmPlan(real, task));
        expect(agents).toHaveLength(1);
        expect(agents[0]).toMatchObject({ kind: real, real: true });
      }
    }
  });

  it('never more tile cursors than tiles, capped at MAX_TILE_CURSORS', () => {
    for (const tileCount of [0, 1, 2, 5, 8, 50]) {
      const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard', { tileCount }));
      const tiles = agents.filter((a) => a.tileIndex != null);
      expect(tiles.length).toBe(Math.min(tileCount, MAX_TILE_CURSORS));
      expect(agents.filter((a) => a.real)).toHaveLength(1);
      expect(tiles.map((a) => a.tileIndex)).toEqual(tiles.map((_, i) => i));
    }
  });

  it('every cursor belongs to the engine that was really called', () => {
    for (const real of ['gemini', 'nano'] as const) {
      const other = real === 'gemini' ? 'nano' : 'gemini';
      const agents = buildSwarmAgents(buildMixedSwarmPlan(real, 'dashboard', { tileCount: 6 }));
      expect(agents.some((a) => a.kind === other)).toBe(false);
      expect(agents.every((a) => a.label.startsWith(real === 'gemini' ? 'Gemini · ' : 'Nano · '))).toBe(true);
    }
  });

  it('labels the real call per task and engine', () => {
    expect(buildMixedSwarmPlan('nano', 'dashboard').calls[0].label).toBe('Nano · board draft');
    expect(buildMixedSwarmPlan('gemini', 'dashboard').calls[0].label).toBe('Gemini · board plan');
    expect(buildMixedSwarmPlan('nano', 'floorplan').calls[0].label).toBe('Nano · floor plan');
    expect(buildMixedSwarmPlan('gemini', 'kannada').calls[0].label).toBe('Gemini · Kannada pack');
  });
});

describe('honestyNote', () => {
  it('says how many model calls, and what the other cursors are', () => {
    expect(honestyNote(buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard')))).toBe('1 model call.');
    expect(honestyNote(buildSwarmAgents(buildMixedSwarmPlan('nano', 'dashboard', { tileCount: 3 })))).toBe('1 model call; 3 cursors mark the tiles it has made so far.');
  });
});

describe('poseAt — unique non-overlapping targets', () => {
  it('spreads end positions across a grid with a minimum separation', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 8 }));
    const ends = agents.map((a, i) => poseAt(a, i, 999999, { seed: 1, total: agents.length }));
    let minDist = Infinity;
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const dx = ends[i].x - ends[j].x;
        const dy = ends[i].y - ends[j].y;
        minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
      }
    }
    expect(minDist).toBeGreaterThan(0.05);
  });

  it('is deterministic for the same seed (?sim=1 safe to record)', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 8 }));
    const a = agents.map((a, i) => poseAt(a, i, 700, { seed: 3, total: agents.length }));
    const b = agents.map((a, i) => poseAt(a, i, 700, { seed: 3, total: agents.length }));
    expect(a).toEqual(b);
  });
});

/** Minimal hand-rolled fake DOM, matching the style the rest of this suite
 *  uses under Vitest's node environment (no jsdom). */
class FakeEl {
  tag: string;
  style = { setProperty(_k: string, _v: string) {} } as unknown as CSSStyleDeclaration;
  hidden = false;
  children: FakeEl[] = [];
  classSet = new Set<string>();
  attrs: Record<string, string> = {};
  textContent = '';
  title = '';
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(_: string) {}
  get innerHTML() { return ''; }
  get classList() {
    return {
      add: (c: string) => this.classSet.add(c),
      toggle: (c: string, on: boolean) => { if (on) this.classSet.add(c); else this.classSet.delete(c); },
    };
  }
  appendChild(el: FakeEl) { this.children.push(el); return el; }
  append(...els: FakeEl[]) { this.children.push(...els); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  remove() {}
}
const fakeDoc = { createElement: (tag: string) => new FakeEl(tag) } as unknown as Document;

describe('swarmPillText — real calls, never a cursor count', () => {
  it('one Nano call reads as one Nano call', () => {
    expect(swarmPillText({ gemini: 0, nano: 1, bytes: 0 })).toBe('Nano · 1 call · 0 B to cloud');
    expect(swarmPillText({ gemini: 1, nano: 0, bytes: 0 })).toBe('Gemini · 1 call · 0 B to cloud');
  });
  it('the pill for a turn is built from its real calls only, however many tile cursors fly', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    const layer = createSwarmLayer(container, { reducedMotion: true, doc: fakeDoc });
    layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    layer.setTiles(6);
    const pill = (container as unknown as FakeEl).children[0];
    expect(pill.textContent).toBe('Nano · 1 call · 0 B to cloud');
    expect(pill.textContent).not.toMatch(/agent|\b6\b|\b7\b/);
  });
  it('formats KB/MB like the ledger does', () => {
    expect(swarmPillText({ gemini: 1, nano: 0, bytes: 2048 })).toContain('2.0 KB to cloud');
    expect(swarmPillText({ gemini: 1, nano: 0, bytes: 3 * 1024 * 1024 })).toContain('3.0 MB to cloud');
  });
  it('plural calls', () => {
    expect(swarmPillText({ gemini: 2, nano: 0, bytes: 0 })).toBe('Gemini · 2 calls · 0 B to cloud');
  });
});

describe('poseAt — deterministic sim path', () => {
  const agent: SwarmAgentSpec = { id: 'real-0', kind: 'gemini', label: 'planner', color: '#6e8bff', real: true };

  it('same seed + index + t gives the same pose', () => {
    const a = poseAt(agent, 0, 700, { seed: 7 });
    const b = poseAt(agent, 0, 700, { seed: 7 });
    expect(a).toEqual(b);
  });

  it('different seeds give different poses', () => {
    const a = poseAt(agent, 0, 700, { seed: 1 });
    const b = poseAt(agent, 0, 700, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('settles into "editing" phase at or past the flight duration', () => {
    const atEnd = poseAt(agent, 0, 1400, { seed: 1, durationMs: 1400 });
    const pastEnd = poseAt(agent, 0, 9000, { seed: 1, durationMs: 1400 });
    expect(atEnd.phase).toBe('editing');
    expect(pastEnd).toEqual(atEnd);
  });

  it('is mid-flight before the duration elapses', () => {
    expect(poseAt(agent, 0, 10, { seed: 1, durationMs: 1400 }).phase).toBe('flying');
  });
});

describe('createSwarmLayer', () => {
  it('spawns one element per agent and shows the pill', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    const layer = createSwarmLayer(container, { reducedMotion: true, doc: fakeDoc, raf: undefined, caf: undefined });
    layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    const c = container as unknown as FakeEl;
    // pill + N cursors
    expect(c.children.length).toBe(1 + buildSwarmAgents(buildMixedSwarmPlan('nano', 'dashboard')).length);
    expect(c.hidden).toBe(false);
  });

  it('reduced motion never schedules a frame', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    let rafCalls = 0;
    const layer = createSwarmLayer(container, {
      reducedMotion: true, doc: fakeDoc,
      raf: () => { rafCalls++; return 1; },
      caf: () => {},
    });
    layer.start(buildMixedSwarmPlan('gemini', 'dashboard'), 1);
    expect(rafCalls).toBe(0);
  });

  it('non-reduced motion schedules exactly one shared frame to start', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    let rafCalls = 0;
    const layer = createSwarmLayer(container, {
      reducedMotion: false, doc: fakeDoc,
      raf: () => { rafCalls++; return 1; },
      caf: () => {},
      now: () => 0,
    });
    layer.start(buildMixedSwarmPlan('gemini', 'dashboard'), 1);
    expect(rafCalls).toBe(1);
  });

  it('settle hides the container and removes cursors', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    const layer = createSwarmLayer(container, { reducedMotion: true, doc: fakeDoc });
    layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    layer.settle();
    const c = container as unknown as FakeEl;
    expect(c.hidden).toBe(true);
  });

  it('fires onReachTarget once per tile cursor under reduced motion (all start at the end pose)', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    const hits: Array<{ tileIndex: number; kind: string }> = [];
    const layer = createSwarmLayer(container, {
      reducedMotion: true, doc: fakeDoc,
      onReachTarget: (tileIndex, kind) => hits.push({ tileIndex, kind }),
    });
    layer.start(buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 4 }), 1);
    expect(hits).toEqual([0, 1, 2, 3].map((tileIndex) => ({ tileIndex, kind: 'gemini' })));
  });

  it('setTiles adds one cursor per NEW tile, keeps the others, and does nothing once settled', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    const c = container as unknown as FakeEl;
    const hits: number[] = [];
    const layer = createSwarmLayer(container, { reducedMotion: true, doc: fakeDoc, onReachTarget: (i) => hits.push(i) });
    layer.setTiles(3); // not running: nothing
    expect(c.children.length).toBe(1);
    layer.start(buildMixedSwarmPlan('nano', 'dashboard'), 1);
    expect(c.children.length).toBe(1 + 1); // pill + the one call
    layer.setTiles(2);
    expect(c.children.length).toBe(1 + 1 + 2);
    layer.setTiles(2); // same reply, no new tile
    layer.setTiles(1); // a shorter partial never removes or duplicates
    expect(c.children.length).toBe(1 + 1 + 2);
    layer.setTiles(3);
    expect(c.children.length).toBe(1 + 1 + 3);
    expect(hits).toEqual([0, 1, 2]);
    layer.setTiles(99);
    expect(c.children.length).toBe(1 + 1 + MAX_TILE_CURSORS);
    layer.settle();
    layer.setTiles(5);
    expect(c.children.length).toBe(1 + 1 + MAX_TILE_CURSORS); // FakeEl.remove is a no-op; nothing was added
  });

  it('never fires onReachTarget twice for the same agent in one run', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    let calls = 0;
    const layer = createSwarmLayer(container, { reducedMotion: true, doc: fakeDoc, onReachTarget: () => { calls++; } });
    const plan = buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 4 });
    layer.start(plan, 1);
    const tileAgentCount = buildSwarmAgents(plan).filter((a) => a.tileIndex != null).length;
    expect(calls).toBe(tileAgentCount);
    layer.settle();
    layer.start(plan, 1);
    expect(calls).toBe(tileAgentCount * 2);
  });
});
