// Deterministic English parser for short spoken commands.
// Always-available fallback behind the hybrid AI path: same vocabulary, zero
// network. Output is run through validateOp so the engine never sees raw text.

import { validateOp, type Axis, type Op, type Shape } from './ops';
import type { TemplateName } from './templates';

export interface TemplateCommand {
  template: TemplateName;
  params: Record<string, number>;
}

export interface Clarify {
  clarify: string;
}

export type RuleParse = Op | TemplateCommand | Clarify;

export function isTemplateCommand(r: RuleParse): r is TemplateCommand {
  return 'template' in r;
}

export function isClarify(r: RuleParse): r is Clarify {
  return 'clarify' in r;
}

// ---------------------------------------------------------------------------
// Normalisation: lowercase, strip punctuation, undo common speech-to-text
// misrecognitions, convert number words to digits.

const WORD_NUMS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

// Homophones that ASR often emits instead of a digit. Only converted when the
// surrounding tokens make a number plausible ("taller by too" -> 2), so that
// "align to floor" keeps its "to".
const HOMOPHONE_NUMS: Record<string, number> = {
  to: 2, too: 2, for: 4, won: 1, ate: 8, tree: 3, free: 3,
};

// Word-for-word fixes applied unconditionally.
const WORD_FIXES: Record<string, string> = {
  whole: 'hole', wholes: 'holes', buy: 'by', bye: 'by', write: 'right',
  cylindrical: 'cylinder', q: 'cube', ad: 'add', att: 'add',
};

const NUMERIC_CONTEXT = new Set([
  'left', 'right', 'up', 'down', 'forward', 'back', 'by', 'deep', 'depth',
  'spacing', 'scale', 'rotate', 'fillet', 'hole', 'radius', 'count',
]);

const FILLERS = new Set([
  'a', 'an', 'the', 'please', 'that', 'this', 'it', 'me', 'us', 'then',
  'now', 'and', 'of', 'in', 'degrees', 'degree', 'mm', 'millimeter',
  'millimeters', 'millimetre', 'millimetres',
]);

const isNum = (t: string | undefined): boolean =>
  t !== undefined && /^-?\d+(\.\d+)?$/.test(t);

export function normalize(utterance: string): string[] {
  const raw = utterance
    .toLowerCase()
    .replace(/[^a-z0-9.\- ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 0)
    .map((t) => WORD_FIXES[t] ?? t)
    .map((t) => (WORD_NUMS[t] !== undefined ? String(WORD_NUMS[t]) : t));

  // Contextual homophone -> digit ("hole six" already handled above;
  // "taller by too" -> "taller by 2").
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const h = HOMOPHONE_NUMS[t];
    if (
      h !== undefined &&
      (isNum(raw[i - 1]) || isNum(raw[i + 1]) || NUMERIC_CONTEXT.has(raw[i - 1] ?? ''))
    ) {
      tokens.push(String(h));
    } else {
      tokens.push(t);
    }
  }

  // "twenty 5" -> 25, "1 point 5" -> 1.5, "minus 45" -> -45, cm -> mm.
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
    if (isNum(t) && isNum(tokens[i + 1]) && Number(t) % 10 === 0 && Number(t) >= 20 && Number(tokens[i + 1]) < 10) {
      out.push(String(Number(t) + Number(tokens[i + 1])));
      i += 1;
      continue;
    }
    if ((t === 'cm' || t === 'centimeter' || t === 'centimeters') && out.length && isNum(out[out.length - 1])) {
      out[out.length - 1] = String(Number(out[out.length - 1]) * 10);
      continue;
    }
    if (FILLERS.has(t)) continue;
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vocabulary tables.

const SHAPE_WORDS: Record<string, Shape> = {
  box: 'box', cube: 'box', block: 'box', brick: 'box',
  cylinder: 'cylinder', tube: 'cylinder', rod: 'cylinder', pipe: 'cylinder',
  sphere: 'sphere', ball: 'sphere', orb: 'sphere',
  cone: 'cone',
  torus: 'torus', ring: 'torus', donut: 'torus', doughnut: 'torus',
};

const ADD_VERBS = new Set(['add', 'create', 'make', 'place', 'put', 'insert', 'draw', 'new', 'build']);

const DIRECTIONS: Record<string, { axis: Axis; sign: 1 | -1 }> = {
  left: { axis: 'x', sign: -1 },
  right: { axis: 'x', sign: 1 },
  forward: { axis: 'y', sign: 1 },
  forwards: { axis: 'y', sign: 1 },
  ahead: { axis: 'y', sign: 1 },
  back: { axis: 'y', sign: -1 },
  backward: { axis: 'y', sign: -1 },
  backwards: { axis: 'y', sign: -1 },
  up: { axis: 'z', sign: 1 },
  down: { axis: 'z', sign: -1 },
};

const RESIZE_WORDS: Record<string, { axis: Axis; sign: 1 | -1 }> = {
  taller: { axis: 'z', sign: 1 },
  higher: { axis: 'z', sign: 1 },
  shorter: { axis: 'z', sign: -1 },
  lower: { axis: 'z', sign: -1 },
  wider: { axis: 'x', sign: 1 },
  narrower: { axis: 'x', sign: -1 },
  thinner: { axis: 'x', sign: -1 },
  thicker: { axis: 'x', sign: 1 },
  fatter: { axis: 'x', sign: 1 },
  shallower: { axis: 'y', sign: -1 },
  longer: { axis: 'y', sign: 1 },
  deeper: { axis: 'y', sign: 1 },
};

const TEMPLATE_PATTERNS: Array<{ re: RegExp; template: TemplateName; numParam: string }> = [
  { re: /cup ?grip|grip .*cup|cup .*grip|cup ?holder|mug ?grip/, template: 'cupGrip', numParam: 'cupDiameterMm' },
  { re: /phone ?(stand|holder|dock)|stand .*phone/, template: 'phoneStand', numParam: 'angleDeg' },
  { re: /utensil|pen ?holder|pencil ?holder|spoon ?holder/, template: 'utensilHolder', numParam: 'diameterMm' },
  { re: /\bhook\b/, template: 'hook', numParam: 'rodDiameterMm' },
];

// ---------------------------------------------------------------------------

const clarify = (msg: string): Clarify => ({ clarify: msg });

/** Build a raw op and push it through validateOp so numbers get clamped. */
function finalize(raw: Record<string, unknown>): RuleParse {
  const v = validateOp(raw);
  return v.ok ? v.op : clarify(v.error);
}

function firstAxis(tokens: string[]): Axis | undefined {
  const t = tokens.find((x) => x === 'x' || x === 'y' || x === 'z');
  return t as Axis | undefined;
}

function numAfter(tokens: string[], words: string[]): number | undefined {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (words.includes(tokens[i]) && isNum(tokens[i + 1])) return Number(tokens[i + 1]);
  }
  return undefined;
}

