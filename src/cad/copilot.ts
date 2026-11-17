// CAD copilot: understands her short spoken / typed request and maps it to a
// typed CAD tool call (cad/tools) or a copilot meta action. Rules first (instant,
// offline, deterministic); when they miss, Nano on the device picks a tool, and
// only hard research questions go to cloud Gemini — or, with no signal, to the
// site checklist.

import { layerFromWords } from './layers';
import { parseFloorHeight } from './stairs';
import { isPlanQuestion } from './planQA';
import type { ToolCall } from './tools';
import type { RegionId } from './guidelines';

export type CopilotMeta =
  | 'open-checklist' | 'email-client' | 'open-changes'
  | 'accept' | 'accept-all' | 'reject' | 'reject-all' | 'revert-last';

export type CopilotIntent =
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'meta'; meta: CopilotMeta }
  | { kind: 'checklist-add'; question: string };

export function regionFromWords(text: string): RegionId | null {
  const t = text.toLowerCase();
  if (/\b(india|indian|nbc|bengaluru|bangalore|mumbai|delhi)\b/.test(t)) return 'india';
  if (/\b(us|usa|american|irc|united states)\b/.test(t)) return 'us';
  if (/\b(international|iso|global)\b/.test(t)) return 'international';
  return null;
}

const call = (tool: string, args: Record<string, unknown> = {}): CopilotIntent => ({ kind: 'tool', call: { tool, args } });

/** Deterministic copilot parse. Null = not a copilot request (the normal
 *  editing pipeline handles it). `walking` = a walkthrough is active. */
export function parseCopilot(utterance: string, opts: { walking?: boolean } = {}): CopilotIntent | null {
  const t = utterance.trim().toLowerCase().replace(/[.!]+$/, '');
  if (!t) return null;

  // Walk controls first while walking: "forward", "turn left", "stop".
  if (opts.walking) {
    if (/^(stop|exit|end|leave)( the)?( walk(ing|through)?)?$|stop walking|exit walk/.test(t)) return call('walkthrough', { on: false });
    if (/\bturn (left|right)\b|^(look|face) (left|right)$/.test(t)) return call('walk_step', { step: /left/.test(t) ? 'turn_left' : 'turn_right' });
    if (/^(go |walk |move |step )?(forward|ahead|straight)( please)?$|^keep going$/.test(t)) return call('walk_step', { step: 'forward' });
    if (/^(go |walk |move |step )?back(ward)?s?( please)?$/.test(t)) return call('walk_step', { step: 'back' });
    if (/^(go |step |move )?(left|right)$/.test(t)) return call('walk_step', { step: t.includes('left') ? 'left' : 'right' });
  }

  // Review pipeline
  if (/^(accept|approve|apply) (all|everything)( changes)?$/.test(t)) return { kind: 'meta', meta: 'accept-all' };
  if (/^(reject|decline|discard) (all|everything)( changes)?$/.test(t)) return { kind: 'meta', meta: 'reject-all' };
  if (/^(accept|approve)( (it|this|that|the change))?$/.test(t)) return { kind: 'meta', meta: 'accept' };
  if (/^(reject|decline)( (it|this|that|the change))?$/.test(t)) return { kind: 'meta', meta: 'reject' };
  if (/\b(revert|roll back|rollback)\b.*\b(last|latest|previous)\b/.test(t)) return { kind: 'meta', meta: 'revert-last' };
  if (/\b(show|open)\b.*\b(changes|history|change log|changelog)\b|^(changes|history)$|who changed/.test(t)) return { kind: 'meta', meta: 'open-changes' };

  // Site checklist
  if (/\b(email|mail|write to|message)\b.*\bclient\b/.test(t)) return { kind: 'meta', meta: 'email-client' };
  if (/\b(show|open|read)\b.*\b(site )?checklist\b|^(site )?checklist$/.test(t)) return { kind: 'meta', meta: 'open-checklist' };
  const add = t.match(/^(?:add|save|put|note)(?: this)?(?: to (?:the |my )?(?:site )?checklist)?[:,]?\s+(.{6,})$/);
  if (add && /checklist/.test(t)) return { kind: 'checklist-add', question: add[1].replace(/\s*to (the |my )?(site )?checklist$/, '') };

  // Guideline check
  if (/\b(follow|meet|pass|break|check|against|comply|okay|ok)\b.*\b(rules?|codes?|regulations?|guidelines?|standards?|bylaws?|nbc)\b|\b(code|guideline|rule) check\b|^check (my |the )?(drawing|plan)$/.test(t)) {
    const region = regionFromWords(t);
    return call('guideline_check', region ? { region } : {});
  }

  // Staircase
  if (/\b(build|add|make|design|draw|create|put|place|give me)\b.*\b(stair|stairs|staircase|stairway|steps)\b|^(a )?(stair|staircase)( please)?$/.test(t)) {
    const fh = parseFloorHeight(t);
    const args: Record<string, unknown> = {};
    if (fh) args.floorHeight = fh;
    if (/\bdown\b/.test(t)) args.dir = 'down';
    return call('add_stair', args);
  }

  // Walkthrough
  if (/\bwalk ?through\b|\bwalk me\b|\bwalk (around|inside)\b|\bvirtual (tour|walk)\b|\bfirst[- ]person\b|\btake me (inside|through)\b/.test(t)) {
    const room = t.match(/\b(?:in|into|from|of) the ([a-z ]+?)$/);
    return call('walkthrough', { on: true, ...(room ? { room: room[1] } : {}) });
  }

  // 2D → 3D with materials
  if (/\b(convert|turn|make|change|show)\b.*\b(3d|three d|render)\b|\brender\b|\b(materials?|finishes|lighting)\b/.test(t)
    && !/\b(2d|plan view|flat)\b.*\bback\b/.test(t)) {
    if (/\b(off|close|exit|back to (the )?(plan|2d))\b/.test(t)) return call('view_3d', { on: false });
    return call('set_materials', { style: utterance.trim().slice(0, 120) });
  }
  if (/\b(3d|three d)( view)?\b/.test(t)) return call('view_3d', { on: !/\b(off|close|exit|hide)\b/.test(t) });
  if (/\bback to (the )?(plan|2d)\b|\b2d view\b/.test(t)) return call('view_3d', { on: false });

  // Zoom
  if (/\bzoom (in|closer)\b|\bcloser\b$/.test(t)) return call('zoom', { to: 'in' });
  if (/\bzoom (out|back)\b/.test(t)) return call('zoom', { to: 'out' });
  if (/\b(fit|whole plan|zoom to fit|show (me )?everything)\b/.test(t)) return call('zoom', { to: 'fit' });

  // Layers
  const lay = t.match(/^(hide|show|turn off|turn on)\b/);
  if (lay) {
    const layer = layerFromWords(t);
    if (layer) return call('show_layer', { layer, visible: !/hide|off/.test(lay[1]) });
  }

  // Plan-data questions (answered from the drawing)
  if (isPlanQuestion(t)) return call('measure', { question: utterance.trim() });
  return null;
}

