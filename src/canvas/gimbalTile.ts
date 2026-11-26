// The gimbal tile (pure half): which buttons it has, what its status line
// says and where a press goes. The tile never moves the stand itself and
// never claims a state: the status is ONLY what the docked iPhone reported
// (its announce on the laptop, the plugin's read-back on the iPhone).
//
// A press goes through the paths that already exist for the spoken phrases:
//   modes (Follow me / Follow my hands / Hold still)
//     iPhone app: the same handler as "follow me" (gimbalCanvas.setMode via
//                 canvasInputs, plus the hand-sensing request for hands)
//     laptop:     relay 'gimbalMode' → the iPhone runs that same handler and
//                 re-announces what DockKit REALLY did
//   cues (Nod / Shake)
//     bodyLanguage('yes' | 'no') — local plugin cue on the iPhone, relay
//     'gimbalCue' from the laptop (rate-limited there).
//
// No "Centre" button: the plugin's aim() is a RELATIVE move and it cannot
// read the stand's orientation, so there is no honest "neutral" to aim at —
// DockKit's absolute setOrientation is not exposed to the web layer.
import type { GimbalCueKind, GimbalModeKind } from '../relay/protocol';
import { GIMBAL_CUES, GIMBAL_MODES } from '../relay/protocol';
import type { PhoneSenseStatus } from './phonePoint';
import type { GimbalTileState, SurfacePlan, TileSpec } from './surfacePlan';
import { MAX_TILES } from './surfacePlan';

export const GIMBAL_TILE_LABEL = 'Gimbal';
export const GIMBAL_TRACKING = 'Tracking you';
export const GIMBAL_HANDS = 'Following your hands';
export const GIMBAL_HOLD = 'Holding still';
export const GIMBAL_NO_STAND = 'No stand docked';
/** On the laptop with no iPhone paired at all. */
export const GIMBAL_NO_PHONE = 'No iPhone paired — pair the iPhone on its stand';
export const GIMBAL_ADDED = 'Added the gimbal controls.';
export const GIMBAL_ALREADY = 'The gimbal controls are already on this board.';
export const GIMBAL_NO_ROOM = 'This board is full — remove a tile to add the gimbal controls.';
export const GIMBAL_NO_BOARD = 'Open a dashboard first, then add the gimbal.';

export interface GimbalButton {
  act: 'mode' | 'cue';
  value: GimbalModeKind | GimbalCueKind;
  label: string;
}

export const GIMBAL_MODE_BUTTONS: readonly GimbalButton[] = [
  { act: 'mode', value: 'face', label: 'Follow me' },
  { act: 'mode', value: 'hands', label: 'Follow my hands' },
  { act: 'mode', value: 'hold', label: 'Hold still' },
];
export const GIMBAL_CUE_BUTTONS: readonly GimbalButton[] = [
  { act: 'cue', value: 'yes', label: 'Nod' },
  { act: 'cue', value: 'no', label: 'Shake' },
];

/** The iPhone's reported gimbal state → what the tile shows. */
export function gimbalTileState(s: PhoneSenseStatus | null | undefined, o: { paired?: boolean } = {}): GimbalTileState {
  if (!s) return { docked: false, mode: '', status: o.paired === false ? GIMBAL_NO_PHONE : GIMBAL_NO_STAND, error: '' };
  switch (s.gimbal) {
    case 'tracking': return { docked: true, mode: 'face', status: GIMBAL_TRACKING, error: '' };
    // 'hands' only claims following while the hand-sensing layer really runs.
    case 'hands': return s.sensor
      ? { docked: true, mode: 'hands', status: GIMBAL_HANDS, error: '' }
      : { docked: true, mode: 'hold', status: GIMBAL_HOLD, error: '' };
    case 'ready': return { docked: true, mode: 'hold', status: GIMBAL_HOLD, error: '' };
    default: return { docked: false, mode: '', status: GIMBAL_NO_STAND, error: '' };
  }
}

/** A tile press (untrusted action payload) → the one thing it asks for. */
export function gimbalPress(name: string, value: unknown): { mode: GimbalModeKind } | { cue: GimbalCueKind } | null {
  if (name === 'gimbal.mode' && typeof value === 'string' && (GIMBAL_MODES as readonly string[]).includes(value)) return { mode: value as GimbalModeKind };
  if (name === 'gimbal.cue' && (value === 'yes' || value === 'no') && (GIMBAL_CUES as readonly string[]).includes(value)) return { cue: value };
  return null;
}

/** "add the gimbal" / "gimbal controls" / "show the gimbal tile". */
export function isAddGimbal(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '').trim();
  return /^(?:please\s+)?(?:(?:add|show|put|give\s+me)\s+(?:me\s+)?(?:the\s+|a\s+)?gimbal(?:\s+(?:controls?|tile))?(?:\s+(?:here|to\s+(?:the|this|my)\s+(?:board|dashboard)))?|(?:the\s+)?gimbal\s+controls?)(?:\s+please)?$/.test(t);
}

function hasGimbal(tiles: readonly TileSpec[]): boolean {
  for (const t of tiles) {
    if (t.type === 'gimbal') return true;
    if ((t.type === 'row' || t.type === 'grid' || t.type === 'card') && hasGimbal(t.children)) return true;
    if (t.type === 'tabs' && t.tabs.some((tab) => hasGimbal(tab.children))) return true;
    if (t.type === 'split' && (hasGimbal(t.first) || hasGimbal(t.second))) return true;
  }
  return false;
}
export const planHasGimbal = (plan: SurfacePlan): boolean => hasGimbal(plan.tiles);

/** The board with the gimbal tile added (after the device tiles, before a
 *  "Connect a device" tile). Same object when it is already there; null when
 *  the board is full. */
export function withGimbalTile(plan: SurfacePlan): SurfacePlan | null {
  if (hasGimbal(plan.tiles)) return plan;
  if (plan.tiles.length >= MAX_TILES) return null;
  const tiles = [...plan.tiles];
  const connectAt = tiles.findIndex((t) => t.type === 'connect');
  tiles.splice(connectAt < 0 ? tiles.length : connectAt, 0, { type: 'gimbal', label: GIMBAL_TILE_LABEL });
  return { ...plan, tiles };
}