/**
 * Parse one short spoken command into an Op, a template command, or a
 * clarification question. Deterministic; never throws.
 */
export function parseCommand(utterance: string): RuleParse {
  const tokens = normalize(utterance);
  if (tokens.length === 0) return clarify('I did not hear a command.');
  const s = tokens.join(' ');
  const nums = tokens.filter(isNum).map(Number);
  const has = (w: string) => tokens.includes(w);

  // Undo / redo first: they must win even inside longer phrases.
  if (has('undo') || s.includes('go back')) return { op: 'undo' };
  if (has('redo')) return { op: 'redo' };

  // select <name> / delete <name>
  if (['select', 'pick', 'choose', 'grab'].includes(tokens[0])) {
    const name = tokens.slice(1).join(' ');
    return name ? finalize({ op: 'select', target: name }) : clarify('Select which part?');
  }
  if (['delete', 'remove', 'erase', 'trash'].includes(tokens[0])) {
    const name = tokens.slice(1).join(' ');
    return finalize({ op: 'delete', target: name || 'selected' });
  }

  // Templates ("cup grip", "phone stand", "hook", "utensil holder").
  for (const { re, template, numParam } of TEMPLATE_PATTERNS) {
    if (re.test(s)) {
      const params: Record<string, number> = {};
      if (nums.length > 0) params[numParam] = nums[0];
      return { template, params };
    }
  }

  // Booleans.
  if (has('union') || has('combine') || has('merge') || has('weld') || s.includes('join'))
    return finalize({ op: 'union', targets: ['selected', 'last'] });
  if (has('subtract') || s.includes('cut out') || has('carve'))
    return finalize({ op: 'subtract', target: 'selected', tool: 'last' });

  // Hole ("hole 6 mm through"; "whole" already corrected in normalize()).
  if (has('hole') || has('holes') || has('drill')) {
    if (nums.length === 0) return clarify('What diameter should the hole be, in millimeters?');
    const depth = has('through')
      ? 'through'
      : numAfter(tokens, ['deep', 'depth']) ?? (nums.length > 1 ? nums[1] : 'through');
    return finalize({
      op: 'hole', target: 'selected', diameter: nums[0], depth,
      axis: firstAxis(tokens) ?? (has('sideways') ? 'x' : 'z'),
    });
  }

  // Add shape ("add a cylinder 20 by 40", "box 30 20 10").
  const shapeTok = tokens.find((t) => SHAPE_WORDS[t] !== undefined);
  if (shapeTok && (tokens.some((t) => ADD_VERBS.has(t)) || SHAPE_WORDS[tokens[0]] !== undefined)) {
    const shape = SHAPE_WORDS[shapeTok];
    switch (shape) {
      case 'box': {
        const [a = 20, b, c] = nums;
        const w = a;
        const d = shapeTok === 'cube' ? a : b ?? a;
        const h = c ?? (shapeTok === 'cube' ? a : b ?? a);
        return finalize({ op: 'add', shape, params: { w, d, h } });
      }
      case 'cylinder':
        return finalize({
          op: 'add', shape,
          params: { diameter: nums[0] ?? 20, height: nums[1] ?? nums[0] ?? 20 },
        });
      case 'sphere':
        return finalize({ op: 'add', shape, params: { diameter: nums[0] ?? 20 } });
      case 'cone':
        return finalize({
          op: 'add', shape,
          params: {
            diameter: nums[0] ?? 20, height: nums[1] ?? nums[0] ?? 20,
            ...(nums[2] !== undefined ? { topDiameter: nums[2] } : {}),
          },
        });
      case 'torus':
        return finalize({
          op: 'add', shape,
          params: { diameter: nums[0] ?? 30, tube: nums[1] ?? Math.max(2, (nums[0] ?? 30) / 5) },
        });
    }
  }

  // Align ("align to floor", "drop it to the ground").
  if (has('floor') || has('ground'))
    return finalize({ op: 'align', target: 'selected', to: 'floor', mode: 'center' });

  // Rotate ("rotate 45 around z").
  if (has('rotate') || has('turn') || has('spin') || has('twist')) {
    let deg = nums[0] ?? 90;
    if (has('counterclockwise') || has('anticlockwise')) deg = -Math.abs(deg);
    return finalize({ op: 'rotate', target: 'selected', axis: firstAxis(tokens) ?? 'z', deg });
  }

  // Mirror ("mirror x", "flip y").
  if (has('mirror') || has('flip')) {
    const a = firstAxis(tokens);
    return a
      ? finalize({ op: 'mirror', target: 'selected', axis: a })
      : clarify('Mirror across which axis: x, y, or z?');
  }

  // Array ("array 3 spacing 20").
  if (has('array') || has('copies') || has('repeat') || has('duplicate')) {
    if (nums.length === 0) return clarify('How many copies?');
    const spacing = numAfter(tokens, ['spacing', 'gap', 'apart', 'every']) ?? nums[1] ?? 20;
    return finalize({
      op: 'array', target: 'selected', count: nums[0], spacing,
      axis: firstAxis(tokens) ?? 'x',
    });
  }

  // Fillet ("fillet 2", "round the edges").
  if (has('fillet') || has('round') || has('rounded'))
    return finalize({ op: 'fillet', target: 'selected', radius: nums[0] ?? 2 });

  // Move ("move left 10", "up 5").
  const dirTok = tokens.find((t) => DIRECTIONS[t] !== undefined);
  if (dirTok) {
    if (nums.length === 0) return clarify('How far should I move it, in millimeters?');
    const { axis, sign } = DIRECTIONS[dirTok];
    const d = { dx: 0, dy: 0, dz: 0 };
    d[`d${axis}`] = sign * nums[0];
    return finalize({ op: 'move', target: 'selected', ...d });
  }

  // Resize adjectives ("taller by 5", "wider by 3").
  const sizeTok = tokens.find((t) => RESIZE_WORDS[t] !== undefined);
  if (sizeTok) {
    if (nums.length === 0) return clarify('By how many millimeters?');
    const { axis, sign } = RESIZE_WORDS[sizeTok];
    return finalize({ op: 'scale', target: 'selected', deltaMm: { [axis]: sign * nums[0] } });
  }
  if (has('bigger') || has('larger') || has('smaller')) {
    const grow = !has('smaller');
    if (nums.length > 0) {
      const n = (grow ? 1 : -1) * nums[0];
      return finalize({ op: 'scale', target: 'selected', deltaMm: { x: n, y: n, z: n } });
    }
    return finalize({ op: 'scale', target: 'selected', factor: grow ? 1.25 : 0.8 });
  }

  // Scale ("scale 1.5", "double it", "half the size").
  if (has('double')) return finalize({ op: 'scale', target: 'selected', factor: 2 });
  if (has('half') || has('halve')) return finalize({ op: 'scale', target: 'selected', factor: 0.5 });
  if (has('scale') || has('resize')) {
    return nums.length > 0
      ? finalize({ op: 'scale', target: 'selected', factor: nums[0] })
      : clarify('Scale by what factor?');
  }

  return clarify(
    'I did not catch that. Try "add a box", "move left 10", "hole 6 through", or "make it taller by 5".',
  );
}
