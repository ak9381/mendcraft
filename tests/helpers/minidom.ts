// Minimal document/window stub so createReferenceBoard can be unit-tested in
// Vitest's node environment without adding a jsdom dependency.

type Handler = (...args: unknown[]) => void;

export class MiniEl {
  tagName: string;
  className = '';
  id = '';
  hidden = false;
  type = '';
  private _text = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: MiniEl[] = [];
  parentElement: MiniEl | null = null;
  clientWidth = 1200;
  clientHeight = 800;
  private attrs: Record<string, string> = {};
  private listeners: Record<string, Handler[]> = {};
  private _html = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get textContent(): string {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v: string) { this._text = v ?? ''; }

  get innerHTML(): string { return this._html; }
  set innerHTML(v: string) {
    this._html = v;
    if (v === '') this.children = [];
  }

  remove(): void {
    const p = this.parentElement;
    if (!p) return;
    p.children = p.children.filter((c) => c !== this);
    this.parentElement = null;
  }

  classList = {
    add: (c: string) => {
      const parts = new Set(this.className.split(/\s+/).filter(Boolean));
      parts.add(c);
      this.className = [...parts].join(' ');
    },
    remove: (c: string) => {
      this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' ');
    },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
    toggle: (c: string, on?: boolean) => {
      const next = on ?? !this.classList.contains(c);
      if (next) this.classList.add(c); else this.classList.remove(c);
      return next;
    },
  };

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
    if (name === 'id') this.id = value;
  }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  append(...nodes: MiniEl[]): void {
    for (const n of nodes) {
      n.parentElement = this;
      this.children.push(n);
    }
  }
  appendChild(node: MiniEl): MiniEl { this.append(node); return node; }
  addEventListener(type: string, fn: Handler): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(): void { /* noop */ }
  focus(): void { /* noop */ }
  click(): void { /* noop */ }
  querySelector(sel: string): MiniEl | null { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel: string): MiniEl[] {
    return walk(this).filter((el) => el !== this && matches(el, sel));
  }
}

function walk(el: MiniEl): MiniEl[] {
  const out: MiniEl[] = [el];
  for (const c of el.children) out.push(...walk(c));
  return out;
}

function matches(el: MiniEl, sel: string): boolean {
  const parts = sel.trim().split(/\s+/);
  // only simple .class / #id / tag selectors (one token is enough here)
  const token = parts[parts.length - 1];
  if (token.startsWith('.')) return el.classList.contains(token.slice(1));
  if (token.startsWith('#')) return el.id === token.slice(1);
  return el.tagName === token.toUpperCase();
}

export function installMiniDom(): void {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') return;
  const body = new MiniEl('body');
  const doc = {
    body,
    documentElement: new MiniEl('html'),
    createElement: (tag: string) => new MiniEl(tag),
  };
  const win = {
    document: doc,
    addEventListener() { /* noop */ },
    removeEventListener() { /* noop */ },
    open() { return null; },
    requestAnimationFrame(fn: (t: number) => void) { fn(0); return 0; },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  };
  Object.assign(globalThis, {
    document: doc,
    window: win,
    ResizeObserver: win.ResizeObserver,
    requestAnimationFrame: win.requestAnimationFrame,
  });
}
