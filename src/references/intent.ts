// Voice → reference-search intent (pure). English is the polished path; a few
// Kannada, Hindi, Spanish and Japanese keywords are recognised so a non-English
// request still reaches search (Gemini then turns it into a query). Grid
// navigation phrases only match while the results are on the canvas (or a
// real-browser tab is open), so they cannot steal "next" from music.

import type { GenerateKind, IntentContext, ReferenceIntent, SearchEngine, SearchIntent } from './types';

export function normUtterance(utterance: string): string {
  return utterance.trim().toLowerCase().replace(/[.!?।]+$/u, '').replace(/\s+/g, ' ');
}

const DEMO_PHRASES = /^(do\s+)?(the\s+)?(drawing references|find drawing references)(\s+please)?$/;

const SEARCH = /^(?:please\s+)?(?:(?:can\s+you|could\s+you|please)\s+)?(?:find|get|show|search(?:\s+for)?|look\s*up|give|fetch|bring)\s+(?:me\s+)?(?:(?:some|more|a\s+few)\s+)?(?:references?|pictures?|images?|photos?|pics?|drawings?)\s+(?:for|of|about|on)\s+(.+)$/;
const SEARCH_SHORT = /^(?:references?|pictures?|images?|photos?|pics?)\s+(?:for|of|about)\s+(.+)$/;
const SHOW_ME = /^show\s+me\s+(.+)$/;

// Inspirations, mockups, and “draw me a reference of …” (generate path).
const INSPIRE = /^(?:please\s+)?(?:(?:can\s+you|could\s+you)\s+)?(?:find|get|show|search(?:\s+for)?|give|fetch|bring|generate|make)\s+(?:me\s+)?(?:(?:some|more|a\s+few|a|an)\s+)?(?:landing\s+page\s+)?(?:inspirations?|ideas?|mockups?|wireframes?|layouts?|landing\s+pages?)\s+(?:for|of|about|on)?\s*(.+)$/;
const DRAW_ME = /^(?:please\s+)?(?:(?:can\s+you|could\s+you)\s+)?(?:draw|sketch|doodle)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:pose\s+)?(?:reference\s+)?(?:drawing\s+|sketch\s+|line\s*art\s+)?(?:of|for|showing)?\s*(.+)$/;
const POSE_REF = /^(?:please\s+)?(?:(?:can\s+you|could\s+you|find|show|get|give)\s+(?:me\s+)?)?(?:a\s+|an\s+|some\s+)?(?:pose\s+references?|line\s*art|reference\s+drawings?|sketch(?:es)?)\s+(?:of|for|showing)?\s*(.+)$/;

// Non-English cues that this is a picture-reference request (topic is refined later).
const OTHER_LANG = /(ಉಲ್ಲೇಖ|ಚಿತ್ರ|ಹುಡುಕು|संदर्भ|तस्वीर|चित्र|खोज|referencias?|fotos?|im[aá]genes?|busca|参考|画像|写真|探して)/u;

const MORE = /^(more|more\s+results|show\s+more|next\s+page|another\s+page)$/;
const PREV_PAGE = /^(previous\s+page|prev\s+page|last\s+page|go\s+back\s+a\s+page)$/;
const NEXT_CARD = /^(next|next\s+(one|card|picture|image|result)|the\s+next\s+one)$/;
const PREV_CARD = /^(previous|prev|last\s+one|the\s+previous\s+one|go\s+back)$/;
const PICK_THIS = /^(pick\s+(this|that|it)|this\s+one|that\s+one|select\s+(this|that|it)|choose\s+(this|that|it))$/;
const PLACE = /^(place\s+(it|this|that|them)?|put\s+it(\s+(here|there|on\s+(the\s+)?canvas))?|drop\s+it|add\s+it(\s+to\s+(the\s+)?canvas)?|stick\s+it(\s+here)?)$/;
const BIGGER = /^(bigger|make\s+it\s+bigger|larger|make\s+it\s+larger|zoom\s+in)$/;
const SMALLER = /^(smaller|make\s+it\s+smaller|tiny|make\s+it\s+tiny|zoom\s+out)$/;
const CLOSE = /^(close(\s+(the\s+)?(references?|grid|pictures?|results?|tab))?|dismiss|never\s+mind|nevermind|cancel)$/;
const WEB = /^(search\s+(on\s+)?the\s+web|open\s+(in\s+)?(the\s+)?(browser|tab)|search\s+the\s+web|full\s+page|look\s+it\s+up\s+on\s+the\s+web)$/;

