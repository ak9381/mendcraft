// The product journey, as one spine: empty → devices → dashboard → music →
// saved → floor plan → checked → language → offline → shared. Pure: given the
// focused board's shape and a little context, which step is she on? The
// next-step chips (nextSteps.ts) suggest what comes after it.
import type { SurfacePlan, TileSpec } from './surfacePlan';

export type JourneyStep = 'empty' | 'devices' | 'dashboard' | 'music' | 'saved' | 'floorplan' | 'checked' | 'language' | 'offline' | 'shared';

export interface JourneyBoard { kind: string; tiles: { kind: string }[]; pinned: boolean }

export interface JourneyCtx {
  /** Active UI language ('en' unless a pack is on). */
  lang: string;
  online: boolean;
  /** Paired phones. Pairing happens at connect, so this alone never means "shared". */
  phones: number;
  /** The accessibility check has run on this plan board. */
  checked?: boolean;
  /** This board was sent to a phone. */
  shared?: boolean;
}

const DEVICE_TILES = new Set(['lamp', 'switch', 'music', 'scene']);

export function journeyStepOf(board: JourneyBoard, ctx: JourneyCtx): JourneyStep {
  if (!board.tiles.length) return 'empty';
  if (ctx.shared) return 'shared';
  if (!ctx.online) return 'offline';
  const kinds = new Set(board.tiles.map((t) => t.kind));
  // A room dashboard may carry a small room-plan tile; it is still a dashboard.
  if (board.kind === 'plan' || (board.kind !== 'room' && kinds.has('plan'))) {
    if (!ctx.checked) return 'floorplan';
    return ctx.lang && ctx.lang !== 'en' ? 'language' : 'checked';
  }
  if (board.pinned) return 'saved';
  if (kinds.has('music')) return 'music';
  if ([...kinds].some((k) => DEVICE_TILES.has(k) || k === 'stat' || k === 'chart')) return 'dashboard';
  return 'devices';
}

function leafKinds(tiles: readonly TileSpec[], out: { kind: string }[]): void {
  for (const t of tiles) {
    switch (t.type) {
      case 'row': case 'grid': case 'card': leafKinds(t.children, out); break;
      case 'tabs': t.tabs.forEach((tab) => leafKinds(tab.children, out)); break;
      case 'split': leafKinds(t.first, out); leafKinds(t.second, out); break;
      default: out.push({ kind: t.type });
    }
  }
}

/** The journey's view of a board: its surface kind (else the frame kind) and
 *  every leaf tile, nested containers flattened. */
export function boardForJourney(frame: { kind: string; pinned: boolean }, surface: SurfacePlan | undefined): JourneyBoard {
  const tiles: { kind: string }[] = [];
  if (surface) leafKinds(surface.tiles, tiles);
  return { kind: surface?.kind ?? frame.kind, tiles, pinned: frame.pinned };
}
