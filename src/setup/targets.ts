// Five-point first-run calibration (Nutshell-style): hold the pointer on
// four corners and the centre so the reach box is measured from deliberate
// holds, not a free wave.

import type { Pt } from '../input/handLogic';
import { reachFromPoints, type ReachBox } from './calibration';

export interface CalibrationTarget {
  id: 'tl' | 'tr' | 'c' | 'bl' | 'br';
  nx: number;
  ny: number;
  label: string;
}

export const CALIBRATION_TARGETS: readonly CalibrationTarget[] = [
  { id: 'tl', nx: 0.18, ny: 0.2, label: 'Top left' },
  { id: 'tr', nx: 0.82, ny: 0.2, label: 'Top right' },
  { id: 'c', nx: 0.5, ny: 0.5, label: 'Centre' },
  { id: 'bl', nx: 0.18, ny: 0.8, label: 'Bottom left' },
  { id: 'br', nx: 0.82, ny: 0.8, label: 'Bottom right' },
];

export const TARGET_HOLD_MS = 700;
/** Hit radius in 0–1 landmark space — generous for arthritis. */
export const TARGET_HIT_RADIUS = 0.14;

export function targetHit(cursor: Pt, target: Pick<CalibrationTarget, 'nx' | 'ny'>, radius = TARGET_HIT_RADIUS): boolean {
  const dx = cursor.x - target.nx;
  const dy = cursor.y - target.ny;
  return dx * dx + dy * dy <= radius * radius;
}

export function reachFromTargetHits(hits: readonly Pt[]): ReachBox {
  return reachFromPoints(hits);
}
