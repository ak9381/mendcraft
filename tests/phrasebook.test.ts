// Personal phrasebook: the pure store (create / load / update / select over an
// in-memory seam), the few-shot prefix builder, the privacy gate in fuseIntent,
// and the teach / correction parsers. No network, no IndexedDB — the real app
// swaps in the IndexedDB adapter behind the same PhrasebookStore interface.

import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_FEWSHOT,
  MAX_OP_CHARS,
  buildFewShotPrefix,
  createMemoryPhrasebookStore,
  createPhrasebook,
  normalizePhrase,
  parseCorrectionCommand,
  parseTeachCommand,
  phraseTokens,
  scoreEntry,
  selectExamples,
  type PhrasebookEntry,
  type PhrasebookStore,
} from '../src/ai/phrasebook';
import { buildFusionPrompt, type FusionContext } from '../src/ai/intentFusion';
import { fuseIntent, setModelsForTest, type TextGenModel } from '../src/ai/hybrid';
import { planMode, setActiveMode } from '../src/core/modes';

// A deterministic clock + id generator so seq/createdAt ties are intentional.
const fixedClock = () => 1000;
const opts = { now: fixedClock, genId: (s: number) => `p${s}` };

function entry(phrase: string, op: Record<string, unknown>, extra: Partial<PhrasebookEntry> = {}): PhrasebookEntry {
  return { id: phrase, phrase, op, mode: 'plan', kind: 'phrase', createdAt: 1000, seq: 1, ...extra };
}

describe('phrasebook store: create / load / update', () => {
  it('adds entries and reports the count', async () => {
    const pb = createPhrasebook(createMemoryPhrasebookStore(), opts);
    await pb.init();
    await pb.add({ phrase: 'pop a door here', op: { op: { op: 'add_door' } }, mode: 'plan', kind: 'phrase' });
    await pb.add({ phrase: 'the big room', op: { op: { op: 'select' } }, mode: 'plan', kind: 'phrase' });
    expect(pb.count()).toBe(2);
    expect(pb.entries().map((e) => e.phrase)).toContain('pop a door here');
  });

  it('persists across a store reload (survives like a page refresh)', async () => {
    const store = createMemoryPhrasebookStore();
    const pb1 = createPhrasebook(store, opts);
    await pb1.init();
    await pb1.add({ phrase: 'wider', op: { op: { op: 'resize' } }, mode: 'plan', kind: 'correction' });

    const pb2 = createPhrasebook(store, opts);
    await pb2.init();
    expect(pb2.count()).toBe(1);
    expect(pb2.entries()[0].kind).toBe('correction');
  });

  it('continues seq numbering after a reload (no id/seq collision)', async () => {
    const store = createMemoryPhrasebookStore();
    const pb1 = createPhrasebook(store, opts);
    await pb1.init();
    await pb1.add({ phrase: 'a', op: {}, mode: 'plan', kind: 'phrase' });
    await pb1.add({ phrase: 'b', op: {}, mode: 'plan', kind: 'phrase' });

    const pb2 = createPhrasebook(store, opts);
    await pb2.init();
    const c = await pb2.add({ phrase: 'c', op: {}, mode: 'plan', kind: 'phrase' });
    expect(c.seq).toBe(3);
    expect(pb2.count()).toBe(3);
  });

  it('re-teaching the same phrase updates in place instead of duplicating', async () => {
    const pb = createPhrasebook(createMemoryPhrasebookStore(), opts);
    await pb.init();
    const first = await pb.add({ phrase: 'the big room', op: { op: { op: 'a' } }, mode: 'plan', kind: 'phrase' });
    const second = await pb.add({ phrase: 'The Big Room', op: { op: { op: 'b' } }, mode: 'plan', kind: 'phrase' });
    expect(pb.count()).toBe(1);
    expect(second.id).toBe(first.id); // same slot, replaced op
    expect(pb.entries()[0].op).toEqual({ op: { op: 'b' } });
  });

  it('keeps same-text phrases in different modes separate', async () => {
    const pb = createPhrasebook(createMemoryPhrasebookStore(), opts);
    await pb.init();
    await pb.add({ phrase: 'the hero', op: {}, mode: 'plan', kind: 'phrase' });
    await pb.add({ phrase: 'the hero', op: {}, mode: 'ui', kind: 'phrase' });
    expect(pb.count()).toBe(2);
  });

  it('update() edits an entry and remove() drops it', async () => {
    const pb = createPhrasebook(createMemoryPhrasebookStore(), opts);
    await pb.init();
    const e = await pb.add({ phrase: 'wider', op: { v: 1 }, mode: 'plan', kind: 'phrase' });
    const up = await pb.update(e.id, { op: { v: 2 } });
    expect(up?.op).toEqual({ v: 2 });
    expect(await pb.update('missing', { op: {} })).toBeNull();
    await pb.remove(e.id);
    expect(pb.count()).toBe(0);
  });
});

