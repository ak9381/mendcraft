// Floor-plan templates: only `blank`. A floor plan is generated (Gemini
// writes a plan document, code draws it — canvas/planGenerate.ts) or drawn by
// hand; no plan is written into the code. A plan tile's template is the
// starting point its board mounts with: always an empty drawing, which the
// stored drawing beside the board (planDocs.ts) then replaces.

export type PlanTemplateName = 'blank';

export const PLAN_TEMPLATE_NAMES: readonly PlanTemplateName[] = ['blank'] as const;

export function isPlanTemplateName(v: unknown): v is PlanTemplateName {
  return typeof v === 'string' && (PLAN_TEMPLATE_NAMES as readonly string[]).includes(v);
}

/** The op envelopes for a plan template: `blank` has none. */
export function buildPlanTemplate(name: PlanTemplateName): Record<string, unknown>[] {
  void name;
  return [];
}