const CHOOSE_SEARCH = /^(search|search\s+the\s+web|the\s+web|photos?|pictures?|images?|google(\s+images?)?|pinterest|first|the\s+first\s+(one|card)?|number\s+(one|1))$/;
const CHOOSE_GENERATE = /^(generate|gemini|draw|sketch|mockups?|inspirations?|ideas?|second|the\s+second\s+(one|card)?|number\s+(two|2))$/;

const ORDINALS: Array<[RegExp, number]> = [
  [/\b(the\s+)?(first|1st|number\s+one|number\s+1)\b/, 1],
  [/\b(the\s+)?(second|2nd|number\s+two|number\s+2)\b/, 2],
  [/\b(the\s+)?(third|3rd|number\s+three|number\s+3)\b/, 3],
  [/\b(the\s+)?(fourth|4th|number\s+four|number\s+4)\b/, 4],
  [/\b(the\s+)?(fifth|5th|number\s+five|number\s+5)\b/, 5],
  [/\b(the\s+)?(sixth|6th|number\s+six|number\s+6)\b/, 6],
  [/\b(the\s+)?(seventh|7th|number\s+seven|number\s+7)\b/, 7],
  [/\b(the\s+)?(eighth|8th|number\s+eight|number\s+8)\b/, 8],
  [/\b(the\s+)?(last|final)\s+(one|card|picture|image|result)?\b/, -1],
];

const PICK_NUM = /^(?:pick|choose|select|take|number|open)?\s*(?:number\s*)?(\d+)\s*(?:one|card|picture|image|result)?$/;

const VAGUE = /\b(something|stuff|things?|like\s+that|those|these|whatever|nice|pretty|kind\s+of)\b/;

const PINTEREST_TAIL = /\s+(?:on|from|via|in)\s+pinterest\s*$/;
const GOOGLE_TAIL = /\s+(?:on|from|via)\s+google(?:\s+images?)?\s*$/;
const EXPLICIT_SEARCH = /\b(search\s+(the\s+)?(web|internet)|google\s+images?|on\s+pinterest|on\s+google|from\s+pinterest)\b/;
const EXPLICIT_GENERATE = /\b(generate|with\s+gemini|using\s+gemini|draw\s+me|sketch\s+me|make\s+me\s+(a\s+)?(mockup|layout|wireframe|sketch|drawing|reference))\b/;
const DRAWING_CUES = /\b(line\s*art|pose\s+references?|reference\s+drawings?|sketches?|draw\s+me|sketch\s+me|doodle)\b/;
const LAYOUT_CUES = /\b(inspirations?|ideas?|mockups?|wireframes?|layouts?|landing\s+pages?)\b/;

export function topicLooksFuzzy(topic: string): boolean {
  const t = topic.trim();
  if (!t || t.length < 2) return true;
  if (VAGUE.test(t) && t.split(/\s+/).length <= 4) return true;
  // Non-Latin script: let Gemini turn it into an English search query.
  if (/[^\u0000-\u007f]/.test(t) && !/^[0-9\s\p{P}]+$/u.test(t)) return true;
  return false;
}

function cleanTopic(raw: string): string {
  return raw.replace(/^(the|a|an|some|me|my)\s+/, '').replace(/\s+please$/, '').trim();
}

export function parseEngineAndTopic(rawTopic: string): { query: string; engine: SearchEngine } {
  let q = cleanTopic(rawTopic);
  let engine: SearchEngine = 'google';
  if (PINTEREST_TAIL.test(q) || /\bpinterest$/.test(q)) {
    engine = 'pinterest';
    q = q.replace(PINTEREST_TAIL, '').replace(/\s*\bpinterest$/, '').trim();
  }
  q = q.replace(GOOGLE_TAIL, '').trim();
  return { query: cleanTopic(q), engine };
}

export function preferredPath(utterance: string, topic: string): {
  preferred: 'search' | 'generate';
  generateKind: GenerateKind;
  explicit: boolean;
} {
  const t = normUtterance(utterance);
  const blob = `${t} ${topic}`;
  const drawing = DRAWING_CUES.test(blob) || DRAW_ME.test(t);
  const layout = LAYOUT_CUES.test(blob);
  const explicitGen = EXPLICIT_GENERATE.test(t) || drawing;
  const explicitSearch = EXPLICIT_SEARCH.test(t);
  if (explicitGen && !explicitSearch) {
    return { preferred: 'generate', generateKind: layout && !drawing ? 'layout' : 'drawing', explicit: true };
  }
  if (explicitSearch && !explicitGen) {
    return { preferred: 'search', generateKind: layout ? 'layout' : 'drawing', explicit: true };
  }
  if (layout) return { preferred: 'generate', generateKind: 'layout', explicit: false };
  if (drawing) return { preferred: 'generate', generateKind: 'drawing', explicit: true };
  // photos / pictures / images / references → search
  return { preferred: 'search', generateKind: 'drawing', explicit: false };
}

