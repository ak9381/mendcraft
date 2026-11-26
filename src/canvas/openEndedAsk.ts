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
export const OPEN_ENDED_INSTRUCTION = 'You can only chat; you never change boards, devices or plans, or call, message, order, book or remind anyone, so never say you will. One or two short, friendly sentences, plain words, no emoji.';

/** What replaces a reply that promised an action chat cannot do — a plan
 *  ask gets the plan's own way in; anything else, the board's buttons. */
export const CHAT_CANT_ACT = 'I can’t do that from chat — try “draw the floor plan” or use the board’s buttons.';
export const CHAT_CANT_ACT_GENERIC = 'I can’t do that from chat — use the board’s buttons, or say it as a command.';
/** For an action outside the app (call, text, order, book, remind…). */
export const CHAT_CANT_ACT_OUTSIDE = 'I can’t do that — I can only change things here on your boards and devices.';
const PLAN_ASK = /\b(floor\s*plans?|plan|rooms?|bed\s*rooms?|study|kitchen|bath\s*rooms?|living\s*room|walls?|doors?|windows?|stairs?|hall(way)?|office|garage)\b/i;
export function cantActLine(asked = '', reply = ''): string {
  if (PLAN_ASK.test(asked)) return CHAT_CANT_ACT;
  // Something the app has (a lamp, a board, a tile) → its buttons; anything
  // else (a call, an order, a reminder) is simply not something it can do.
  return APP_THING.test(asked || reply) ? CHAT_CANT_ACT_GENERIC : CHAT_CANT_ACT_OUTSIDE;
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
const APP_THING = new RegExp(String.raw`\b(?:${OBJ.replace(/^it\|that\|them\|/, '')})\b`, 'i');
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

// ── Inverted guard ────────────────────────────────────────────────────────
// The lists above only know the board's own verbs; Nano also says "I will
// call your daughter right away". So any first-person "I'll / I will / I'm
// going to / let me / I'd be happy to <verb>" is a promise UNLESS the verb is
// conversation itself (explain, think, suggest, tell you, be…). Chat can't
// remember either, so "I'll remember that" / "I'll keep that in mind" count.
const CHAT_VERBS = new Set(['be', 'explain', 'describe', 'clarify', 'answer', 'chat', 'talk', 'listen', 'think', 'suggest', 'recommend', 'say', 'ask', 'guess', 'wonder', 'admit', 'mention', 'repeat', 'rephrase', 'wait', 'know', 'hear', 'bet', 'stay', 'share', 'summarize', 'summarise', 'answer', 'reply', 'respond', 'imagine', 'agree', 'note']);
// Verbs that reach outside the app — never something chat (or the app) does.
const OUTSIDE = 'call|ring|phone|dial|text|message|email|e-mail|mail|send|order|book|buy|purchase|pay|reserve|schedule|remind|alert|notify|contact|reach|tell|invite|arrange|cancel|transfer|post|share|fetch|deliver|pick|drive|cook|clean|lock|unlock|check|look|find|search|google|ask';
const OUTSIDE_RE = new RegExp(String.raw`\b(?:${OUTSIDE})\b`, 'i');
// Words that may sit between the lead and its verb.
const SKIP = /^(?:\s+(?:go\s+ahead\s+and|now|just|quickly|also|always|still|probably|really|certainly|definitely|gladly|happily|surely|simply|then|first|immediately|soon|right\s+now|actually|personally|try\s+(?:to|and)|be\s+(?:happy|glad|delighted|pleased|sure|able)\s+to|need\s+to|have\s+to|want\s+to|make\s+sure\s+to))/i;
const NEGATION = /^\s+(?:not|never|n't)\b/i;
/** Judge the words after a lead ("I'll", "let me"…): is this a promise? */
function judgeAfterLead(after: string, bareIsPromise: boolean, complete: boolean): boolean {
  let a = after;
  for (let m = SKIP.exec(a); m; m = SKIP.exec(a)) a = a.slice(m[0].length);
  if (NEGATION.test(a)) return false;
  const w = /^\s+([a-z][a-z'-]*)/i.exec(a);
  // "Sure, I can." / "I'd be happy to!" — but a stream that just stops
  // after "Sure, I'll" is not finished yet.
  if (!w) return bareIsPromise && (complete || /^\s*[.!?,;:—…]/.test(a));
  const verb = w[1].toLowerCase();
  const rest = a.slice(w[0].length);
  switch (verb) {
    case 'tell': return !/^\s+(?:you|me|us|a|an|some|one|the\s+truth|stories|jokes)\b/i.test(rest);
    case 'help': return OUTSIDE_RE.test(rest.split(/[.!?]/)[0]) && !/^\s+(?:you\s+)?(?:explain|understand|think|decide|choose|figure)\b/i.test(rest);
    case 'see': return !/^\s*(?:[,.!?…]|$|you\b)/i.test(rest);
    case 'make': return !/^\s+(?:a|an|one|my)?\s*(?:suggestion|guess|point|joke|recommendation|observation|comment)s?\b/i.test(rest);
    case 'give': return !/^\s+(?:you\s+)?(?:a|an|some|one|my)?\s*(?:tip|idea|hint|example|suggestion|rundown|overview|summary|thought|answer|opinion)s?\b/i.test(rest);
    case 'keep': return !/^\s+it\s+(?:short|simple|brief|quick)\b/i.test(rest);
    case 'put': return !/^\s+it\s+(?:this|that|another|simply)\s+way\b|^\s+it\s+simply\b/i.test(rest);
    case 'walk': return !/^\s+you\s+through\b/i.test(rest);
    case 'start': case 'begin': return !/^\s+(?:by|with)\b/i.test(rest);
    case 'share': return !/^\s+(?:a|an|some|one|my)\s+(?:tip|idea|thought|story|joke|fact)s?\b/i.test(rest);
    default: return !CHAT_VERBS.has(verb);
  }
}
const LEAD = /\b(?:I\s*'ll|I\s+will|I\s+shall|I\s*'m\s+(?:going\s+to|gonna)|I\s+am\s+(?:going\s+to|gonna)|let\s+me|allow\s+me\s+to)\b|\b(I\s*'d|I\s+would)\s+(?:be\s+(?:glad|happy|delighted|pleased)\s+to|love\s+to|like\s+to)\b/gi;
const YES_CAN = /(?:^|[.!?,;—]\s*)(?:yes|yeah|yep|yup|sure|of\s+course|absolutely|certainly|okay|ok|no\s+problem|definitely|right)\b[,!.—\s]*(?:I\s+(?:can|could|will)|I\s*'ll)\b/gi;
const I_CAN = /\bI\s+(?:can|could)\b(?!\s*not|'t)/gi;
const I_AM_ING = /\bI\s*(?:'m|\s+am)\s+(?:now\s+|just\s+|currently\s+|already\s+)?([a-z]+ing)\b([^.!?]*)/gi;
const LEAD_ING = /(?:^|[.!?,;:—]\s*)([A-Za-z]+ing)\b([^.!?]*)/g;
const CHAT_ING = new Set(['being', 'thinking', 'explaining', 'listening', 'talking', 'chatting', 'wondering', 'hoping', 'glad', 'happy', 'here', 'going', 'feeling', 'doing', 'saying', 'asking', 'guessing', 'learning', 'smiling', 'nothing', 'something', 'anything', 'everything', 'morning', 'evening', 'thing', 'bring', 'string', 'spring', 'swing', 'sing', 'ring', 'wing', 'sting', 'king', 'during', 'ceiling', 'ping', 'cling', 'fling', 'sling', 'having', 'trying']);
const SOON = /\b(?:now|right\s+away|straight\s+away|for\s+you|as\s+we\s+speak|immediately|at\s+once)\b/i;
/** The inverted checks: true when any first-person claim of an action
 *  (beyond conversation) is in the text. */
function claimsAnyAction(raw: string, complete: boolean): boolean {
  const t = raw.replace(/[’‘]/g, "'");
  for (const m of t.matchAll(LEAD)) {
    if (judgeAfterLead(t.slice(m.index! + m[0].length), !!m[1], complete)) return true;
  }
  for (const m of t.matchAll(YES_CAN)) {
    if (judgeAfterLead(t.slice(m.index! + m[0].length), true, complete)) return true;
  }
  // "I can call her" — a bare "I can" is only a promise for an outside verb
  // ("I can tell you about…", "I can turn this around for you" pass).
  for (const m of t.matchAll(I_CAN)) {
    const w = /^\s+(?:just\s+|also\s+)?([a-z][a-z'-]*)/i.exec(t.slice(m.index! + m[0].length));
    if (w && new RegExp(`^(?:${OUTSIDE})$`, 'i').test(w[1]) && !/^tell$|^ask$|^check$|^look$|^share$/i.test(w[1])) return true;
  }
  // "I'm calling her now", "I'm sending it for you"
  for (const m of t.matchAll(I_AM_ING)) {
    if (!CHAT_ING.has(m[1].toLowerCase()) && SOON.test(m[2])) return true;
  }
  // "Calling your daughter right away." / "Sure — sending it now."
  for (const m of t.matchAll(LEAD_ING)) {
    const w = m[1].toLowerCase();
    if (w.length >= 6 && !CHAT_ING.has(w) && SOON.test(m[2])) return true;
  }
  // "right away" with no "you" before it in its sentence ("You should rest right away" passes).
  for (const s of t.split(/(?<=[.!?])\s+/)) {
    const i = s.search(/\b(?:right|straight)\s+away\b/i);
    if (i >= 0 && !/\byou\b/i.test(s.slice(0, i))) return true;
  }
  if (/(?:^|[.!?,;—]\s*)on\s+it\s*(?:[.!]|$)/i.test(t)) return true;
  return false;
}

/** True when the reply promises (or claims) an action chat cannot take. */
export function promisesAction(reply: string, complete = true): boolean {
  const t = String(reply ?? '');
  return PROMISES.some((re) => re.test(t)) || claimsAnyAction(t, complete);
}
/** The reply as it may be shown and spoken: an action promise is replaced
 *  by the honest line, everything else passes unchanged. */
export function promiseGuard(reply: string, asked = ''): { reply: string; replaced: boolean } {
  return promisesAction(reply) ? { reply: cantActLine(asked, reply), replaced: true } : { reply, replaced: false };
}

/** A clause that could still turn into a promise once its sentence ends. */
const RISKY = new RegExp(String.raw`\bI\s*(?:['’]ll|['’]d|['’]m|will|shall|would|can|could|am)\b|\blet\s+me\b|\ballow\s+me\b|\b(?:right|straight)\s+away\b|\bon\s+it\b|^\s*[A-Za-z]+ing\b|^\s*(?:yes|yeah|yep|yup|sure|of\s+course|absolutely|certainly|okay|ok|no\s+problem|definitely|right)\b|\b(?:I|let\s+me|allow\s+me)\b[^.!?]*\b(?:${ACT}|${ACTED}|${ACTING}|do|handle|got|on)\b|^\s*(?:${ACTING})\b|\b(?:is|are)\s+now\b|\b(?:has|have)\s+been\b|\b(?:one|a|just\s+a)\s+(?:moment|second|sec)\b|\bhang\s+on\b|\bbear\s+with\s+me\b`, 'i');
/** While a reply streams: the part that may already be shown and spoken —
 *  whole clauses only, and a clause that might become a promise ("I'll add,")
 *  is held until its sentence has ended and passed the guard. null = the
 *  reply has promised an action: show and say none of it. */
export function guardSafePrefix(full: string): string | null {
  const t = String(full ?? '');
  // A word still being written ("I will b…") is not judged until it is whole.
  if (promisesAction(t.replace(/[A-Za-z’'-]+$/, ''), false)) return null;
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
