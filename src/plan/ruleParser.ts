// Deterministic English parser for short spoken PLAN commands. Always-available
// fallback behind the hybrid AI path: same vocabulary, zero network. Output is
// a loose op envelope (or a generate/clarify), re-validated by validatePlanOp
// before the engine ever sees it.
//
// Examples it understands:
//   "two bedroom plan"            -> { generate: 'twoBedroom' }
//   "room 4 by 3"                 -> add_room 4 m × 3 m
//   "add a door"                  -> add_door on the selected wall
//   "make this wall 4 meters"     -> set_length selected 4 m
//   "move it 500 left"            -> move selected dx -500 mm
//   "thicker by 50"               -> set_thickness selected delta +50 mm
//   "dimension this wall" / "undo"

import type { Clarify } from '../core/ruleParser';
import type { PlanTemplateName } from './templates';

export interface PlanGenerate {
  generate: PlanTemplateName;
}
/** A loose op envelope (validated later) or a generate/clarify instruction. */
export type PlanParse = Record<string, unknown> | Clarify | PlanGenerate;

export function isPlanClarify(r: PlanParse): r is Clarify {
  return 'clarify' in r;
}
export function isPlanGenerate(r: PlanParse): r is PlanGenerate {
  return 'generate' in r;
}

const WORD_NUMS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100,
};

// Homophones ASR emits for digits, only treated as numbers in a numeric context.
const HOMOPHONE_NUMS: Record<string, number> = { to: 2, too: 2, for: 4, won: 1, ate: 8 };

const WORD_FIXES: Record<string, string> = {
  metre: 'meters', metres: 'meters', meter: 'meters', meters: 'meters',
  centimetre: 'cm', centimetres: 'cm', centimeter: 'cm', centimeters: 'cm',
  millimetre: 'mm', millimetres: 'mm', millimeter: 'mm', millimeters: 'mm',
  bedrooms: 'bedroom', rooms: 'room', doors: 'door', windows: 'window',
  walls: 'wall', thick: 'thickness', wide: 'thickness',
};

const isNum = (t: string | undefined): boolean => t !== undefined && /^-?\d+(\.\d+)?$/.test(t);

