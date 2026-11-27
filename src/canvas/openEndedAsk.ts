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
export const OPEN_ENDED_INSTRUCTION = 'You can only chat; you never change boards, devices or plans, or call, message, order, book or remind anyone, so never say you will or did, nor what state a device is in. Reply in English: one or two short, friendly sentences, no emoji.';

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
/** Up to two adverbs between "I've" / "I" and the verb: "I've also paused it", "I've now switched everything off". */
const ADV = String.raw`(?:(?:just|now|already|also|since|indeed|finally|really|even|then|actually|quickly|gently|successfully|[a-z]+ly)\s+){0,2}`;
const OBJ_PHRASE = String.raw`(?:\s+(?:on|off|up|down|in|out|back|over))?(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${OBJ})\b`;
const OBJ_ONLY = String.raw`(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${OBJ})\b`;
const FUTURE = String.raw`\b(?:I\s*(?:['’]ll|\s+will|\s+shall|['’]m\s+going\s+to|\s+am\s+going\s+to|['’]m\s+gonna|['’]d\s+(?:be\s+(?:glad|happy|delighted)\s+to|love\s+to)|\s+would\s+(?:be\s+(?:glad|happy|delighted)\s+to|love\s+to)|\s+can)|let\s+me|allow\s+me\s+to)\s+(?:go\s+ahead\s+and\s+|now\s+|just\s+|quickly\s+)?`;
const PROMISES: RegExp[] = [
  new RegExp(String.raw`${FUTURE}(?!put\s+it\s+(?:this|that|another)\s+way)(?:${ACT})${OBJ_PHRASE}`, 'i'), // "Let me put it this way" is talk
  new RegExp(String.raw`${FUTURE}(?:do|handle|take\s+care\s+of|sort\s+out)\s+(?:that|it|this)\b`, 'i'),
  new RegExp(String.raw`\bI\s*(?:['’]ll|\s+will)\s+get\s+(?:it|that|this|them)\s+(?:sorted|done|fixed|added|set\s+up|ready|going|moving|changed)\b`, 'i'),
  new RegExp(String.raw`\b(?:I|we)\s*(?:['’]ve|\s+have)\s+${ADV}(?:${ACTED})(?:${OBJ_PHRASE}|\s+everything\b)`, 'i'),
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
const APP_ACT = 'add|make|create|build|draw|place|insert|change|move|remove|delete|turn|switch|set|open|close|update|connect|start|stop|play|pause|dim|brighten|widen|resize|rename|extend|enlarge|fix|save|undo|put|get|install|adjust|lower|raise|mute|unmute|record';
const OUTSIDE = 'call|ring|phone|dial|text|message|email|e-mail|mail|send|forward|order|book|buy|purchase|pay|reserve|schedule|remind|alert|notify|contact|invite|arrange|cancel|transfer|post|deliver|fetch|drive|cook|clean|lock|unlock|remember|ping|inform|warm|cool|heat';
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
    // "I'll warm up to the idea", "I'll warm to it", "I'll cool off and rest" are talk; "warm up the room" is not (sim-main 0159aad).
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
  new RegExp(String.raw`\bI\s*(?:'ve|\s+have|'d|\s+had)?\s+${ADV}(?:${OUTSIDE_PAST})\b`, 'i'),
  /\bI\s*(?:'ve|\s+have)\s+(?:just\s+|already\s+)?(?:told|let)\s+(?!you\b|me\b)\w+(?:\s+\w+)?(?:\s+know)?\b/i,
  new RegExp(String.raw`\b(?:has|have|was|were)\s+(?:just\s+|now\s+|already\s+)?been\s+(?:${OUTSIDE_PAST}|told|set|added|turned|switched)\b`, 'i'),
  // "Got it, the fan is off." — chat switched nothing.
  /(?:^|[.!?]\s*)(?:got\s+it|done|okay|ok|sure|there|all\s+set|alright)[,!.—\s]+(?:the|your)\s+(?:[\w'-]+\s+){0,3}(?:is|are)\s+(?:now\s+)?(?:on|off|set|booked|sent|done|locked|unlocked|playing|paused|muted)\b/i,
];
// Final review C1: a plain past tense ("I turned the lamp on"), a bare
// participle opener ("Turned the lamp on.", "Sure! Turning the lamp on.") and
// a state that changed ("The lamp is on now", "Done — …") are claims too.
const APP_PAST = 'turned|switched|set|played|added|dimmed|brightened|paused|stopped|started|muted|unmuted|moved|removed|deleted|created|built|drew|drawn|placed|inserted|changed|updated|connected|disconnected|opened|closed|renamed|resized|widened|extended|enlarged|fixed|saved|undid|adjusted|lowered|raised|installed|recorded|put|warmed|cooled|heated|locked|unlocked|skipped|queued|restarted|resumed';
const APP_GERUND = 'turning|switching|setting|playing|adding|dimming|brightening|pausing|stopping|starting|muting|unmuting|moving|removing|deleting|creating|building|drawing|placing|inserting|changing|updating|connecting|opening|closing|renaming|resizing|fixing|saving|undoing|adjusting|lowering|raising|putting|warming|cooling|heating|locking|unlocking|skipping|queueing|queuing|resuming';
/** The board's things, without bare pronouns ("Playing it safe" is talk). */
const THING = OBJ.replace(/^it\|that\|them\|/, '');
const STATE = 'on|off|playing|paused|muted|unmuted|dimmed|brighter|dimmer|louder|quieter|warmer|cooler|locked|unlocked|connected|disconnected|stopped|added|removed|set|ready';
/** The states any named thing may claim ("the heater is on now"): no
 *  comparatives ("the weather is warmer now" is talk). */
const STATE_ONOFF = 'on|off|playing|paused|muted|unmuted|locked|unlocked|connected|disconnected|stopped|added|removed|set|ready';
/** A state that ends its clause ("on now.", "on for you", "off!"). */
const STATE_END = String.raw`(?:\s+(?:now|already|for\s+you|again))*\s*(?:[.!,;—–]|$)`;
const STATE_CLAIMS: RegExp[] = [
  // "I turned the lamp on", "I just dimmed the lights" — not "I set out…", "I changed my mind", "I turned 80".
  new RegExp(String.raw`\bI\s+${ADV}(?:${APP_PAST})\b(?!\s+(?:out|to|my\s+mind|\d+|[a-z]+ing)\b)`, 'i'),
  // "Turned the lamp on." / "Sure! Turning the lamp on." / "Switched off the fan for you."
  new RegExp(String.raw`(?:^|[.!?,;:—–-]\s*)(?:${APP_PAST}|${APP_GERUND})(?:\s+(?:on|off|up|down|in|out|back|over))?(?:\s+(?:${DET}))*(?:\s+[\w’'-]+)?\s+(?:${THING})\b`, 'i'),
  // "The lamp is on (now)", "Your lights are off now", "The lamp's on now", "Lamp is on."
  new RegExp(String.raw`(?:\b(?:the|your|my)\s+(?:[\w’'-]+\s+){0,2}|(?:^|[.!?,;:—]\s*))(?:${THING})\s*(?:is|are|['’]s|['’]re)\s+(?:now\s+|already\s+)?(?:${STATE})\b(?!\s*\?)`, 'i'),
  // Any named thing that is "now" in a changed state: "The heater is on now", "The music is now playing".
  new RegExp(String.raw`\b(?:the|your|my)\s+(?:[\w’'-]+\s+){1,3}?(?:is|are|['’]s|['’]re)\s+(?:now\s+(?:${STATE_ONOFF})|(?:${STATE_ONOFF})\s+now)\b`, 'i'),
  // "Done — …", "Done, the lamp is on", "Done: …"
  /(?:^|[.!?]\s*)(?:all\s+)?done\s*[—–:,-]/i,
  // Final review 2. A pronoun in a changed state, ending its clause: "It's on
  // now.", "It is on." — not "It's on my list", "If it's off, tap it".
  new RegExp(String.raw`(?<!\b(?:if|when|whether|unless|once)\s+)\b(?:it|everything)\s*(?:is|'s)\s+(?:now\s+|all\s+)?(?:${STATE})${STATE_END}`, 'i'),
  // Verbless: "Lamp on!", "Lights on for you.", "Lamp: on."
  new RegExp(String.raw`(?:^|[.!?,;—–]\s*)(?:(?:okay|ok|sure|alright|done|there)[,!\s—–]+)?(?:the\s+|your\s+)?(?:${THING})\s*:?\s+(?:on|off)${STATE_END}`, 'i'),
  // "Okay, lamp turned on." — a thing opening its clause with a past verb.
  new RegExp(String.raw`(?:^|[.!?,;:—–]\s*)(?:the\s+|your\s+)?(?:${THING})\s+(?:${APP_PAST})\b(?!\s+(?:out|to|into)\b)`, 'i'),
  // Passive: "The fan was switched off.", "The lamp got turned on."
  new RegExp(String.raw`\b(?:${THING})\s+(?:was|were|got|has\s+been|have\s+been)\s+(?:just\s+|now\s+|already\s+)?(?:${APP_PAST})\b`, 'i'),
  // "I made the lamp brighter.", "I've got the lamp on for you."
  new RegExp(String.raw`\bI\s*(?:'ve|\s+have)?\s+(?:just\s+|now\s+|already\s+)?(?:made|got|gotten|had)\s+(?:the|your|my)\s+(?:[\w'-]+\s+){0,2}?(?:${THING})\s+(?:${STATE})\b`, 'i'),
  // "I did turn on the lamp." — not "I did think so".
  new RegExp(String.raw`\bI\s+${ADV}did\s+${ADV}(?:turn|switch|set|dim|brighten|play|add|start|stop|connect|open|close|move|remove|change|put|make|build|draw)${OBJ_PHRASE}`, 'i'),
  // "Your lamp should be on now."
  new RegExp(String.raw`\b(?:${THING}|it)\s+(?:should|must)\s+(?:now\s+)?be\s+(?:now\s+)?(?:${STATE})${STATE_END}`, 'i'),
  // "There's now a study next to bedroom 2." — not "There's now a chance of rain".
  new RegExp(String.raw`\bthere\s*(?:'s|\s+is|\s+are|'re)\s+now\s+(?:(?:${DET})\s+)*(?:[\w'-]+\s+)?(?:${THING})\b`, 'i'),
];
// ── State assertions (final review 3) ─────────────────────────────────────
// One rule instead of a phrase list: a sentence that ASSERTS a current or
// changed state of a device, board, tile, plan, room, music, volume,
// brightness, colour or mode is a claim — chat changed nothing and cannot see
// the devices. Only declaratives count: a question, a condition ("if the lamp
// is off, tap its tile"), a wish or feeling ("I'm glad it's brighter"), an
// instruction and a quoted example are not claims.
const THING2 = `${THING}|volume|brightness|colou?r|modes?|timer|alarm|reminder|message|text|e-?mail|playlist|status|state|everything`;
const COLOUR = 'red|orange|yellow|green|blue|purple|violet|pink|white|warm\\s+white|cool\\s+white|daylight|teal|cyan|magenta|amber';
const SCENE = 'sunset|party|relax|focus|cozy|cosy|night\\s+light|reading|ocean|romance|fireplace|forest|candlelight|movie|bedtime';
const PRED_DEV = String.raw`on|off|out|up|down|playing|paused|muted|unmuted|dimmed|brighter|dimmer|louder|quieter|softer|warmer|cooler|bigger|smaller|wider|ready|updated|saved|added|created|set|connected|done|at\s+(?:full|max(?:imum)?|half|\d+)\S*(?:\s+(?:brightness|volume|percent|%))?|\d+\s*%|\d+|${COLOUR}|in\s+(?:[\w-]+\s+){1,2}mode|(?:${SCENE})(?:\s+(?:scene|mode))?|on\s+(?:the|your)\s+(?:board|dashboard|plan|canvas)`;
const PRED_PRON = 'on|off|out|brighter|dimmer|louder|quieter|softer|warmer|cooler|playing|paused|muted|done|set|ready|both\\s+on|both\\s+off|all\\s+(?:on|off)';
const BE = String.raw`(?:is|are|'s|'re|was|were)(?:\s+(?:now|already|both|all|still|just|currently))*`;
const CHANGE = String.raw`(?:now\s+|just\s+)?(?:came|went|switched|turned|glows|is\s+glowing|looks|got|has\s+gone|has\s+come)`;
const END = String.raw`(?:\s+(?:now|already|again|for\s+you|both|too|successfully|here|right\s+now))*\s*(?:[.!,;—–]|$)`;
const PAST1 = `${APP_PAST}|made|changed|dimmed|started|sent|saved|updated|added|created|set`;
const NP = String.raw`(?:(?:the|your|my|both|all|all\s+the|every|each|a|new)\s+)*(?:[\w'-]+\s+){0,2}?(?:${THING2})`;
const ASSERT_RULES: RegExp[] = [
  // "Both lamps are on.", "The lamp came on.", "Volume's at 70 now.", "The lamp now glows blue."
  new RegExp(String.raw`(?:^|[,;—–:]\s*)(?:and\s+|now\s+)?${NP}\s*(?:${BE}|${CHANGE}|now)\s+(?:now\s+|to\s+)?(?:${PRED_DEV})${END}`, 'i'),
  // "They're on now.", "It's blue now.", "Everything is off."
  new RegExp(String.raw`(?:^|[,;—–]\s*)(?:and\s+|now\s+)?(?:they|it|everything|all\s+of\s+them|both\s+of\s+them)\s*${BE}\s+(?:(?:${PRED_PRON})${END}|(?:${COLOUR})\s+now\b)`, 'i'),
  // "Now it is blue." / "Now playing jazz." / "Now the lamp is on."
  /^now\s+(?:playing|it\s+is|it's|the\s+\w+)/i,
  // Verbless: "Lights out!", "✅ Lamp on", "lamp → on", "Lamp status: on", "Party mode on!", "All on!"
  new RegExp(String.raw`^[^\p{L}]*(?:the\s+|your\s+)?(?:[\w'-]+\s+)?(?:${THING2}|all)(?:\s+(?:status|state))?\s*(?::|→|->|=)?\s*(?:on|off|out|up|down|paused|playing)(?:\s+for\s+you)?\s*[.!]*\s*$`, 'iu'),
  // "Board saved.", "Timer set for 5 minutes.", "Colour changed to purple.", "Brightness set to 40%."
  new RegExp(String.raw`^(?:the\s+|your\s+|a\s+)?(?:new\s+)?(?:[\w'-]+\s+)?(?:${THING2}|board|plan|dashboard)\s+(?:${PAST1})(?:\s+(?:on|off|up|down))?(?:\s+(?:for|to|at|successfully)\b[^.!?]*)?\s*[.!]*$`, 'i'),
  // "Just turned it on.", "Made it brighter.", "Turning them off.", "Changed it to blue."
  new RegExp(String.raw`^(?:just\s+|now\s+|successfully\s+)?(?:${PAST1}|${APP_GERUND})\s+(?:(?:on|off|up|down)\s+)?(?:it|that|them|this|those|these|everything|both)\s+(?:on|off|up|down|out|brighter|dimmer|louder|softer|quieter|warmer|cooler|to\b|${COLOUR})`, 'i'),
  // "Turned the volume up.", "Switching the lights off."
  new RegExp(String.raw`^(?:just\s+)?(?:${PAST1}|${APP_GERUND})\s+(?:the|your|my|both)\s+(?:[\w'-]+\s+)?(?:${THING2})\s+(?:up|down|on|off|out)\b`, 'i'),
  // "I've set a reminder.", "I have sent the message."
  /\bI\s*(?:'ve|\s+have)\s+(?:just\s+|now\s+|already\s+)?(?:set|sent|saved|started|scheduled|created|made)\s+(?:a|an|the|your)\s+(?:timer|alarm|reminder|message|text|e-?mail|note)\b/i,
  // "Dimmed to 20%.", "Set to 40%.", "Switched to relax mode."
  new RegExp(String.raw`^(?:just\s+)?(?:${PAST1})\s+to\s+(?:\d+|(?:[\w-]+\s+){0,2}(?:mode|scene)|${COLOUR}|${SCENE})`, 'i'),
  // "Just switched off the lamp.", "Successfully dimmed the lamp."
  new RegExp(String.raw`^(?:just|successfully)\s+(?:${PAST1})\b`, 'i'),
  /\bsuccessful(?:ly)?\b/i,
  // "We turned the lamp off.", "Mendcraft has turned it on."
  new RegExp(String.raw`\b(?:we|mendcraft)\s*(?:'ve|\s+have|\s+has)?\s+${ADV}(?:${PAST1})\b(?!\s+(?:out|to\s+(?:be|go|see)|our\s+minds?|it\s+(?:through|work|happen|home))\b)`, 'i'),
  // Done-words said as the whole sentence.
  /^(?:you\s+got\s+it|will\s+do|sure\s+thing|(?:you'?re\s+|we'?re\s+|there,?\s+)?all\s+set|(?:that'?s\s+|it'?s\s+|all\s+)?taken\s+care\s+of|(?:it|that)\s*(?:'s|\s+is)\s+(?:all\s+)?(?:done|set|handled|sorted)|all\s+done(?:\s+here)?|done\s+and\s+done|finished|sorted|success|it\s+worked|mission\s+accomplished|consider\s+it\s+(?:handled|sorted)|saved|sent|updated|added)\s*[.!]*$/i,
  // "Blue it is.", "Warm white it is!"
  /^(?!(?:that|this|so|there|here|what|how|true|such|yes|indeed)\b)(?:[\w'-]+\s+){1,2}it\s+is\s*[.!]*$/i,
];
// ── Exemptions, per clause (final review 4) ─────────────────────────────
// A clause is exempt only by how IT starts: a condition that instructs her
// ("If the lamp is off, …"), "I can't / I'm not able to / I don't know …",
// an instruction to her ("tap the lamp tile"), something SHE did ("you set
// up…"), a feeling ("I'm glad…", "hope that helps"), a generic gerund
// ("Dimming the lights at night helps sleep"). A whole sentence is exempt
// only when it is a question. A trailing "hope that helps" or "when you
// asked" never exempts the clause that holds the claim.
const EXEMPT_CLAUSE = new RegExp([
  String.raw`^(?:if|when|whenever|whether|once|unless|until|in\s+case|before|after)\b`,
  String.raw`^(?:i\s+can'?t|i\s+cannot|i\s+can\s+only|i'?m\s+not\s+able|i\s+am\s+not\s+able|i\s+(?:don'?t|do\s+not)\s+know|i'?m\s+not\s+sure|i\s+am\s+not\s+sure|i\s+(?:don'?t|do\s+not)\s+have|i\s+have\s+no\s+way|not\s+sure|i\s+(?:can'?t|cannot)\s+(?:see|tell))\b`,
  String.raw`^(?:just\s+|please\s+)?(?:tap|press|use|say|try|drag|ask|open|pick|hold|click|choose|check|look|swipe|slide|go\s+to|point|wave|speak|keep|leave)\b`,
  // The past, not now: "Lamps were once lit with oil."
  String.raw`\b(?:was|were)\s+once\b|\bused\s+to\b|\bin\s+the\s+(?:past|old\s+days)\b`,
  // A purpose that leads into her instruction: "To turn the lamp on, say …".
  String.raw`^to\s+[a-z]+\b`,
  String.raw`^you\b(?!\s*(?:got\s+it|'?re\s+(?:all\s+)?(?:set|good\s+to\s+go)|are\s+(?:all\s+)?set))`,
  String.raw`^(?:i'?m|i\s+am|so|really)?\s*(?:glad|happy|delighted|pleased)\b|^(?:i\s+)?(?:hope|hopefully|wish)\b|^let\s+me\s+know\b`,
  String.raw`^my\s+favou?rite\b`,
  // Who she is (final review 5): "I'm Gemini Nano", "I run on device", "I can help you build boards".
  String.raw`^(?:i'?m|i\s+am|my\s+name\s+is|this\s+is)\s+(?:gemini|nano|mendcraft|google|an?\s+(?:[\w'-]+\s+){0,3}(?:model|assistant|helper|ai)|the\s+(?:[\w'-]+\s+){0,2}(?:assistant|helper|model))\b|^i\s+(?:run|work|live)\b|^i\s+can\s+help\s+(?:you\s+)?(?:with|build|make|create|draw|sketch|plan|design|write)\b`,
  // "I wouldn't know whether…", "I couldn't say".
  String.raw`^i\s+(?:wouldn'?t|couldn'?t|would\s+not|could\s+not)\s+(?:know|tell|say)\b`,
  // Her instruction: "Remember to turn the lamp off", "Don't forget…", "Make sure…", "For a new board, say …".
  String.raw`^(?:remember|don'?t\s+forget|do\s+not\s+forget)\s+to\b|^(?:make|be)\s+sure\s+(?:to\b|(?:that\s+)?(?:the|your)\s+[^,;]*\b(?:plugged|charged|connected|close|near|within|switched\s+on\s+at\s+the\s+wall)\b)|^never\b|^for\s+(?:a|an)\s+[\w'-]+(?:\s+[\w'-]+)?$`,
  // A definition: "Brightness is how much light…", "\"Paused\" means…", "Standby is when…".
  String.raw`^(?:"…"|[\w'-]+)\s+(?:means|refers\s+to|is\s+(?:when|how|what|where|the\s+(?:amount|measure|level|word|name)))\b`,
  // Lamps in general, not hers: "Most smart lamps can be dimmed", "Stage lights are dimmed before a play starts".
  String.raw`^(?:(?:most|many|some|all|old|smart|stage|street|traffic|fairy|festival|led|christmas|oil)\s+)*(?:lamps|lights|bulbs|speakers|candles)\b(?=[^]*\b(?:during|all\s+over|before|after|at\s+(?:night|dusk|dawn|bedtime)|every|usually|often|always|sometimes|can|could|may|might|waste|use|save|cost)\b)|^(?:most|many)\s+(?:[\w-]+\s+)?(?:lamps|lights|bulbs|speakers|people|homes)\b`,
  // A generic statement ("A lamp that is on all day uses more power") — not
  // one that says something changed ("A new tile is on…", "A room was added").
  String.raw`^(?:a|an)\s+(?![^,;]*\b(?:new|now|was|were|has\s+been|have\s+been|added|created|moved|removed|turned|switched)\b)`,
  // Advice: "around 70% brightness is comfortable".
  String.raw`^(?!(?:i|we)\b)[^]*\b(?:around|about|roughly|between|up\s+to)\s+\d+`,
  String.raw`\bin\s+my\s+(?:imagination|head|mind|dreams?)\b`,
  String.raw`^(?!(?:every|no|some|any)thing\b|morning|evening|ceiling)[a-z]+ing\b(?:\s+[\w'-]+){0,5}\s+(?:helps?|is|are|can|could|takes?|makes?|sets?|feels?|works?|keeps?|saves?|gives?|brings?|creates?|matters?)\b`,
].join('|'), 'i');
const CLAUSE_LEAD = /^(?:(?:okay|ok|sure(?!\s+thing)|yes|yeah|great|alright|absolutely|perfect|no\s+problem|got\s+it|and|so|well|but|also|then|there\s+(?:you|we)\s+(?:are|go)|here\s+you\s+go|all\s+good|sorted)\b[,!.—–\s]*)+/i;
function sentencesOf(t: string): string[] {
  return t.replace(/["“][^"”]*["”]/g, '"…"').split(/(?<=[.!?;])\s+/).map((x) => x.trim()).filter(Boolean);
}
/** The reply with its questions and exempt clauses taken out: what it asserts. */
function assertedText(t: string): string {
  const out: string[] = [];
  for (const sen of sentencesOf(t)) {
    if (/\?\s*["”')]*\s*$/.test(sen)) continue;
    // "… and I switched it off": a first-person or state clause after and / but / so is its own clause,
    // so an exemption for the first ("I'm Gemini Nano") never shields it.
    const parts = sen.split(/(\s*[,;:—–]\s*|\s+-\s+|\s+(?:and|but|so)\s+(?=(?:i|i'?ve|i'?m|we|it|they|everything|the|your|my|now)\b))/i);
    let kept = '';
    for (let i = 0; i < parts.length; i += 2) {
      const clause = parts[i].trim();
      const bare = clause.replace(CLAUSE_LEAD, '').trim();
      if (bare && EXEMPT_CLAUSE.test(bare)) continue;
      kept += (kept ? (parts[i - 1] ?? ' ') : '') + clause;
    }
    if (kept.trim()) out.push(kept.trim());
  }
  return out.join(' ');
}

// ── Thing + state (final review 4): conservative, high recall ─────────────
// Open chat cannot see or change anything, so a clause that names an app
// thing together with a state, action or result word is a claim.
const APP_THINGS = String.raw`lamps?|lights?|bulbs?|speakers?|music|songs?|tracks?|playlists?|jazz|radio|albums?|tunes?|volume|brightness|colou?rs?|gimbal|stand|camera|boards?|tiles?|plans?|floor\s*plans?|rooms?|stud(?:y|ies)|kitchens?|bath\s*rooms?|bed\s*rooms?|bedroom\s+\w+|balcon(?:y|ies)|halls?|dashboards?|canvas|kannada|hindi|english|language|phones?|scenes?|modes?|timers?|reminders?|alarms?|sliders?|buttons?|fans?|plugs?|devices?|tv`;
const NON_LOCATIVE = String.raw`(?!\s+(?:the|a|an|your|my|its|this|that|their|our|his|her|to|of|with|topic|track|duty|limits|guard|course|balance)\b)`;
const STATE_WORDS = new RegExp([
  String.raw`\b(?:on|off|(?<!turned\s)out)\b${NON_LOCATIVE}`,
  String.raw`\b(?:set|turned(?!\s+out\b)|switched|changed|added|moved|removed|deleted|created|updated|saved|pinned|unpinned|paired|connected|linked|muted|unmuted|paused|stopped|started|skipped|queued|dimmed|brightened|raised|lowered|lit|enabled|active|ready|done(?!\s+by)|handled|sorted|playing|running|following|glowing|shining|blasting|holding|showing|now|new|maximum|max|full|half|percent)\b`,
  String.raw`\btook\s+care\b|\btaken\s+care\b|\bwent\s+(?:up|down|off|out)\b|\bcame\s+on\b|\bat\s+\d+|\d+\s*%`,
  // A comparative is a change only when something says so ("is wider now", "made it larger").
  String.raw`\b(?:is|are|'s|'re|was|were|now|made|got|became|been)\b[^,;]*\b(?:brighter|dimmer|warmer|cooler|louder|quieter|softer|bigger|larger|wider|smaller|lower|higher)\b`,
].join('|'), 'i');
const THING_RE = new RegExp(String.raw`\b(?:${APP_THINGS})\b`, 'i');
const ACTION_PAST = 'turned|switched|dimmed|brightened|paused|muted|unmuted|skipped|stopped|started|changed|set|saved|added|moved|removed|pinned|connected|paired|updated|raised|lowered|queued|lit|done|sorted|handled|resumed|restarted|cleared|undone';
const CLAUSE_CLAIMS: RegExp[] = [
  // "Turned off, as you asked.", "Brightened it up.", "Switched on for you!"
  new RegExp(String.raw`^(?:just\s+|now\s+|all\s+)?(?:${ACTION_PAST})\b(?!\s+(?:\d|a|an|the|your|my|some|up|is|are|was|by|in)\b)`, 'i'),
  // "Off they go.", "On it goes."
  /^(?:on|off|up|down)\s+(?:they|it|we)\s+go(?:es)?\b/i,
  // A bare change word as the whole clause: "brighter", "all warmer now".
  /^(?:all\s+)?(?:brighter|dimmer|warmer|cooler|louder|quieter|softer|on|off)(?:\s+now)?$/i,
  // Out in the world: "Your table is booked for 8."
  /\b(?:is|are|was|were|has\s+been|have\s+been)\s+(?:now\s+|all\s+)?(?:booked|ordered|reserved|scheduled|cancell?ed|paid|delivered|sent|texted|emailed)\b/i,
  // "It has been switched off.", "They've both been dimmed."
  new RegExp(String.raw`\b(?:has|have|'s|'ve)\s+(?:\w+\s+)?been\s+(?:${ACTION_PAST}|${APP_PAST})\b`, 'i'),
  // "Both of them are off now.", "It's switched off."
  new RegExp(String.raw`\b(?:it|they|them|both|everything|all\s+of\s+them|both\s+of\s+them)\s*(?:is|are|'s|'re|seems?\s+to\s+be|appears?\s+to\s+be|looks?(?:\s+to\s+be)?)\s+(?:\w+\s+)?(?:on|off|out|playing|paused|muted|dimmed|switched\s+(?:on|off)|turned\s+(?:on|off))\b${NON_LOCATIVE}`, 'i'),
  // "I took care of the lights.", "I've gone ahead and dimmed the lights.", "I went ahead and…"
  new RegExp(String.raw`\b(?:i|we)\s*(?:'ve|\s+have|'d|\s+had)?\s+${ADV}(?:gone\s+ahead\s+and\s+|went\s+ahead\s+and\s+)?(?:${ACTION_PAST}|${APP_PAST}|took\s+care|handled|sorted|took)\b(?!\s+(?:out|to|my\s+mind|\d+|[a-z]+ing|the\s+page|a\s+corner|the\s+tables|over\s+a\s+new\s+leaf)\b)`, 'i'),
];
/** True when an asserted clause claims a state or an action on an app thing. */
function thingStateClaim(clause: string): boolean {
  // "Lights on Diwali": on + a name is a time or a place, not a state.
  const c = clause.replace(CLAUSE_LEAD, '').trim().replace(/\b(?:on|off)\s+(?=\p{Lu}\p{Ll})/gu, 'during ');
  if (!c) return false;
  if (THING_RE.test(c) && STATE_WORDS.test(c)) return true;
  return CLAUSE_CLAIMS.some((re) => re.test(c));
}
function clausesOf(t: string): string[] {
  return t.split(/[.!;]+\s*|\s*[,:—–]\s*|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
}
const LEAD_IN = CLAUSE_LEAD;
/** True when a sentence asserts a device / board state (see above). */
function assertsState(sentence: string): boolean {
  const s = sentence.replace(LEAD_IN, '').trim();
  if (!s) return false;
  return ASSERT_RULES.some((re) => re.test(s));
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
  // State claims are judged per sentence, never inside a question, a
  // condition or a wish ("If the lamp is off, tap its tile.").
  // A label and its value: "Lamp brightness: 40%", "Volume: 30%", "Music: paused".
  if (new RegExp(String.raw`(?:^|[.!;]\s*)(?:[\w'-]+\s+){0,2}(?:${APP_THINGS})\s*:\s*(?:\d+\s*%?|on|off|out|playing|paused|muted|ready|done|${COLOUR})\s*(?:[.!,;]|$)`, 'i').test(t)) return true;
  const asserted = assertedText(t);
  if (asserted && (STATE_CLAIMS.some((re) => re.test(asserted))
    || sentencesOf(asserted).some(assertsState)
    || clausesOf(asserted).some(thingStateClaim))) return true;
  if (/(?:^|[.!?,;—]\s*)on\s+it\s*(?:[.!]|$)/i.test(t)) return true;
  // Kannada in Latin letters (final review 5): "deepa on aagide", "volume kammi maadide".
  if (/\b(?:on|off|pause|play|start|stop|jaasti|jasti|kammi|kadime|full|mute|band)\s+(?:aagide|agide|aagtide|aagtaide|aaythu|aaytu|aayitu|aytu|maadide|madide|maadiddini|madiddini|maadiddene|maadidini|maadidene|maadiddeeni|maadde|madde)\b/i.test(t)) return true;
  return false;
}
/** Sentences that only teach her what to say are not judged. */
const judged = (t: string): string => whereItRuns(t).split(/(?<=[.!?])\s+/).filter((s) => !HOW_TO_ASK.test(s)).join(' ');
/** Final review 5: "on your device", "on-device", "in the cloud", "in your
 *  browser" say where the model runs, not what state a device is in. */
function whereItRuns(t: string): string {
  return t
    .replace(/\b(?:right\s+)?(?:here\s+)?(?:on|in|inside)\s+(?:your|this|the|my|a)\s+(?:own\s+)?(?:device|phone|laptop|computer|browser|tablet|machine|chrome)\b/gi, 'here')
    .replace(/\bon[-\s]device\b/gi, 'local')
    .replace(/\b(?:in|to|from)\s+the\s+cloud\b/gi, 'remotely');
}

// ── Non-English replies (final review C1b) ─────────────────────────────────
// The guard above can only read English. Chat is told to answer in English,
// and a reply that does not look English is never parsed: it is replaced
// whole by this fixed honest line. English replies (to any language) stay
// natural and every one of them still passes through the promise guard.
export const CHAT_ENGLISH_ONLY = 'I can only chat in English for now.';
/** Common function words of Spanish, French, German, Italian, Portuguese
 *  and Dutch that English does not use (so "a", "no", "me", "he", "has",
 *  "is", "in" are left out), plus the lamp words a foreign claim uses.
 *  Final review 2: short words English also writes ("AI", "LA", "EU", "en
 *  route", "pour", "ja", "du", "su", "est", "et al", "tu", "il", "le", "lo",
 *  "di", "des", "con", "sur", "gut", "wel", "pas") are left out too. */
const FOREIGN_WORDS = new Set(('el|los|las|del|que|y|un|una|unos|por|para|es|está|esta|estoy|estás|muy|pero|sí|gracias|hola|sus|como|más|ya|listo|hecho|claro|bien|aquí|también|les|vous|nous|elle|une|avec|dans|c\'est|oui|merci|bonjour|j\'ai|suis|der|das|und|ist|ich|habe|nicht|ein|eine|mit|auf|für|wir|danke|hallo|zu|che|sono|grazie|ciao|gli|è|não|obrigado|obrigada|olá|você|uma|em|het|een|ik|niet|encendido|encendida|encendí|apagado|apagada|lámpara|luz|luces|allumé|allumée|éteint|lampe|eingeschaltet|ausgeschaltet|accesa|acceso|spenta|ligada|ligado|aan|uit').split('|'));
const EN_WORDS = new Set(('i|i\'m|i\'ll|i\'d|i\'ve|you|you\'re|your|it|it\'s|is|are|was|be|am|the|of|and|to|that|this|what|how|can|would|will|for|with|my|we|not|have|has|do|there|here|so|just|like|all|about|at|on|or|but|if|she|her|good|nice|glad|happy|sorry|thanks|thank|hi|hello|hey|sure|yes|okay|me|a|an|let|make|fine|ok').split('|'));
/** Letters of a script other than Latin a short English reply may still
 *  carry: one restored name ("Hi ಅಮ್ಮ!"), never a sentence. */
const OTHER_SCRIPT_NAME_MAX = 12;
/** True when a reply reads as English: most of its letters are plain Latin
 *  (or a short English reply carries one or two words in another script,
 *  a name), and it does not have at least two different common foreign
 *  words outnumbering the English ones. */
export function looksEnglish(text: string): boolean {
  const t = String(text ?? '').replace(/[’‘]/g, "'");
  const letters = t.match(/\p{L}/gu) ?? [];
  if (!letters.length) return true;
  // Accented letters are Latin too ("Déjà vu!"): only another script counts against it.
  const ascii = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  // "Los Angeles", "Las Vegas", "El Niño", "San José": a place name, not Spanish.
  const words = t.replace(/\b(?:Los|Las|El|La|San|Santa|Del|De|Le|Les)\s+\p{Lu}[\p{L}'-]*/gu, ' ').toLowerCase().match(/[\p{L}]+(?:'[\p{L}]+)?/gu) ?? [];
  const latinWords = words.filter((w) => /[a-z]/.test(w));
  const en = latinWords.filter((w) => EN_WORDS.has(w)).length;
  if (ascii / letters.length < 0.75) {
    const other = letters.length - ascii;
    const otherWords = words.length - latinWords.length;
    if (other > OTHER_SCRIPT_NAME_MAX || otherWords > 2 || en === 0) return false;
  }
  const foreign = new Set(latinWords.filter((w) => FOREIGN_WORDS.has(w))).size;
  return foreign < 2 || foreign <= en;
}
/** While streaming: a reply whose foreign words still outnumber its English
 *  ones is not shown yet ("Hola," may be the start of a Spanish reply). */
function foreignSoFar(text: string): boolean {
  const words = String(text ?? '').replace(/[’‘]/g, "'").toLowerCase().match(/[\p{L}]+(?:'[\p{L}]+)?/gu) ?? [];
  const foreign = words.filter((w) => FOREIGN_WORDS.has(w)).length;
  return foreign > 0 && foreign > words.filter((w) => EN_WORDS.has(w)).length;
}

/** True when the reply promises (or claims) an action chat cannot take. */
export function promisesAction(reply: string, complete = true): boolean {
  const t = judged(String(reply ?? ''));
  return PROMISES.some((re) => re.test(t)) || claimsAnyAction(t, complete);
}
/** The reply as it may be shown and spoken: an action promise is replaced
 *  by the honest line, everything else passes unchanged. */
export function promiseGuard(reply: string, asked = ''): { reply: string; replaced: boolean } {
  if (!looksEnglish(reply)) return { reply: CHAT_ENGLISH_ONLY, replaced: true };
  return promisesAction(reply) ? { reply: cantActLine(asked, reply), replaced: true } : { reply, replaced: false };
}

/** A clause that could still turn into a promise once its sentence ends. */
const RISKY = new RegExp(String.raw`^\s*(?:no|nope|nah|well|hmm|oh|actually|so|great|perfect|alright|good|done|there|you(?:['’]re|\s+are)\s+all\s+set|all\s+(?:set|done)|sorted|finished|success|it\s+worked|mission\s+accomplished|as\s+(?:requested|you\s+asked)|here\s+you\s+(?:go|are)|voil[aà]|consider\s+it\s+done|and\s+done)\b[\s,!.—–-]*$|\bI\s*(?:['’]ll|['’]d|['’]m|will|shall|would|can|could|am)\b|\blet\s+me\b|\ballow\s+me\b|\b(?:right|straight)\s+away\b|\bon\s+it\b|^\s*[A-Za-z]+ing\b|^\s*(?:yes|yeah|yep|yup|sure|of\s+course|absolutely|certainly|okay|ok|no\s+problem|definitely|right)\b|\b(?:I|let\s+me|allow\s+me)\b[^.!?]*\b(?:${ACT}|${ACTED}|${ACTING}|do|handle|got|on)\b|^\s*(?:${ACTING})\b|\b(?:is|are)\s+now\b|\b(?:has|have)\s+been\b|\b(?:one|a|just\s+a)\s+(?:moment|second|sec)\b|\bhang\s+on\b|\bbear\s+with\s+me\b|\b(?:is|are|['’]s|['’]re)\s+(?:now\s+)?(?:${STATE})\b|^\s*(?:${APP_PAST}|${APP_GERUND})\b|\bI\s+(?:${APP_PAST})\b`, 'i');
/** While a reply streams: the part that may already be shown and spoken —
 *  whole clauses only, and a clause that might become a promise ("I'll add,")
 *  is held until its sentence has ended and passed the guard. null = the
 *  reply has promised an action: show and say none of it. */
export function guardSafePrefix(full: string): string | null {
  const t = String(full ?? '');
  // A word still being written ("I will b…") is not judged until it is whole.
  const whole = t.replace(/[\p{L}’'-]+$/u, '');
  // Not English (final review C1b): none of it is shown or spoken.
  if (!looksEnglish(whole)) return null;
  if (foreignSoFar(whole)) return '';
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
