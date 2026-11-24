// Cross-device tile pick-and-drop payloads — PURE, no DOM, no network. A tile
// that crosses a viewport edge travels as a small JSON blob: the tile spec
// itself (re-validated through coerceTileSpec, so nothing unbounded or media-ish
// slips through) plus which component it was and where it is headed. apply/
// remove operate on a SurfacePlan's TOP-LEVEL tiles using the same stable
// tileComponentId the renderer uses.

import {
  coerceTileSpec,
  tileComponentId,
  type SurfacePlan,
  type TileSpec,
} from './surfacePlan';
import type { Side } from './screenLayout';

/** Where a tile is going / coming from. 'laptop' is the hub; left/right are the
 *  two phone slots (see screenLayout). */
export type TransferEndpoint = 'laptop' | Side;

/** The wire payload for a committed transfer. No media — just a validated tile
 *  spec and routing. Carried as size-capped JSON text inside a `cmd` message, or
 *  summarised in a host `state` snapshot so the other phone sees it too. */
export interface TileTransfer {
  tile: TileSpec;
  componentId: string;
  from: TransferEndpoint;
  to: TransferEndpoint;
  /** Which edge it should appear entering from on the target (opposite of exit). */
  enterEdge: Side;
}

/** Max JSON length of a transfer blob — a tile spec is tiny; this is a flood
 *  guard well under the room-message cap, not a real limit on legit tiles. */
export const TRANSFER_JSON_MAX = 8000;

const ENDPOINTS: readonly TransferEndpoint[] = ['laptop', 'left', 'right'];
const SIDES: readonly Side[] = ['left', 'right'];

function isEndpoint(v: unknown): v is TransferEndpoint {
  return typeof v === 'string' && (ENDPOINTS as readonly string[]).includes(v);
}

/**
 * Validate an untrusted transfer blob (already parsed from JSON). The tile is
 * re-coerced through coerceTileSpec; a bad/oversized/media-ish tile is rejected.
 * Returns null on anything malformed.
 */
export function validateTransfer(raw: unknown): TileTransfer | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isEndpoint(o.from) || !isEndpoint(o.to) || o.from === o.to) return null;
  if (typeof o.componentId !== 'string' || !o.componentId || o.componentId.length > 80) return null;
  if (!(SIDES as readonly string[]).includes(o.enterEdge as string)) return null;
  const coerced = coerceTileSpec(o.tile);
  if (!coerced.ok) return null;
  return {
    tile: coerced.value,
    componentId: o.componentId.slice(0, 80),
    from: o.from,
    to: o.to,
    enterEdge: o.enterEdge as Side,
  };
}

/** Parse + validate a transfer from its JSON wire text (size-capped). */
export function parseTransfer(text: string): TileTransfer | null {
  if (typeof text !== 'string' || text.length > TRANSFER_JSON_MAX) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return validateTransfer(raw);
}

/** Serialise a transfer to size-capped JSON wire text, or null if it won't fit
 *  (shouldn't happen for a real tile — coerceTileSpec already bounds it). */
export function serializeTransfer(t: TileTransfer): string | null {
  const text = JSON.stringify({
    tile: t.tile,
    componentId: t.componentId,
    from: t.from,
    to: t.to,
    enterEdge: t.enterEdge,
  });
  return text.length <= TRANSFER_JSON_MAX ? text : null;
}

/** The enter edge on the target when a tile exits across `exitSide`. A tile
 *  pushed off the laptop's LEFT edge arrives entering the phone from its RIGHT;
 *  pushed off the RIGHT edge, it enters from the phone's LEFT. */
export function enterEdgeForExit(exitSide: Side): Side {
  return exitSide === 'left' ? 'right' : 'left';
}

/** Append a tile to a plan's top-level tiles, skipping an exact component-id
 *  duplicate (idempotent re-apply). Returns a NEW plan; the input is untouched. */
export function applyTileToPlan(plan: SurfacePlan, tile: TileSpec): SurfacePlan {
  const id = tileComponentId(tile, [plan.tiles.length]);
  const exists = plan.tiles.some((t, i) => tileComponentId(t, [i]) === id);
  if (exists) return plan;
  return { ...plan, tiles: [...plan.tiles, tile] };
}

/** Remove the top-level tile whose stable component id matches. Returns a NEW
 *  plan (unchanged if nothing matched). */
export function removeTileFromPlan(plan: SurfacePlan, componentId: string): SurfacePlan {
  const keep = plan.tiles.filter((t, i) => tileComponentId(t, [i]) !== componentId);
  if (keep.length === plan.tiles.length) return plan;
  return { ...plan, tiles: keep };
}

/** Find the top-level tile with this component id (for building the payload). */
export function findTile(plan: SurfacePlan, componentId: string): TileSpec | null {
  for (let i = 0; i < plan.tiles.length; i++) {
    if (tileComponentId(plan.tiles[i], [i]) === componentId) return plan.tiles[i];
  }
  return null;
}
