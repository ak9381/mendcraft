// Deterministic English parser for short spoken UI commands. Always-available
// fallback behind the hybrid AI path: same vocabulary, zero network. Output is
// a loose op envelope (or a generate / clarify / export directive), re-validated
// by validateUiOp before the engine ever sees it.
//
// Examples it understands:
//   "login screen"                 -> { generate: 'login' }
//   "mobile frame"                 -> add_frame mobile
//   "make the button blue"         -> set_fill (button) blue
//   "make it 48 pixels tall"       -> set_size selected h 48
//   "add a password field"         -> add_node input password
//   "add a button called Sign up"  -> add_node button "Sign up"
//   "center it" / "gap 24" / "add 16 pixels of padding"
//   "move it up" / "delete it" / "select the heading" / "undo" / "export html"

import type { Clarify } from '../../core/ruleParser';
import type { FramePreset } from './doc';
import type { UiTemplateName } from './templates';
import { findColor } from './colors';

export interface UiGenerate { generate: UiTemplateName; preset?: FramePreset }
export interface UiExport { export: true }
export type UiParse = Record<string, unknown> | Clarify | UiGenerate | UiExport;

export function isUiClarify(r: UiParse): r is Clarify {
  return 'clarify' in r;
}
export function isUiGenerate(r: UiParse): r is UiGenerate {
  return 'generate' in r;
}
export function isUiExport(r: UiParse): r is UiExport {
  return 'export' in r;
}

const WORD_NUMS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, twelve: 12, sixteen: 16, twenty: 20, twenty4: 24,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100,
};

const isNum = (t: string | undefined): boolean => t !== undefined && /^-?\d+(\.\d+)?$/.test(t);

function normalize(utterance: string): string[] {
  const raw = utterance
    .toLowerCase()
    .replace(/[^a-z0-9.\- ]+/g, ' ')
    .replace(/([a-z])-([a-z])/g, '$1 $2')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 0)
    .map((t) => (WORD_NUMS[t] !== undefined ? String(WORD_NUMS[t]) : t));

  // "twenty 4" -> 24 (tens + ones).
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (isNum(t) && isNum(raw[i + 1]) && Number(t) % 10 === 0 && Number(t) >= 20 && Number(raw[i + 1]) < 10) {
      out.push(String(Number(t) + Number(raw[i + 1])));
      i += 1;
      continue;
    }
    out.push(t);
  }
  return out;
}

const clarify = (msg: string): Clarify => ({ clarify: msg });

/** Pull a trailing label/text off the ORIGINAL utterance (preserve casing). */
function extractLabel(utterance: string): string | undefined {
  const m = utterance.match(/\b(?:called|named|labell?ed|titled|saying|that says?|with (?:the )?text|with label|text)\s+(.+)$/i);
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, '').replace(/[.?!]+$/, '').trim() || undefined;
}

/** Which named node a command targets ("the button", "email field"), or 'selected'. */
function targetOf(_tokens: string[], s: string): string {
  if (/\bemail\b/.test(s)) return 'email field';
  if (/\bpassword\b/.test(s)) return 'password field';
  if (/\b(heading|title|header)\b/.test(s)) return 'heading';
  if (/\b(button|cta|sign in|sign up)\b/.test(s)) return 'button';
  if (/\b(input|field|textbox)\b/.test(s)) return 'input';
  if (/\b(image|picture|photo)\b/.test(s)) return 'image';
  if (/\b(text|paragraph|body|label)\b/.test(s)) return 'text';
  if (/\b(card|box|rect)\b/.test(s)) return 'rect';
  return 'selected';
}

