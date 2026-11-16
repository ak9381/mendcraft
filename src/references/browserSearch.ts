// Real-browser picture search (Google Images / Pinterest) and the overlay
// command state used by the Chrome extension content script. Pure: no DOM,
// no chrome APIs — the extension and the studio both call these helpers.

export type SearchEngine = 'google' | 'pinterest';
export type GenerateKind = 'drawing' | 'layout';
export type RefPath = 'search' | 'generate';

export function googleImagesUrl(query: string): string {
  const q = encodeURIComponent(query.trim() || 'drawings');
  return `https://www.google.com/search?udm=2&tbm=isch&q=${q}`;
}

export function pinterestSearchUrl(query: string): string {
  const q = encodeURIComponent(query.trim() || 'drawings');
  return `https://www.pinterest.com/search/pins/?q=${q}`;
}

export function searchPageUrl(query: string, engine: SearchEngine = 'google'): string {
  return engine === 'pinterest' ? pinterestSearchUrl(query) : googleImagesUrl(query);
}

/** Prefer the full-size image from a Google imgres link when present. */
export function bestImageUrl(src: string, href?: string): string {
  const link = href || '';
  try {
    const u = new URL(link, 'https://www.google.com');
    const imgurl = u.searchParams.get('imgurl') || u.searchParams.get('img_url');
    if (imgurl && /^https?:\/\//i.test(imgurl)) return imgurl.slice(0, 2000);
  } catch { /* ignore */ }
  const m = link.match(/[?&]imgurl=([^&]+)/i);
  if (m) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (/^https?:\/\//i.test(decoded)) return decoded.slice(0, 2000);
    } catch { /* ignore */ }
  }
  return src.slice(0, 2000);
}

export interface OverlayImage {
  index: number;
  src: string;
  href?: string;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BoxLike = {
  src: string;
  href?: string;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const MIN_SIDE = 80;
const MAX_BADGES = 8;

/** Visible, large-enough image tiles, numbered 1..N. Icons and tiny thumbs are skipped. */
export function collectResultImages(boxes: readonly BoxLike[], viewport: { w: number; h: number }): OverlayImage[] {
  const out: OverlayImage[] = [];
  for (const b of boxes) {
    if (!b.src || b.w < MIN_SIDE || b.h < MIN_SIDE) continue;
    if (b.x + b.w < 0 || b.y + b.h < 0 || b.x > viewport.w || b.y > viewport.h) continue;
    const src = bestImageUrl(b.src, b.href);
    if (out.some((x) => x.src === src)) continue;
    out.push({
      index: out.length + 1,
      src,
      href: b.href,
      title: b.title,
      x: b.x, y: b.y, w: b.w, h: b.h,
    });
    if (out.length >= MAX_BADGES) break;
  }
  return out;
}

export interface OverlayState {
  images: OverlayImage[];
  highlighted: number | null;
  cursor: { x: number; y: number } | null;
  scrollDir: 'up' | 'down' | null;
  nextPage: boolean;
  picked: OverlayImage | null;
  closed: boolean;
}

export function emptyOverlay(): OverlayState {
  return { images: [], highlighted: null, cursor: null, scrollDir: null, nextPage: false, picked: null, closed: false };
}

export type RefsCommand =
  | { type: 'setImages'; images: OverlayImage[] }
  | { type: 'scroll'; dir: 'up' | 'down' }
  | { type: 'nextPage' }
  | { type: 'highlight'; index: number }
  | { type: 'cursor'; x: number; y: number }
  | { type: 'pick'; index?: number }
  | { type: 'close' };

export function imageAtPoint(state: OverlayState, x: number, y: number): OverlayImage | null {
  let hit: OverlayImage | null = null;
  for (const img of state.images) {
    if (x >= img.x && x <= img.x + img.w && y >= img.y && y <= img.y + img.h) hit = img;
  }
  return hit;
}

export function applyRefsCommand(state: OverlayState, cmd: RefsCommand): OverlayState {
  if (state.closed && cmd.type !== 'setImages') return state;
  switch (cmd.type) {
    case 'setImages':
      return { ...emptyOverlay(), images: cmd.images, highlighted: cmd.images[0]?.index ?? null };
    case 'scroll':
      return { ...state, scrollDir: cmd.dir, nextPage: false };
    case 'nextPage':
      return { ...state, nextPage: true, scrollDir: 'down' };
    case 'highlight': {
      const img = state.images.find((i) => i.index === cmd.index);
      return img ? { ...state, highlighted: img.index, scrollDir: null, nextPage: false } : state;
    }
    case 'cursor': {
      const hit = imageAtPoint(state, cmd.x, cmd.y);
      return {
        ...state,
        cursor: { x: cmd.x, y: cmd.y },
        highlighted: hit ? hit.index : state.highlighted,
        scrollDir: null,
        nextPage: false,
      };
    }
    case 'pick': {
      const index = cmd.index ?? state.highlighted;
      const img = state.images.find((i) => i.index === index) ?? null;
      return { ...state, highlighted: img?.index ?? state.highlighted, picked: img, scrollDir: null, nextPage: false };
    }
    case 'close':
      return { ...state, closed: true, picked: null, scrollDir: null, nextPage: false };
  }
}

export function pickByNumber(state: OverlayState, n: number): OverlayImage | null {
  if (n === -1) return state.images[state.images.length - 1] ?? null;
  return state.images.find((i) => i.index === n) ?? null;
}
