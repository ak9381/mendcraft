// @vitest-environment happy-dom
// Language packs for any script in the fixed check table (Kannada first):
// the script check, the ask, and the pack as a stored artifact — approved
// once, applied from the store offline, kept when undo goes back to English,
// and dropped at load when it fails its check.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EN_PACK, LANG_NAMES, LANG_SCRIPTS, SCRIPT_UNKNOWN, STATUS_KEYS, coerceLanguagePack, languageAsk, packPrompt, packSwaps, statusText,
} from '../../src/canvas/languagePack';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { createReplayEngines } from '../../src/canvas/replayEngine';
import { joinCanvasDoc, splitCanvasDoc } from '../../src/canvas/canvasPersistence';
import { coerceArtifact, type Artifact } from '../../src/artifacts/artifact';
import { createMemoryArtifactStore, loadArtifacts } from '../../src/artifacts/store';
import { routeLine } from '../../src/canvas/routeLine';
import { spokenLangFor } from '../../src/ai/readAloud';
import type { CanvasDoc } from '../../src/canvas/frames';
import { KN_PACK } from '../helpers/knPack';

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '../fixtures/written/gemini.pack.kn.json'), 'utf8')) as { reply: string };
const packArtifact = (over: Partial<Artifact> = {}): Artifact => ({
  id: 'pack-kn', kind: 'pack', v: 1, title: 'Language: kn', by: 'gemini', at: 1, status: 'approved',
  data: KN_PACK as unknown as Record<string, unknown>, ...over,
});

