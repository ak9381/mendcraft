// CAD extras for the canvas plan board: accessibility check, 3D, DXF. Pure
// helpers over the plan's own code (checkPlanAccessibility, toDxf) so the
// board buttons and the voice routes share one path. The accessibility check
// is local: no model call.
import { isAccessibilityRequest } from '../core/a11y';
import { checkPlanAccessibility } from '../plan/accessibility';
import { toDxf } from '../plan/export';
import type { PlanDoc } from '../plan/doc';

export type PlanExtra = 'check' | '3d' | 'dxf';

export const NOTHING_TO_CHECK = 'Nothing to check yet — draw or generate a plan first.';
export const DXF_FILENAME = 'mendcraft-plan.dxf';

/** Which CAD extra (if any) a spoken or typed line asks for. */
export function parsePlanExtra(text: string): PlanExtra | null {
  const t = text.trim().toLowerCase();
  if (isAccessibilityRequest(t)) return 'check';
  if (/^(please\s+)?(show |toggle |switch to |turn on |turn off )?(the )?3\s?-?d( view| mode)?$/.test(t)) return '3d';
  if (/^(please )?(export|download)( the| my)?( floor)?( plan)?( as| to)?( a)? ?dxf( file)?$|^(please )?(export|download)( the| my)? (floor )?(plan|dxf)( file)?$/.test(t)) return 'dxf';
  return null;
}

/** The extra to run, or null when there is no plan board to run it on (the
 *  line then falls through to the normal routes). */
export function routePlanExtra(text: string, hasPlanBoard: boolean): PlanExtra | null {
  return hasPlanBoard ? parsePlanExtra(text) : null;
}

export function isPlanEmpty(doc: PlanDoc): boolean {
  return doc.walls.length === 0 && doc.openings.length === 0 && doc.fixtures.length === 0;
}

export interface A11yReport {
  empty: boolean;
  issues: ReturnType<typeof checkPlanAccessibility>;
  text: string;
}

export function accessibilityReport(doc: PlanDoc): A11yReport {
  if (isPlanEmpty(doc)) return { empty: true, issues: [], text: NOTHING_TO_CHECK };
  const issues = checkPlanAccessibility(doc);
  if (issues.length === 0) {
    return { empty: false, issues, text: 'Accessibility check passed — no door-width, ramp or corridor issues found.' };
  }
  const fails = issues.filter((i) => i.severity === 'fail').length;
  const head = `${issues.length} accessibility ${issues.length === 1 ? 'issue' : 'issues'}${fails ? `, ${fails} hard ${fails === 1 ? 'fail' : 'fails'}` : ''}.`;
  const lines = issues.slice(0, 4).map((i) => i.message);
  const more = issues.length > 4 ? ` +${issues.length - 4} more.` : '';
  return { empty: false, issues, text: `${head} ${lines.join(' ')}${more}` };
}

/** Export the plan as DXF through `save`; returns the filename, or null when
 *  there is nothing to export. */
export function exportPlanDxf(doc: PlanDoc, save: (name: string, text: string, mime: string) => void): string | null {
  if (isPlanEmpty(doc)) return null;
  save(DXF_FILENAME, toDxf(doc), 'application/dxf');
  return DXF_FILENAME;
}

export function browserDownload(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
