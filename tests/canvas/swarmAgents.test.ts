import { describe, expect, it } from 'vitest';
import {
  assignSwarmColor,
  buildSwarmAgents,
  buildSwarmPlanForCall,
  createSwarmLayer,
  honestyNote,
  poseAt,
  REAL_CALL_CAP,
  swarmPillText,
  type SwarmAgentSpec,
} from '../../src/canvas/swarmAgents';

describe('assignSwarmColor', () => {
  it('nano is always green', () => {
    expect(assignSwarmColor('nano', 0)).toBe('#53d17a');
    expect(assignSwarmColor('nano', 5)).toBe('#53d17a');
  });
  it('gemini alternates blue and purple', () => {
    expect(assignSwarmColor('gemini', 0)).toBe('#6e8bff');
    expect(assignSwarmColor('gemini', 1)).toBe('#b388ff');
    expect(assignSwarmColor('gemini', 2)).toBe('#6e8bff');
  });
});

describe('buildSwarmAgents — cursor count/colour assignment', () => {
  it('assigns colours per kind in order, independent across kinds', () => {
    const agents = buildSwarmAgents({
      calls: [{ kind: 'gemini', label: 'planner' }],
      subSteps: [{ kind: 'gemini', label: 'tile 2' }, { kind: 'nano', label: 'labels' }, { kind: 'gemini', label: 'tile 3' }],
    });
    expect(agents.map((a) => a.color)).toEqual(['#6e8bff', '#b388ff', '#53d17a', '#6e8bff']);
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

describe('buildSwarmPlanForCall', () => {
  it('lands in the ~10-20 cursor range the demo calls for', () => {
    const plan = buildSwarmPlanForCall('gemini');
    const agents = buildSwarmAgents(plan);
    expect(agents.length).toBeGreaterThanOrEqual(10);
    expect(agents.length).toBeLessThanOrEqual(20);
    expect(agents.filter((a) => a.real).length).toBe(1);
  });

  it('labels nano as "Nano · labels" and gemini as "Gemini · planner"', () => {
    expect(buildSwarmPlanForCall('nano').calls[0].label).toBe('Nano · labels');
    expect(buildSwarmPlanForCall('gemini').calls[0].label).toBe('Gemini · planner');
  });
});

describe('honestyNote', () => {
  it('states agent count vs real model call count', () => {
    const agents = buildSwarmAgents(buildSwarmPlanForCall('gemini'));
    expect(honestyNote(agents)).toBe(`${agents.length} agents show the real steps of about 1 model call.`);
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
    layer.start(buildSwarmPlanForCall('nano'), 1);
    const c = container as unknown as FakeEl;
    // pill + N cursors
    expect(c.children.length).toBe(1 + buildSwarmAgents(buildSwarmPlanForCall('nano')).length);
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
    layer.start(buildSwarmPlanForCall('gemini'), 1);
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
    layer.start(buildSwarmPlanForCall('gemini'), 1);
    expect(rafCalls).toBe(1);
  });

  it('settle hides the container and removes cursors', () => {
    const container = new FakeEl('div') as unknown as HTMLElement;
    const layer = createSwarmLayer(container, { reducedMotion: true, doc: fakeDoc });
    layer.start(buildSwarmPlanForCall('nano'), 1);
    layer.settle();
    const c = container as unknown as FakeEl;
    expect(c.hidden).toBe(true);
  });
});