/** Keep only the numbers Gemini needs, so the prompt stays small and cheap. */
export function compactPlanSummary(summary: string, max = 480): string {
  const raw = summary.trim();
  if (!raw) return '';
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const slim: Record<string, unknown> = {};
    if (Array.isArray(o.walls)) slim.walls = (o.walls as { id?: string; lenMm?: number; thick?: number }[]).slice(0, 24).map((w) => ({
      id: w.id, len: w.lenMm, thick: w.thick,
    }));
    if (Array.isArray(o.openings)) slim.openings = (o.openings as object[]).slice(0, 24);
    if (Array.isArray(o.rooms)) slim.rooms = (o.rooms as object[]).slice(0, 16);
    if (o.selected) slim.sel = o.selected;
    const s = JSON.stringify(slim);
    if (s.length <= max) return s;
    return s.slice(0, max);
  } catch {
    return raw.length <= max ? raw : raw.slice(0, max);
  }
}

/** Prompt for cloud Gemini on a hard question (with the plan summary). */
export function copilotAnswerPrompt(question: string, summary: string, region: string): string {
  const plan = compactPlanSummary(summary);
  return `Site-visit CAD copilot. 2 short sentences. Typical values only; never certified compliance. Suggest tool calls only if a drawing change would help (they are reviewed first). Region: ${region}. Plan mm: ${plan}\nQ: ${question}\nJSON: {"answer":"...","calls":[],"why":"..."}`;
}

export const COPILOT_ANSWER_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    calls: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool'] } },
    why: { type: 'string' },
  },
  required: ['answer'],
};

export const EMAIL_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: { subject: { type: 'string' }, body: { type: 'string' } },
  required: ['subject', 'body'],
};

export function emailPrompt(items: { question: string; answer?: string }[], summary: string): string {
  const list = items.map((it, i) => `${i + 1}. ${it.question}${it.answer ? ` (my note: ${it.answer})` : ''}`).join('\n');
  return `Write a short, warm, professional email from an architect to her client after a site visit, asking these open questions clearly as a numbered list. Plain text, no placeholders like [Name] except "Hello," as the greeting, sign off "Thank you." Keep it under 150 words. Plan context (mm): ${summary.slice(0, 400)}\nQuestions:\n${list}\nReply JSON only: {"subject":"...","body":"..."}`;
}

/** Accept / reject / walk-step commands stay on the rules path even when Nano
 *  is ready — they must be instant and deterministic. */
export function isInstantCopilot(intent: CopilotIntent | null): boolean {
  if (!intent) return false;
  if (intent.kind === 'meta' || intent.kind === 'checklist-add') return true;
  if (intent.kind === 'tool') {
    if (intent.call.tool === 'walk_step') return true;
    if (intent.call.tool === 'walkthrough' && intent.call.args.on === false) return true;
  }
  return false;
}

/** When Nano is ready, a rules-recognised canvas tool (e.g. "convert 2D to 3D")
 *  is offered to Nano first. Instant meta/walk commands stay on rules. */
export function shouldNanoPickIntent(deviceReady: boolean, intent: CopilotIntent | null): boolean {
  return deviceReady && !!intent && intent.kind === 'tool' && !isInstantCopilot(intent);
}

/** If Nano only turned the 3D view on, but her words clearly asked to convert
 *  or dress the model, keep Nano as the router and use the materials tool. */
export function refineCadPick(utterance: string, call: ToolCall): ToolCall {
  const rules = parseCopilot(utterance);
  if (rules?.kind === 'tool' && rules.call.tool === 'set_materials' && call.tool === 'view_3d') {
    return rules.call;
  }
  return call;
}