export function makeSearch(query: string, raw: string, extra?: Partial<SearchIntent>): SearchIntent {
  const { query: q, engine } = parseEngineAndTopic(query);
  const pref = preferredPath(raw, q);
  return {
    type: 'search',
    query: q,
    raw,
    fuzzy: topicLooksFuzzy(q),
    engine,
    preferred: pref.preferred,
    generateKind: pref.generateKind,
    explicit: pref.explicit,
    ...extra,
  };
}

/** 1-based card number, or -1 for "the last one". Null if the words are not a pick. */
export function parsePickNumber(utterance: string): number | null {
  const t = normUtterance(utterance);
  if (!t) return null;
  for (const [re, n] of ORDINALS) if (re.test(t)) return n;
  const m = t.match(PICK_NUM);
  if (m) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  }
  return null;
}

export function parseReferenceIntent(utterance: string, ctx: IntentContext = {}): ReferenceIntent | null {
  const t = normUtterance(utterance);
  if (!t) return null;

  if (ctx.chooserOpen) {
    if (CHOOSE_SEARCH.test(t)) return { type: 'chooseSearch' };
    if (CHOOSE_GENERATE.test(t)) return { type: 'chooseGenerate' };
    if (CLOSE.test(t)) return { type: 'close' };
  }

  const resultsOpen = !!(ctx.gridOpen || ctx.browserOpen);
  if (resultsOpen) {
    if (MORE.test(t)) return { type: 'more' };
    if (PREV_PAGE.test(t)) return { type: 'prevPage' };
    if (WEB.test(t)) return { type: 'webSearch' };
    if (PLACE.test(t)) return { type: 'place' };
    if (BIGGER.test(t)) return { type: 'bigger' };
    if (SMALLER.test(t)) return { type: 'smaller' };
    if (CLOSE.test(t)) return { type: 'close' };
    if (PICK_THIS.test(t)) return { type: 'pickHover' };
    const n = parsePickNumber(t);
    if (n !== null) return { type: 'pick', index: n };
    if (NEXT_CARD.test(t)) return { type: 'next' };
    if (PREV_CARD.test(t)) return { type: 'prev' };
  } else if (ctx.hasSelection) {
    if (PLACE.test(t)) return { type: 'place' };
    if (BIGGER.test(t)) return { type: 'bigger' };
    if (SMALLER.test(t)) return { type: 'smaller' };
    if (CLOSE.test(t)) return { type: 'close' };
  }

  if (DEMO_PHRASES.test(t)) {
    return makeSearch('drawings', utterance, { fuzzy: false, preferred: 'search', generateKind: 'drawing', explicit: false, engine: 'google' });
  }

  const draw = t.match(DRAW_ME) || t.match(POSE_REF);
  if (draw) {
    const { query, engine } = parseEngineAndTopic(draw[1]);
    if (query) {
      return makeSearch(query, utterance, {
        engine,
        preferred: 'generate',
        generateKind: 'drawing',
        explicit: true,
        fuzzy: topicLooksFuzzy(query),
      });
    }
  }

  const inspire = t.match(INSPIRE);
  if (inspire) {
    const { query, engine } = parseEngineAndTopic(inspire[1]);
    if (query) {
      return makeSearch(query, utterance, {
        engine,
        preferred: 'generate',
        generateKind: 'layout',
        explicit: EXPLICIT_GENERATE.test(t),
        fuzzy: topicLooksFuzzy(query),
      });
    }
  }

  let topic: string | null = null;
  const a = t.match(SEARCH) || t.match(SEARCH_SHORT);
  if (a) topic = cleanTopic(a[1]);
  else {
    const show = t.match(SHOW_ME);
    if (show && /\b(references?|pictures?|images?|photos?|pics?|drawings?|inspirations?|mockups?|sketches?)\b/.test(show[1])) {
      topic = cleanTopic(show[1].replace(/\b(references?|pictures?|images?|photos?|pics?)\s+(for|of|about)\s+/g, '').replace(/\b(some|more)\s+/, ''));
    }
  }
  if (topic) return makeSearch(topic, utterance);

  if (OTHER_LANG.test(utterance)) {
    return makeSearch(utterance.trim(), utterance, { fuzzy: true });
  }
  return null;
}
