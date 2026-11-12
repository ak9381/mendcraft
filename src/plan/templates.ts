// Deterministic PLAN templates: each returns a list of plan op envelopes that
// PlanEngine.applyGenerated() builds from a blank document in one undoable step.
// These back both the rules fallback ("two bedroom plan" with no AI) and the
// cloud generate path (the model returns {ops:[...]}, code re-validates them).
//
// Note on ids: applyGenerated resets the id counter, so wall ids are
// deterministic. add_room reuses a coincident wall, so two rooms placed side by
// side SHARE one wall. In `twoBedroom` the shared wall is `w3`; the template
// dimensions and selects it so the frozen demo ("make it 4 meters") lands on a
// single, already-selected wall without any pointing.

export type PlanTemplateName = 'twoBedroom' | 'oneRoom' | 'studio';

export const PLAN_TEMPLATE_NAMES: readonly PlanTemplateName[] = ['twoBedroom', 'oneRoom', 'studio'] as const;

export function isPlanTemplateName(v: unknown): v is PlanTemplateName {
  return typeof v === 'string' && (PLAN_TEMPLATE_NAMES as readonly string[]).includes(v);
}

/** Two 4 m × 3 m bedrooms sharing a central wall (`w3`), dimensioned + selected. */
function twoBedroom(): Record<string, unknown>[] {
  return [
    { op: 'add_room', nums: { x: 0, y: 0, w: 4, h: 3 }, unit: 'm', name: 'Bedroom 1' },
    { op: 'add_room', nums: { x: 4, y: 0, w: 4, h: 3 }, unit: 'm', name: 'Bedroom 2' },
    { op: 'add_dim', target: 'w3' },
    { op: 'select', target: 'w3' },
  ];
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
