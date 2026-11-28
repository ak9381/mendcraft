// What she said, cleaned up once before anything reads it. Speech recognition
// mishears a handful of words the canvas depends on ("gymbo" for gimbal,
// "about" for a board, "belt me" for build me). Each fix is one row of a
// table, anchored to the words around it, so "tell me about gimbals" and
// "the belt of Orion" are left alone. `raw` stays what she said (caption,
// chat, redaction); `text` is what modals, routeLine and Nano read.
// Also the one home of "what is the board FOR": status words vs control words.

export type BoardPurpose = 'status' | 'controls' | 'plan';

export interface Heard {
  /** Exactly what was heard or typed. */
  raw: string;
  /** The line with the mishearing table applied. */
  text: string;
  /** One note per rule that changed the line ("gymbo→gimbal"). */
  fixes: string[];
  /** What a board she asks for is for, from her words (null = no purpose words). */
  purpose: BoardPurpose | null;
}

interface MisheardRule { re: RegExp; to: string; note: string }

const GIMBAL_SOUNDS = 'gymbo|gymbal|gymbol|gimbo|jimbo|kimbo|kimball?|gambel|gimble|gimbel|gimbol';
const BOARD_SOUNDS = 'about|a\\s*bout|a\\s+bored|a\\s+bord|a\\s+boat|a\\s+bird|a\\s+bold|abort|aboard';
const BUILD_SOUNDS = 'belt|bolt|built|bill|felt|bell';
const BOARD_NOUN = '(?=[^.?!]*\\b(?:board|dashboard|dash\\s+board|control\\s+panel|panel|page|screen|floor\\s*plan)\\b)';

/** Context-anchored rewrites, applied in order. Each `to` is the canonical
 *  word, which no rule matches again (so hear() is idempotent). */
export const MISHEARD: readonly MisheardRule[] = [
  // "connect the gymbo", "add my kimbo stand": only after a verb or determiner.
  { re: new RegExp(`\\b(connect|add|pair|link|show|the|my|our)(\\s+(?:the\\s+|my\\s+|our\\s+)?)(?:${GIMBAL_SOUNDS})\\b`, 'gi'), to: '$1$2gimbal', note: 'gimbal' },
  // "belt me a board": a build verb at the start of the line before me.
  { re: new RegExp(`^(\\s*)(?:${BUILD_SOUNDS})\\s+me\\b`, 'i'), to: '$1build me', note: 'build' },
  // "bolt a dashboard", "built the floor plan": only when a board noun follows.
  { re: new RegExp(`^(\\s*)(?:${BUILD_SOUNDS})\\s+(a|the)\\b${BOARD_NOUN}`, 'i'), to: '$1build $2', note: 'build' },
  // "build me about to keep track…": a board after a build verb.
  { re: new RegExp(`\\b(build|make|create|give|set\\s+up)(\\s+me)?\\s+(?:${BOARD_SOUNDS})\\b`, 'gi'), to: '$1$2 a board', note: 'a board' },
  { re: /\bdash\s+board(s?)\b/gi, to: 'dashboard$1', note: 'dashboard' },
  { re: /\b(?:flaw|flow|floor)\s+plane?(s?)\b/gi, to: 'floor plan$1', note: 'floor plan' },
];

/** The two rewrites routeLine always applied to the status-board check
 *  (kept exactly, re-exported from routeLine.ts). */
export const fixBoard = (t: string): string => t
  .replace(/^\s*(?:belt|bolt|built|bill|felt|bell)\s+me\b/i, 'build me')
  .replace(/\b(build|make|create|give|set\s+up)(\s+me)?\s+(?:about|a\s*bout|a\s+bored|a\s+bord|a\s+boat|a\s+bird|a\s+bold|abort|aboard)\b/gi, '$1$2 a board');

// What she wants it FOR decides the board, not the word she used for it:
// "a dashboard to keep track of my devices and their status" is the status board.
export const STATUS_WORDS_RE = /\b(?:status|statuses|keep\s+track|track\s+of|what(?:'|’)?s\s+(?:on|connected)|(?:are|is)\s+(?:connected|working|online))\b/i;
export const CONTROL_WORDS_RE = /\b(?:control|controls|turn\s+(?:on|off)|switch(?:es)?|dim|brighten|brightness|volume|play|pause|sliders?|buttons?\s+(?:to|for)\s+(?:turn|switch|dim|play))\b/i;
const PLAN_WORDS_RE = /\bfloor\s*plans?\b/i;

/** Status words and no control words: the status board; control words: the
 *  dashboard; a floor plan: the plan. Purpose wins over the board noun. */
export function boardPurpose(raw: string): BoardPurpose | null {
  const text = fixBoard(raw);
  if (PLAN_WORDS_RE.test(text)) return 'plan';
  if (CONTROL_WORDS_RE.test(text)) return 'controls';
  if (STATUS_WORDS_RE.test(text)) return 'status';
  return null;
}

export function hear(raw: string): Heard {
  let text = raw;
  const fixes: string[] = [];
  for (const rule of MISHEARD) {
    rule.re.lastIndex = 0;
    text = text.replace(rule.re, (...m: unknown[]) => {
      const whole = m[0] as string;
      const out = rule.to.replace(/\$(\d)/g, (_s, n: string) => (typeof m[Number(n)] === 'string' ? m[Number(n)] as string : ''));
      if (out !== whole) fixes.push(`${whole.trim()}→${out.trim()}`);
      return out;
    });
  }
  return { raw, text, fixes, purpose: boardPurpose(text) };
}