describe('phrasebook text helpers', () => {
  it('normalizePhrase lowercases, trims, and strips edge punctuation', () => {
    expect(normalizePhrase('  The  Big-Room! ')).toBe('the big-room');
  });

  it('phraseTokens drops stopwords but keeps content', () => {
    expect(phraseTokens('make the big room')).toEqual(['big', 'room']);
  });

  it('phraseTokens falls back to all tokens when only stopwords', () => {
    expect(phraseTokens('make it')).toEqual(['make', 'it']);
  });

  it('scoreEntry ranks an exact match above a partial overlap', () => {
    const big = entry('the big room', {});
    const exact = scoreEntry(big, phraseTokens('select the big room'));
    const partial = scoreEntry(entry('big kitchen island', {}), phraseTokens('select the big room'));
    expect(exact).toBeGreaterThan(partial);
    expect(scoreEntry(big, phraseTokens('delete that wall'))).toBe(0);
  });
});

describe('selectExamples (relevance + caps)', () => {
  const entries: PhrasebookEntry[] = [
    entry('the big room', { op: 1 }, { seq: 1 }),
    entry('pop a door here', { op: 2 }, { seq: 2 }),
    entry('the big room wall', { op: 3 }, { seq: 3 }),
    entry('a ui thing', { op: 4 }, { seq: 4, mode: 'ui' }),
  ];

  it('returns only relevant, same-mode entries, best first', () => {
    const picked = selectExamples(entries, 'make the big room bigger', 'plan');
    expect(picked.map((e) => e.phrase)).toContain('the big room');
    expect(picked.every((e) => e.mode === 'plan')).toBe(true);
    // The ui-mode entry is never offered to a plan command.
    expect(picked.some((e) => e.mode === 'ui')).toBe(false);
  });

  it('returns [] when nothing overlaps (so an escalation sends no phrasebook)', () => {
    expect(selectExamples(entries, 'delete that column', 'plan')).toEqual([]);
    expect(selectExamples(entries, '', 'plan')).toEqual([]);
  });

  it('caps the number of examples', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(`wall number ${i}`, { i }, { seq: i }));
    expect(selectExamples(many, 'wall', 'plan').length).toBeLessThanOrEqual(MAX_FEWSHOT);
  });
});

describe('buildFewShotPrefix', () => {
  it('returns empty string for no entries (prompt stays unchanged)', () => {
    expect(buildFewShotPrefix([])).toBe('');
  });

  it('renders each phrase => op JSON on its own line', () => {
    const prefix = buildFewShotPrefix([
      entry('pop a door here', { op: { op: 'add_door' } }),
      entry('the big room', { op: { op: 'select', id: 'r1' } }),
    ]);
    expect(prefix).toContain('- "pop a door here" => {"op":{"op":"add_door"}}');
    expect(prefix).toContain('- "the big room" =>');
    expect(prefix.toLowerCase()).toContain('taught you');
  });

  it('truncates an oversized op so one entry cannot blow the context window', () => {
    const huge = { op: { notes: 'x'.repeat(500) } };
    const prefix = buildFewShotPrefix([entry('big one', huge)]);
    expect(prefix).toContain('(truncated)');
    // The rendered JSON for the entry stays within the cap (+ marker).
    const line = prefix.split('\n').find((l) => l.includes('big one'))!;
    expect(line.length).toBeLessThan(MAX_OP_CHARS + 80);
  });

  it('escapes double quotes in the phrase so it cannot break the line', () => {
    const prefix = buildFewShotPrefix([entry('say "hi"', {})]);
    expect(prefix).not.toContain('"hi"'); // double quotes become single quotes
    expect(prefix).toContain("say 'hi'");
  });
});

