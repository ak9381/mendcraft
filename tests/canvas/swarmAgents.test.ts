import { describe, expect, it } from 'vitest';
import {
  assignSwarmColor,
  buildMixedSwarmPlan,
  buildSwarmAgents,
  createSwarmLayer,
  honestyNote,
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

describe('buildMixedSwarmPlan', () => {
  const tasks: SwarmTask[] = ['dashboard', 'floorplan', 'kannada', 'generic'];

  it('lands in the ~10-20 cursor range for every task and real engine', () => {
    for (const task of tasks) {
      for (const real of ['gemini', 'nano'] as const) {
        const agents = buildSwarmAgents(buildMixedSwarmPlan(real, task));
        expect(agents.length).toBeGreaterThanOrEqual(10);
        expect(agents.length).toBeLessThanOrEqual(20);
        expect(agents.filter((a) => a.real).length).toBe(1);
      }
    }
  });

  it('mixes Gemini AND Nano cursors, not all-one-kind', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard'));
    const gemini = agents.filter((a) => a.kind === 'gemini');
    const nano = agents.filter((a) => a.kind === 'nano');
    expect(gemini.length).toBeGreaterThan(0);
    expect(nano.length).toBeGreaterThan(0);
    // Both Gemini blue shades and the single Nano green appear.
    const colors = new Set(agents.map((a) => a.color));
    expect(colors.has('#5A7BA6')).toBe(true);
    expect(colors.has('#7B9BC2')).toBe(true);
    expect(colors.has('#6B8F71')).toBe(true);
  });

  it('the pill shows both Gemini and Nano counts', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard'));
    const gemini = agents.filter((a) => a.kind === 'gemini').length;
    const nano = agents.filter((a) => a.kind === 'nano').length;
    const text = swarmPillText({ agents: agents.length, gemini, nano, bytes: 0 });
    expect(text).toContain(`Gemini ${gemini}`);
    expect(text).toContain(`Nano ${nano}`);
  });

  it('never marks more than REAL_CALL_CAP agents real', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('nano', 'dashboard'));
    expect(agents.filter((a) => a.real).length).toBeLessThanOrEqual(REAL_CALL_CAP);
  });

  it('labels the real call per task and engine', () => {
    expect(buildMixedSwarmPlan('nano', 'dashboard').calls[0].label).toBe('Nano · labels');
    expect(buildMixedSwarmPlan('gemini', 'dashboard').calls[0].label).toBe('Gemini · planner');
    expect(buildMixedSwarmPlan('nano', 'floorplan').calls[0].label).toBe('Nano · room labels');
    expect(buildMixedSwarmPlan('gemini', 'kannada').calls[0].label).toBe('Gemini · translation plan');
  });

  it('uses Kannada-swap labels for the kannada task', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'kannada'));
    expect(agents.some((a) => a.label.includes('Kannada'))).toBe(true);
  });

  it('adds an honest redaction cursor when a name was redacted', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('nano', 'dashboard', { redactedName: true }));
    expect(agents.some((a) => a.label.includes('redaction'))).toBe(true);
  });

  it('tile-bound sub-steps share a tileIndex across Gemini (frame) and Nano (label)', () => {
    const plan = buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 5 });
    const agents = buildSwarmAgents(plan);
    const tileIndexes = new Set(agents.filter((a) => a.tileIndex != null).map((a) => a.tileIndex));
    expect(tileIndexes.has(0)).toBe(true);
    expect(tileIndexes.has(4)).toBe(true);
    const framers = agents.filter((a) => a.tileIndex === 0 && a.kind === 'gemini');
    const labelers = agents.filter((a) => a.tileIndex === 0 && a.kind === 'nano');
    expect(framers.length).toBeGreaterThan(0);
    expect(labelers.length).toBeGreaterThan(0);
  });

  it('clamps tile count into [4, 8] regardless of a tiny or huge plan', () => {
    const tiny = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 1 }));
    const huge = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 50 }));
    expect(tiny.length).toBeGreaterThanOrEqual(10);
    expect(huge.length).toBeLessThanOrEqual(20);
  });
});

describe('honestyNote', () => {
  it('states agent count vs real model call count', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard'));
    expect(honestyNote(agents)).toBe(`${agents.length} agents show the real steps of about 1 model call.`);
  });
});

describe('poseAt — unique non-overlapping targets', () => {
  it('spreads end positions across a grid with a minimum separation', () => {
    const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard'));
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
    const agents = buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard'));
    const a = agents.map((a, i) => poseAt(a, i, 700, { seed: 3, total: agents.length }));
    const b = agents.map((a, i) => poseAt(a, i, 700, { seed: 3, total: agents.length }));
    expect(a).toEqual(b);
  });
});

describe('swarmPillText', () => {
  it('builds the status pill', () => {
    expect(swarmPillText({ agents: 15, gemini: 1, nano: 14, bytes: 0 })).toBe('15 agents · Gemini 1 · Nano 14 · 0 B to cloud');
  });
  it('formats KB/MB like the ledger does', () => {
    expect(swarmPillText({ agents: 1, gemini: 1, nano: 0, bytes: 2048 })).toContain('2.0 KB to cloud');
    expect(swarmPillText({ agents: 1, gemini: 1, nano: 0, bytes: 3 * 1024 * 1024 })).toContain('3.0 MB to cloud');
  });
  it('singular agent', () => {
    expect(swarmPillText({ agents: 1, gemini: 1, nano: 0, bytes: 0 })).toContain('1 agent ·');
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

  it('fires onReachTarget once per tile-bound agent under reduced motion (all start at the end pose)', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    const hits: Array<{ tileIndex: number; kind: string }> = [];
    const layer = createSwarmLayer(container, {
      reducedMotion: true, doc: fakeDoc,
      onReachTarget: (tileIndex, kind) => hits.push({ tileIndex, kind }),
    });
    const plan = buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 4 });
    layer.start(plan, 1);
    const tileAgents = buildSwarmAgents(plan).filter((a) => a.tileIndex != null);
    expect(hits.length).toBe(tileAgents.length);
    expect(hits.some((h) => h.tileIndex === 0 && h.kind === 'gemini')).toBe(true);
    expect(hits.some((h) => h.tileIndex === 0 && h.kind === 'nano')).toBe(true);
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
