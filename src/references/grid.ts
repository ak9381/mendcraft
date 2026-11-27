// Numbered, well-spaced result grid on the canvas. Pure layout + navigation.
// About 6–8 large targets at a time, including the "Search on the web" card.

import { WEB_SEARCH_ID, type GridBox, type GridItem, type RefHit } from './types';

export const IMAGES_PER_PAGE = 7;

/** Build the visible items for one page: images, then the web-search card. */
export function pageItems(hits: RefHit[], opts: { includeWeb?: boolean } = {}): GridItem[] {
  const items: GridItem[] = hits.slice(0, IMAGES_PER_PAGE).map((hit, i) => ({
    id: hit.id,
    index: i + 1,
    kind: 'image' as const,
    hit,
  }));
  if (opts.includeWeb !== false) items.push({ id: WEB_SEARCH_ID, index: items.length + 1, kind: 'web' });
  return items;
}

/**
 * Lay out `count` cards in up to 2 rows × 4 columns, with generous gaps and
 * padding so arthritic pinch targets stay large.
 */
export function layoutGrid(
  items: readonly GridItem[],
  width: number,
  height: number,
): GridBox[] {
  const n = items.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const cols = Math.min(4, Math.max(2, n <= 4 ? n : Math.ceil(n / 2)));
  const rows = Math.ceil(n / cols);
  const padX = Math.max(88, Math.min(128, width * 0.09));
  const padTop = Math.max(72, Math.min(120, height * 0.12));
  const padBot = Math.max(28, Math.min(64, height * 0.06));
  const gapX = Math.max(20, Math.min(36, width * 0.025));
  const gapY = Math.max(20, Math.min(36, height * 0.04));
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBot;
  const cellW = (innerW - gapX * (cols - 1)) / cols;
  const cellH = (innerH - gapY * (rows - 1)) / rows;
  // Keep cards chunky but not taller than a comfortable photo aspect.
  const w = Math.max(140, Math.min(cellW, 280));
  const h = Math.max(160, Math.min(cellH, w * 1.25, 320));
  const usedW = cols * w + (cols - 1) * gapX;
  const usedH = rows * h + (rows - 1) * gapY;
  const ox = padX + Math.max(0, (innerW - usedW) / 2);
  const oy = padTop + Math.max(0, (innerH - usedH) / 2);
  return items.map((item, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return { id: item.id, x: ox + c * (w + gapX), y: oy + r * (h + gapY), w, h };
  });
}

export function boxCenter(b: GridBox): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function hitBox(x: number, y: number, boxes: readonly GridBox[]): GridBox | null {
  for (const b of boxes) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

/**
 * Snap the hover cursor to the nearest card. `radius` is extra reach around
 * each card (default: half the smallest gap, at least 36px) so a shaky pointer
 * still lands on a target.
 */
export function snapHover(
  x: number,
  y: number,
  boxes: readonly GridBox[],
  radius = 36,
): string | null {
  if (!boxes.length) return null;
  const inside = hitBox(x, y, boxes);
  if (inside) return inside.id;
  let best: GridBox | null = null;
  let bestD = Infinity;
  for (const b of boxes) {
    const cx = Math.min(Math.max(x, b.x), b.x + b.w);
    const cy = Math.min(Math.max(y, b.y), b.y + b.h);
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best && bestD <= radius ? best.id : null;
}

export function itemByIndex(items: readonly GridItem[], index: number): GridItem | null {
  if (!items.length) return null;
  if (index === -1) return items[items.length - 1];
  return items.find((it) => it.index === index) ?? null;
}

export function stepHover(
  currentId: string | null,
  items: readonly GridItem[],
  dir: 1 | -1,
): string | null {
  if (!items.length) return null;
  const i = currentId ? items.findIndex((it) => it.id === currentId) : -1;
  if (i < 0) return dir === 1 ? items[0].id : items[items.length - 1].id;
  const next = (i + dir + items.length) % items.length;
  return items[next].id;
}