describe('teach / correction parsers', () => {
  it('parses "when I say X, do Y"', () => {
    expect(parseTeachCommand('when I say the big room, do select the living room'))
      .toEqual({ phrase: 'the big room', target: 'select the living room' });
  });

  it('parses "teach X means Y" and strips quotes', () => {
    expect(parseTeachCommand('teach "pop a door" means add a door'))
      .toEqual({ phrase: 'pop a door', target: 'add a door' });
  });

  it('rejects a non-teach command', () => {
    expect(parseTeachCommand('add a door')).toBeNull();
    expect(parseTeachCommand('when I say hello')).toBeNull(); // no target
  });

  it('parses corrections that carry an explicit "I meant" marker', () => {
    expect(parseCorrectionCommand('no, I meant move it left')).toEqual({ target: 'move it left' });
    expect(parseCorrectionCommand('actually, I meant widen the wall')).toEqual({ target: 'widen the wall' });
    expect(parseCorrectionCommand('no, actually I meant delete it')).toEqual({ target: 'delete it' });
    expect(parseCorrectionCommand('that should be 3 meters')).toEqual({ target: '3 meters' });
  });

  it('does not treat a normal command as a correction', () => {
    expect(parseCorrectionCommand('add a window')).toBeNull();
    // "actually" alone is a filler, not a correction marker — must NOT hijack.
    expect(parseCorrectionCommand('actually move the wall left')).toBeNull();
    expect(parseCorrectionCommand('actually, delete that door')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The privacy gate lives in fuseIntent: the phrasebook may be attached to the
// on-device model always, but reaches the cloud ONLY on a sanctioned escalation.

describe('buildFusionPrompt few-shot slot', () => {
  const ctx: FusionContext = {
    space: 'plan', unit: 'mm', cursor: null, hoverId: null, selectedIds: [], nearby: [],
  };
  it('includes the few-shot block when given, omits it when absent', () => {
    const withFew = buildFusionPrompt('INTENT', 'make it wider', ctx, undefined, 'FEWSHOT-BLOCK');
    expect(withFew).toContain('FEWSHOT-BLOCK');
    const without = buildFusionPrompt('INTENT', 'make it wider', ctx, undefined, '');
    expect(without).not.toContain('FEWSHOT-BLOCK');
  });
});

describe('fuseIntent privacy gate for the phrasebook', () => {
  const ctx: FusionContext = {
    space: 'plan', unit: 'mm', cursor: null, hoverId: null, selectedIds: [], nearby: [],
  };
  // A model that records the exact prompt it was asked, and echoes a valid op.
  function spyModel(inferenceSource: string): { model: TextGenModel; prompts: string[] } {
    const prompts: string[] = [];
    const model: TextGenModel = {
      generateContent: async (p: string) => {
        prompts.push(p);
        return { response: { text: () => '{"op":{"op":"select"},"confidence":0.9}', inferenceSource } };
      },
    };
    return { model, prompts };
  }

  afterEach(() => setModelsForTest(null));

  it('attaches the phrasebook to the on-device model', async () => {
    setActiveMode(planMode);
    const { model, prompts } = spyModel('on_device');
    setModelsForTest({ enabled: true, appCheck: 'ready', fusion: model });
    await fuseIntent('make the room wider', ctx, { fewShot: 'MY-PHRASEBOOK' });
    expect(prompts[0]).toContain('MY-PHRASEBOOK');
  });

  it('withholds the phrasebook from a first (non-escalated) cloud call', async () => {
    setActiveMode(planMode);
    const { model, prompts } = spyModel('in_cloud');
    setModelsForTest({ enabled: true, appCheck: 'ready', fusionCloud: model });
    // forceCloud with no examplesCloudOk = a no-device / translate call, NOT an
    // escalation → the phrasebook must not be sent.
    await fuseIntent('make the room wider', ctx, { forceCloud: true, fewShot: 'MY-PHRASEBOOK' });
    expect(prompts[0]).not.toContain('MY-PHRASEBOOK');
  });

  it('sends the phrasebook to the cloud ONLY on a sanctioned escalation', async () => {
    setActiveMode(planMode);
    const { model, prompts } = spyModel('in_cloud');
    setModelsForTest({ enabled: true, appCheck: 'ready', fusionCloud: model });
    await fuseIntent('make the room wider', ctx, {
      forceCloud: true, fewShot: 'MY-PHRASEBOOK', examplesCloudOk: true,
    });
    expect(prompts[0]).toContain('MY-PHRASEBOOK');
  });
});
