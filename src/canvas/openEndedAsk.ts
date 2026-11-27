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
export const OPEN_ENDED_INSTRUCTION = 'You can only chat; you never change boards, devices or plans (nor see them), or call, message, order, book or remind anyone, so never say you will or did, or that one is on. In English: one or two short, kind sentences, no emoji.';

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
const ACTED = 'added|made|created|built|drawn|drew|put|placed|inserted|changed|moved|removed|deleted|turned|switched|set|opened|closed|updated|connected|started|stopped|played|dimmed|widened|resized|renamed|extended|enlarged|fixed|saved|undone|done|sorted|paused|muted|lowered|raised|increased|decreased|reduced|skipped|brightened|adjusted';
const ACTING = 'adding|making|creating|building|drawing|putting|placing|inserting|changing|moving|removing|deleting|turning|switching|setting|opening|closing|updating|connecting|starting|stopping|playing|dimming|widening|resizing|renaming|extending|enlarging|fixing|saving|undoing';
const OBJ = 'it|that|them|boards?|plans?|floor\\s*plans?|rooms?|lamps?|lights?|bulbs?|tiles?|stud(?:y|ies)|bed\\s*rooms?|kitchens?|bath\\s*rooms?|living\\s*rooms?|walls?|doors?|windows?|stairs?|staircase|dashboards?|devices?|speakers?|music|songs?|tvs?|fans?|thermostats?|plugs?|scenes?|layouts?|buttons?|garage|office|hall(?:way)?|lounge|closet|colou?rs?|volume|brightness|heat(?:er|ers|ing)|air\\s*con|oven|blinds|curtains|timers?|alarms?|temperature|modes?|tracks?|playlists?';
const APP_THING = new RegExp(String.raw`\b(?:${OBJ.replace(/^it\|that\|them\|/, '')})\b`, 'i');
const DET = 'a|an|the|your|my|new|one|this|these|those|some|another|second|extra|that';
const OBJ_PHRASE = String.raw`(?:\s+(?:on|off|up|down|in|out|back|over))?(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${OBJ})\b`;
const OBJ_ONLY = String.raw`(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${OBJ})\b`;
const FUTURE = String.raw`\b(?:I\s*(?:['’]ll|\s+will|\s+shall|['’]m\s+going\s+to|\s+am\s+going\s+to|['’]m\s+gonna|['’]d\s+(?:be\s+(?:glad|happy|delighted)\s+to|love\s+to)|\s+would\s+(?:be\s+(?:glad|happy|delighted)\s+to|love\s+to)|\s+can)|let\s+me|allow\s+me\s+to)\s+(?:go\s+ahead\s+and\s+|now\s+|just\s+|quickly\s+)?`;
const PROMISES: RegExp[] = [
  new RegExp(String.raw`${FUTURE}(?!put\s+it\s+(?:this|that|another)\s+way)(?:${ACT})${OBJ_PHRASE}`, 'i'), // "Let me put it this way" is talk
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

// ── Action claims beyond the board's own verbs ────────────────────────────
// The lists above only know the board's objects; Nano also says "I will call
// your daughter right away". Allowed by default: a reply is only a promise
// when its first-person verb is an action — the app's own (add, turn, play…)
// or one out in the world (call, text, order, book, remind…) — or when a
// lighter verb (check, tell her, look into…) is aimed at now / for you.
// Talk itself ("I'll do my best", "I'll keep you company", "I'll try") passes.
const APP_ACT = 'add|make|create|build|draw|place|insert|change|move|remove|delete|turn|switch|set|open|close|update|connect|start|stop|play|pause|dim|brighten|widen|resize|rename|extend|enlarge|fix|save|undo|put|get|install|adjust|lower|raise|mute|unmute|record|warm|cool';
const OUTSIDE = 'call|ring|phone|dial|text|message|email|e-mail|mail|send|forward|order|book|buy|purchase|pay|reserve|schedule|remind|alert|notify|inform|ping|contact|invite|arrange|cancel|transfer|post|deliver|fetch|drive|cook|clean|lock|unlock|remember';
const STRONG = new RegExp(String.raw`^(?:${APP_ACT}|${OUTSIDE})$`, 'i');
const OUTSIDE_ONLY = new RegExp(String.raw`^(?:${OUTSIDE})$`, 'i');
const ANY_ACT = new RegExp(String.raw`\b(?:${OUTSIDE}|${APP_ACT})\b`, 'i');
/** Lighter verbs: a promise only when aimed at now / for you (or, for tell, at someone else). */
const WEAK = /^(?:check|look|find|search|tell|share|see|help|handle|do|take|sort|keep|ask|let|note|write|reach)$/i;
const SOON = /\b(?:now|right\s+away|straight\s+away|for\s+you|as\s+we\s+speak|immediately|at\s+once|in\s+a\s+(?:moment|second|minute|sec)|for\s+(?:\w+\s+){0,2}(?:seconds?|minutes?|hours?|days?))\b/i;
// Words that may sit between the lead and its verb.
const SKIP = /^(?:\s+(?:go\s+ahead\s+and|now|just|quickly|also|always|still|probably|really|certainly|definitely|gladly|happily|surely|simply|then|first|immediately|soon|right\s+now|actually|personally|be\s+(?:happy|glad|delighted|pleased|sure|able)\s+to|need\s+to|have\s+to|want\s+to|make\s+sure\s+to))/i;
const NEGATION = /^\s+(?:not|never|n't)\b/i;
/** Exemptions after a strong verb: "stop rambling", "make a suggestion", "get back to…". */
function strongExempt(verb: string, rest: string): boolean {
  if (/^\s+[a-z]+ing\b/i.test(rest) && !/^\s+(?:something|nothing|anything|everything)\b/i.test(rest)) return true; // "stop rambling", "start chatting"
  switch (verb) {
    case 'make': return /^\s+(?:a|an|one|my)?\s*(?:suggestion|guess|point|joke|recommendation|observation|comment|wish|promise)s?\b/i.test(rest);
    case 'put': return /^\s+it\s+(?:this|that|another|simply)\s+way\b|^\s+it\s+simply\b|^\s+(?:the\s+)?kettle\s+on\b/i.test(rest);
    case 'start': case 'begin': return /^\s+(?:by|with|over)\b/i.test(rest);
    case 'get': return /^\s+(?:back|to|you\s+(?:an?\s+)?(?:idea|answer|tip))\b|^\s+(?:it|that|what\s+you\s+mean)\s*(?:[.!,?]|$)|^\s+(?:this|that)\s+straight\b/i.test(rest);
    case 'set': return /^\s+(?:the\s+)?(?:record\s+straight|scene)\b/i.test(rest);
    case 'turn': return /^\s+(?:this|that|it)\s+around\b/i.test(rest);
    // "I'll warm up to the idea", "I'll warm to it", "I'll cool off and rest" are talk; "warm up the room" is not.
    case 'warm': case 'cool': return /^\s*(?:\s(?:up|down|off))?\s*(?:to\b|and\b|[.!?,;]|$)/i.test(rest);
    default: return false;
  }
}
/** Judge the words after a lead ("I'll", "let me"…): is this a promise?
 *  `complete` is false while a reply streams: a verb whose verdict needs the
 *  next word is not decided until that word has arrived. */
function judgeAfterLead(after: string, bareIsPromise: boolean, complete: boolean): boolean {
  let a = after;
  for (let m = SKIP.exec(a); m; m = SKIP.exec(a)) a = a.slice(m[0].length);
  if (NEGATION.test(a)) return false;
  const w = /^\s+([a-z][a-z'-]*)/i.exec(a);
  // "Sure, I can." / "I'd be happy to!" — but a stream that just stops after "Sure, I'll" is not finished yet.
  if (!w) return bareIsPromise && (complete || /^\s*[.!?,;:—…]/.test(a));
  const verb = w[1].toLowerCase();
  const rest = a.slice(w[0].length);
  if (!complete && /^\s*$/.test(rest)) return false; // undecided until the next word
  const clause = rest.split(/[.!?;:]/)[0];
  if (STRONG.test(verb)) return !strongExempt(verb, rest);
  if (!WEAK.test(verb)) return false;
  switch (verb) {
    case 'tell': return !/^\s+(?:you|me|us|a|an|some|one|the\s+truth|stories|jokes)\b/i.test(rest); // "tell her" relays a message
    case 'let': return /^\s+(?:\w+\s+){1,2}know\b/i.test(rest) && !/^\s+me\s+know\b/i.test(rest); // "let your son know"
    case 'note': case 'write': return /^\s+(?:that|it|this)?\s*down\b/i.test(rest);
    case 'reach': return /^\s+out\b/i.test(rest);
    case 'see': return /^\s+what\s+I\s+can\s+do\b/i.test(rest);
    case 'help': return ANY_ACT.test(clause.split(/\b(?:if|when)\b/)[0]) && !/^\s+(?:you\s+)?(?:explain|understand|think|decide|choose|figure)\b/i.test(rest);
    case 'keep': return /^\s+(?:that|it|this)\s+in\s+mind\b/i.test(rest);
    case 'take': return /^\s+care\s+of\s+(?:it|that|this|them)\b/i.test(rest);
    case 'do': case 'handle': case 'sort': return /^\s+(?:that|it|this)\b/i.test(rest) && !/^\s+(?:that|it|this)\s+(?:way|again)\b/i.test(rest);
    default: return SOON.test(clause);
  }
}
const LEAD = /\b(?:I\s*'ll|I\s+will|I\s+shall|I\s*'m\s+(?:going\s+to|gonna)|I\s+am\s+(?:going\s+to|gonna)|let\s+me|allow\s+me\s+to)\b|\b(I\s*'d|I\s+would)\s+(?:be\s+(?:glad|happy|delighted|pleased)\s+to|love\s+to|like\s+to)\b/gi;
const YES_CAN = /(?:^|[.!?,;—]\s*)(?:yes|yeah|yep|yup|sure|of\s+course|absolutely|certainly|okay|ok|no\s+problem|definitely|right)\b[,!.—\s]*(?:I\s+(?:can|could|will)|I\s*'ll)\b/gi;
const I_CAN = /\bI\s+(?:can|could)\b(?!\s*not|'t)/gi;
const I_AM_ING = /\bI\s*(?:'m|\s+am)\s+(?:now\s+|just\s+|currently\s+|already\s+)?([a-z]+ing)\b([^.!?]*)/gi;
const LEAD_ING = /(?:^|[.!?,;:—]\s*)([A-Za-z]+ing)\b([^.!?]*)/g;
/** "setting" → set, "making" → make, "calling" → call. */
function strongGerund(ing: string): boolean {
  const stem = ing.toLowerCase().slice(0, -3);
  const forms = [stem, `${stem}e`, stem.replace(/(.)\1$/, '$1')];
  return forms.some((f) => f.length > 1 && STRONG.test(f));
}
const OUTSIDE_PAST = 'sent|called|rang|rung|phoned|dialled|dialed|texted|messaged|emailed|mailed|forwarded|ordered|booked|bought|purchased|paid|reserved|scheduled|reminded|alerted|notified|contacted|invited|arranged|cancell?ed|transferred|posted|delivered|informed|pinged';
const PAST_CLAIMS: RegExp[] = [
  new RegExp(String.raw`\bI\s*(?:'ve|\s+have|'d|\s+had)?\s+(?:just\s+|now\s+|already\s+)?(?:${OUTSIDE_PAST})\b`, 'i'),
  /\bI\s*(?:'ve|\s+have)\s+(?:just\s+|already\s+)?(?:told|let)\s+(?!you\b|me\b)\w+(?:\s+\w+)?(?:\s+know)?\b/i,
  new RegExp(String.raw`\b(?:has|have|was|were)\s+(?:just\s+|now\s+|already\s+)?been\s+(?:${OUTSIDE_PAST}|told|set|added|turned|switched)\b`, 'i'),
  // "Got it, the fan is off." — chat switched nothing.
  /(?:^|[.!?]\s*)(?:got\s+it|done|okay|ok|sure|there|all\s+set|alright)[,!.—\s]+(?:the|your)\s+(?:[\w'-]+\s+){0,3}(?:is|are)\s+(?:now\s+)?(?:on|off|set|booked|sent|done|locked|unlocked|playing|paused|muted)\b/i,
];
// Final review sim-1 C1 (port of main): a plain past tense ("I turned the
// lamp on"), a bare participle opener ("Turned the lamp on.", "Sure! Turning
// the lamp on."), a state that changed ("The lamp is on now", "It's on now",
// "Lamp on!") and "there's now …" are claims too — chat changed nothing.
const APP_PAST = 'turned|switched|set|played|added|dimmed|brightened|paused|stopped|started|muted|unmuted|moved|removed|deleted|created|built|drew|drawn|placed|inserted|changed|updated|connected|disconnected|opened|closed|renamed|resized|widened|extended|enlarged|fixed|saved|undid|adjusted|lowered|raised|installed|recorded|put|warmed|cooled|heated|locked|unlocked|skipped|queued|restarted|resumed';
const APP_GERUND = 'turning|switching|setting|playing|adding|dimming|brightening|pausing|stopping|starting|muting|unmuting|moving|removing|deleting|creating|building|drawing|placing|inserting|changing|updating|connecting|opening|closing|renaming|resizing|fixing|saving|undoing|adjusting|lowering|raising|putting|warming|cooling|heating|locking|unlocking|skipping|queueing|queuing|resuming';
/** The board's things, without bare pronouns ("Playing it safe" is talk). */
const THING = OBJ.replace(/^it\|that\|them\|/, '');
const STATE = 'on|off|playing|paused|muted|unmuted|dimmed|brighter|dimmer|louder|quieter|warmer|cooler|locked|unlocked|connected|disconnected|stopped|added|removed|set|ready|running|saved|updated|lowered|raised|changed|moved';
const S_START = String.raw`(?:^|[.!?,;:—–-]\s*)`;
const S_END = String.raw`\s*(?:[.!…]|$)`;
const STATE_CLAIMS: RegExp[] = [
  // "I turned the lamp on", "I just dimmed the lights" — not "I set out…", "I changed my mind", "I turned 80".
  new RegExp(String.raw`\bI\s+(?:just\s+|now\s+|already\s+|also\s+|quickly\s+)?(?:${APP_PAST})\b(?=(?:\s+(?:on|off|up|down|over|back|to))?(?:\s+(?:${DET}|both|all|every))*(?:\s+[\w’'-]+){0,2}?\s+(?:${THING})\b|\s+(?:it|them|that|this|everything|both|all)\s*(?:\b(?:on|off|up|down|over|back|for\s+you|now|to)\b|[.!…]|$))`, 'i'),
  // "I made the lamp brighter", "I got the lights on" — not "I made a mistake".
  new RegExp(String.raw`\bI\s+(?:just\s+|now\s+|already\s+)?(?:made|got|left|kept|had)(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${THING})\b`, 'i'),
  // "Turned the lamp on." / "Sure! Turning the lamp on." / "Playing your music."
  new RegExp(String.raw`${S_START}(?:just\s+|now\s+)?(?:${APP_PAST}|${APP_GERUND})(?:\s+(?:on|off|up|down|in|out|back|over|to))?(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${THING})\b`, 'i'),
  // "The lamp is on (now)", "Your lights are off now", "The lamp's on now", "Lamp is on."
  new RegExp(String.raw`(?:\b(?:the|your|my|both|all\s+(?:the|your|my))\s+(?:[\w’'-]+\s+){0,2}|${S_START}(?:next|both|all|this|that)?\s*(?:[\w’'-]+\s+)?)(?:${THING})\s*(?:is|are|['’]s|['’]re)\s+(?:now\s+|already\s+|currently\s+|still\s+|right\s+now\s+)?(?:${STATE}|at\s+\d+(?:\.\d+)?\s*(?:%|percent)|\d+(?:\.\d+)?\s*(?:%|percent))(?!\w)(?!\s*\?)`, 'i'),
  // Any named thing that is "now" in a changed state: "The heater is on now", "The music is now playing".
  new RegExp(String.raw`(?:\b(?:the|your|my)\s+(?:[\w’'-]+\s+){0,2}|${S_START})(?:${THING})\s*(?:is|are|['’]s|['’]re)\s+(?:now\s+[\w%]+|[\w%]+\s+now)\b`, 'i'),
  // "It's on now.", "It is on.", "They're off now." — the whole sentence, or with "now".
  new RegExp(String.raw`${S_START}(?:(?:now|and|so|okay|ok|alright|there|yes|yep|no|nope)[,!\s]+)?(?:it|they|everything|all|both)\s*(?:is|are|['’]s|['’]re)\s+(?:now\s+|already\s+|all\s+|currently\s+|still\s+)?(?:${STATE})(?:\s+(?:now|right\s+now|currently|at\s+the\s+moment|for\s+you))?${S_END}`, 'i'),
  new RegExp(String.raw`\b(?:it|they|everything)\s*(?:is|are|['’]s|['’]re)\s+(?:now\s+(?:${STATE})|(?:${STATE})\s+now)\b`, 'i'),
  // "Lamp on!", "Lights off." — a sentence that is only the new state.
  new RegExp(String.raw`${S_START}(?:the\s+|your\s+)?(?:[\w’'-]+\s+)?(?:${THING})\s*:?\s+(?:now\s+)?(?:${STATE}|up|down|at\s+\d+\s*(?:%|percent))(?:\s+now)?${S_END}`, 'i'),
  // "Okay, lamp turned on.", "Lights switched off for you."
  new RegExp(String.raw`${S_START}(?:the\s+|your\s+)?(?:[\w’'-]+\s+)?(?:${THING})\s+(?:${APP_PAST})\b(?:\s+(?:on|off|up|down))?(?:\s+for\s+you)?${S_END}`, 'i'),
  // "There's now a study next to bedroom 2."
  new RegExp(String.raw`\bthere\s*(?:['’]s|\s+is|\s+are|['’]re)\s+now\s+(?:(?:${DET})\s+)*(?:[\w’'-]+\s+){0,2}(?:${THING})\b`, 'i'),
  // "Done — …", "Done, the lamp is on", "Done: …"
  /(?:^|[.!?]\s*)(?:all\s+)?done\s*[—–:,-]/i,
  // Final review sim-2 §3: what a model writes when it says it acted.
  // "Just turned it on.", "Turning that on.", "Dimmed it for you." ("Playing it safe" is talk.)
  new RegExp(String.raw`${S_START}(?:just\s+|now\s+)?(?:${APP_PAST}|${APP_GERUND})(?:\s+(?:on|off|up|down))?\s+(?:it|them|that|this|those|these|everything|both|all)(?:\s+(?:back\s+)?(?:on|off|up|down|for\s+you|now|right\s+away))*${S_END}`, 'i'),
  // "Brightness set to 40%.", "Set to 40%.", "Lamp set to blue.", "Colour changed to purple." (not "I set to work").
  new RegExp(String.raw`${S_START}(?!(?:I|we|you|they)\s)(?:(?:the|your)\s+)?(?:[\w’'-]+\s+){0,2}?(?:now\s+)?(?:set|changed|dimmed|lowered|raised|turned\s+(?:up|down)|switched)\s+to\s+[\w%#’' -]{1,24}${S_END}`, 'i'),
  // "It seems to be on.", "The lamp appears to be off."
  new RegExp(String.raw`(?:\b(?:it|they)|\b(?:the|your|my)\s+(?:[\w’'-]+\s+)?(?:${THING}))\s+(?:seems?|appears?|looks?)\s+(?:to\s+be\s+)?(?:${STATE})\b(?!\s*\?)`, 'i'),
  // "The lamp should be on now."
  new RegExp(String.raw`(?:\b(?:it|they)|(?:${THING}))\s+(?:should|will|would|must)\s+(?:now\s+)?be\s+(?:now\s+)?(?:${STATE})(?:\s+now\b|${S_END})`, 'i'),
  // "Your plan now has a study.", "Your floor plan now shows two bedrooms."
  new RegExp(String.raw`\b(?:${THING})\s+now\s+(?:has|have|shows?|contains?|includes?|holds?)\b`, 'i'),
  // "Sure, done.", "Got it, done.", "It's done.", "All set!", "Will do.", "Taken care of.", "You got it!"
  new RegExp(String.raw`${S_START}(?:(?:it|that)\s*(?:['’]s|\s+is)\s+)?(?:all\s+)?done${S_END}`, 'i'),
  new RegExp(String.raw`${S_START}(?:you['’]re\s+|we['’]re\s+)?all\s+set${S_END}|${S_START}will\s+do${S_END}|${S_START}you\s+got\s+it${S_END}`, 'i'),
  new RegExp(String.raw`${S_START}(?:(?:it|that)\s*(?:['’]s|\s+is)\s+)?(?:been\s+)?taken\s+care\s+of${S_END}`, 'i'),
];
// The guard reads English. A claim in another Latin-script language is
// caught by its own few words (no general foreign-word list: "AI helps."
// must pass); a reply in another script cannot be read at all, see readable().
const FOREIGN_CLAIMS = /\b(?:he|ha|hemos|has|j['’]ai|ai|avons|habe|hab|haben|ho|abbiamo|eu|já)\s+(?:\p{L}+\s+){0,3}?(?:encendid[oa]s?|apagad[oa]s?|puesto|añadido|cambiado|allumée?s?|éteinte?s?|ajoutée?s?|mise?|eingeschaltet|ausgeschaltet|angemacht|ausgemacht|hinzugefügt|acces[oa]|spent[oa]|aggiunt[oa]|liguei|desliguei|acendi|apaguei)(?!\p{L})|\b(?:está|están|est|sont|ist|sind|è|sono)\s+(?:ahora\s+|maintenant\s+|jetzt\s+|ora\s+)?(?:encendid[oa]s?|apagad[oa]s?|allumée?s?|éteinte?s?|an|aus|eingeschaltet|ausgeschaltet|acces[oa]|spent[oa])(?!\p{L})|\b(?:listo|hecho|fait|erledigt|fatto|pronto)\s*[,.!]/iu;
/** True when the guard can read the reply: most of its letters are plain
 *  Latin (a name restored in another script is fine). */
export function readable(text: string): boolean {
  const letters = String(text ?? '').match(/\p{L}/gu) ?? [];
  if (!letters.length) return true;
  if (letters.filter((c) => /[A-Za-zÀ-ɏ]/.test(c)).length / letters.length >= 0.75) return true;
  // Final review sim-2 §3: "Hi ಅಮ್ಮ!", "ಧನ್ಯವಾದ means thank you." — at most two
  // words in another script, and no more of them than English words.
  const words = String(text ?? '').split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const other = words.filter((w) => /[^\P{L}A-Za-zÀ-ɏ]/u.test(w)).length;
  return other <= 2 && words.length - other >= other;
}
/** A sentence that only shows her how to ask ("…if you say 'turn on the lamp'"). */
const HOW_TO_ASK = /\bif\s+you\s+(?:say|ask|tell\s+me)\s*[,:]?\s*["“'‘]/i;
/** The extra checks: true when any first-person claim of an action is in the text. */
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
    if (w && OUTSIDE_ONLY.test(w[1]) && !/^remember$/i.test(w[1])) return true;
  }
  // "I'm calling her now", "I'm setting a timer for ten minutes"
  for (const m of t.matchAll(I_AM_ING)) if (strongGerund(m[1]) && SOON.test(m[2])) return true;
  // "Calling your daughter right away." / "Sure — sending it now."
  for (const m of t.matchAll(LEAD_ING)) if (strongGerund(m[1]) && SOON.test(m[2])) return true;
  // "right away" with no "you" before it in its sentence ("You should rest right away" passes).
  for (const s of t.split(/(?<=[.!?])\s+/)) {
    const i = s.search(/\b(?:right|straight)\s+away\b/i);
    if (i >= 0 && !/\byou\b/i.test(s.slice(0, i))) return true;
  }
  if (PAST_CLAIMS.some((re) => re.test(t))) return true;
  if (STATE_CLAIMS.some((re) => re.test(t))) return true;
  if (assertsThingState(t)) return true;
  if (FOREIGN_CLAIMS.test(t)) return true;
  if (/(?:^|[.!?,;—]\s*)on\s+it\s*(?:[.!]|$)/i.test(t)) return true;
  return false;
}
/** Sentences that only teach her what to say are not judged. */
const judged = (t: string): string => claimText(t.split(/(?<=[.!?])\s+/).filter((s) => !HOW_TO_ASK.test(s)).join(' '));

// ── What may be a claim (final review sim-2 §3) ───────────────────────────
// A claim ASSERTS a state. A question, a condition ("If the lamp is off, tap
// its tile"), a negated ability or knowledge ("I can't see whether…"),
// uncertainty ("Maybe it's off"), a general truth ("Turning off lights saves
// energy", "…in most homes"), a reaction to what she said ("I'm glad the lamp
// is on for you!") and make-believe are not, so those clauses are not judged.
const NOT_CLAIM_CLAUSE: RegExp[] = [
  // An instruction to HER ("Tap the lamp tile", "Say lamp on", "You can ask me…").
  /^\s*(?:(?:just|please|then|so|now|and|or|go\s+ahead\s+and)\s+)*(?:tap|press|say|try|use|check|look|ask|remember|turn|switch|put|make|open|close|play|pause|dim|pick|choose|hold|point|drag|wait|give|keep|take|read|see|click|select|speak|go|show|add|move|drink|rest)\b(?!\s+to\b)/i,
  /^\s*(?:(?:and|so|but)\s+)?you\s+(?:can|could|may|might|should|will\s+need\s+to)\b/i,
  /^\s*(?:and\s+|but\s+|so\s+)?(?:if|when|whenever|whether|once|unless|until|while|before|after)\b/i,
  /^\s*(?:(?:sorry|unfortunately|honestly|but|and|so|oh|hmm)[\s,!]+)*I\s*(?:can['’]?t|cannot|can\s+not|could\s*n['’]?t|could\s+not|am\s+not|['’]m\s+not|am\s+unable|['’]m\s+unable|don['’]?t|do\s+not|didn['’]?t|did\s+not|haven['’]?t|have\s+not|have\s+no|never)\b/i,
  /\b(?:might|may|maybe|perhaps|possibly|not\s+sure|unsure|I\s+think|I\s+guess|I\s+believe|probably|no\s+idea)\b/i,
  /\b(?:usually|typically|generally|normally|often|sometimes|in\s+most\s+homes|most\s+people|many\s+people|at\s+night)\b/i,
  /^\s*(?:(?:great|good|nice|wonderful|oh|aw+|lovely)[\s,!]+)*(?:I\s*['’]m\s+|I\s+am\s+)?(?:so\s+|really\s+|very\s+)?(?:glad|happy|pleased|relieved)\b(?!\s+to\b(?!\s+hear))/i,
  /\bin\s+(?:my|your)\s+(?:imagination|head|mind|dreams?)\b|\bin\s+(?:the|a|this)\s+(?:story|song|poem|joke|game)\b/i,
  /\bready\s+when(?:ever)?\s+you(?:['’]re|\s+are)\b/i,
  // A gerund that is the subject of a general truth ("Dimming the lights helps you sleep").
  /^\s*(?![A-Za-z]*thing\b)[A-Za-z]+ing\s+(?!(?:is|are|was|were)\b)(?=[^.!?]*\b(?:can|could|will|would|should|is|was|helps?|saves?|makes?|lifts?|keeps?|gives?|creates?|tends?|works?|uses?|costs?|means?|improves?|reduces?|brings?|feels?|sounds?|looks?)\b)/i,
];
// The broad rule, per clause (after claimText took out questions,
// conditions, "I can't…", instructions to her and the rest): a clause that
// names a thing of the app together with a state, action or result word is a
// claim — chat can see and change none of them. And a pronoun that was
// switched, dimmed or set ("I dimmed it a little", "Changed it to daylight").
const APP_NOUN = /\b(?:lamps?|lights?|bulbs?|speakers?|music|songs?|tracks?|playlists?|volume|brightness|colou?rs?|gimbals?|stand|camera|boards?|tiles?|plans?|floor\s*plans?|rooms?|bed\s*rooms?|kitchens?|bath\s*rooms?|stud(?:y|ies)|dashboards?|language|kannada|phones?|scenes?|modes?|heat(?:er|ing)|fans?)\b/i;
const RESULT_WORD = new RegExp(String.raw`\b(?:turned|switched|changed|added|moved|removed|deleted|saved|built|updated|connected|paired|opened|closed|dimmed|brightened|lowered|raised|muted|unmuted|paused|resumed|stopped|skipped|pointed|playing|following|tracking|glowing|went|came|rebuilt|now|ready|done(?!\s+(?:by|from|with)\b)|set\s+(?:to|up)|at\s+(?:full|max(?:imum)?|min(?:imum)?|\d+(?:\.\d+)?\s*(?:%|percent))|(?:has|have|had|was|were)\s+been\s+\w+ed|(?:up|down|back)\s+(?:a\s+(?:notch|bit|little)|again))\b|\b(?:is|are|['’]s|['’]re|now|made|got|turned|went|it)\s+(?:(?:a\s+)?(?:bit|little|lot|much)\s+)?(?:brighter|dimmer|warmer|cooler|louder|quieter|softer|bigger|larger|smaller|wider)\b|\b(?:brighter|dimmer|warmer|cooler|louder|quieter|softer|bigger|larger|smaller|wider)\s+(?:now|for\s+you)\b|:\s*\d+\s*(?:%|percent)|\b(?:volume|brightness|music|lights?|lamps?|it|them|back|way|all)\s+(?:up|down|back\s+on)(?=\s*(?:[.!…]|$))|\bback\s+(?:up|on)(?=\s*(?:[.!…]|$))|\b(?:brighter|dimmer|warmer|cooler|louder|quieter|softer)\s+(?:light|lights|lamp|music|volume|colou?r)\s*$|^\s*now\s+playing\b|(?:\b(?:is|are|['’]s|['’]re|now|to)\s+|:\s*)(?:open|set|blue|red|green|purple|orange|yellow|pink|white|warm\s+white|cool\s+white|daylight)\b|\b(?:on|off|out)(?=\s*(?:[.!…:]|$|now\b|for\s+you\b|again\b|already\b|in\s+a\s+(?:second|moment|minute)\b|and\b))`, 'i');
const PRONOUN_ACTED = /\b(?:turned|switched|dimmed|brightened|changed|set|paused|muted|played|stopped|lowered|raised|put)\s+(?:it|them|everything|both|all)\b(?!\s+(?:over|around|aside|badly|simply|clumsily|safe|right|straight|across|into\s+words|this\s+way|that\s+way|another\s+way))|\bmade\s+(?:it|them|everything)\s+(?:a\s+(?:bit|little)\s+)?(?:brighter|dimmer|warmer|cooler|louder|quieter|softer|bigger|smaller|blue|red|green|purple)\b/i;
const PRONOUN_STATE = new RegExp(String.raw`\b(?:it|they|everything|both|all)\s*(?:is|are|['’]s|['’]re|has\s+been|have\s+been)\s+(?:now\s+|all\s+|already\s+|still\s+|currently\s+)?(?:switched|turned|dimmed|paused|muted|playing|brighter|dimmer|warmer|cooler|louder|quieter|at\s+\d|(?:on|off)(?=\s*(?:[.!…]|$|now\b|for\s+you\b|right\s+now\b)))`, 'i');
function assertsThingState(text: string): boolean {
  // "can be changed with…" says what is possible, not what happened.
  const t = text.replace(/\b(?:can|could|may|might)\s+(?:also\s+)?be\s+\w+/gi, ' ');
  for (const clause of t.split(/[.!?…;,—–]+/)) {
    if (APP_NOUN.test(clause) && RESULT_WORD.test(clause)) return true;
    if (PRONOUN_ACTED.test(clause) || PRONOUN_STATE.test(clause)) return true;
  }
  return /(?:^|[.!?,;:—–]\s*)(?:finished|sorted|complete|all\s+good\s+to\s+go)\s*(?:[.!…]|$)/i.test(t);
}

/** The reply with every sentence or clause that cannot be a claim taken out:
 *  a question goes whole; a condition, negation, uncertainty or general truth
 *  goes clause by clause, and a condition after a clause is cut off it
 *  ("Check whether the lamp is on" → "Check"). */
export function claimText(text: string): string {
  // What she could say, quoted, is an example, never a claim ('say "lamp on"').
  const unquoted = String(text ?? '').replace(/["“][^"”]*["”]|‘[^’]*’|(?<!\w)'[^']*'(?!\w)/g, '…');
  const sentences = unquoted.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) ?? [];
  const out: string[] = [];
  for (const sentence of sentences) {
    if (/\?\s*["'”’)\]]*\s*$/.test(sentence)) continue;
    const parts = sentence.split(/([,;:—–]\s*|\s+-\s+)/);
    let kept = '';
    for (let i = 0; i < parts.length; i += 2) {
      const clause = parts[i] ?? '';
      const sep = parts[i + 1] ?? '';
      if (NOT_CLAIM_CLAUSE.some((re) => re.test(clause))) {
        // A dropped clause keeps the sentence's end, so the clause before it still ends a sentence.
        const end = /[.!…]+["'”’)\]]*\s*$/.exec(clause)?.[0] ?? '';
        kept += end ? (kept ? end : '') : '';
        continue;
      }
      kept += clause.replace(/\s+\b(?:if|whether|when|whenever|unless|once)\b[^.!?…]*/i, '') + sep;
    }
    out.push(kept);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}


/** True when the reply promises (or claims) an action chat cannot take. */
export function promisesAction(reply: string, complete = true): boolean {
  const t = judged(String(reply ?? ''));
  return PROMISES.some((re) => re.test(t)) || claimsAnyAction(t, complete);
}
/** The reply as it may be shown and spoken: an action promise is replaced
 *  by the honest line, everything else passes unchanged. */
export function promiseGuard(reply: string, asked = ''): { reply: string; replaced: boolean } {
  // A reply the guard cannot read is never passed on as it is.
  if (!readable(reply)) return { reply: cantActLine(asked, reply), replaced: true };
  return promisesAction(reply) ? { reply: cantActLine(asked, reply), replaced: true } : { reply, replaced: false };
}

/** A clause that could still turn into a promise once its sentence ends. */
const RISKY = new RegExp(String.raw`\bI\s*(?:['’]ll|['’]d|['’]m|will|shall|would|can|could|am)\b|\blet\s+me\b|\ballow\s+me\b|\b(?:right|straight)\s+away\b|\bon\s+it\b|^\s*[A-Za-z]+ing\b|^\s*(?:yes|yeah|yep|yup|sure|of\s+course|absolutely|certainly|okay|ok|no\s+problem|definitely|right)\b|\b(?:I|let\s+me|allow\s+me)\b[^.!?]*\b(?:${ACT}|${ACTED}|${ACTING}|do|handle|got|on)\b|^\s*(?:${ACTING})\b|\b(?:is|are)\s+now\b|\b(?:has|have)\s+been\b|\b(?:one|a|just\s+a)\s+(?:moment|second|sec)\b|\bhang\s+on\b|\bbear\s+with\s+me\b|\b(?:is|are|['’]s|['’]re)\s+(?:now\s+)?(?:${STATE})\b|^\s*(?:${APP_PAST}|${APP_GERUND})\b|\bI\s+(?:${APP_PAST}|made|got|left|kept|had)\b|\bthere\s*(?:['’]s|\s+is|\s+are)\s+now\b|(?:${THING})\s+(?:${STATE}|${APP_PAST})\b`, 'i');
/** While a reply streams: the part that may already be shown and spoken —
 *  whole clauses only, and a clause that might become a promise ("I'll add,")
 *  is held until its sentence has ended and passed the guard. null = the
 *  reply has promised an action: show and say none of it. */
export function guardSafePrefix(full: string): string | null {
  const t = String(full ?? '');
  // A word still being written ("I will b…") is not judged until it is whole.
  const whole = t.replace(/[\p{L}\p{M}’'-]+$/u, '');
  // A reply the guard cannot read (another script) is held whole: the end
  // of the turn decides (promiseGuard replaces it).
  if (!readable(whole)) return '';
  if (promisesAction(whole, false)) return null;
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
