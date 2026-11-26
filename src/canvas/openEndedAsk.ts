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

/** What replaces a reply that promised an action chat cannot do — a plan
 *  ask gets the plan's own way in; anything else, the board's buttons. */
export const CHAT_CANT_ACT = 'I can’t do that from chat — try “draw the floor plan” or use the board’s buttons.';
export const CHAT_CANT_ACT_GENERIC = 'I can’t do that from chat — use the board’s buttons, or say it as a command.';
const PLAN_ASK = /\b(floor\s*plans?|plan|rooms?|bed\s*rooms?|study|kitchen|bath\s*rooms?|living\s*room|walls?|doors?|windows?|stairs?|hall(way)?|office|garage)\b/i;
export function cantActLine(asked = ''): string {
  return PLAN_ASK.test(asked) ? CHAT_CANT_ACT : CHAT_CANT_ACT_GENERIC;
}

// A first-person promise (or claim) of an action ON SOMETHING chat could
// touch: "I'll add a study", "I can do that", "Done!", "I've added it", "Let
// me turn on the lamp", "Your study has been added", "one moment while I add
// it". The verb needs an object word after it, so "I'll put the kettle on",
// "I'm turning 80", "Let me make a suggestion" and "I'm doing well" pass.
const ACT = 'add|make|create|build|draw|put|place|insert|change|move|remove|delete|turn|switch|set|open|close|update|connect|start|stop|play|dim|brighten|widen|resize|rename|extend|enlarge|fix|save|undo|get';
const ACTED = 'added|made|created|built|drawn|drew|put|placed|inserted|changed|moved|removed|deleted|turned|switched|set|opened|closed|updated|connected|started|stopped|played|dimmed|widened|resized|renamed|extended|enlarged|fixed|saved|undone|done|sorted';
const ACTING = 'adding|making|creating|building|drawing|putting|placing|inserting|changing|moving|removing|deleting|turning|switching|setting|opening|closing|updating|connecting|starting|stopping|playing|dimming|widening|resizing|renaming|extending|enlarging|fixing|saving|undoing';
const OBJ = 'it|that|them|boards?|plans?|floor\\s*plans?|rooms?|lamps?|lights?|bulbs?|tiles?|stud(?:y|ies)|bed\\s*rooms?|kitchens?|bath\\s*rooms?|living\\s*rooms?|walls?|doors?|windows?|stairs?|staircase|dashboards?|devices?|speakers?|music|songs?|tvs?|fans?|thermostats?|plugs?|scenes?|layouts?|buttons?|garage|office|hall(?:way)?|lounge|closet';
const DET = 'a|an|the|your|my|new|one|this|these|those|some|another|second|extra|that';
const OBJ_PHRASE = String.raw`(?:\s+(?:on|off|up|down|in|out|back|over))?(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${OBJ})\b`;
const OBJ_ONLY = String.raw`(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${OBJ})\b`;
const FUTURE = String.raw`\b(?:I\s*(?:['’]ll|\s+will|\s+shall|['’]m\s+going\s+to|\s+am\s+going\s+to|['’]m\s+gonna|['’]d\s+(?:be\s+(?:glad|happy|delighted)\s+to|love\s+to)|\s+would\s+(?:be\s+(?:glad|happy|delighted)\s+to|love\s+to)|\s+can)|let\s+me|allow\s+me\s+to)\s+(?:go\s+ahead\s+and\s+|now\s+|just\s+|quickly\s+)?`;
const PROMISES: RegExp[] = [
  new RegExp(String.raw`${FUTURE}(?:${ACT})${OBJ_PHRASE}`, 'i'),
  new RegExp(String.raw`${FUTURE}(?:do|handle|take\s+care\s+of|sort\s+out)\s+(?:that|it|this)\b`, 'i'),
  new RegExp(String.raw`\bI\s*(?:['’]ll|\s+will)\s+get\s+(?:it|that|this|them)\s+(?:sorted|done|fixed|added|set\s+up|ready|going|moving|changed)\b`, 'i'),
  new RegExp(String.raw`\bI\s*(?:['’]ve|\s+have)\s+(?:just\s+|now\s+|already\s+)?(?:${ACTED})${OBJ_PHRASE}`, 'i'),
  /\bI\s*(?:['’]ve|\s+have)\s+got\s+(?:it|that|this|you\s+covered)\b/i,
  new RegExp(String.raw`\bI\s*(?:['’]m|\s+am)\s+(?:now\s+|just\s+)?(?:${ACTING})${OBJ_PHRASE}`, 'i'),
  /\bI\s*(?:['’]m|\s+am)\s+on\s+it\b/i,
  /(?:^|[.!?]\s*)(?:all\s+)?done\s*[.!]/i,
  /\b(?:consider\s+it\s+done|there\s+you\s+go|coming\s+right\s+up)\b/i,
  // a claim in the passive: "Your study has been added", "The study is now next to…"
  new RegExp(String.raw`\b(?:the|your)\s+(?:[\w’'-]+\s+)?(?:${OBJ})\s+(?:has|have)\s+been\s+(?:${ACTED})\b`, 'i'),
  new RegExp(String.raw`\b(?:the|your)\s+(?:[\w’'-]+\s+)?(?:${OBJ})\s+(?:is|are)\s+now\b`, 'i'),
  // "one moment while I add it", "Adding a study now"
  new RegExp(String.raw`\b(?:while|as|once|then|and)\s+I\s+(?:${ACT})${OBJ_PHRASE}`, 'i'),
  new RegExp(String.raw`(?:^|[.!?,;—]\s*)(?:${ACTING})${OBJ_ONLY}[^.!?]*\b(?:now|for\s+you)\b`, 'i'),
];

/** True when the reply promises (or claims) an action chat cannot take. */
export function promisesAction(reply: string): boolean {
  const t = String(reply ?? '');
  return PROMISES.some((re) => re.test(t));
}
/** The reply as it may be shown and spoken: an action promise is replaced
 *  by the honest line, everything else passes unchanged. */
export function promiseGuard(reply: string, asked = ''): { reply: string; replaced: boolean } {
  return promisesAction(reply) ? { reply: cantActLine(asked), replaced: true } : { reply, replaced: false };
}

/** A clause that could still turn into a promise once its sentence ends. */
const RISKY = new RegExp(String.raw`\b(?:I|let\s+me|allow\s+me)\b[^.!?]*\b(?:${ACT}|${ACTED}|${ACTING}|do|handle|got|on)\b|^\s*(?:${ACTING})\b|\b(?:is|are)\s+now\b|\b(?:has|have)\s+been\b|\b(?:one|a|just\s+a)\s+(?:moment|second|sec)\b|\bhang\s+on\b|\bbear\s+with\s+me\b`, 'i');
/** While a reply streams: the part that may already be shown and spoken —
 *  whole clauses only, and a clause that might become a promise ("I'll add,")
 *  is held until its sentence has ended and passed the guard. null = the
 *  reply has promised an action: show and say none of it. */
export function guardSafePrefix(full: string): string | null {
  const t = String(full ?? '');
  if (promisesAction(t)) return null;
  const re = /[,.!?;:—…]+["'”’)\]]*(?=\s)/g;
  let out = 0;
  let clauseStart = 0;
  let held: number | null = null; // start of the first clause still on hold
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const end = m.index + m[0].length;
    const clause = t.slice(clauseStart, end);
    const sentenceEnd = /[.!?…]/.test(m[0]);
    if (held === null && RISKY.test(clause)) held = clauseStart;
    if (held === null) out = end;
    else if (sentenceEnd) { held = null; out = end; } // the whole sentence passed promisesAction above
    clauseStart = end;
  }
  return t.slice(0, out).trim();
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
