import './board.css';

// On-canvas reference board: a numbered grid of picture cards (no iframe) and
// the placed image nodes that stay on the canvas with their credit. Hands and
// voice drive it; mouse still works because each card is a real button.

import { parseReferenceIntent } from './intent';
import type { IntentContext, GridItem, PlacedRef, RefHit, ReferenceIntent, SearchPage } from './types';
import { layoutGrid, pageItems, itemByIndex, stepHover, snapHover } from './grid';
import { emptyRefGestureState, type RefGestureState } from './gestures';
import { fixtureSearch } from './demo';
import { searchReferences, webSearchUrl } from './search';
import type { HandEvent } from '../input/handLogic';

export interface RefLedgerCall {
  job: string;
  reason: string;
  sent: string;
  ms?: number;
  source?: 'cloud' | 'rules' | 'on-device';
}

export interface ReferenceBoardOpts {
  search?: (query: string, page: number) => Promise<SearchPage>;
  refineQuery?: (request: string) => Promise<{ query: string; source: 'on-device' | 'cloud' | 'rules'; ms: number } | null>;
  openWeb?: (url: string) => void;
  speak?: (text: string) => void;
  onCall?: (call: RefLedgerCall) => void;
  onStatus?: (text: string) => void;
  /** Use fixture pictures (sim / screenshot / offline). */
  fixtures?: boolean;
}

export interface ApplyResult {
  ok: boolean;
  detail: string;
}

export interface ReferenceBoard {
  readonly element: HTMLElement;
  isGridOpen(): boolean;
  hasSelection(): boolean;
  apply(intent: ReferenceIntent): Promise<ApplyResult>;
  handleUtterance(utterance: string): Promise<ApplyResult | null>;
  handleHand(e: HandEvent, client: { x: number; y: number }): boolean;
  closeGrid(): boolean;
  showDemoGrid(query?: string): void;
  pendingConfirm(): boolean;
  confirm(): boolean;
}

interface BoardState {
  query: string;
  page: number;
  hits: RefHit[];
  hasMore: boolean;
  items: ReturnType<typeof pageItems>;
  hoveredId: string | null;
  selectedId: string | null;
  placed: PlacedRef[];
  selectedPlacedId: string | null;
  pending: 'place' | 'web' | null;
  loading: boolean;
  open: boolean;
}

function emptyState(): BoardState {
  return {
    query: '', page: 1, hits: [], hasMore: false, items: [],
    hoveredId: null, selectedId: null, placed: [], selectedPlacedId: null,
    pending: null, loading: false, open: false,
  };
}

let placedSeq = 1;

