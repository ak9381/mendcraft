// The gimbal tile (pure half): what its status line says and which presses
// it may carry. The tile itself is a generated DeviceTile (cls 'gimbal',
// deviceTile.ts): its controls are the model's (or the standard set,
// controlSpec.standardControls), checked by coerceControls, and a press goes
// through controlSpec.bindingIntent like any device. The tile never moves the
// stand itself and never claims a state: the status is ONLY what the docked
// iPhone reported (its announce on the laptop, the plugin's read-back on the
// iPhone).
//
// A press goes through the paths that already exist for the spoken phrases:
//   modes (follow me / follow my hands / hold still)
//     iPhone app: the same handler as "follow me" (gimbalCanvas.setMode via
//                 canvasInputs, plus the hand-sensing request for hands)
//     laptop:     relay 'gimbalMode' → the iPhone runs that same handler and
//                 re-announces what DockKit REALLY did
//   cues (nod / shake / wake up)
//     bodyLanguage(kind) — local plugin cue on the iPhone, relay
//     'gimbalCue' from the laptop (rate-limited there).
//
// No "Centre" intent: the plugin's aim() is a RELATIVE move and it cannot
// read the stand's orientation, so there is no honest "neutral" to aim at —
// DockKit's absolute setOrientation is not exposed to the web layer.
import type { GimbalCueKind, GimbalModeKind } from '../relay/protocol';
import { GIMBAL_CUES, GIMBAL_MODES } from '../relay/protocol';
import type { PhoneSenseStatus } from './phonePoint';
import type { GimbalTileState, SurfacePlan, TileSpec } from './surfacePlan';

export const GIMBAL_TILE_LABEL = 'Gimbal';
export const GIMBAL_TRACKING = 'Tracking you';
export const GIMBAL_HANDS = 'Following your hands';
export const GIMBAL_HOLD = 'Holding still';
/** Hands mode is on at the iPhone, but no hand frames are being sensed yet:
 *  it is neither following nor confirmed still. */
export const GIMBAL_HANDS_WAITING = 'Docked · waiting to see your hands';
export const GIMBAL_NO_STAND = 'No stand docked';
/** On the laptop with no iPhone paired at all. */
export const GIMBAL_NO_PHONE = 'No iPhone paired — pair the iPhone on its stand';
/** The iPhone's reported gimbal state → what the tile shows. */
export function gimbalTileState(s: PhoneSenseStatus | null | undefined, o: { paired?: boolean } = {}): GimbalTileState {
  if (!s) return { docked: false, mode: '', status: o.paired === false ? GIMBAL_NO_PHONE : GIMBAL_NO_STAND, error: '' };
  switch (s.gimbal) {
    case 'tracking': return { docked: true, mode: 'face', status: GIMBAL_TRACKING, error: '' };
    // 'hands' only claims following while the hand-sensing layer really runs.
    case 'hands': return s.sensor
      ? { docked: true, mode: 'hands', status: GIMBAL_HANDS, error: '' }
      : { docked: true, mode: 'hands', status: GIMBAL_HANDS_WAITING, error: '' };
    // "Holding still" only once the iPhone reports tracking off ('ready').
    case 'ready': return { docked: true, mode: 'hold', status: GIMBAL_HOLD, error: '' };
    default: return { docked: false, mode: '', status: GIMBAL_NO_STAND, error: '' };
  }
}

/** A press (what the binding resolved, re-checked here) → the one thing it
 *  asks for: an allow-listed mode or cue, else null. The wake-up is a cue
 *  like the others (spec 5.5 lists it): a reviewed "Wake up" button may send it. */
export function gimbalPress(name: string, value: unknown): { mode: GimbalModeKind } | { cue: GimbalCueKind } | null {
  if (name === 'gimbal.mode' && typeof value === 'string' && (GIMBAL_MODES as readonly string[]).includes(value)) return { mode: value as GimbalModeKind };
  if (name === 'gimbal.cue' && typeof value === 'string' && (GIMBAL_CUES as readonly string[]).includes(value)) return { cue: value as GimbalCueKind };
  return null;
}

/** What a mode is called when the laptop says it asked the iPhone. */
export const GIMBAL_MODE_WORDS: Record<GimbalModeKind, string> = { face: 'follow me', hands: 'follow my hands', hold: 'hold still' };

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
