// A faked document just rich enough for createHandPointer(): buttons and
// `.mc-frame` boards hit-tested by rect, overlay elements whose classList /
// style the pointer paints. Shared by the dwell-lock and grab tests.
import { vi } from 'vitest';

export interface Rect { left: number; top: number; width: number; height: number }

export interface FakeEl {
  tagName: string;
  rect: Rect;
  dataset: Record<string, string>;
  classList: { add: () => void; remove: () => void; toggle: () => void; contains: () => boolean };
  getAttribute: () => null;
  closest: (sel: string) => FakeEl | null;
  matches: (sel: string) => boolean;
  getBoundingClientRect: () => Rect & { right: number; bottom: number };
  getRootNode: () => unknown;
  parentElement: null;
  click: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
}

function base(tagName: string, rect: Rect): FakeEl {
  return {
    tagName,
    rect,
    dataset: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    getAttribute: () => null,
    closest: () => null,
    matches: () => false,
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    getRootNode: () => ({ host: null }),
    parentElement: null,
    click: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

/** A plain `<button>`; pass `inFrame` to make `closest('.mc-frame')` find it. */
export function fakeButton(rect: Rect, inFrame?: FakeEl): FakeEl {
  const el = base('BUTTON', rect);
  el.matches = (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button'));
  el.closest = (sel: string) => (sel === '.mc-frame' ? inFrame ?? null : null);
  return el;
}

/** A `.mc-frame` board (data-frame=id) with no controls of its own. */
export function fakeFrame(rect: Rect, id: string): FakeEl {
  const el = base('SECTION', rect);
  el.dataset = { frame: id };
  el.matches = (sel: string) => sel.split(',').some((s) => s.trim() === '.mc-frame');
  el.closest = (sel: string) => (sel === '.mc-frame' ? el : null);
  return el;
}

export interface FakeOverlay {
  className: string;
  hidden: boolean;
  style: Record<string, string> & { setProperty: (k: string, v: string) => void };
  classList: { toggle: (c: string, on?: boolean) => void; add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
  setAttribute: () => void;
  remove: () => void;
  append: () => void;
}

function fakeOverlay(): FakeOverlay {
  const classes = new Set<string>();
  return {
    className: '',
    hidden: true,
    style: Object.assign({} as Record<string, string> & { setProperty: (k: string, v: string) => void }, {
      setProperty(k: string, v: string) { (this as Record<string, string>)[k] = v; },
    }),
    classList: {
      toggle: (c: string, on?: boolean) => {
        const next = on === undefined ? !classes.has(c) : on;
        if (next) classes.add(c); else classes.delete(c);
      },
      add: (c: string) => { classes.add(c); },
      remove: (c: string) => { classes.delete(c); },
      contains: (c: string) => classes.has(c),
    },
    setAttribute: () => {},
    remove: () => {},
    append: () => {},
  };
}

const inside = (r: Rect, x: number, y: number) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;

/** Buttons are on top of frames; later frames are on top of earlier ones.
 *  `covers` are opaque non-interactive chrome above everything (e.g. a
 *  right-side cluster panel sitting over a board). */
export function fakeHandDoc(buttons: FakeEl[], frames: FakeEl[] = [], covers: FakeEl[] = []): Document & { __created: FakeOverlay[] } {
  const created: FakeOverlay[] = [];
  const doc = {
    __created: created,
    createElement: () => { const el = fakeOverlay(); created.push(el); return el; },
    body: { append: () => {} },
    querySelectorAll: (sel: string) => {
      if (sel === '*' || sel === '[aria-modal=true]') return [];
      if (sel === '.mc-frame') return frames;
      return sel.split(',').some((s) => s.trim().startsWith('button')) ? buttons : [];
    },
    elementFromPoint: (x: number, y: number) =>
      covers.find((c) => inside(c.rect, x, y))
      ?? buttons.find((b) => inside(b.rect, x, y))
      ?? [...frames].reverse().find((f) => inside(f.rect, x, y))
      ?? null,
  };
  return doc as unknown as Document & { __created: FakeOverlay[] };
}

/** The coral cursor overlay elements (one per hand slot). */
export function cursorsOf(doc: { __created: FakeOverlay[] }): FakeOverlay[] {
  return doc.__created.filter((el) => String(el.className).includes('mc-hand-cursor'));
}

/** The dwell ring overlay elements (one per hand slot). */
export function ringsOf(doc: { __created: FakeOverlay[] }): FakeOverlay[] {
  return doc.__created.filter((el) => String(el.className).includes('mc-hand-dwell'));
}
