// Open-ended canvas speech ("hi", "what can you do") that isn't a known
// command: a short conversational reply, Nano-first so the Nano vs Gemini
// badge stays honest, falling through to Gemini when Nano can't answer.
// No board, no proposal, no connectRoom — just a reply.
import type { EngineId, SurfaceEngine } from './aiTurn';
import { REPLY_MAX_CHARS } from './liveReply';

export interface OpenEndedReply { engineId: EngineId; reply: string; sim: boolean }

/** Short on purpose, in two ways: the instruction is one line (every
 *  character is read before the first is written), and it asks for a reply
 *  that is quick to write and to say aloud. */
export function buildOpenEndedPrompt(text: string): string {
  return `${OPEN_ENDED_INSTRUCTION}\nShe said: "${text}"`;
}
/** Chat can't act: it never touches a board, a device or the plan, so the
 *  model is told so — and promiseGuard() below catches it when it forgets. */
export const OPEN_ENDED_INSTRUCTION = 'You can only chat; you never change boards, devices or plans, so never say you will. One or two short, friendly sentences, plain words, no emoji.';

/** What replaces a reply that promised an action chat cannot do. */
export const CHAT_CANT_ACT = 'I can’t do that from chat — try “draw the floor plan” or use the board’s buttons.';

// A first-person promise (or claim) of an action: "I'll add…", "I can do
// that", "Done!", "I've added…", "Let me add…". Normal chat ("I'm doing
// well", "I'll be happy to help", "I can tell you about…") passes.
const ACT = 'add|make|create|build|draw|put|place|insert|change|move|remove|delete|turn|switch|set|open|close|update|connect|start|stop|play|dim|brighten|widen|resize|rename|extend|enlarge|fix|save|undo';
const ACTED = 'added|made|created|built|drawn|drew|put|placed|inserted|changed|moved|removed|deleted|turned|switched|set|opened|closed|updated|connected|started|stopped|played|dimmed|widened|resized|renamed|extended|enlarged|fixed|saved|undone|done';
const ACTING = 'adding|making|creating|building|drawing|putting|placing|inserting|changing|moving|removing|deleting|turning|switching|setting|opening|closing|updating|connecting|starting|stopping|playing|dimming|widening|resizing|renaming|extending|enlarging|fixing|saving|undoing|on it';
const PROMISES: RegExp[] = [
  new RegExp(String.raw`\bI\s*(?:['’]ll|\s+will|\s+shall|['’]m\s+going\s+to|\s+am\s+going\s+to|['’]m\s+gonna)\s+(?:go\s+ahead\s+and\s+|now\s+|just\s+|quickly\s+)?(?:${ACT})\b`, 'i'),
  new RegExp(String.raw`\bI\s*(?:['’]ll|\s+will)\s+do\s+(?:that|it|this)\b`, 'i'),
  new RegExp(String.raw`\bI\s*(?:['’]ve|\s+have)\s+(?:just\s+|now\s+|already\s+)?(?:${ACTED})\b`, 'i'),
  new RegExp(String.raw`\bI\s*(?:['’]m|\s+am)\s+(?:now\s+|just\s+)?(?:${ACTING})\b`, 'i'),
  new RegExp(String.raw`\bI\s+can\s+(?:do|handle|take\s+care\s+of)\s+(?:that|it|this)\b`, 'i'),
  new RegExp(String.raw`\bI\s+can\s+(?:${ACT})\s+(?:that|it|this|a|an|the|one|your)\b`, 'i'),
  new RegExp(String.raw`\blet\s+me\s+(?:just\s+|quickly\s+)?(?:${ACT})\b`, 'i'),
  /(?:^|[.!?]\s*)(?:all\s+)?done\s*[.!]/i,
  /\b(?:consider\s+it\s+done|there\s+you\s+go|coming\s+right\s+up|on\s+it[.!])/i,
  new RegExp(String.raw`(?:^|[.!?,]\s*)(?:${ACTING.replace('|on it', '')})\s+(?:it|that|a|an|the|your)\b[^.!?]*\b(?:now|for\s+you)\b`, 'i'),
];

/** True when the reply promises (or claims) an action chat cannot take. */
export function promisesAction(reply: string): boolean {
  const t = String(reply ?? '');
  return PROMISES.some((re) => re.test(t));
}
/** The reply as it may be shown and spoken: an action promise is replaced
 *  by the honest line, everything else passes unchanged. */
export function promiseGuard(reply: string): { reply: string; replaced: boolean } {
  return promisesAction(reply) ? { reply: CHAT_CANT_ACT, replaced: true } : { reply, replaced: false };
}

/** Called once per engine actually tried (never for its scripted fallback),
 *  with the raw prompt; returns the prompt that really goes to that engine —
 *  the caller redacts and books a cloud engine's send here. */
export type OpenEndedPrepare = (engine: SurfaceEngine, prompt: string) => string | { prompt: string; onCloudSend?: () => void };

async function streamOrFallback(engine: SurfaceEngine, prompt: string, onText?: (full: string) => void, prepare?: OpenEndedPrepare): Promise<OpenEndedReply> {
  const prepared = prepare ? prepare(engine, prompt) : prompt;
  const p = typeof prepared === 'string' ? prepared : prepared.prompt;
  const onCloudSend = typeof prepared === 'string' ? undefined : prepared.onCloudSend;
  try {
    const reply = await engine.stream(p, (full) => onText?.(full), { shape: 'text', maxChars: REPLY_MAX_CHARS, ...(onCloudSend ? { onCloudSend } : {}) });
    return { engineId: engine.id, reply, sim: engine.sim };
  } catch (e) {
    // The prepared (SIM) reply is not a second send: no prepare, no booking.
    if (engine.fallback) return streamOrFallback(engine.fallback, p, onText);
    throw e;
  }
}

/** Nano first (and its own SIM fallback, if any); only on a real failure does
 *  this reach for a fresh Gemini engine. */
export async function openEndedAsk(text: string, nano: SurfaceEngine, gemini: SurfaceEngine, onText?: (full: string) => void, prepare?: OpenEndedPrepare): Promise<OpenEndedReply> {
  const prompt = buildOpenEndedPrompt(text);
  try {
    return await streamOrFallback(nano, prompt, onText, prepare);
  } catch {
    return await streamOrFallback(gemini, prompt, onText, prepare);
  }
}
