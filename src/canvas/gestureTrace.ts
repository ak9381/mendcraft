// Ring-buffer gesture trace for live debugging. Enabled by ?debug=gestures
// or by assigning window.__mcTrace (the API is then installed on that same
// global so a Mac CDP session can pull frames).

export interface GestureTraceFrame {
  t: number;
  hand: number;
  classification: string;
  pinchDistance: number;
  focusedTargetId: string | null;
  raw: { x: number; y: number };
  eased: { x: number; y: number };
  clickTarget: string | null;
}

export const TRACE_CAP = 240;

export function targetIdOf(el: Element | null | undefined): string | null {
  if (!el) return null;
  const id = el.getAttribute?.('id');
  if (id) return id;
  const act = el.getAttribute?.('data-act');
  if (act) return `data-act=${act}`;
  const aria = el.getAttribute?.('aria-label')?.trim();
  if (aria) return aria;
  const cls = typeof el.className === 'string' ? el.className.trim() : '';
  if (cls) {
    const bit = cls.split(/\s+/).find((c) => /review-approve|review-reject|review-ask|btn|primary/.test(c));
    if (bit) return `.${bit}`;
    return `.${cls.split(/\s+/)[0]}`;
  }
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return text || el.tagName?.toLowerCase() || null;
}

export interface GestureTrace {
  enabled: boolean;
  enable(): void;
  push(frame: GestureTraceFrame): void;
  frames: GestureTraceFrame[];
  dump(): GestureTraceFrame[];
  clear(): void;
}

export function createGestureTrace(cap = TRACE_CAP): GestureTrace {
  const frames: GestureTraceFrame[] = [];
  let enabled = false;
  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    enable() { enabled = true; },
    push(frame) {
      if (!enabled) return;
      frames.push(frame);
      if (frames.length > cap) frames.splice(0, frames.length - cap);
    },
    frames,
    dump() { return frames.slice(); },
    clear() { frames.length = 0; },
  };
}

export function shouldEnableGestureTrace(win: { location?: { search?: string }; __mcTrace?: unknown } | undefined): boolean {
  if (!win) return false;
  try {
    const q = new URLSearchParams(win.location?.search ?? '');
    if (q.get('debug') === 'gestures') return true;
  } catch { /* ignore */ }
  const pre = win.__mcTrace as { enabled?: boolean } | boolean | undefined;
  return pre === true || (typeof pre === 'object' && pre?.enabled === true);
}

/** Install (or replace) window.__mcTrace with a live ring buffer. */
export function installGestureTrace(win: (Window & { __mcTrace?: unknown }) | undefined): GestureTrace {
  const trace = createGestureTrace();
  if (shouldEnableGestureTrace(win)) trace.enable();
  if (win) win.__mcTrace = trace;
  return trace;
}

let installed: GestureTrace | null = null;

/** One process-wide trace, installed on window.__mcTrace when a window exists. */
export function getGestureTrace(win?: (Window & { __mcTrace?: unknown }) | undefined): GestureTrace {
  if (installed) return installed;
  const w = win ?? (typeof window !== 'undefined' ? (window as Window & { __mcTrace?: unknown }) : undefined);
  installed = installGestureTrace(w);
  return installed;
}