describe('the script check (LANG_SCRIPTS)', () => {
  it('a Kannada pack passes; the same strings under lang "hi" are refused', () => {
    expect(coerceLanguagePack(KN_PACK).ok).toBe(true);
    const hi = coerceLanguagePack({ ...KN_PACK, lang: 'hi' });
    expect(hi.ok).toBe(false);
    if (!hi.ok) expect(hi.error).toMatch(/Hindi script/);
  });

  it('a pack for lang "xx" is refused with SCRIPT_UNKNOWN', () => {
    const r = coerceLanguagePack({ ...KN_PACK, lang: 'xx' });
    expect(r).toEqual({ ok: false, error: SCRIPT_UNKNOWN });
    expect(SCRIPT_UNKNOWN).toBe("I can't check that script yet. Nothing changed.");
    // English is the baseline in code, never a pack.
    expect(coerceLanguagePack(EN_PACK)).toEqual({ ok: false, error: SCRIPT_UNKNOWN });
  });

  it('the table and the names cover the same eleven languages', () => {
    expect(Object.keys(LANG_SCRIPTS).sort()).toEqual(['bn', 'de', 'es', 'fr', 'gu', 'hi', 'kn', 'ml', 'mr', 'ta', 'te']);
    expect(Object.keys(LANG_NAMES).sort()).toEqual(Object.keys(LANG_SCRIPTS).sort());
    // Hindi and Marathi share Devanagari; Spanish takes its accents.
    const deva = { ...KN_PACK.strings };
    for (const k of Object.keys(deva) as (keyof typeof deva)[]) deva[k] = 'सब दिखाओ';
    expect(coerceLanguagePack({ lang: 'hi', strings: deva }).ok).toBe(true);
    expect(coerceLanguagePack({ lang: 'mr', strings: deva }).ok).toBe(true);
    expect(coerceLanguagePack({ lang: 'ta', strings: deva }).ok).toBe(false);
    const es = { ...KN_PACK.strings };
    for (const k of Object.keys(es) as (keyof typeof es)[]) es[k] = 'Mostrar todo';
    expect(coerceLanguagePack({ lang: 'es', strings: es }).ok).toBe(true);
  });

  it('a phrase in another script is dropped, the pack kept (live: unknown intent "ai")', () => {
    const r = coerceLanguagePack({ ...KN_PACK, phrases: { lampOn: ['lamp on', 'ದೀಪ ಆನ್ ಮಾಡು'], ai: ['ಎಐ'] } });
    expect(r.ok && r.value.phrases).toEqual({ lampOn: ['ದೀಪ ಆನ್ ಮಾಡು'] });
  });

  it('a string must be mostly in its script, one line, with no hidden or direction characters', () => {
    const withKeep = (keep: string) => coerceLanguagePack({ ...KN_PACK, strings: { ...KN_PACK.strings, keep } });
    expect(withKeep('Show everything ಅ').ok).toBe(false); // English with one Kannada letter
    expect(withKeep('\u202Eಇಟ್ಟುಕೋ').ok).toBe(false); // right-to-left override
    for (const c of ['\u200B', '\u200E', '\u200F', '\u202A', '\u2066', '\u2069', '\uFEFF', '\u0007']) expect(withKeep(`ಇಟ್ಟು${c}ಕೋ`).ok, escape(c)).toBe(false);
    expect(withKeep('ಇಟ್ಟು\nಕೋ').ok).toBe(false);
    const zwj = withKeep('ನೆಲ ನಕ್ಷೆ\u200Dಗಳು\u200C');
    expect(zwj.ok).toBe(true); // ZWJ / ZWNJ join Kannada letters
    const trimmed = withKeep('  ಇಟ್ಟುಕೋ  ');
    expect(trimmed.ok && trimmed.value.strings.keep).toBe('ಇಟ್ಟುಕೋ');
    expect(withKeep('ಎಐ ಚಟುವಟಿಕೆ (AI)').ok).toBe(true); // a short Latin word inside is fine
  });

  it('a Latin-script pack that is mostly the English labels is refused', () => {
    const r = coerceLanguagePack({ lang: 'es', strings: { ...EN_PACK.strings, showEverything: 'Mostrar todo' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/still English/);
  });

  it('status lines are optional generated pack keys, checked like strings; English otherwise', () => {
    const r = coerceLanguagePack({ ...KN_PACK, status: { lightsOn: 'ದೀಪ ಆನ್ ಆಯಿತು.', lightsOff: 'Lights off.', beep: 'ಬೀಪ್' } });
    expect(r.ok && r.value.status).toEqual({ lightsOn: 'ದೀಪ ಆನ್ ಆಯಿತು.' });
    if (!r.ok) return;
    expect(statusText('lightsOn', r.value)).toBe('ದೀಪ ಆನ್ ಆಯಿತು.');
    expect(statusText('lightsOff', r.value)).toBe('Lights off.');
    const noStatus = coerceLanguagePack({ ...KN_PACK, status: undefined });
    expect(noStatus.ok && noStatus.value.status).toBeUndefined();
    expect(packPrompt('kn')).toContain('lightsOn: Lights on.');
  });

  it('the hand-written fixture passes the check, with its "ai" phrase dropped', () => {
    const t = FIXTURE.reply;
    const r = coerceLanguagePack(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.lang).toBe('kn'); expect(Object.keys(r.value.phrases)).not.toContain('ai');
      expect(Object.keys(r.value.status ?? {}).sort()).toEqual([...STATUS_KEYS].sort()); // "beep" dropped
    }
  });

  it('the prompt names the language and the English labels, and the review lists each swap', () => {
    const p = packPrompt('ta');
    expect(p).toContain('into Tamil');
    expect(p).toContain('"lang":"ta"');
    expect(p).toContain('showEverything: Show everything');
    expect(packSwaps(KN_PACK)[0]).toEqual({ key: 'showEverything', en: 'Show everything', to: 'ಎಲ್ಲಾ ತೋರಿಸು' });
  });

  it('a stored pack must sit under its own language id', () => {
    expect(coerceArtifact(packArtifact()).ok).toBe(true);
    expect(coerceArtifact(packArtifact({ id: 'pack-hi' })).ok).toBe(false);
  });
});

describe('languageAsk', () => {
  it('languageAsk finds kn, hi, ta, te, ml, bn, gu, mr, es, fr, de and nothing else', () => {
    const asks: [string, string][] = [
      ['add Kannada', 'kn'], ['switch to Hindi', 'hi'], ['in Tamil', 'ta'], ['add Telugu please', 'te'],
      ['change the language to Malayalam', 'ml'], ['use Bengali', 'bn'], ['switch to Gujarati.', 'gu'],
      ['add Marathi', 'mr'], ['in Spanish', 'es'], ['switch the canvas to French', 'fr'], ['add German', 'de'],
      ['Kannada pack', 'kn'], ['add हिन्दी', 'hi'], ['ಕನ್ನಡ ಪ್ಯಾಕ್'.replace(' ಪ್ಯಾಕ್', '') + ' pack', 'kn'],
    ];
    for (const [text, code] of asks) expect(languageAsk(text), text).toBe(code);
    for (const text of ['add Japanese', 'switch to English', 'play an old Kannada song', 'add a lamp', 'show everything',
      'translate this to Hindi for me later', 'new board', '', 'Hindi', 'ಕನ್ನಡ', 'German', 'I like Tamil films']) {
      expect(languageAsk(text), text).toBeNull();
    }
  });

  it('routes to one language turn: a table code, English, or a language it cannot check', () => {
    const world = { hasPlanBoard: false, devices: [] };
    expect(routeLine('add Kannada', world)).toEqual({ name: 'language', code: 'kn', fresh: false });
    expect(routeLine('switch to English', world)).toEqual({ name: 'language', code: 'en', fresh: false });
    expect(routeLine('add Japanese', world)).toEqual({ name: 'language', code: 'ja', fresh: false });
    expect(routeLine('make a new Kannada pack', world)).toEqual({ name: 'language', code: 'kn', fresh: true });
    expect(routeLine('write me a fresh Hindi language pack please', world)).toEqual({ name: 'language', code: 'hi', fresh: true });
    expect(routeLine('play an old Kannada song', world).name).not.toBe('language');
    // A language name said on its own, or in another sentence, is not an ask.
    for (const t of ['Hindi', 'Japanese', 'English', 'my mother speaks Tamil']) expect(routeLine(t, world).name, t).not.toBe('language');
  });
});

describe('read aloud follows the pack script', () => {
  it('speaks a line in the pack language only when it is in that script; never in another voice', () => {
    expect(spokenLangFor('ದೀಪ ಆನ್ ಆಯಿತು.', 'kn')).toBe('kn-IN');
    expect(spokenLangFor('Lights on.', 'kn')).toBeNull();
    expect(spokenLangFor('बत्ती जली', 'hi')).toBe('hi-IN');
    expect(spokenLangFor('Lights on.', 'hi')).toBeNull();
    expect(spokenLangFor('Lights on.', null)).toBe('en-US');
    expect(spokenLangFor('Lights on.', 'es')).toBe('en-US');
  });
});

// ---- the pack on the canvas, as a stored artifact ----
let handle: CanvasHandle | null = null;
function mount(opts: Parameters<typeof mountCanvas>[1] = {}): { h: CanvasHandle; root: HTMLElement } {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, ...opts });
  return { h: handle, root };
}
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });
const barText = (root: HTMLElement): string | undefined => root.querySelector<HTMLElement>('[data-i18n=showEverything]')?.textContent?.trim();
const reviewTitle = (root: HTMLElement): string => root.querySelector('.mc-review-title')?.textContent ?? '';
/** Save the way canvasMain does: layout + the artifacts that changed. */
function saveAll(doc: CanvasDoc, prev: Artifact[], h: CanvasHandle): Artifact[] {
  const by = (id: string) => h.makerOf(id) ?? prev.find((a) => a.id === id)?.by ?? 'person';
  const { put, remove } = splitCanvasDoc(doc, prev, by, 2);
  const map = new Map(prev.map((a) => [a.id, a]));
  for (const a of put) map.set(a.id, a);
  for (const id of remove) map.delete(id);
  return [...map.values()];
}