function normalize(utterance: string): string[] {
  const raw = utterance
    .toLowerCase()
    .replace(/[^a-z0-9.\- ]+/g, ' ')
    .replace(/([a-z])-([a-z])/g, '$1 $2') // "two-bedroom" -> "two bedroom"
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 0)
    .map((t) => WORD_FIXES[t] ?? t)
    .map((t) => (WORD_NUMS[t] !== undefined ? String(WORD_NUMS[t]) : t));

  const tokens: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const h = HOMOPHONE_NUMS[t];
    if (h !== undefined && (isNum(raw[i - 1]) || isNum(raw[i + 1]))) tokens.push(String(h));
    else tokens.push(t);
  }

  // "1 point 5" -> 1.5, "minus 3" -> -3.
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ((t === 'minus' || t === 'negative') && isNum(tokens[i + 1])) {
      out.push(String(-Number(tokens[i + 1])));
      i += 1;
      continue;
    }
    if (isNum(t) && tokens[i + 1] === 'point' && isNum(tokens[i + 2])) {
      out.push(`${t}.${tokens[i + 2]}`);
      i += 2;
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Find the unit (mm/cm/m) that appears in the command; default mm. */
function unitOf(tokens: string[], fallback: 'mm' | 'cm' | 'm'): 'mm' | 'cm' | 'm' {
  if (tokens.includes('meters') || tokens.includes('m')) return 'm';
  if (tokens.includes('cm')) return 'cm';
  if (tokens.includes('mm')) return 'mm';
  return fallback;
}

const clarify = (msg: string): Clarify => ({ clarify: msg });

/** Parse one short spoken plan command. Deterministic; never throws. */
export function parsePlanCommand(utterance: string): PlanParse {
  const tokens = normalize(utterance);
  if (tokens.length === 0) return clarify('I did not hear a command.');
  const s = tokens.join(' ');
  const nums = tokens.filter(isNum).map(Number);
  const has = (w: string) => tokens.includes(w);

  if (has('undo') || s.includes('go back')) return { op: 'undo' };
  if (has('redo')) return { op: 'redo' };

  // Whole-plan templates (also the no-AI fallback for "two bedroom plan").
  if (has('bedroom')) {
    if (nums[0] === 1 || has('single')) return { generate: 'oneRoom' };
    return { generate: 'twoBedroom' };
  }
  if (has('studio') || s.includes('one room') || s.includes('single room')) {
    return { generate: has('studio') ? 'studio' : 'oneRoom' };
  }

  // Select / delete.
  if (['select', 'pick', 'choose'].includes(tokens[0])) {
    const target = tokens.slice(1).filter((t) => t !== 'the' && t !== 'wall').join(' ');
    return target ? { op: 'select', target } : clarify('Select which wall or room?');
  }
  if (['delete', 'remove', 'erase'].includes(tokens[0])) {
    const target = tokens.slice(1).filter((t) => t !== 'the').join(' ') || 'selected';
    return { op: 'delete', target };
  }

  // Add a room: "room 4 by 3", "add a bedroom 4 by 3 meters". Bare numbers in a
  // room command are metres (the natural spoken unit for rooms).
  if (has('room')) {
    const dims = nums.length >= 2 ? [nums[0], nums[1]] : [nums[0] ?? 4, nums[0] ?? 4];
    const nameTokens = tokens.filter((t) => !isNum(t) && !['room', 'add', 'a', 'an', 'the', 'by', 'x', 'meters', 'm', 'new', 'make'].includes(t));
    const env: Record<string, unknown> = {
      op: 'add_room',
      nums: { x: 0, y: 0, w: dims[0], h: dims[1] },
      unit: unitOf(tokens, 'm'),
    };
    if (nameTokens.length) env.name = nameTokens.join(' ');
    return env;
  }

  // Doors / windows on the selected wall.
  if (has('door')) {
    const env: Record<string, unknown> = { op: 'add_door', target: 'selected' };
    if (nums.length) env.nums = { width: nums[0] };
    if (nums.length) env.unit = unitOf(tokens, 'm');
    if (has('right')) env.swing = 'right';
    return env;
  }
  if (has('window')) {
    const env: Record<string, unknown> = { op: 'add_window', target: 'selected' };
    if (nums.length) env.nums = { width: nums[0] };
    if (nums.length) env.unit = unitOf(tokens, 'm');
    return env;
  }

  // Dimension the selected wall.
  if (has('dimension') || has('dimensions') || s.includes('measure'))
    return { op: 'add_dim', target: 'selected' };

  // Thickness: "thicker by 50", "make the wall 200 thick".
  if (has('thicker') || has('thinner') || has('thickness')) {
    if (nums.length === 0) return clarify('By how many millimetres?');
    const unit = unitOf(tokens, 'mm');
    if (has('thicker')) return { op: 'set_thickness', target: 'selected', nums: { delta: nums[0] }, unit };
    if (has('thinner')) return { op: 'set_thickness', target: 'selected', nums: { delta: -nums[0] }, unit };
    return { op: 'set_thickness', target: 'selected', nums: { thickness: nums[0] }, unit };
  }

  // Set length: "make this wall 4 meters", "4 meters long", "set length 4 m".
  if (has('length') || has('long') || ((has('meters') || has('m')) && (has('make') || has('set') || has('wall')))) {
    if (nums.length === 0) return clarify('How long should the wall be?');
    return { op: 'set_length', target: 'selected', nums: { length: nums[0] }, unit: unitOf(tokens, 'm') };
  }

  // Offset the wall perpendicular to itself: "offset 300".
  if (has('offset')) {
    if (nums.length === 0) return clarify('Offset by how much?');
    return { op: 'offset', target: 'selected', nums: { dist: nums[0] }, unit: unitOf(tokens, 'mm') };
  }

  // Move: "move it 500 left", "move left 500", "nudge up 200". Default mm.
  const dirs: Record<string, [string, number]> = {
    left: ['dx', -1], right: ['dx', 1], up: ['dy', 1], down: ['dy', -1],
    north: ['dy', 1], south: ['dy', -1], east: ['dx', 1], west: ['dx', -1],
  };
  const dirTok = tokens.find((t) => dirs[t] !== undefined);
  if (has('move') || has('nudge') || dirTok) {
    if (!dirTok) return clarify('Move which way — left, right, up, or down?');
    if (nums.length === 0) return clarify('Move how far, in millimetres?');
    const [field, sign] = dirs[dirTok];
    return { op: 'move', target: 'selected', nums: { [field]: sign * nums[0] }, unit: unitOf(tokens, 'mm') };
  }

  return clarify(
    'Try "two bedroom plan", "room 4 by 3", "add a door", "make this wall 4 meters", "move it 500 left", or "undo".',
  );
}