/** Parse one short spoken UI command. Deterministic; never throws. */
export function parseUiCommand(utterance: string): UiParse {
  const tokens = normalize(utterance);
  if (tokens.length === 0) return clarify('I did not hear a command.');
  const s = tokens.join(' ');
  const nums = tokens.filter(isNum).map(Number);
  const has = (w: string) => tokens.includes(w);

  // Undo/redo are engine-level; expose them as plain ops the controller handles.
  if (has('undo') || s.includes('go back')) return { op: 'undo' };
  if (has('redo')) return { op: 'redo' };

  if (s.includes('export') || s.includes('download html') || s.includes('download the html')) return { export: true };

  const mobile = /\b(mobile|phone)\b/.test(s);

  // Whole-screen templates.
  if (/\blog ?in\b/.test(s) || /\bsign ?in\b/.test(s) || (has('login')) ) {
    return { generate: 'login', preset: mobile ? 'mobile' : 'desktop' };
  }
  if (has('landing') || has('hero')) return { generate: 'landing', preset: mobile ? 'mobile' : 'desktop' };
  if (has('pricing')) return { generate: 'pricing', preset: mobile ? 'mobile' : 'desktop' };

  // New frame.
  if (has('frame') || (has('screen') && (has('new') || has('add') || mobile || /\bdesktop\b/.test(s)))) {
    return { op: 'add_frame', preset: mobile ? 'mobile' : 'desktop' };
  }

  // Undo/redo already handled above.

  // Select / delete.
  if (['select', 'pick', 'choose'].includes(tokens[0])) {
    return { op: 'select', target: targetOf(tokens, s) };
  }
  if (['delete', 'remove', 'erase'].includes(tokens[0]) || s.includes('delete it') || s.includes('remove it')) {
    const t = targetOf(tokens, s);
    return { op: 'delete', target: t };
  }

  // "wrap in a row" / "wrap it in a column" / "group them" → wrap op (Shift+A).
  if (has('wrap') || (has('group') && !has('background'))) {
    return { op: 'wrap', target: 'selected', direction: has('row') ? 'row' : has('column') || has('col') ? 'column' : undefined };
  }
  if (has('duplicate') || s.includes('copy it') || s.includes('copy that')) {
    return { op: 'duplicate', target: 'selected' };
  }

  // Move up / down (reorder within the stack). Guard the bare "up/down"
  // shorthand so it never swallows "add a button called Sign up".
  const addContext = has('add') || has('insert') || has('called') || has('named') || tokens[0] === 'new';
  if (has('move') || has('nudge') || (!addContext && (has('up') || has('down')) && !has('scroll'))) {
    if (has('up')) return { op: 'move', target: 'selected', nums: { delta: -1 } };
    if (has('down')) return { op: 'move', target: 'selected', nums: { delta: 1 } };
    return clarify('Move it up or down?');
  }

  // Add a node. "add 16 pixels of padding" / "add a 24 gap" are layout edits,
  // not new nodes — let them fall through to the padding/gap branches below.
  const layoutContext = has('padding') || has('pad') || has('gap') || has('spacing');
  if (!layoutContext && (has('add') || has('insert') || (['new'].includes(tokens[0])))) {
    const label = extractLabel(utterance);
    if (has('password')) return { op: 'add_node', nodeType: 'input', inputType: 'password', label: label ?? 'Password' };
    if (has('email')) return { op: 'add_node', nodeType: 'input', inputType: 'email', label: label ?? 'Email' };
    if (has('input') || has('field') || has('textbox')) return { op: 'add_node', nodeType: 'input', inputType: 'text', label: label ?? 'Field' };
    if (has('button') || has('cta')) return { op: 'add_node', nodeType: 'button', label: label ?? 'Button' };
    if (has('heading') || has('title') || has('header')) return { op: 'add_node', nodeType: 'text', role: 'heading', text: label ?? 'Heading' };
    if (has('text') || has('paragraph') || has('body') || has('label')) return { op: 'add_node', nodeType: 'text', role: 'body', text: label ?? 'Text' };
    if (has('image') || has('picture') || has('photo')) return { op: 'add_node', nodeType: 'image' };
    if (has('navbar') || has('nav') || s.includes('navigation bar')) return { op: 'add_node', nodeType: 'navbar' };
    if (has('divider') || has('separator') || has('rule')) return { op: 'add_node', nodeType: 'divider' };
    if (has('icon') || has('circle') || has('avatar')) return { op: 'add_node', nodeType: 'icon' };
    if (has('card')) return { op: 'add_node', nodeType: 'card' };
    if (has('stack') || has('row') || has('column') || has('section')) {
      return { op: 'add_node', nodeType: 'stack', direction: has('row') ? 'row' : 'column' };
    }
    return clarify('Add what — a heading, text, input, button, image, or card?');
  }

  // Colour: "make the button blue", "the heading red".
  const color = findColor(tokens);
  if (color && (has('make') || has('color') || has('colour') || has('fill') || has('turn'))) {
    return { op: 'set_fill', target: targetOf(tokens, s), fill: color };
  }
  if (color) return { op: 'set_fill', target: targetOf(tokens, s), fill: color };

  // Size: "bigger heading", "smaller text".
  if (has('bigger') || has('larger') || has('smaller')) {
    const t = targetOf(tokens, s);
    const heading = t === 'heading';
    const big = !has('smaller');
    const size = heading ? (big ? 40 : 22) : (big ? 22 : 13);
    return { op: 'set_style', target: t === 'selected' ? 'heading' : t, nums: { size } };
  }

  // Padding: "add 16 pixels of padding", "padding 24".
  if (has('padding') || has('pad')) {
    if (nums.length === 0) return clarify('How many pixels of padding?');
    return { op: 'set_layout', target: 'root', nums: { padding: nums[0] } };
  }
  // Gap: "gap 24", "16 gap".
  if (has('gap') || has('spacing')) {
    if (nums.length === 0) return clarify('What gap, in pixels?');
    return { op: 'set_layout', target: 'root', nums: { gap: nums[0] } };
  }
  // Center: "center it", "center everything".
  if (has('center') || has('centre') || has('middle')) {
    return { op: 'set_layout', target: 'root', align: 'center', justify: 'center' };
  }
  // Stack direction.
  if (s.includes('stack vertically') || s.includes('make it a column') || has('column')) {
    return { op: 'set_layout', target: 'root', direction: 'column' };
  }
  if (s.includes('stack horizontally') || s.includes('in a row') || has('row')) {
    return { op: 'set_layout', target: 'root', direction: 'row' };
  }

  // Size in px: "make it 48 pixels tall", "200 wide".
  if (nums.length > 0 && (has('tall') || has('high') || has('height'))) {
    return { op: 'set_size', target: targetOf(tokens, s), nums: { h: nums[0] } };
  }
  if (nums.length > 0 && (has('wide') || has('width'))) {
    return { op: 'set_size', target: targetOf(tokens, s), nums: { w: nums[0] } };
  }

  // Set text: "change the text to Welcome".
  const newText = extractLabel(utterance);
  if (newText && (has('change') || has('set') || has('rename') || has('say'))) {
    return { op: 'set_text', target: targetOf(tokens, s), text: newText };
  }

  return clarify(
    'Try "login screen", "add a button called Sign up", "make the button blue", "make it 48 pixels tall", "center it", or "export html".',
  );
}
