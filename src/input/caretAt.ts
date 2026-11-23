// C023: which caret position a point over a single-line text field means, so a
// hand pinch-dragged across the text can select a range like a mouse drag.

/** Nearest caret index (0..text.length) for an x offset into the text run. */
export function caretIndexAt(text: string, x: number, width: (s: string) => number): number {
  if (x <= 0) return 0;
  let prev = 0;
  for (let i = 1; i <= text.length; i++) {
    const w = width(text.slice(0, i));
    if (w >= x) return x - prev < w - x ? i - 1 : i;
    prev = w;
  }
  return text.length;
}

let ctx: CanvasRenderingContext2D | null | undefined;

/** Caret index in `el` under viewport x (input fields; textarea uses its first line). */
export function fieldCaretAt(el: HTMLInputElement | HTMLTextAreaElement, clientX: number): number {
  const view = el.ownerDocument?.defaultView;
  const cs = view?.getComputedStyle?.(el);
  const r = el.getBoundingClientRect?.() ?? { left: 0 };
  const pad = (parseFloat(cs?.paddingLeft ?? '0') || 0) + (parseFloat(cs?.borderLeftWidth ?? '0') || 0);
  const x = clientX - r.left - pad + (el.scrollLeft || 0);
  const font = cs ? `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}` : '';
  const size = parseFloat(cs?.fontSize ?? '16') || 16;
  if (ctx === undefined) {
    try { ctx = el.ownerDocument?.createElement('canvas').getContext('2d') ?? null; } catch { ctx = null; }
  }
  const c = ctx;
  const width = c ? (s: string) => { c.font = font; return c.measureText(s).width; } : (s: string) => s.length * size * 0.55;
  return caretIndexAt(String(el.value ?? ''), x, width);
}
