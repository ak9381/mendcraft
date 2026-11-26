// The legacy studio's two "generate a whole thing" calls. The canvas port
// replaced src/ai/hybrid.ts with sim-main's, which no longer has the studio's
// part-template and screen-generate jobs; bringing them back would need far
// more of the old hybrid internals than the studio is worth here. So both
// are switched off and say so plainly — never a made-up result.
import type { TemplateName } from '../core/templates';
import type { Frame } from '../ui/design/doc';
import type { Source } from './hybrid';

export const STUDIO_FEATURE_OFF = 'This studio feature is not in this build.';

export interface GenerateUiResult {
  frame?: Frame;
  clarify?: string;
  note?: string;
  source: Source;
}

export type TemplateResult =
  | { template: TemplateName; params: Record<string, number>; source: Source }
  | { clarify: string; source: Source };

export async function generateTemplate(_prompt: string): Promise<TemplateResult> {
  return { clarify: STUDIO_FEATURE_OFF, source: 'rules' };
}

export async function generateUi(_prompt: string): Promise<GenerateUiResult> {
  return { clarify: STUDIO_FEATURE_OFF, source: 'rules' };
}