export function createReferenceBoard(opts: ReferenceBoardOpts = {}): ReferenceBoard {
  const root = document.createElement('div');
  root.className = 'mc-ref-layer';
  root.setAttribute('aria-label', 'Reference pictures');

  const grid = document.createElement('section');
  grid.className = 'mc-ref-grid-panel';
  grid.hidden = true;
  grid.setAttribute('role', 'dialog');
  grid.setAttribute('aria-label', 'Reference search results');

  const head = document.createElement('header');
  head.className = 'mc-ref-grid-head';
  const title = document.createElement('h2');
  title.className = 'mc-ref-grid-title';
  title.textContent = 'References';
  const hint = document.createElement('p');
  hint.className = 'mc-ref-grid-hint';
  hint.textContent = 'Pinch a card to pick · hover and wait to dwell · palm to close · say “number two” or “place it”';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mc-ref-x';
  closeBtn.setAttribute('aria-label', 'Close references');
  closeBtn.textContent = '✕';
  head.append(title, hint, closeBtn);

  const status = document.createElement('p');
  status.className = 'mc-ref-grid-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const cards = document.createElement('div');
  cards.className = 'mc-ref-grid';

  const confirmBar = document.createElement('div');
  confirmBar.className = 'mc-ref-confirm';
  confirmBar.hidden = true;

  grid.append(head, status, cards, confirmBar);

  const nodes = document.createElement('div');
  nodes.className = 'mc-ref-nodes';

  root.append(nodes, grid);

  let st = emptyState();
  let gstate: RefGestureState = emptyRefGestureState();
  let boxes = layoutGrid([], 1, 1);

  const speak = (t: string) => opts.speak?.(t);
  const note = (t: string) => {
    status.textContent = t;
    opts.onStatus?.(t);
  };

  function layout(): void {
    const w = root.clientWidth || root.parentElement?.clientWidth || 960;
    const h = root.clientHeight || root.parentElement?.clientHeight || 640;
    boxes = layoutGrid(st.items, w, h);
    const map = new Map(boxes.map((b) => [b.id, b]));
    for (const el of cards.querySelectorAll<HTMLElement>('.mc-ref-card')) {
      const b = map.get(el.dataset.id ?? '');
      if (!b) continue;
      el.style.left = `${b.x}px`;
      el.style.top = `${b.y}px`;
      el.style.width = `${b.w}px`;
      el.style.height = `${b.h}px`;
    }
  }

  function paintCards(): void {
    cards.innerHTML = '';
    for (const item of st.items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mc-ref-card${item.kind === 'web' ? ' mc-ref-card-web' : ''}`;
      btn.dataset.id = item.id;
      btn.dataset.index = String(item.index);
      btn.id = item.kind === 'web' ? 'btn-ref-web' : `btn-ref-card-${item.index}`;
      const num = document.createElement('span');
      num.className = 'mc-ref-num';
      num.textContent = String(item.index);
      btn.append(num);
      if (item.kind === 'web') {
        const label = document.createElement('span');
        label.className = 'mc-ref-web-label';
        label.textContent = 'Search on the web';
        const sub = document.createElement('span');
        sub.className = 'mc-ref-credit';
        sub.textContent = 'Opens a full-page search · pinch to confirm';
        btn.append(label, sub);
        btn.setAttribute('aria-label', `${item.index}. Search on the web`);
      } else if (item.hit) {
        const img = document.createElement('img');
        img.alt = item.hit.title;
        img.src = item.hit.thumbUrl;
        img.referrerPolicy = 'no-referrer';
        img.loading = 'lazy';
        img.draggable = false;
        const cap = document.createElement('span');
        cap.className = 'mc-ref-credit';
        cap.textContent = `${item.hit.source} · ${item.hit.license}${item.hit.creator ? ` · ${item.hit.creator}` : ''}`;
        btn.append(img, cap);
        btn.setAttribute('aria-label', `${item.index}. ${item.hit.title}. ${item.hit.credit}`);
      }
      btn.addEventListener('click', () => { void onCardActivate(item); });
      cards.append(btn);
    }
    layout();
    highlight();
  }

  function highlight(): void {
    for (const el of cards.querySelectorAll<HTMLElement>('.mc-ref-card')) {
      const id = el.dataset.id;
      el.classList.toggle('hovered', id === st.hoveredId);
      el.classList.toggle('selected', id === st.selectedId);
    }
    for (const el of nodes.querySelectorAll<HTMLElement>('.mc-ref-node')) {
      el.classList.toggle('selected', el.dataset.id === st.selectedPlacedId);
    }
  }

  function paintPlaced(): void {
    nodes.innerHTML = '';
    for (const p of st.placed) {
      const el = document.createElement('figure');
      el.className = 'mc-ref-node';
      el.dataset.id = p.id;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.width = `${p.w}px`;
      el.style.height = `${p.h}px`;
      const img = document.createElement('img');
      img.alt = p.hit.title;
      img.src = p.hit.fullUrl || p.hit.thumbUrl;
      img.referrerPolicy = 'no-referrer';
      img.draggable = false;
      const cap = document.createElement('figcaption');
      cap.className = 'mc-ref-node-credit';
      cap.textContent = p.hit.credit;
      el.append(img, cap);
      el.addEventListener('click', () => {
        st.selectedPlacedId = p.id;
        highlight();
      });
      nodes.append(el);
    }
    highlight();
  }

  function setPending(kind: 'place' | 'web' | null, message?: string): void {
    st.pending = kind;
    gstate = { ...gstate, pendingConfirm: kind !== null };
    if (!kind) {
      confirmBar.hidden = true;
      confirmBar.innerHTML = '';
      return;
    }
    confirmBar.hidden = false;
    confirmBar.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = message ?? (kind === 'web'
      ? 'Open a full-page web search? Pinch to confirm.'
      : 'Place this picture on the canvas? Pinch to confirm.');
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = kind === 'web' ? 'Open search' : 'Place it';
    yes.addEventListener('click', () => { confirm(); });
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'ghost';
    no.textContent = 'Cancel';
    no.addEventListener('click', () => {
      setPending(null);
      note('Cancelled.');
    });
    confirmBar.append(p, yes, no);
    yes.focus();
  }

  function selectedItem(): GridItem | null {
    const id = st.selectedId ?? st.hoveredId;
    return st.items.find((it) => it.id === id) ?? null;
  }

  function placeHit(hit: RefHit, at?: { x: number; y: number }): PlacedRef {
    const w = 280;
    const h = 210;
    const n = st.placed.length;
    const x = at ? at.x - w / 2 : 48 + (n % 4) * 36;
    const y = at ? at.y - h / 2 : 48 + (n % 4) * 36;
    const node: PlacedRef = {
      id: `placed-${placedSeq++}`,
      hit,
      x: Math.max(8, x),
      y: Math.max(8, y),
      w, h,
    };
    st.placed = [...st.placed, node];
    st.selectedPlacedId = node.id;
    paintPlaced();
    return node;
  }

  function openWebSearch(): void {
    const url = webSearchUrl(st.query || 'drawings');
    if (opts.openWeb) opts.openWeb(url);
    else window.open(url, '_blank', 'noopener');
    note('Opened a full-page search.');
    speak('Opened a web search.');
  }

  function closeGrid(): boolean {
    if (!st.open) return false;
    st.open = false;
    st.hoveredId = null;
    st.selectedId = null;
    st.pending = null;
    grid.hidden = true;
    setPending(null);
    note('References closed.');
    return true;
  }

  async function runSearch(query: string, page: number, raw?: string, fuzzy?: boolean): Promise<ApplyResult> {
    let q = query.trim();
    if (!q) return { ok: false, detail: 'What should I find pictures of?' };

    if ((fuzzy || !q) && opts.refineQuery) {
      const t0 = performance.now();
      const refined = await opts.refineQuery(raw || q);
      if (refined?.query) {
        q = refined.query;
        opts.onCall?.({
          job: 'references',
          reason: 'refine search query',
          sent: raw || query,
          ms: refined.ms ?? performance.now() - t0,
          source: refined.source === 'rules' ? 'rules' : refined.source,
        });
      }
    }

    st.loading = true;
    st.open = true;
    st.query = q;
    st.page = page;
    st.selectedId = null;
    st.hoveredId = null;
    grid.hidden = false;
    title.textContent = `References for “${q}”`;
    note('Searching…');
    paintCards();

    const t0 = performance.now();
    try {
      const searchFn = opts.search
        ?? (opts.fixtures ? (query2: string, p: number) => Promise.resolve(fixtureSearch(query2, p)) : searchReferences);
      const pageRes = await searchFn(q, page);
      st.hits = pageRes.hits;
      st.hasMore = pageRes.hasMore;
      st.page = pageRes.page;
      st.items = pageItems(st.hits);
      st.loading = false;
      const usedFixtures = !opts.search && !!opts.fixtures;
      if (!usedFixtures) {
        opts.onCall?.({
          job: 'references',
          reason: 'Openverse and Wikimedia search',
          sent: q,
          ms: performance.now() - t0,
          source: 'cloud',
        });
      }
      if (!st.hits.length) {
        paintCards();
        const detail = `I couldn't find pictures of ${q}.`;
        note(detail);
        speak(detail);
        return { ok: false, detail };
      }
      paintCards();
      const detail = `Here are ${st.hits.length} pictures of ${q}. Pinch one, or say number two.`;
      note(detail);
      speak(detail);
      return { ok: true, detail };
    } catch (err) {
      st.loading = false;
      const detail = `Search failed: ${(err as Error).message}`;
      note(detail);
      speak('I could not search just now.');
      return { ok: false, detail };
    }
  }

  async function onCardActivate(item: GridItem): Promise<void> {
    st.selectedId = item.id;
    highlight();
    if (item.kind === 'web') {
      setPending('web', 'Open a full-page web search? Pinch to confirm.');
      note('Pinch to open a web search.');
      speak('Pinch to open a web search.');
      return;
    }
    note(`Selected ${item.index}. ${item.hit?.title ?? ''}. Say place it, or pinch and drag.`);
    speak(`Number ${item.index} selected. Pinch and drag to place it, or say place it.`);
  }

  function doPlace(at?: { x: number; y: number }): ApplyResult {
    const item = selectedItem();
    if (!item || item.kind !== 'image' || !item.hit) {
      return { ok: false, detail: 'Pick a picture first. Say number two, or pinch a card.' };
    }
    const node = placeHit(item.hit, at);
    setPending(null);
    const detail = `Placed “${item.hit.title}” on the canvas. ${item.hit.credit}`;
    note(detail);
    speak(`Placed number ${item.index} on the canvas.`);
    void node;
    return { ok: true, detail };
  }

  function resizeSelected(factor: number): ApplyResult {
    const id = st.selectedPlacedId;
    if (!id) return { ok: false, detail: 'Place a picture first, then say bigger or smaller.' };
    st.placed = st.placed.map((p) => {
      if (p.id !== id) return p;
      const w = Math.min(640, Math.max(120, p.w * factor));
      const h = Math.min(480, Math.max(90, p.h * factor));
      return { ...p, w, h, x: p.x - (w - p.w) / 2, y: p.y - (h - p.h) / 2 };
    });
    paintPlaced();
    const detail = factor > 1 ? 'Bigger.' : 'Smaller.';
    note(detail);
    speak(detail);
    return { ok: true, detail };
  }

  function confirm(): boolean {
    if (st.pending === 'web') {
      setPending(null);
      openWebSearch();
      return true;
    }
    if (st.pending === 'place' || st.selectedId) {
      setPending(null);
      doPlace();
      return true;
    }
    return false;
  }

  async function apply(intent: ReferenceIntent): Promise<ApplyResult> {
    switch (intent.type) {
      case 'search':
        return runSearch(intent.query, 1, intent.raw, intent.fuzzy);
      case 'more':
        if (!st.open) return { ok: false, detail: 'There is no search open.' };
        if (!st.hasMore) {
          const detail = 'That was the last page.';
          note(detail);
          speak(detail);
          return { ok: false, detail };
        }
        return runSearch(st.query, st.page + 1);
      case 'prevPage':
        if (!st.open) return { ok: false, detail: 'There is no search open.' };
        if (st.page <= 1) return { ok: false, detail: 'This is the first page.' };
        return runSearch(st.query, st.page - 1);
      case 'next': {
        st.hoveredId = stepHover(st.hoveredId ?? st.selectedId, st.items, 1);
        st.selectedId = st.hoveredId;
        highlight();
        const it = selectedItem();
        const detail = it ? `Number ${it.index}.` : 'No more cards.';
        note(detail);
        speak(detail);
        return { ok: !!it, detail };
      }
      case 'prev': {
        st.hoveredId = stepHover(st.hoveredId ?? st.selectedId, st.items, -1);
        st.selectedId = st.hoveredId;
        highlight();
        const it = selectedItem();
        const detail = it ? `Number ${it.index}.` : 'No more cards.';
        note(detail);
        speak(detail);
        return { ok: !!it, detail };
      }
      case 'pick': {
        const it = itemByIndex(st.items, intent.index);
        if (!it) return { ok: false, detail: `There is no number ${intent.index} on this page.` };
        await onCardActivate(it);
        return { ok: true, detail: `Selected number ${it.index}.` };
      }
      case 'pickHover': {
        const it = selectedItem();
        if (!it) return { ok: false, detail: 'Point at a card first, then say pick this.' };
        await onCardActivate(it);
        return { ok: true, detail: `Selected number ${it.index}.` };
      }
      case 'place':
        if (!selectedItem() || selectedItem()?.kind !== 'image') {
          return { ok: false, detail: 'Pick a picture first. Say number two, or pinch a card.' };
        }
        setPending('place');
        note('Pinch to place it on the canvas.');
        speak('Pinch to place it on the canvas.');
        return { ok: true, detail: 'Pinch to place it on the canvas.' };
      case 'bigger':
        return resizeSelected(1.25);
      case 'smaller':
        return resizeSelected(0.8);
      case 'close': {
        const ok = closeGrid();
        const detail = ok ? 'References closed.' : 'The reference grid is already closed.';
        speak(ok ? 'Closed.' : detail);
        return { ok, detail };
      }
      case 'webSearch':
        setPending('web');
        note('Pinch to open a web search.');
        speak('Pinch to open a web search.');
        return { ok: true, detail: 'Pinch to open a web search.' };
    }
  }

  closeBtn.addEventListener('click', () => { closeGrid(); speak('Closed.'); });
  window.addEventListener('resize', () => { if (st.open) layout(); });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (st.open) layout(); }).observe(root);
  }

  function whenSized(fn: () => void, tries = 0): void {
    if ((root.clientWidth || root.parentElement?.clientWidth || 0) >= 200 || tries >= 30) fn();
    else requestAnimationFrame(() => whenSized(fn, tries + 1));
  }

  // Sim / screenshot: ?refs=1 or ?refs=drawings opens the fixture grid.
  try {
    const params = new URLSearchParams(window.location.search);
    const refs = params.get('refs');
    if (refs !== null) {
      opts.fixtures = true;
      const q = !refs || refs === '1' ? 'drawings' : refs;
      whenSized(() => { void runSearch(q, 1); });
    }
  } catch {
    // Not in a browser / no location.
  }

  const board: ReferenceBoard = {
    element: root,
    isGridOpen: () => st.open,
    hasSelection: () => !!(st.selectedId || st.selectedPlacedId),
    apply,
    async handleUtterance(utterance: string) {
      const ctx: IntentContext = { gridOpen: st.open, hasSelection: !!(st.selectedId || st.selectedPlacedId) };
      const intent = parseReferenceIntent(utterance, ctx);
      if (!intent) return null;
      return apply(intent);
    },
    handleHand(e: HandEvent, client: { x: number; y: number }) {
      if (!st.open) {
        if (e.type === 'pinch-tap') {
          const hit = document.elementFromPoint(client.x, client.y)?.closest<HTMLElement>('.mc-ref-node');
          if (hit?.dataset.id) {
            st.selectedPlacedId = hit.dataset.id;
            highlight();
            return true;
          }
        }
        return false;
      }
      const rect = root.getBoundingClientRect();
      const local = { x: client.x - rect.left, y: client.y - rect.top };
      if (e.type === 'tracking' || e.type === 'pinch-start' || e.type === 'pinch-move' || e.type === 'pinch-end' || e.type === 'pinch-tap') {
        const snap = snapHover(local.x, local.y, boxes);
        if (snap !== st.hoveredId) {
          st.hoveredId = snap;
          highlight();
        }
      }
      if (e.type === 'pinch-tap') {
        const item = st.items.find((it) => it.id === (st.hoveredId ?? st.selectedId));
        if (st.pending) return confirm();
        if (item) { void onCardActivate(item); return true; }
        return false;
      }
      if (e.type === 'pinch-start') {
        gstate = { ...gstate, pinching: true, pinchAt: { ...local }, moved: 0 };
        return !!(st.hoveredId || st.selectedId || st.pending);
      }
      if (e.type === 'pinch-move' && gstate.pinching) {
        gstate.moved = gstate.pinchAt
          ? Math.hypot(local.x - gstate.pinchAt.x, local.y - gstate.pinchAt.y)
          : 0;
        return gstate.moved > 16;
      }
      if (e.type === 'pinch-end') {
        if (gstate.moved > 16 && (st.selectedId || st.hoveredId)) {
          const item = selectedItem();
          if (item?.kind === 'image' && item.hit) {
            doPlace(local);
            gstate = emptyRefGestureState();
            return true;
          }
        }
        gstate = emptyRefGestureState();
        return false;
      }
      if (e.type === 'tracking') {
        // Hover snap only; dwell and pinch-tap are handled by the shell (cards are buttons).
        return false;
      }
      return false;
    },
    closeGrid,
    showDemoGrid(query = 'drawings') {
      opts.fixtures = true;
      void runSearch(query, 1);
    },
    pendingConfirm: () => st.pending !== null,
    confirm,
  };

  return board;
}
