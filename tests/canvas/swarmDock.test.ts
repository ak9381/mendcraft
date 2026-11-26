import { describe, expect, it } from 'vitest';
import { mountSwarmDock, shortAgentName } from '../../src/canvas/swarmDock';
import type { SwarmAgentSpec } from '../../src/canvas/swarmAgents';

/** Minimal hand-rolled fake DOM, in the same style the rest of this suite
 *  uses under Vitest's node environment (no jsdom) — rich enough for
 *  swarmDock.ts's actual DOM surface: class/attribute/descendant
 *  querySelector, classList, dataset, event listeners (with capture) and
 *  dispatch, and contains(). */
class El {
  tag: string;
  attrs: Record<string, string> = {};
  classSet = new Set<string>();
  children: El[] = [];
  parent: El | null = null;
  hidden = false;
  style = { setProperty: (_k: string, _v: string) => {} } as unknown as CSSStyleDeclaration;
  private html = '';
  private text = '';
  private listeners: { type: string; capture: boolean; fn: (e: unknown) => void }[] = [];
  constructor(tag: string) { this.tag = tag; }
  set className(v: string) { this.classSet = new Set(v.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classSet].join(' '); }
  get classList() {
    const self = this;
    return {
      add: (c: string) => self.classSet.add(c),
      remove: (c: string) => self.classSet.delete(c),
      contains: (c: string) => self.classSet.has(c),
    };
  }
  set innerHTML(v: string) { this.html = v; this.children = parseHTML(v); this.children.forEach((c) => { c.parent = this; }); }
  get innerHTML() { return this.html; }
  set textContent(v: string) { this.text = v; this.html = ''; this.children = []; }
  get textContent() { return this.text; }
  get dataset() {
    const self = this;
    return new Proxy({} as Record<string, string | undefined>, {
      get(_t, k: string) { return self.attrs[`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`]; },
      set(_t, k: string, v: string) { self.attrs[`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = v; return true; },
    });
  }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  appendChild(el: El) { el.parent = this; this.children.push(el); return el; }
  append(...els: El[]) { els.forEach((e) => this.appendChild(e)); }
  insertBefore(el: El, ref: El) {
    el.parent = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(el); else this.children.splice(i, 0, el);
    return el;
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  addEventListener(type: string, fn: (e: unknown) => void, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    this.listeners.push({ type, capture, fn });
  }
  removeEventListener(type: string, fn: (e: unknown) => void, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.capture === capture && l.fn === fn));
  }
  /** Fires capture-phase listeners root→target, then bubble-phase target→root. */
  dispatch(type: string, target: El = this) {
    const chain: El[] = [];
    let n: El | null = target;
    while (n) { chain.push(n); n = n.parent; }
    const event = { target };
    [...chain].reverse().forEach((el) => el.listeners.filter((l) => l.type === type && l.capture).forEach((l) => l.fn(event)));
    chain.forEach((el) => el.listeners.filter((l) => l.type === type && !l.capture).forEach((l) => l.fn(event)));
  }
  contains(node: El): boolean {
    let n: El | null = node;
    while (n) { if (n === this) return true; n = n.parent; }
    return false;
  }
  querySelector(sel: string): El | null { return findAll(this, sel)[0] ?? null; }
}

/** Just enough HTML→El parsing for swarmDock.ts's two static `innerHTML`
 *  templates (the mini terminal shell, the dock chip) — nested tags with
 *  `class="..."`/other attrs and a bare boolean `hidden`; text runs are
 *  dropped since no test reads them (the app sets `.textContent` directly
 *  on elements it queries back out). */
function parseHTML(html: string): El[] {
  const stack: El[] = [];
  const roots: El[] = [];
  const tokenRe = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*)?\/?>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    const token = m[0];
    if (token[0] !== '<') continue; // text run — not needed for our assertions
    if (token.startsWith('</')) { stack.pop(); continue; }
    const tagMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*)?)\/?>$/.exec(token)!;
    const el = new El(tagMatch[1]);
    const attrRe = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(tagMatch[2] ?? ''))) {
      const key = am[1]; const val = am[2] ?? '';
      if (key === 'class') el.className = val;
      else if (key === 'hidden') el.hidden = true;
      else el.attrs[key] = val;
    }
    if (stack.length) stack[stack.length - 1].appendChild(el); else roots.push(el);
    stack.push(el);
  }
  return roots;
}

function parsePart(part: string) {
  const m = /^([a-zA-Z0-9-]*)((?:\.[a-zA-Z0-9-]+)*)(?:\[([a-zA-Z0-9-]+)="([^"]*)"])?$/.exec(part.trim());
  if (!m) throw new Error(`bad fake selector part: ${part}`);
  return {
    tag: m[1] || null,
    classes: (m[2].match(/\.[a-zA-Z0-9-]+/g) ?? []).map((c) => c.slice(1)),
    attrName: m[3] || null,
    attrVal: m[4],
  };
}
function matchesPart(el: El, part: ReturnType<typeof parsePart>): boolean {
  if (part.tag && el.tag !== part.tag) return false;
  if (part.classes.some((c) => !el.classSet.has(c))) return false;
  if (part.attrName && el.attrs[part.attrName] !== part.attrVal) return false;
  return true;
}
function descendants(el: El): El[] {
  const out: El[] = [];
  for (const c of el.children) { out.push(c); out.push(...descendants(c)); }
  return out;
}
function findAll(root: El, selector: string): El[] {
  const parts = selector.trim().split(/\s+/).map(parsePart);
  let scope = [root];
  let result: El[] = [];
  for (const part of parts) {
    const pool = scope.flatMap(descendants);
    result = pool.filter((el) => matchesPart(el, part));
    scope = result;
  }
  return result;
}

/** swarmDock.ts also attaches a capture-phase pointerdown listener to `doc`
 *  itself (to close the mini terminal on an outside tap), so the fake
 *  document needs to be a dispatchable El too, not just a createElement stub. */
class FakeDoc extends El {
  createElement(tag: string) { return new El(tag); }
}
const fakeDoc = new FakeDoc('#document') as unknown as Document;

function buildAiPanel(): El {
  const aiPanel = new El('div');
  for (const engine of ['nano', 'gemini']) {
    const dock = new El('div'); dock.className = 'mc-term-dock'; dock.setAttribute('data-engine', engine);
    const chips = new El('div'); chips.className = 'mc-term-dock-chips';
    const history = new El('details'); history.className = 'mc-term-dock-history'; history.hidden = true;
    const historyChips = new El('div'); historyChips.className = 'mc-term-dock-history-chips';
    const historyCount = new El('span'); historyCount.className = 'mc-term-dock-history-count'; historyCount.textContent = '0';
    history.append(historyCount, historyChips);
    dock.append(chips, history);
    aiPanel.append(dock);
  }
  return aiPanel;
}

/** Runs setTimeoutFn callbacks synchronously, in call order — good enough to
 *  exercise the staggering code path without real timers. */
function immediateTimers() {
  return { setTimeoutFn: (cb: () => void) => { cb(); return 0; }, clearTimeoutFn: () => {} };
}

function agent(id: string, kind: 'nano' | 'gemini', label: string, tileIndex?: number): SwarmAgentSpec {
  return { id, kind, label, color: '#000', real: id.startsWith('real'), tileIndex };
}

describe('shortAgentName', () => {
  it('strips the redundant engine prefix', () => {
    expect(shortAgentName('Nano · labels')).toBe('labels');
    expect(shortAgentName('Gemini · planner')).toBe('planner');
    expect(shortAgentName('gemini: planner')).toBe('planner');
  });
  it('leaves a label with no engine prefix alone', () => {
    expect(shortAgentName('tile 3')).toBe('tile 3');
  });
});

describe('mountSwarmDock — chips per engine', () => {
  it('start() renders one chip per agent under its own engine dock, reduced motion skips staggering', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div') as unknown as HTMLElement;
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root, { doc: fakeDoc, ...immediateTimers() });
    const agents = [agent('real-0', 'gemini', 'Gemini · planner'), agent('sub-0', 'nano', 'Nano · labels')];
    dock.start(agents, { reducedMotion: true });
    const nanoChips = aiPanel.querySelector('.mc-term-dock[data-engine="nano"] .mc-term-dock-chips')!;
    const geminiChips = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-chips')!;
    expect(nanoChips.children.length).toBe(1);
    expect(geminiChips.children.length).toBe(1);
    expect(nanoChips.children[0].classSet.has('is-working')).toBe(true);
  });

  it('settle() marks every chip done, including ones never added', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div') as unknown as HTMLElement;
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('real-0', 'nano', 'Nano · labels')], { reducedMotion: true });
    dock.settle();
    const chips = aiPanel.querySelector('.mc-term-dock[data-engine="nano"] .mc-term-dock-chips')!;
    expect(chips.children[0].classSet.has('is-done')).toBe(true);
    expect(chips.children[0].classSet.has('is-working')).toBe(false);
  });

  it('folds chips past MAX_VISIBLE into one overflow control per engine', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div') as unknown as HTMLElement;
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root, { doc: fakeDoc, ...immediateTimers() });
    const agents = Array.from({ length: 9 }, (_, i) => agent(`sub-${i}`, 'gemini', `Gemini · tile ${i + 1}`));
    dock.start(agents, { reducedMotion: true });
    const chips = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-chips')!;
    // 6 visible chips + 1 overflow control.
    expect(chips.children.length).toBe(7);
    const overflow = chips.children[chips.children.length - 1];
    expect(overflow.textContent).toBe('+3');
    overflow.dispatch('click', overflow);
    expect(chips.children.length).toBe(9);
  });
});

describe('mountSwarmDock — session history', () => {
  it('folds the previous turn into history instead of discarding it, and clears the live dock', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div') as unknown as HTMLElement;
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('real-0', 'nano', 'Nano · labels')], { reducedMotion: true });
    dock.settle();
    dock.start([agent('real-1', 'nano', 'Nano · device values')], { reducedMotion: true });
    const liveChips = aiPanel.querySelector('.mc-term-dock[data-engine="nano"] .mc-term-dock-chips')!;
    const historyChips = aiPanel.querySelector('.mc-term-dock[data-engine="nano"] .mc-term-dock-history-chips')!;
    const history = aiPanel.querySelector('.mc-term-dock[data-engine="nano"] .mc-term-dock-history')!;
    const count = aiPanel.querySelector('.mc-term-dock[data-engine="nano"] .mc-term-dock-history-count')!;
    expect(liveChips.children.length).toBe(1);
    expect(liveChips.children[0].attrs['data-agent-id']).toBe('real-1');
    expect(historyChips.children.length).toBe(1);
    expect(historyChips.children[0].attrs['data-agent-id']).toBe('real-0');
    expect(historyChips.children[0].classSet.has('is-done')).toBe(true);
    expect(history.hidden).toBe(false);
    expect(count.textContent).toBe('1');
  });

  it('a folded-into-overflow agent still gets a real chip once it lands in history', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div') as unknown as HTMLElement;
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root, { doc: fakeDoc, ...immediateTimers() });
    const agents = Array.from({ length: 9 }, (_, i) => agent(`sub-${i}`, 'gemini', `Gemini · tile ${i + 1}`));
    dock.start(agents, { reducedMotion: true });
    dock.settle(); // 6 real chips + an un-expanded overflow still hiding 3
    dock.start([agent('real-0', 'gemini', 'Gemini · planner')], { reducedMotion: true });
    const historyChips = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-history-chips')!;
    expect(historyChips.children.length).toBe(9);
    expect(historyChips.children.every((c) => c.classSet.has('is-done'))).toBe(true);
  });

  it('a history chip still opens its own mini terminal when tapped', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div');
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root as unknown as HTMLElement, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('real-0', 'gemini', 'Gemini · planner')], { reducedMotion: true, payloads: { gemini: 'Dashboard for [Client A]' } });
    dock.settle();
    dock.start([agent('real-1', 'gemini', 'Gemini · layout')], { reducedMotion: true });
    const historyChip = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-history-chips')!.children[0];
    historyChip.dispatch('click', historyChip);
    const mini = root.children.find((c) => c.classSet.has('mc-mini-terminal'))!;
    expect(mini.hidden).toBe(false);
    expect(mini.querySelector('.mc-term-title')!.textContent).toBe('planner');
  });
});

describe('mountSwarmDock — mini terminal', () => {
  it('tapping a chip opens its mini terminal with the agent label (no engine prefix)', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div');
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root as unknown as HTMLElement, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('real-0', 'gemini', 'Gemini · planner')], { reducedMotion: true });
    const chip = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-chips')!.children[0];
    chip.dispatch('click', chip);
    const mini = root.children.find((c) => c.classSet.has('mc-mini-terminal'))!;
    expect(mini.hidden).toBe(false);
    expect(mini.querySelector('.mc-term-title')!.textContent).toBe('planner');
    expect(chip.attrs['aria-pressed']).toBe('true');
  });

  it('shows the exact redacted payload as the chip opens — never a raw name', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div');
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root as unknown as HTMLElement, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('real-0', 'gemini', 'Gemini · planner')], {
      reducedMotion: true,
      payloads: { gemini: 'Dashboard for [Client A]: bulb, plug' },
    });
    const chip = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-chips')!.children[0];
    chip.dispatch('click', chip);
    const mini = root.children.find((c) => c.classSet.has('mc-mini-terminal'))!;
    const lines = mini.querySelector('.mc-term-lines')!;
    expect(lines.innerHTML).toContain('Dashboard for [Client A]: bulb, plug');
    expect(lines.innerHTML).not.toMatch(/Sharma/);
  });

  it('omits the payload line for an engine that made no real call this turn', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div');
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root as unknown as HTMLElement, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('sub-0', 'nano', 'Nano · labels')], { reducedMotion: true, payloads: { gemini: 'Dashboard for [Client A]' } });
    const chip = aiPanel.querySelector('.mc-term-dock[data-engine="nano"] .mc-term-dock-chips')!.children[0];
    chip.dispatch('click', chip);
    const mini = root.children.find((c) => c.classSet.has('mc-mini-terminal'))!;
    expect(mini.querySelector('.mc-term-lines')!.innerHTML).not.toContain('received');
  });

  it('tapping the same chip again closes it; tapping another switches', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div');
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root as unknown as HTMLElement, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('real-0', 'gemini', 'Gemini · planner'), agent('sub-0', 'nano', 'Nano · labels')], { reducedMotion: true });
    const geminiChip = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-chips')!.children[0];
    const nanoChip = aiPanel.querySelector('.mc-term-dock[data-engine="nano"] .mc-term-dock-chips')!.children[0];
    const mini = root.children.find((c) => c.classSet.has('mc-mini-terminal'))!;
    geminiChip.dispatch('click', geminiChip);
    expect(mini.hidden).toBe(false);
    geminiChip.dispatch('click', geminiChip);
    expect(mini.hidden).toBe(true);
    nanoChip.dispatch('click', nanoChip);
    expect(mini.hidden).toBe(false);
    expect(mini.querySelector('.mc-term-title')!.textContent).toBe('labels');
    expect(geminiChip.attrs['aria-pressed']).toBe('false');
  });

  it('fires onOpenAgent/onCloseAgent with the agent id and kind', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div');
    const opened: { id: string; kind: string }[] = [];
    const closed: { id: string; kind: string }[] = [];
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root as unknown as HTMLElement, {
      doc: fakeDoc, ...immediateTimers(),
      onOpenAgent: (id, kind) => opened.push({ id, kind }),
      onCloseAgent: (id, kind) => closed.push({ id, kind }),
    });
    dock.start([agent('real-0', 'gemini', 'Gemini · planner')], { reducedMotion: true });
    const chip = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-chips')!.children[0];
    chip.dispatch('click', chip);
    chip.dispatch('click', chip);
    expect(opened).toEqual([{ id: 'real-0', kind: 'gemini' }]);
    expect(closed).toEqual([{ id: 'real-0', kind: 'gemini' }]);
  });

  it('a pointerdown outside the mini terminal and its chip closes it', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div');
    const outside = new El('div');
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root as unknown as HTMLElement, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('real-0', 'gemini', 'Gemini · planner')], { reducedMotion: true });
    const chip = aiPanel.querySelector('.mc-term-dock[data-engine="gemini"] .mc-term-dock-chips')!.children[0];
    const mini = root.children.find((c) => c.classSet.has('mc-mini-terminal'))!;
    chip.dispatch('click', chip);
    expect(mini.hidden).toBe(false);
    // The real document's capture-phase listener fires for any descendant;
    // this fake only walks a target's actual parent chain, so `outside`
    // needs to be attached under the fake document first.
    (fakeDoc as unknown as El).appendChild(outside);
    (fakeDoc as unknown as El).dispatch('pointerdown', outside);
    expect(mini.hidden).toBe(true);
  });

  it('destroy() removes the mini terminal from root', () => {
    const aiPanel = buildAiPanel();
    const root = new El('div');
    const dock = mountSwarmDock(aiPanel as unknown as HTMLElement, root as unknown as HTMLElement, { doc: fakeDoc, ...immediateTimers() });
    dock.start([agent('real-0', 'gemini', 'Gemini · planner')], { reducedMotion: true });
    expect(root.children.some((c) => c.classSet.has('mc-mini-terminal'))).toBe(true);
    dock.destroy();
    expect(root.children.some((c) => c.classSet.has('mc-mini-terminal'))).toBe(false);
  });
});
