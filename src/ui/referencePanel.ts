// Floating browser reference panel pinned over the canvas: a movable, resizable
// card with an address bar and a sandboxed iframe for pulling up reference
// material (docs, images, specs) without leaving the design. We cannot read a
// remote site's frame-busting headers cross-origin, so we detect refusal
// heuristically: if no load event arrives within a timeout, we assume the site
// refused framing and offer an "Open in new tab" card. No proxying, no header
// bypass. URL normalisation is pure (input/urlLogic) and unit-tested.

import { normalizeUrl, hostLabel } from '../input/urlLogic';

export interface ReferencePanel {
  readonly element: HTMLElement;
  open(url?: string): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

const LOAD_TIMEOUT_MS = 4000;
const DEFAULT_URL = 'https://developer.mozilla.org/en-US/docs/Web/HTML';

export function createReferencePanel(): ReferencePanel {
  const root = document.createElement('section');
  root.className = 'mc-ref-panel';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Browser reference');
  root.style.left = '80px';
  root.style.top = '96px';
  root.style.width = '420px';
  root.style.height = '340px';

  // ─── header (drag handle + title + close) ───────────────────────────────────
  const head = document.createElement('div');
  head.className = 'mc-ref-head';
  const grip = document.createElement('span');
  grip.className = 'mc-ref-grip';
  grip.textContent = '⠿';
  grip.setAttribute('aria-hidden', 'true');
  const titleEl = document.createElement('span');
  titleEl.className = 'mc-ref-title';
  titleEl.textContent = 'Reference';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mc-ref-x';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close reference panel');
  closeBtn.addEventListener('click', () => close());
  head.append(grip, titleEl, closeBtn);

  // ─── address bar ────────────────────────────────────────────────────────────
  const bar = document.createElement('form');
  bar.className = 'mc-ref-bar';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mc-ref-url';
  input.placeholder = 'Enter a URL or search…';
  input.setAttribute('aria-label', 'Reference URL or search');
  input.autocomplete = 'off';
  const go = document.createElement('button');
  go.type = 'submit';
  go.className = 'mc-ref-go';
  go.textContent = 'Go';
  bar.append(input, go);
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    navigate(input.value);
  });

  // ─── body: iframe + states ──────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'mc-ref-body';
  const frame = document.createElement('iframe');
  frame.className = 'mc-ref-frame';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = 'Reference content';

  const status = document.createElement('div');
  status.className = 'mc-ref-status';
  status.hidden = true;
  status.setAttribute('role', 'status');

  body.append(frame, status);

  const resizer = document.createElement('div');
  resizer.className = 'mc-ref-resize';
  resizer.setAttribute('aria-hidden', 'true');

  root.append(head, bar, body, resizer);

  // ─── frame-refusal detection ────────────────────────────────────────────────
  let timeoutId: number | null = null;
  let currentUrl = '';

  function clearTimer(): void {
    if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
  }

  function showBlocked(url: string): void {
    clearTimer();
    frame.hidden = true;
    status.hidden = false;
    status.innerHTML = '';
    const msg = document.createElement('p');
    msg.textContent = `${hostLabel(url)} did not load here — it may refuse to be embedded.`;
    const openLink = document.createElement('a');
    openLink.href = url;
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    openLink.className = 'mc-ref-open';
    openLink.textContent = 'Open in new tab ↗';
    status.append(msg, openLink);
  }

  function showLoading(): void {
    status.hidden = false;
    status.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = 'Loading…';
    status.append(p);
  }

  frame.addEventListener('load', () => {
    // A blocked frame may still fire load on a browser error page; we can't read
    // it cross-origin, so we trust the timer-based heuristic and just reveal the
    // frame on any genuine load within the window.
    if (frame.hidden) return;        // we already fell back to the blocked card
    if (!currentUrl) return;         // initial about:blank load
    clearTimer();
    status.hidden = true;
  });

  function navigate(raw: string): void {
    const url = normalizeUrl(raw);
    if (!url) return;
    currentUrl = url;
    input.value = url;
    titleEl.textContent = hostLabel(url);
    frame.hidden = false;
    showLoading();
    clearTimer();
    frame.src = url;
    timeoutId = window.setTimeout(() => showBlocked(url), LOAD_TIMEOUT_MS);
  }

  // ─── drag to move (pointer-based: works with mouse and pinch pointer) ────────
  let dragging = false;
  let dragDX = 0;
  let dragDY = 0;
  head.addEventListener('pointerdown', (e) => {
    if (e.target === closeBtn) return;
    dragging = true;
    const r = root.getBoundingClientRect();
    dragDX = e.clientX - r.left;
    dragDY = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    root.style.left = `${Math.max(0, e.clientX - dragDX)}px`;
    root.style.top = `${Math.max(0, e.clientY - dragDY)}px`;
  });
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { head.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  // ─── resize handle (pointer-based) ──────────────────────────────────────────
  let resizing = false;
  resizer.addEventListener('pointerdown', (e) => {
    resizing = true;
    resizer.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const r = root.getBoundingClientRect();
    root.style.width = `${Math.max(240, e.clientX - r.left)}px`;
    root.style.height = `${Math.max(180, e.clientY - r.top)}px`;
  });
  const endResize = (e: PointerEvent) => {
    if (!resizing) return;
    resizing = false;
    try { resizer.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  resizer.addEventListener('pointerup', endResize);
  resizer.addEventListener('pointercancel', endResize);

  function open(url?: string): void {
    root.hidden = false;
    if (url || !currentUrl) navigate(url ?? DEFAULT_URL);
    input.focus();
  }
  function close(): void {
    root.hidden = true;
    clearTimer();
    // Stop any media/scripts in the frame while hidden.
    frame.src = 'about:blank';
    currentUrl = '';
  }

  return {
    element: root,
    open,
    close,
    toggle() { root.hidden ? open() : close(); },
    isOpen: () => !root.hidden,
    dispose() { clearTimer(); root.remove(); },
  };
}
