// "TAUGHT ONCE, DONE FOREVER" recipes — the declarative model + strict validator.
// A recipe is pure JSON: a named, replayable list of existing op-log ops. There
// is NO code in a recipe and nothing is ever eval'd: the validator admits only
// JSON-safe values, and every step is re-validated by the mode's own op
// validator when it is replayed (AI or storage output is never trusted).

export const RECIPE_DEVICES = ['designer', 'browser', 'lamp', 'music', 'android', 'iphone'] as const;
export type RecipeDevice = (typeof RECIPE_DEVICES)[number];

export interface RecipePoint {
  x: number;
  y: number;
}

/** One replayable step: exactly one op-log op (plan/ui/part vocabulary). */
export interface RecipeStep {
  op: Record<string, unknown>;
}

export interface Recipe {
  id: string;
  name: string;
  /** Other phrasings that should run this recipe ("amma bathroom", Kannada name…). */
  aliases: string[];
  /** BCP-47-ish language the recipe was taught in ('en', 'kn'). */
  language: string;
  device: RecipeDevice;
  /** Editor mode the steps were recorded in ('plan' | 'ui' | 'part'), designer only. */
  mode?: string;
  taughtBy: string;
  steps: RecipeStep[];
  /** Named fill-in slots (reserved for part 2 — phone-side recipes). */
  slots?: Record<string, string>;
  /** Where the recording was anchored; replay rebases positions from here. */
  anchor?: RecipePoint;
  createdAt: number;
  updatedAt: number;
}

export const RECIPE_LIMITS = {
  idLen: 64,
  nameLen: 60,
  aliasCount: 12,
  stepCount: 40,
  stringLen: 500,
  arrayLen: 64,
  objectKeys: 32,
  depth: 6,
  slotCount: 8,
} as const;

export type RecipeValidation = { ok: true; recipe: Recipe } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const fail = (error: string): RecipeValidation => ({ ok: false, error });

/** Non-empty trimmed string capped at `max` chars, else undefined. */
function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= max ? t : undefined;
}

/**
 * Is this value plain JSON within our size/depth limits? Rejects functions,
 * symbols, class instances, non-finite numbers, oversized strings/arrays/
 * objects, and anything deeper than RECIPE_LIMITS.depth. This is the "no code,
 * no eval" gate for untrusted recipe content.
 */
export function isJsonSafe(v: unknown, depth: number = RECIPE_LIMITS.depth): boolean {
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= RECIPE_LIMITS.stringLen;
  if (depth <= 0) return false;
  if (Array.isArray(v)) {
    return v.length <= RECIPE_LIMITS.arrayLen && v.every((x) => isJsonSafe(x, depth - 1));
  }
  if (typeof v === 'object') {
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
    const entries = Object.entries(v as Record<string, unknown>);
    return entries.length <= RECIPE_LIMITS.objectKeys && entries.every(([, x]) => isJsonSafe(x, depth - 1));
  }
  return false;
}

function validStep(raw: unknown): RecipeStep | string {
  if (!isObj(raw)) return 'step must be an object';
  const op = raw.op;
  if (!isObj(op)) return 'step needs an { op: {...} } object';
  if (typeof op.op !== 'string' || !op.op.trim() || op.op.length > 32) {
    return 'step op needs a short string "op" name';
  }
  if (!isJsonSafe(op)) return 'step op must be plain JSON (no code, bounded size)';
  return { op };
}

function validPoint(v: unknown): RecipePoint | undefined {
  if (!isObj(v)) return undefined;
  const { x, y } = v;
  if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
  if (typeof y !== 'number' || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/** Strict validator for an untrusted recipe (storage, Firestore, AI, import). */
export function validateRecipe(raw: unknown): RecipeValidation {
  if (!isObj(raw)) return fail('recipe must be an object');
  const id = text(raw.id, RECIPE_LIMITS.idLen);
  if (!id) return fail('recipe needs an id');
  const name = text(raw.name, RECIPE_LIMITS.nameLen);
  if (!name) return fail(`recipe needs a name (1-${RECIPE_LIMITS.nameLen} chars)`);

  if (!Array.isArray(raw.aliases)) return fail('aliases must be an array');
  const aliases = raw.aliases
    .map((a) => text(a, RECIPE_LIMITS.nameLen))
    .filter((a): a is string => !!a);
  if (aliases.length !== raw.aliases.length) return fail('aliases must be short non-empty strings');
  if (aliases.length > RECIPE_LIMITS.aliasCount) return fail(`too many aliases (max ${RECIPE_LIMITS.aliasCount})`);

  const language = text(raw.language, 10);
  if (!language) return fail('recipe needs a language code');

  if (typeof raw.device !== 'string' || !(RECIPE_DEVICES as readonly string[]).includes(raw.device)) {
    return fail(`unknown device "${String(raw.device)}"`);
  }

  const taughtBy = typeof raw.taughtBy === 'string' ? raw.taughtBy.trim().slice(0, 40) : '';

  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return fail('recipe needs at least one step');
  if (raw.steps.length > RECIPE_LIMITS.stepCount) return fail(`too many steps (max ${RECIPE_LIMITS.stepCount})`);
  const steps: RecipeStep[] = [];
  for (const s of raw.steps) {
    const v = validStep(s);
    if (typeof v === 'string') return fail(v);
    steps.push(v);
  }

  let slots: Record<string, string> | undefined;
  if (raw.slots !== undefined) {
    if (!isObj(raw.slots)) return fail('slots must be an object of strings');
    const entries = Object.entries(raw.slots);
    if (entries.length > RECIPE_LIMITS.slotCount) return fail(`too many slots (max ${RECIPE_LIMITS.slotCount})`);
    slots = {};
    for (const [k, v] of entries) {
      const key = text(k, 24);
      const val = typeof v === 'string' ? v.slice(0, RECIPE_LIMITS.nameLen) : undefined;
      if (!key || val === undefined) return fail('slots must map short names to strings');
      slots[key] = val;
    }
  }

  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : undefined;
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined;
  if (createdAt === undefined || updatedAt === undefined) return fail('recipe needs numeric createdAt/updatedAt');

  const recipe: Recipe = {
    id, name, aliases, language,
    device: raw.device as RecipeDevice,
    taughtBy, steps, createdAt, updatedAt,
  };
  const mode = text(raw.mode, 16);
  if (mode) recipe.mode = mode;
  if (slots) recipe.slots = slots;
  const anchor = validPoint(raw.anchor);
  if (anchor) recipe.anchor = anchor;
  return { ok: true, recipe };
}

/** One human line for a recipe card: "7 steps · adds room, door ×2 · 2D plan". */
export function describeRecipe(recipe: Recipe): string {
  const counts = new Map<string, number>();
  for (const s of recipe.steps) {
    const name = String(s.op.op ?? '?');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .slice(0, 4)
    .map(([name, n]) => (n > 1 ? `${name.replace(/_/g, ' ')} ×${n}` : name.replace(/_/g, ' ')));
  const more = counts.size > 4 ? ', …' : '';
  const where = recipe.mode ? ` · ${recipe.mode}` : '';
  return `${recipe.steps.length} step${recipe.steps.length === 1 ? '' : 's'} · ${parts.join(', ')}${more}${where}`;
}
