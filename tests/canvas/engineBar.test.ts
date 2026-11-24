import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountEngineBar } from '../../src/canvas/engineBar';
import { mountModelPanels } from '../../src/canvas/modelPanels';

/** Minimal fake DOM (the suite runs under Vitest's node environment). */
class FakeEl {
  tag: string;
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  hidden = false;
  textContent = '';
  title = '';
  private cls = new Set<string>();
  private listeners: Record<string, Array<() => void>> = {};
  constructor(tag: string) { this.tag = tag; }
  set className(v: string) { this.cls = new Set(v.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.cls].join(' '); }
  classList = {
    add: (...c: string[]) => c.forEach((x) => this.cls.add(x)),
    remove: (...c: string[]) => c.forEach((x) => this.cls.delete(x)),
    toggle: (c: string, on?: boolean) => { const want = on ?? !this.cls.has(c); if (want) this.cls.add(c); else this.cls.delete(c); return want; },
    contains: (c: string) => this.cls.has(c),
  };
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...els: FakeEl[]) { els.forEach((e) => { e.parent = this; this.children.push(e); }); }
  appendChild(e: FakeEl) { this.append(e); return e; }
  addEventListener(t: string, f: () => void) { (this.listeners[t] ??= []).push(f); }
  click() { (this.listeners.click ?? []).forEach((f) => f()); }
  all(): FakeEl[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector<T = FakeEl>(sel: string): T | null {
    const m = sel.match(/^\.([\w-]+)(?:\[data-(\w+)="([^"]+)"\])?$/);
    if (!m) return null;
    return (this.all().find((e) => e.className.split(/\s+/).includes(m[1]!) && (!m[2] || e.attrs[`data-${m[2]}`] === m[3])) as unknown as T) ?? null;
  }
}
const doc = { createElement: (t: string) => new FakeEl(t) } as unknown as Document;

function mount(onOpen = vi.fn()) {
  const root = new FakeEl('div');
  (root as unknown as { ownerDocument: Document }).ownerDocument = doc;
  const bar = mountEngineBar(root as unknown as HTMLElement, { onOpen });
  const q = (sel: string) => (bar.el as unknown as FakeEl).querySelector(sel)!;
  return { root, bar, onOpen, q };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('engine bar', () => {
  it('mounts two cards, Nano on this device and Gemini cloud, fixed bottom bar class', () => {
    const { bar, q } = mount();
    expect((bar.el as unknown as FakeEl).className).toContain('mc-engine-bar');
    expect(q('.mc-engine-card[data-engine="nano"]').querySelector('.mc-engine-where')!.textContent).toBe('on this device');
    expect(q('.mc-engine-card[data-engine="gemini"]').querySelector('.mc-engine-where')!.textContent).toBe('cloud');
  });

  it('set() shows state and the last line', () => {
    const { bar, q } = mount();
    bar.set('nano', 'working', 'redacted a name');
    const card = q('.mc-engine-card[data-engine="nano"]');
    expect(card.attrs['data-state']).toBe('working');
    expect(card.querySelector('.mc-engine-line')!.textContent).toBe('redacted a name');
    expect(q('.mc-engine-card[data-engine="gemini"]').attrs['data-state']).toBe('idle');
  });

  it('keeps the previous line when set() is called without one, and clips long lines to 60 chars', () => {
    const { bar, q } = mount();
    bar.set('gemini', 'working', 'planning');
    bar.set('gemini', 'done');
    expect(q('.mc-engine-card[data-engine="gemini"]').querySelector('.mc-engine-line')!.textContent).toBe('planning');
    bar.set('gemini', 'done', 'x'.repeat(100));
    const t = q('.mc-engine-card[data-engine="gemini"]').querySelector('.mc-engine-line')!.textContent;
    expect(t.length).toBe(60);
    expect(t.endsWith('…')).toBe(true);
  });

  it('setCloudBytes uses the footer formatter ("sent to cloud")', () => {
    const { bar, q } = mount();
    bar.setCloudBytes(2253);
    expect(q('.mc-engine-bytes').textContent).toBe('2.2 KB sent to cloud');
    bar.setCloudBytes(0);
    expect(q('.mc-engine-bytes').textContent).toBe('0 B sent to cloud');
  });

  it('clicking a card opens the AI panel for that engine', () => {
    const { q, onOpen } = mount();
    q('.mc-engine-card[data-engine="gemini"]').click();
    expect(onOpen).toHaveBeenCalledWith('gemini');
    q('.mc-engine-card[data-engine="nano"]').click();
    expect(onOpen).toHaveBeenCalledWith('nano');
  });

  it('a failed engine shows the failure state and reason (Review Focus 5)', () => {
    const { bar, q } = mount();
    bar.set('gemini', 'failed', 'App Check blocked');
    const card = q('.mc-engine-card[data-engine="gemini"]');
    expect(card.attrs['data-state']).toBe('failed');
    expect(card.querySelector('.mc-engine-state')!.textContent).toMatch(/fail/i);
    expect(card.querySelector('.mc-engine-line')!.textContent).toBe('App Check blocked');
  });

  it('queued and unavailable are distinct states', () => {
    const { bar, q } = mount();
    bar.set('gemini', 'queued', '1 request queued');
    expect(q('.mc-engine-card[data-engine="gemini"]').attrs['data-state']).toBe('queued');
    bar.set('nano', 'unavailable');
    expect(q('.mc-engine-card[data-engine="nano"]').attrs['data-state']).toBe('unavailable');
  });

  it('handoff() flags the bar with its direction for 1.2 s, then clears', () => {
    const { bar, q } = mount();
    const el = bar.el as unknown as FakeEl;
    bar.handoff('nano', 'gemini');
    expect(el.classList.contains('is-handoff')).toBe(true);
    expect(el.attrs['data-handoff']).toBe('nano-gemini');
    vi.advanceTimersByTime(1199);
    expect(el.classList.contains('is-handoff')).toBe(true);
    vi.advanceTimersByTime(2);
    expect(el.classList.contains('is-handoff')).toBe(false);
    expect(q('.mc-engine-link')).toBeTruthy();
  });

  it('a second handoff restarts the 1.2 s window', () => {
    const { bar } = mount();
    const el = bar.el as unknown as FakeEl;
    bar.handoff('nano', 'gemini');
    vi.advanceTimersByTime(1000);
    bar.handoff('gemini', 'nano');
    vi.advanceTimersByTime(1000);
    expect(el.classList.contains('is-handoff')).toBe(true);
    expect(el.attrs['data-handoff']).toBe('gemini-nano');
  });

  it('setAgents mirrors the swarm summary and hides when empty', () => {
    const { bar, q } = mount();
    expect(q('.mc-engine-agents').hidden).toBe(true);
    bar.setAgents('6 agents · Gemini 3 · Nano 3');
    expect(q('.mc-engine-agents').hidden).toBe(false);
    expect(q('.mc-engine-agents').textContent).toBe('6 agents · Gemini 3 · Nano 3');
    bar.setAgents('');
    expect(q('.mc-engine-agents').hidden).toBe(true);
  });
});

describe('model panels mirror their engine state into the bar', () => {
  function fakePanel(): HTMLElement {
    const root = new FakeEl('div');
    const mk = (cls: string, hidden = false) => { const e = new FakeEl('div'); e.className = cls; e.hidden = hidden; return e; };
    const build = (engine: string) => {
      const s = mk(`mc-terminal mc-terminal-${engine}`);
      const body = mk('mc-term-body');
      body.append(mk('mc-term-lines'), mk('mc-term-empty'), mk('mc-term-cursor', true));
      s.append(mk('mc-term-queued', true), body);
      return s;
    };
    const panels = mk('mc-terminals', true);
    panels.append(build('nano'), build('gemini'));
    const footer = mk('mc-ai-footer', true);
    footer.append(mk('mc-ai-footer-bytes'));
    root.append(panels, footer);
    return root as unknown as HTMLElement;
  }
  const lineDoc = { createElement: (t: string) => { const e = new FakeEl(t) as FakeEl & { innerHTML: string }; e.innerHTML = ''; return e; } } as unknown as Document;

  it('log verbs map to working/done, fail to failed, queued to queued, handoff to a bar handoff', () => {
    const { bar, q } = mount();
    const panels = mountModelPanels(fakePanel(), lineDoc, bar);
    panels.forEngine('nano').log('redact', 'Sharma → [Client A]');
    expect(q('.mc-engine-card[data-engine="nano"]').attrs['data-state']).toBe('working');
    panels.forEngine('nano').log('done', '4 tiles filled');
    expect(q('.mc-engine-card[data-engine="nano"]').attrs['data-state']).toBe('done');
    panels.forEngine('gemini').fail('App Check blocked');
    const g = q('.mc-engine-card[data-engine="gemini"]');
    expect(g.attrs['data-state']).toBe('failed');
    expect(g.querySelector('.mc-engine-line')!.textContent).toBe('App Check blocked');
    panels.forEngine('nano').setQueued(2);
    expect(q('.mc-engine-card[data-engine="nano"]').attrs['data-state']).toBe('queued');
    panels.showHandoff('nano', 'plan the room');
    expect((bar.el as unknown as FakeEl).attrs['data-handoff']).toBe('nano-gemini');
    panels.setFooterBytes(412);
    expect(q('.mc-engine-bytes').textContent).toBe('412 B sent to cloud');
  });
});
