// Deterministic PLAN templates: each returns a list of plan op envelopes that
// PlanEngine.applyGenerated() builds from a blank document in one undoable step.
// These back both the rules fallback ("two bedroom plan" with no AI) and the
// cloud generate path (the model returns a document, code expands + re-validates).
//
// Note on ids: applyGenerated resets the id counter, so wall ids are
// deterministic. add_room reuses a coincident wall, so two rooms placed side by
// side SHARE one wall. `twoBedroom` is a believable flat (2 bedrooms + living +
// kitchen + bathroom) tiled with no overlaps/gaps; because the two bedrooms are
// placed FIRST and side by side, the wall they share is `w3`, which the
// expansion dimensions and pre-selects so the demo ("make it 4 meters") lands
// on a single, already-selected wall without any pointing.

import { expandPlanDocument } from './ai';

export type PlanTemplateName = 'twoBedroom' | 'oneRoom' | 'studio';

export const PLAN_TEMPLATE_NAMES: readonly PlanTemplateName[] = ['twoBedroom', 'oneRoom', 'studio'] as const;

export function isPlanTemplateName(v: unknown): v is PlanTemplateName {
  return typeof v === 'string' && (PLAN_TEMPLATE_NAMES as readonly string[]).includes(v);
}

/**
 * A believable two-bedroom flat (8 m × 6 m): two 4 m × 3 m bedrooms across the
 * top sharing wall `w3`, and a living room + kitchen + bathroom tiled across the
 * bottom. Perfectly tiled (no overlaps/gaps), with an entrance door on the
 * living-room's outer wall, a door into every room, and windows on outer walls.
 * Built as a DOCUMENT and expanded through the same path as the cloud generator,
 * so code assigns all ids, reuses shared walls, and dimensions + selects `w3`.
 */
function twoBedroom(): Record<string, unknown>[] {
  const doc = {
    unit: 'mm',
    // Bedrooms FIRST (left then right) so their shared wall is `w3`.
    rooms: [
      { name: 'Bedroom 1', x: 0, y: 3000, w: 4000, h: 3000 },
      { name: 'Bedroom 2', x: 4000, y: 3000, w: 4000, h: 3000 },
      { name: 'Living room', x: 0, y: 0, w: 4000, h: 3000 },
      { name: 'Kitchen', x: 4000, y: 0, w: 2000, h: 3000 },
      { name: 'Bathroom', x: 6000, y: 0, w: 2000, h: 3000 },
    ],
    doors: [
      { room: 'Living room', side: 's', width: 900 }, // entrance (outer wall)
      { room: 'Bedroom 1', side: 's', width: 800 },
      { room: 'Bedroom 2', side: 's', width: 800 },
      { room: 'Kitchen', side: 'w', width: 800 },
      { room: 'Bathroom', side: 'w', width: 700 },
    ],
    windows: [
      { room: 'Bedroom 1', side: 'n', width: 1200 },
      { room: 'Bedroom 2', side: 'n', width: 1200 },
      { room: 'Living room', side: 'w', width: 1000 },
      { room: 'Kitchen', side: 's', width: 1000 },
      { room: 'Bathroom', side: 'e', width: 600 },
    ],
  };
  // expandPlanDocument returns fully-validated PlanOps; they are valid op
  // envelopes, so the caller can re-validate them harmlessly.
  return expandPlanDocument(doc) as unknown as Record<string, unknown>[];
}

/** A single 4 m × 3 m room, dimensioned on its left wall and selected. */
function oneRoom(): Record<string, unknown>[] {
  return [
    { op: 'add_room', nums: { x: 0, y: 0, w: 4, h: 3 }, unit: 'm', name: 'Room' },
    { op: 'add_dim', target: 'w5' },
    { op: 'select', target: 'w5' },
  ];
}

/** A studio: one 6 m × 4 m room with a door and a window on the front wall. */
function studio(): Record<string, unknown>[] {
  return [
    { op: 'add_room', nums: { x: 0, y: 0, w: 6, h: 4 }, unit: 'm', name: 'Studio' },
    { op: 'add_door', target: 'w2', nums: { offset: 0.5, width: 0.9 }, unit: 'm' },
    { op: 'add_window', target: 'w4', nums: { width: 1.5 }, unit: 'm' },
    { op: 'add_dim', target: 'w2' },
    { op: 'select', target: 'w2' },
  ];
}

const BUILDERS: Record<PlanTemplateName, () => Record<string, unknown>[]> = {
  twoBedroom,
  oneRoom,
  studio,
};

/** The raw op envelopes for a named plan template (unvalidated — caller validates). */
export function buildPlanTemplate(name: PlanTemplateName): Record<string, unknown>[] {
  return BUILDERS[name]();
}