describe('the pack as an artifact', () => {
  it('an approved pack is stored as pack-kn and applied from the store when offline', async () => {
    const saved: CanvasDoc[] = [];
    // A live-like Gemini engine (not a replay): the artifact is credited to Gemini.
    const sub: (string | undefined)[] = [];
    const engines = { gemini: (_k: string, lang?: string) => { sub.push(lang); return { id: 'gemini' as const, sim: false, stream: async () => FIXTURE.reply }; } };
    const { h, root } = mount({ engines, onPersist: (d) => saved.push(d) });
    expect(barText(root)).toBe('Show everything');
    h.run('add Kannada');
    await vi.waitFor(() => expect(reviewTitle(root)).toBe('Add Kannada'), { timeout: 8000 });
    const review = root.querySelector('.mc-review-dialog')?.textContent ?? '';
    expect(review).toContain('Show everything → ಎಲ್ಲಾ ತೋರಿಸು');
    expect(review).toContain('Gemini');
    expect(barText(root)).toBe('Show everything'); // nothing applied before Approve
    expect(sub).toEqual(['kn']); // the turn asks for the Kannada reply
    h.keep();
    await vi.waitFor(() => expect(barText(root)).toBe('ಎಲ್ಲಾ ತೋರಿಸು'));
    await vi.waitFor(() => expect(saved.at(-1)?.pack?.lang).toBe('kn'));
    const stored = saveAll(saved.at(-1)!, [], h);
    const art = stored.find((a) => a.id === 'pack-kn');
    expect(art?.kind).toBe('pack');
    expect(art?.by).toBe('gemini');
    expect(coerceArtifact(art).ok).toBe(true);
    handle?.destroy(); document.body.innerHTML = '';

    // Offline, with English on screen: asking again applies the stored pack, no model, no review.
    const ask = vi.fn();
    const offline = createReplayEngines({});
    const counting = { gemini: (k: Parameters<NonNullable<typeof offline.gemini>>[0], sub?: string) => { ask(k, sub); return offline.gemini!(k, sub); } };
    const m = mount({ online: false, engines: counting, packs: stored.filter((a) => a.kind === 'pack') });
    expect(barText(m.root)).toBe('Show everything');
    m.h.run('add Kannada');
    await vi.waitFor(() => expect(barText(m.root)).toBe('ಎಲ್ಲಾ ತೋರಿಸು'));
    expect(reviewTitle(m.root)).toBe('');
    expect(ask).not.toHaveBeenCalled();
    expect(m.h.statusSince(0).join('\n')).toContain('Kannada is on, from the pack you approved.');
  });

  it('offline with no stored pack: nothing is written, she is told why', async () => {
    const { h, root } = mount({ online: false, engines: createReplayEngines({ 'gemini.pack.kn': FIXTURE.reply }) });
    h.run('add Hindi');
    await vi.waitFor(() => expect(h.statusSince(0).join('\n')).toContain('Writing a Hindi pack needs Gemini, and you are offline.'));
    expect(barText(root)).toBe('Show everything');
    expect(reviewTitle(root)).toBe('');
  });

  it('a language outside the table is refused with SCRIPT_UNKNOWN', async () => {
    const { h, root } = mount({ engines: createReplayEngines({}) });
    h.run('add Japanese');
    await vi.waitFor(() => expect(h.statusSince(0)).toContain(SCRIPT_UNKNOWN));
    expect(reviewTitle(root)).toBe('');
  });

  it('undo restores EN_PACK and keeps pack-kn in the store', async () => {
    const saved: CanvasDoc[] = [];
    const prev = [packArtifact()];
    const { h, root } = mount({ packs: prev, onPersist: (d) => saved.push(d) });
    h.run('add Kannada'); // from the store: approved before
    await vi.waitFor(() => expect(barText(root)).toBe(KN_PACK.strings.showEverything));
    expect(document.documentElement.lang).toBe('kn');
    h.undo();
    await vi.waitFor(() => expect(barText(root)).toBe(EN_PACK.strings.showEverything));
    expect(document.documentElement.lang).toBe('en');
    await vi.waitFor(() => { expect(saved.length).toBeGreaterThan(0); expect(saved.at(-1)?.pack).toBeUndefined(); });
    const after = splitCanvasDoc(saved.at(-1)!, prev, () => 'person', 2);
    expect(after.layout.lang).toBeUndefined();
    expect(after.remove).not.toContain('pack-kn');
    expect(after.put.map((a) => a.id)).not.toContain('pack-kn');
  });

  it('a pack loaded at boot: "switch to English" goes back, and undo brings it back with its maker', async () => {
    const saved: CanvasDoc[] = [];
    const prev = [packArtifact()];
    const doc = joinCanvasDoc({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], lang: 'kn' }, prev);
    expect(doc?.pack?.lang).toBe('kn');
    const { h, root } = mount({ doc, packs: prev, onPersist: (d) => saved.push(d) });
    expect(barText(root)).toBe(KN_PACK.strings.showEverything);
    h.run('switch to English');
    await vi.waitFor(() => expect(barText(root)).toBe(EN_PACK.strings.showEverything));
    h.undo();
    await vi.waitFor(() => expect(barText(root)).toBe(KN_PACK.strings.showEverything));
    await vi.waitFor(() => expect(saved.at(-1)?.pack?.lang).toBe('kn'));
    expect(saveAll(saved.at(-1)!, prev, h).find((a) => a.id === 'pack-kn')).toEqual(prev[0]); // unchanged, still Gemini's
  });

  it('a stored pack with an unknown string key is dropped on load and the UI stays English', async () => {
    const bad = packArtifact({ data: { ...KN_PACK, strings: { ...KN_PACK.strings, hack: 'ಆನ್' } } as unknown as Record<string, unknown> });
    const store = createMemoryArtifactStore([bad]);
    const loaded = await loadArtifacts(store);
    expect(loaded.ok).toEqual([]);
    expect(loaded.dropped.map((d) => d.id)).toEqual(['pack-kn']);
    const doc = joinCanvasDoc({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], lang: 'kn' }, loaded.ok);
    expect(doc?.pack).toBeUndefined();
    const { root } = mount({ doc, packs: loaded.ok });
    expect(barText(root)).toBe('Show everything');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('the language turn, more', () => {
  const stub = (reply: string) => ({ gemini: () => ({ id: 'gemini' as const, sim: false, stream: async () => reply }) });

  it('a pack that fails its check ends with "Nothing was generated."', async () => {
    const bad = JSON.stringify({ ...KN_PACK, strings: { keep: 'ಇಟ್ಟುಕೋ' } });
    const { h } = mount({ engines: stub(bad) });
    h.run('add Kannada');
    await vi.waitFor(() => expect(h.statusSince(0).some((t) => /^The Kannada pack was incomplete\. Still in English\. Nothing was generated\.$/.test(t))).toBe(true));
    handle?.destroy(); document.body.innerHTML = '';
    const other = mount({ engines: stub(JSON.stringify({ ...KN_PACK, lang: 'hi' })) });
    other.h.run('add Kannada');
    await vi.waitFor(() => expect(other.h.statusSince(0)).toContain('The pack came back for another language, not Kannada. Nothing was generated.'));
    handle?.destroy(); document.body.innerHTML = '';
    const nope = mount({ engines: { gemini: () => ({ id: 'gemini' as const, sim: false, stream: async () => { throw new Error('boom'); } }) } });
    nope.h.run('add Kannada');
    await vi.waitFor(() => expect(nope.h.statusSince(0).some((t) => t.startsWith('The Kannada pack didn’t arrive.') && t.endsWith('Nothing was generated.'))).toBe(true));
  });

  it('dropping a new pack while another shows says "Still in" that language, not English', async () => {
    const { h, root } = mount({ engines: stub(FIXTURE.reply), packs: [packArtifact()] });
    h.run('add Kannada'); // the stored pack, no review
    await vi.waitFor(() => expect(barText(root)).toBe(KN_PACK.strings.showEverything));
    h.run('make a new Kannada pack');
    await vi.waitFor(() => expect(reviewTitle(root)).toBe('Add Kannada'), { timeout: 8000 });
    h.drop();
    await vi.waitFor(() => expect(h.statusSince(0)).toContain('Kept Kannada. Nothing changed.'));
    expect(root.querySelector('.mc-ai-state')?.textContent).toBe('Dropped. Still in Kannada.');
    expect(h.statusSince(0).some((t) => /Still English|Kept English/.test(t))).toBe(false);
    expect(barText(root)).toBe(KN_PACK.strings.showEverything);
  });

  it('"make a new Kannada pack" asks Gemini again through review, even with one stored', async () => {
    const { h, root } = mount({ engines: stub(FIXTURE.reply), packs: [packArtifact()] });
    h.run('make a new Kannada pack');
    await vi.waitFor(() => expect(reviewTitle(root)).toBe('Add Kannada'), { timeout: 8000 });
    expect(barText(root)).toBe('Show everything');
  });

  it('offline, a language waits once: a second ask is not queued again', async () => {
    const { h } = mount({ online: false, engines: stub(FIXTURE.reply) });
    h.run('add Hindi');
    h.run('switch to Hindi');
    await vi.waitFor(() => expect(h.statusSince(0)).toContain('The Hindi pack is already waiting for Gemini. Nothing changed.'));
  });

  it('the maker: a replayed pack is replay\'s; going back to English is hers', async () => {
    const { h, root } = mount({ engines: createReplayEngines({ 'gemini.pack.kn': FIXTURE.reply }) });
    h.run('add Kannada');
    await vi.waitFor(() => expect(reviewTitle(root)).toBe('Add Kannada'), { timeout: 8000 });
    h.keep();
    await vi.waitFor(() => expect(barText(root)).toBe('ಎಲ್ಲಾ ತೋರಿಸು'));
    expect(h.makerOf('pack-kn')).toBe('replay');
    h.run('switch to English');
    await vi.waitFor(() => expect(barText(root)).toBe('Show everything'));
    expect(h.history().at(-1)?.by).toBe('her');
    expect(h.makerOf('pack-kn')).toBe('replay'); // the pack itself is unchanged
  });
});
