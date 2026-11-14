// "Taught once" recipes: validator, recorder + repeat detection, relative
// replay, rules matcher + meta phrases, and storage merge. All pure modules.

import { describe, expect, it } from 'vitest';
import { describeRecipe, isJsonSafe, validateRecipe, type Recipe } from '../src/recipes/model';
import {
  createRecipeRecorder, detectRepeat, makeDesignerRecipe, opSignature,
} from '../src/recipes/recorder';
import {
  anchorOf, buildReplayBatch, buildReplayOps, relativizeSteps, shiftOp,
} from '../src/recipes/replay';
import {
  buildRecipePickPrompt, matchRecipe, normalizePhrase, parseRecipeMeta, parseRecipePick,
} from '../src/recipes/match';
import { createRecipeStore, emptyBook, mergeBooks, sanitizeBook, type RecipeBook } from '../src/recipes/storage';

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'rcp-1',
    name: "Amma's bathroom",
    aliases: ['amma bathroom'],
    language: 'en',
    device: 'designer',
    mode: 'plan',
    taughtBy: 'you',
    steps: [{ op: { op: 'add_room', x: 0, y: 0, w: 2000, h: 1500 } }],
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

// ---------------------------------------------------------------------------
describe('recipe validator', () => {
  it('accepts a well-formed recipe and trims text', () => {
    const v = validateRecipe({ ...recipe(), name: '  Amma bath  ' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.recipe.name).toBe('Amma bath');
  });

  it('rejects missing name, bad device, empty steps', () => {
    expect(validateRecipe({ ...recipe(), name: '' }).ok).toBe(false);
    expect(validateRecipe({ ...recipe(), device: 'toaster' }).ok).toBe(false);
    expect(validateRecipe({ ...recipe(), steps: [] }).ok).toBe(false);
    expect(validateRecipe(null).ok).toBe(false);
  });

  it('rejects too many steps and steps without an op name', () => {
    const many = Array.from({ length: 41 }, () => ({ op: { op: 'move', target: 'selected', dx: 1 } }));
    expect(validateRecipe({ ...recipe(), steps: many }).ok).toBe(false);
    expect(validateRecipe({ ...recipe(), steps: [{ op: { dx: 5 } }] }).ok).toBe(false);
  });

  it('is a no-code gate: functions, class instances, and deep nests are rejected', () => {
    expect(isJsonSafe({ op: 'move', run: () => 1 })).toBe(false);
    expect(isJsonSafe(new (class X { op = 'move'; })())).toBe(false);
    let deep: Record<string, unknown> = { op: 'x' };
    for (let i = 0; i < 10; i++) deep = { op: 'x', inner: deep };
    expect(isJsonSafe(deep)).toBe(false);
    const bad = validateRecipe({ ...recipe(), steps: [{ op: { op: 'move', cb: () => 0 } }] });
    expect(bad.ok).toBe(false);
  });

  it('describes a recipe in one line', () => {
    const r = recipe({
      steps: [
        { op: { op: 'add_room', x: 0, y: 0, w: 1, h: 1 } },
        { op: { op: 'add_door', target: 'selected', width: 900 } },
        { op: { op: 'add_door', target: 'selected', width: 900 } },
      ],
    });
    expect(describeRecipe(r)).toContain('3 steps');
    expect(describeRecipe(r)).toContain('add door ×2');
  });
});

// ---------------------------------------------------------------------------
describe('recorder', () => {
  it('records only while active, skips selection/undo ops', () => {
    const rec = createRecipeRecorder();
    rec.note({ op: 'add_room', x: 1, y: 1, w: 2, h: 2 }); // inactive → ignored
    rec.start();
    rec.note({ op: 'select', target: 'wall-1' });
    rec.note({ op: 'undo' });
    rec.note({ op: 'add_room', x: 1000, y: 500, w: 2000, h: 1500 });
    expect(rec.count()).toBe(1);
  });

  it('coalesces consecutive moves of the same target by summing deltas', () => {
    const rec = createRecipeRecorder();
    rec.start();
    rec.note({ op: 'move', target: 'wall-1', dx: 100, dy: 0 });
    rec.note({ op: 'move', target: 'wall-1', dx: 50, dy: 25 });
    rec.note({ op: 'move', target: 'wall-2', dx: 10, dy: 0 });
    expect(rec.count()).toBe(2);
    const r = rec.save({ id: 'r1', name: 'nudge', language: 'en', mode: 'plan', taughtBy: 'you', now: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.recipe.steps[0].op).toMatchObject({ op: 'move', dx: 150, dy: 25 });
  });

  it('keeps only the last of consecutive absolute tweaks (set_length)', () => {
    const rec = createRecipeRecorder();
    rec.start();
    rec.note({ op: 'set_length', target: 'wall-1', length: 3000 });
    rec.note({ op: 'set_length', target: 'wall-1', length: 4000 });
    expect(rec.count()).toBe(1);
  });

  it('save relativizes positions to the anchor and targets to selected, then resets', () => {
    const rec = createRecipeRecorder();
    rec.start();
    rec.note({ op: 'add_room', x: 1000, y: 500, w: 2000, h: 1500 });
    rec.note({ op: 'add_door', target: 'wall-7', width: 900, swing: 'left' });
    const r = rec.save({ id: 'r1', name: 'bath', language: 'en', mode: 'plan', taughtBy: 'you', now: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipe.anchor).toEqual({ x: 1000, y: 500 });
      expect(r.recipe.steps[0].op).toMatchObject({ op: 'add_room', x: 0, y: 0 });
      expect(r.recipe.steps[1].op.target).toBe('selected');
    }
    expect(rec.active()).toBe(false);
    expect(rec.count()).toBe(0);
  });

  it('refuses to save an empty draft', () => {
    const rec = createRecipeRecorder();
    rec.start();
    const r = rec.save({ id: 'r1', name: 'empty', language: 'en', mode: 'plan', taughtBy: 'you', now: 1 });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('repeat detection', () => {
  const sig = (op: Record<string, unknown>) => opSignature(op);

  it('signature ignores target/ids but keeps parameters', () => {
    expect(sig({ op: 'add_door', target: 'wall-1', width: 900 }))
      .toBe(sig({ op: 'add_door', target: 'wall-9', width: 900 }));
    expect(sig({ op: 'add_door', target: 'wall-1', width: 900 }))
      .not.toBe(sig({ op: 'add_door', target: 'wall-1', width: 800 }));
  });

  it('detects a 2-op sequence done twice and prefers the longest repeat', () => {
    const a = sig({ op: 'add_door', width: 900 });
    const b = sig({ op: 'add_window', width: 1200 });
    expect(detectRepeat([a, b, a, b])).toBe(2);
    expect(detectRepeat([b, a, b])).toBeNull();
    const c = sig({ op: 'add_fixture', kind: 'wc' });
    expect(detectRepeat([a, b, c, a, b, c])).toBe(3);
  });

  it('ignores a doubled single op (below minLen)', () => {
    const a = sig({ op: 'move', dx: 10 });
    expect(detectRepeat([a, a])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('relative replay', () => {
  it('anchorOf finds the first placed point', () => {
    expect(anchorOf([
      { op: { op: 'set_length', target: 'selected', length: 1 } },
      { op: { op: 'add_wall', a: { x: 10, y: 20 }, b: { x: 30, y: 20 }, thickness: 100 } },
    ])).toEqual({ x: 10, y: 20 });
    expect(anchorOf([{ op: { op: 'move', dx: 1, dy: 2 } }])).toEqual({ x: 0, y: 0 });
  });

  it('shiftOp moves x/y, a/b and 3D position but never deltas or sizes', () => {
    const room = shiftOp({ op: 'add_room', x: 100, y: 50, w: 2000, h: 1500 }, 10, -5);
    expect(room).toMatchObject({ x: 110, y: 45, w: 2000, h: 1500 });
    const wall = shiftOp({ op: 'add_wall', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, 5, 5);
    expect(wall.a).toEqual({ x: 5, y: 5 });
    expect(wall.b).toEqual({ x: 105, y: 5 });
    const mv = shiftOp({ op: 'move', target: 't', dx: 10, dy: 10 }, 99, 99);
    expect(mv).toMatchObject({ dx: 10, dy: 10 });
    const add = shiftOp({ op: 'add', shape: 'box', position: { x: 1, y: 2, z: 3 } }, 1, 1);
    expect(add.position).toEqual({ x: 2, y: 3, z: 3 });
  });

  it('relativize + rebase replays the same shape at a new anchor', () => {
    const steps = [
      { op: { op: 'add_room', x: 1000, y: 500, w: 2000, h: 1500 } },
      { op: { op: 'add_fixture', kind: 'wc', x: 1400, y: 900, w: 400, d: 600, rotation: 0 } },
    ];
    const rel = relativizeSteps(steps, { x: 1000, y: 500 });
    expect(rel[1].op).toMatchObject({ x: 400, y: 400 });
    const ops = buildReplayOps(recipe({ steps: rel, anchor: { x: 1000, y: 500 } }), { x: 5000, y: 5000 });
    expect(ops[0]).toMatchObject({ x: 5000, y: 5000 });
    expect(ops[1]).toMatchObject({ x: 5400, y: 5400 });
  });

  it('with no anchor the recipe replays at its recorded spot', () => {
    const rel = relativizeSteps([{ op: { op: 'add_room', x: 1000, y: 500, w: 1, h: 1 } }], { x: 1000, y: 500 });
    const ops = buildReplayOps(recipe({ steps: rel, anchor: { x: 1000, y: 500 } }));
    expect(ops[0]).toMatchObject({ x: 1000, y: 500 });
  });

  it('wraps multi-step replays as ONE batch (single undo group)', () => {
    const ops = [{ op: 'add_room', x: 0, y: 0, w: 1, h: 1 }, { op: 'add_door', target: 'selected', width: 900 }];
    expect(buildReplayBatch(ops)).toEqual({ op: 'batch', ops });
    expect(buildReplayBatch([ops[0]])).toEqual(ops[0]);
  });
});

// ---------------------------------------------------------------------------
describe('rules matcher + meta phrases', () => {
  const refs = [
    { id: 'a', name: "Amma's bathroom", aliases: ['amma bathroom', 'ಅಮ್ಮನ ಬಚ್ಚಲು'] },
    { id: 'b', name: 'Desk nook', aliases: [] },
  ];

  it('normalizes punctuation and case (Kannada letters survive)', () => {
    expect(normalizePhrase("  Amma's  Bathroom! ")).toBe('amma s bathroom');
    expect(normalizePhrase('ಅಮ್ಮನ ಬಚ್ಚಲು ಮಾಡು')).toBe('ಅಮ್ಮನ ಬಚ್ಚಲು ಮಾಡು');
  });

  it('matches exact name, alias, and inside a longer phrase', () => {
    expect(matchRecipe("amma's bathroom", refs)?.id).toBe('a');
    expect(matchRecipe('amma bathroom', refs)?.how).toBe('exact');
    expect(matchRecipe('ಅಮ್ಮನ ಬಚ್ಚಲು', refs)?.id).toBe('a');
    expect(matchRecipe('please do the desk nook now', refs)?.id).toBe('b');
  });

  it('fuzzy-matches near misses and rejects unrelated phrases', () => {
    expect(matchRecipe('desk nok', refs)?.id).toBe('b'); // 1 edit
    expect(matchRecipe('bathroom for amma', refs)?.id).toBe('a'); // token overlap
    expect(matchRecipe('two bedroom plan', refs)).toBeNull();
  });

  it('parses English meta phrases', () => {
    expect(parseRecipeMeta('start teaching')).toEqual({ kind: 'start' });
    expect(parseRecipeMeta('stop teaching')).toEqual({ kind: 'cancel' });
    expect(parseRecipeMeta("save this as Amma's bathroom")).toEqual({ kind: 'save', name: "Amma's bathroom" });
    expect(parseRecipeMeta("do Amma's bathroom")).toEqual({ kind: 'run', name: "Amma's bathroom" });
    expect(parseRecipeMeta('run the recipe desk nook')).toEqual({ kind: 'run', name: 'desk nook' });
    expect(parseRecipeMeta('add a door')).toBeNull();
  });

  it('parses Kannada meta phrases', () => {
    expect(parseRecipeMeta('ಕಲಿಸು')).toEqual({ kind: 'start' });
    expect(parseRecipeMeta('ನಿಲ್ಲಿಸು')).toEqual({ kind: 'cancel' });
    expect(parseRecipeMeta('ಅಮ್ಮನ ಬಚ್ಚಲು ಅಂತ ಉಳಿಸು')).toEqual({ kind: 'save', name: 'ಅಮ್ಮನ ಬಚ್ಚಲು' });
    expect(parseRecipeMeta('ಅಮ್ಮನ ಬಚ್ಚಲು ಮಾಡು')).toEqual({ kind: 'run', name: 'ಅಮ್ಮನ ಬಚ್ಚಲು' });
  });

  it('parses the Nano pick strictly: invented ids become null', () => {
    expect(parseRecipePick({ recipeId: 'a', confidence: 0.9 }, ['a', 'b'])).toEqual({ id: 'a', confidence: 0.9 });
    expect(parseRecipePick({ recipeId: 'none', confidence: 0.9 }, ['a'])).toEqual({ id: null, confidence: 0 });
    expect(parseRecipePick({ recipeId: 'evil-id', confidence: 1 }, ['a'])).toEqual({ id: null, confidence: 0 });
    expect(parseRecipePick('junk', ['a'])).toEqual({ id: null, confidence: 0 });
    expect(buildRecipePickPrompt('do it', refs, 'Kannada')).toContain('Kannada');
  });
});

// ---------------------------------------------------------------------------
describe('storage merge + store', () => {
  it('merges by newest updatedAt per id', () => {
    const a: RecipeBook = { recipes: { r1: recipe({ id: 'r1', updatedAt: 10, name: 'old' }) }, deleted: {} };
    const b: RecipeBook = { recipes: { r1: recipe({ id: 'r1', updatedAt: 20, name: 'new' }) }, deleted: {} };
    expect(mergeBooks(a, b).recipes.r1.name).toBe('new');
    expect(mergeBooks(b, a).recipes.r1.name).toBe('new');
  });

  it('tombstones delete stale copies but a NEWER re-save survives', () => {
    const local: RecipeBook = { recipes: {}, deleted: { r1: 50 } };
    const stale: RecipeBook = { recipes: { r1: recipe({ id: 'r1', updatedAt: 40 }) }, deleted: {} };
    expect(mergeBooks(local, stale).recipes.r1).toBeUndefined();
    const retaught: RecipeBook = { recipes: { r1: recipe({ id: 'r1', updatedAt: 60 }) }, deleted: {} };
    const merged = mergeBooks(local, retaught);
    expect(merged.recipes.r1).toBeDefined();
    expect(merged.deleted.r1).toBe(50);
  });

  it('sanitize drops invalid recipes instead of crashing', () => {
    const book = sanitizeBook({ recipes: { ok: recipe(), bad: { id: 'bad' } }, deleted: { x: 1, y: 'nope' } });
    expect(Object.keys(book.recipes)).toEqual(['rcp-1']);
    expect(book.deleted).toEqual({ x: 1 });
    expect(sanitizeBook('garbage')).toEqual(emptyBook());
  });

  it('store round-trips through storage, tombstones deletes, rejects invalid upserts', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const store = createRecipeStore(storage);
    expect(store.upsert(recipe())).toBeNull();
    expect(store.upsert({ ...recipe(), id: '' } as Recipe)).toBeTruthy(); // invalid → error string
    expect(store.rename('rcp-1', 'Amma bath 2', 99)).toBe(true);
    expect(store.setAliases('rcp-1', [' amma ', ''], 99)).toBe(true);

    const reloaded = createRecipeStore(storage);
    expect(reloaded.get('rcp-1')?.name).toBe('Amma bath 2');
    expect(reloaded.get('rcp-1')?.aliases).toEqual(['amma']);

    expect(reloaded.remove('rcp-1', 123)).toBe(true);
    const again = createRecipeStore(storage);
    expect(again.list()).toEqual([]);
    expect(again.book().deleted['rcp-1']).toBe(123);
  });

  it('makeDesignerRecipe builds a valid recipe from a suggested repeat', () => {
    const steps = [
      { op: { op: 'add_fixture', kind: 'chair', x: 100, y: 100, w: 450, d: 450, rotation: 0 } },
      { op: { op: 'rotate', target: 'fx-1', angle: 90 } },
    ];
    const r = makeDesignerRecipe(steps, { id: 'r9', name: 'chair pair', language: 'en', mode: 'plan', taughtBy: 'you', now: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipe.device).toBe('designer');
      expect(r.recipe.steps[1].op.target).toBe('selected');
    }
  });
});
