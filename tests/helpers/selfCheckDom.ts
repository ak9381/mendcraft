// A minimal fake document, just rich enough for handPointer's collectControls
// (INTERACTIVE querySelectorAll, elementFromPoint, no shadow roots) and
// createHandPointer's own overlay elements (frame/shadow/ring) — the same
// trick tests/canvas/handPointerPipeline.test.ts uses, shared here so
// selfCheck's tests and its latency report can both build fake tiles.

export interface FakeRect { left: number; top: number; width: number; height: number }

/** Node has no innerWidth/innerHeight/MouseEvent — handPointer's isUsable()
 *  and dry-run activate() need them. Call from a beforeEach. */
export function installSelfCheckGlobals(width = 1000, height = 800): void {
  const g = globalThis as Record<string, unknown>;
  g.innerWidth = width;
  g.innerHeight = height;
  if (typeof g.MouseEvent === 'undefined') {
    g.MouseEvent = class FakeMouseEvent {
      type: string;
      constructor(type: string, _init?: unknown) { this.type = type; }
    };
  }
}

export function fakeEl(tag: string, rect: FakeRect, attrs: Record<string, string> = {}): any {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const el: any = {
    tagName: tag.toUpperCase(),
    id: attrs.id ?? '',
    parentElement: null,
    shadowRoot: undefined,
    style: {} as Record<string, string>,
    className: '',
    hidden: false,
    getAttribute: (n: string) => attrs[n] ?? null,
    setAttribute: (n: string, v: string) => { attrs[n] = v; },
    matches: (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button')),
    closest: () => null,
    contains: (other: unknown) => other === el,
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    getRootNode: () => ({ host: null }),
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type: string, fn: (e: unknown) => void) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type: string, fn: (e: unknown) => void) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
    dispatchEvent(e: { type: string }) {
      const withStops = Object.assign(e, {
        stopImmediatePropagation: (e as { stopImmediatePropagation?: () => void }).stopImmediatePropagation ?? (() => {}),
        preventDefault: (e as { preventDefault?: () => void }).preventDefault ?? (() => {}),
      });
      (listeners[e.type] ?? []).slice().forEach((fn) => fn(withStops));
      return true;
    },
    click() { el.dispatchEvent({ type: 'click' }); },
    remove() { /* no-op: tests don't need real detach bookkeeping */ },
  };
  return el;
}

export function fakeHost(rect: FakeRect, attrs: Record<string, string> = {}, tag = 'mc-lamp-tile'): any {
  return fakeEl(tag, rect, attrs);
}

export function fakeDoc(controls: any[], o: { body?: { append: (...els: any[]) => void } } = {}): any {
  const body = o.body ?? { append: () => {} };
  return {
    body,
    createElement: (tag: string) => fakeEl(tag, { left: 0, top: 0, width: 0, height: 0 }),
    querySelectorAll: (sel: string) => {
      if (sel === '*' || sel === '[aria-modal=true]') return [];
      return sel.split(',').some((s) => s.trim().startsWith('button')) ? controls : [];
    },
    elementFromPoint: (x: number, y: number) =>
      controls.find((b) => {
        const r = b.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      }) ?? null,
  };
}
