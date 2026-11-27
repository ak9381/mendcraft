// @vitest-environment happy-dom
// A pack the way live Gemini 2.x writes it.
// Live (production, "add kannada"): Gemini answered in ~2 s and the canvas
// said "The Kannada pack was incomplete" because one core key was left out;
// any single imperfect string sank the whole pack. This reply is written the
// way Gemini really writes one: in a code fence, brand names and numbers kept
// in Latin, two strings too long, a phrase in Latin transliteration, a status
// key left out, and keys it invented. The bad packs must still be refused.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EN_PACK, coerceLanguagePack, statusText } from '../../src/canvas/languagePack';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { KN_PACK } from '../helpers/knPack';

const LIVE_LIKE_REPLY = '```json\n' + JSON.stringify({
  lang: 'kn',
  strings: {
    showEverything: 'ಎಲ್ಲವನ್ನೂ ತೋರಿಸು',
    newBoard: 'ಹೊಸ ಬೋರ್ಡ್',
    save: 'ಉಳಿಸಿ',
    undo: 'ರದ್ದುಮಾಡಿ',
    ai: 'AI ಚಟುವಟಿಕೆ (Gemini, Nano)',
    sayPlaceholder: 'ಆಜ್ಞೆಯನ್ನು ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ಹೇಳಿ…',
    emptyLead: 'ಈ ಬೋರ್ಡ್‌ನಲ್ಲಿ ನೀವು ಏನನ್ನು ನಿರ್ಮಿಸಲು ಬಯಸುತ್ತೀರಿ? ಉದಾಹರಣೆಗೆ Spotify ಪ್ಲೇಯರ್, WiZ ದೀಪ, 3D ನೆಲ ನಕ್ಷೆ ಅಥವಾ DXF ಫೈಲ್ ಅನ್ನು ಸೇರಿಸಿ ನೋಡಿ',
    emptyConnect: 'ಈ ಕೋಣೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ',
    emptyFloorplan: '3D ನೆಲ ನಕ್ಷೆ',
    keep: 'ಇಟ್ಟುಕೊಳ್ಳಿ',
    drop: 'ಬಿಡಿ',
    // `go` left out
    hands: 'ಕೈಗಳು',
    simulateOffline: 'ಆಫ್‌ಲೈನ್ ಅನುಕರಿಸಿ',
    offlineOn: 'ಆಫ್‌ಲೈನ್ (ಅನುಕರಿಸಲಾಗಿದೆ) — 100% ಸ್ಥಳೀಯ',
    tools: 'ಪರಿಕರಗಳು',
    approve: 'ಅನುಮೋದಿಸಿ',
    reject: 'ತಿರಸ್ಕರಿಸಿ',
    askElse: 'ಬೇರೆ ಏನಾದರೂ ಕೇಳಿ, ಉದಾಹರಣೆಗೆ ಬೆಳಕನ್ನು 50% ಗೆ ಇಳಿಸಿ ಅಥವಾ Spotify ನಲ್ಲಿ ಮುಂದಿನ ಹಾಡನ್ನು ಹಾಕಿ',
    title: 'ಮೆಂಡ್‌ಕ್ರಾಫ್ಟ್',
  },
  phrases: {
    lampOn: ['ದೀಪ ಆನ್ ಮಾಡಿ', 'deepa on maadi'],
    lampOff: ['ದೀಪ ಆಫ್ ಮಾಡಿ'],
    brighter: ['ಇನ್ನಷ್ಟು ಪ್ರಕಾಶಮಾನ'],
    dimmer: ['ಮಂದಗೊಳಿಸಿ'],
    save: ['ಉಳಿಸಿ'],
    undo: ['ರದ್ದುಮಾಡಿ'],
    ai: ['ಎಐ'],
  },
  status: {
    lightsOn: 'ದೀಪ ಆನ್ ಆಯಿತು.', lightsOff: 'ದೀಪ ಆಫ್ ಆಯಿತು.', brighter: 'ಇನ್ನಷ್ಟು ಪ್ರಕಾಶಮಾನ.', dimmer: 'ಮಂದವಾಯಿತು.',
    playing: 'ಪ್ಲೇ ಆಗುತ್ತಿದೆ.', paused: 'ವಿರಾಮ.', nextSong: 'ಮುಂದಿನ ಹಾಡು.', louder: 'ಜೋರಾಗಿ.', softer: 'ಮೆಲ್ಲಗೆ.',
    // `done` left out
    volume: 'ಧ್ವನಿ 50%.',
  },
}, null, 2) + '\n```';
const livePack = (): { lang: string; strings: Record<string, string> } =>
  JSON.parse(LIVE_LIKE_REPLY.slice(LIVE_LIKE_REPLY.indexOf('{'), LIVE_LIKE_REPLY.lastIndexOf('}') + 1));

let handle: CanvasHandle | null = null;
function mount(reply: string): { h: CanvasHandle; root: HTMLElement } {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = document.createElement('div');
  document.body.append(root);
  const engines = { gemini: () => ({ id: 'gemini' as const, sim: false, stream: async () => reply }) };
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, engines });
  return { h: handle, root };
}
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });
const barText = (root: HTMLElement): string | undefined => root.querySelector<HTMLElement>('[data-i18n=showEverything]')?.textContent?.trim();
const reviewTitle = (root: HTMLElement): string => root.querySelector('.mc-review-title')?.textContent ?? '';

describe('a live-like Gemini Kannada pack', () => {
  it('passes, with each dropped or missing key named in the notes', () => {
    const r = coerceLanguagePack(livePack());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Brand names, "3D" and "100%" are neutral for the script share.
    expect(r.value.strings.ai).toBe('AI ಚಟುವಟಿಕೆ (Gemini, Nano)');
    expect(r.value.strings.emptyFloorplan).toBe('3D ನೆಲ ನಕ್ಷೆ');
    expect(r.value.strings.offlineOn).toBe('ಆಫ್‌ಲೈನ್ (ಅನುಕರಿಸಲಾಗಿದೆ) — 100% ಸ್ಥಳೀಯ');
    // Too long: dropped; those two labels stay English.
    expect(r.value.strings.emptyLead).toBeUndefined();
    expect(r.value.strings.askElse).toBeUndefined();
    expect(r.value.phrases.lampOn).toEqual(['ದೀಪ ಆನ್ ಮಾಡಿ']);
    expect(r.value.status?.lightsOn).toBe('ದೀಪ ಆನ್ ಆಯಿತು.');
    expect(statusText('done', r.value)).toBe('Done.');
    expect(r.notes).toEqual([
      'missing, kept English: go',
      'dropped, kept English: emptyLead (longer than 80 characters), askElse (longer than 80 characters)',
      'unknown keys ignored: title',
      'phrases for unknown intents ignored: ai',
      'phrases dropped: lampOn “deepa on maadi” (not Kannada script)',
      'status lines missing, kept English: done',
      'unknown status keys ignored: volume',
    ]);
  });

  it('opens the review on the canvas and logs what the check dropped', async () => {
    const { h, root } = mount(LIVE_LIKE_REPLY);
    h.run('add kannada');
    await vi.waitFor(() => expect(reviewTitle(root)).toBe('Add Kannada'), { timeout: 8000 });
    const log = document.body.textContent ?? '';
    // The review says which labels stay English before she approves.
    const review = root.querySelector('.mc-review-dialog')?.textContent ?? '';
    expect(review).toContain('Stays English: What would you like to build on this board?, Go, Something else, 1 status line');
    expect(log).toContain('pack check: missing, kept English: go');
    expect(log).toContain('emptyLead (longer than 80 characters)');
    h.keep();
    await vi.waitFor(() => expect(barText(root)).toBe('ಎಲ್ಲವನ್ನೂ ತೋರಿಸು'));
  });

  it('still refuses the bad packs, and the log names why', async () => {
    const pack = livePack();
    // Mostly English: the script is wrong overall.
    const english = { ...pack, strings: { ...EN_PACK.strings, showEverything: 'ಎಲ್ಲವನ್ನೂ ತೋರಿಸು', save: 'ಉಳಿಸಿ' } };
    const r = coerceLanguagePack(english);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^most core strings failed the Kannada script check: 13 of 15 \(newBoard \(not Kannada script\)/);
    // Most core keys missing.
    const few = coerceLanguagePack({ ...pack, strings: { save: 'ಉಳಿಸಿ', keep: 'ಇಟ್ಟುಕೊಳ್ಳಿ' } });
    expect(few.ok).toBe(false);
    if (!few.ok) expect(few.error).toMatch(/^incomplete pack: missing 13 of 15 core strings/);
    // Every string carries a direction override.
    const rlo = Object.fromEntries(Object.entries(pack.strings).map(([k, v]) => [k, `‮${v}`]));
    const evil = coerceLanguagePack({ ...pack, strings: rlo });
    expect(evil.ok).toBe(false);
    if (!evil.ok) expect(evil.error).toMatch(/hidden or direction characters/);
    // Brand names alone are not Kannada.
    const brand = coerceLanguagePack({ ...pack, strings: { ...pack.strings, ai: 'Gemini Nano' } });
    expect(brand.ok && brand.value.strings.ai).toBeUndefined();
    expect(brand.ok && brand.notes?.[1]).toMatch(/ai \(not Kannada script\)/);
    // A stored pack changed since approval is refused whole.
    expect(coerceLanguagePack({ ...KN_PACK, strings: { ...KN_PACK.strings, keep: 'Keep' } }, { stored: true }).ok).toBe(false);
    expect(coerceLanguagePack(KN_PACK, { stored: true }).ok).toBe(true);

    // One markup string in an otherwise good live pack is tampering: refused whole.
    const marked = coerceLanguagePack({ ...pack, strings: { ...pack.strings, save: 'ಉಳಿಸಿ <img src=x>' } });
    expect(marked).toEqual({ ok: false, error: 'unsafe text in the pack: string save (markup)' });
    const hiddenStatus = coerceLanguagePack({ ...pack, status: { lightsOn: `ದೀಪ${String.fromCharCode(0x200B)}ಆನ್` } });
    expect(hiddenStatus).toEqual({ ok: false, error: 'unsafe text in the pack: status lightsOn (hidden or direction characters)' });

    const { h } = mount(JSON.stringify(english));
    h.run('add kannada');
    await vi.waitFor(() => expect(h.statusSince(0).some((t) => /^Refused the Kannada pack: most core strings failed/.test(t) && t.endsWith('Nothing was generated.'))).toBe(true));
    expect(document.body.textContent).toContain('pack check: most core strings failed the Kannada script check');
  });
});

describe('neutral Latin in the script share', () => {
  const withAi = (ai: string) => coerceLanguagePack({ ...KN_PACK, strings: { ...KN_PACK.strings, ai } });
  const kept = (ai: string): boolean => { const r = withAi(ai); return r.ok && r.value.strings.ai === ai; };

  it('only real numbers with units are neutral, not digits hidden in a Latin word', () => {
    expect(kept('Delete0all0your0files ಅ')).toBe(false);
    expect(kept('Send1to1Google ಅ')).toBe(false);
    for (const s of ['ಬೆಳಕು 60%', '3D ನೆಲ ನಕ್ಷೆ', 'ವೇಗ 2.4GHz ವೈಫೈ', 'ದೀಪ 100W ಬೆಳಕು', 'ತಾಪ 21°C ಇದೆ']) expect(kept(s), s).toBe(true);
  });

  it('brand names are neutral only in their exact casing, and never carry a label alone', () => {
    expect(kept('AI ಚಟುವಟಿಕೆ (Gemini, Nano)')).toBe(true);
    expect(kept('AI Gemini Nano ಅ')).toBe(false);
    expect(kept('OK ಅ')).toBe(false);
    expect(kept('gemini nano ಚಟುವಟಿಕೆ')).toBe(false); // lower case is ordinary English
  });
});

import { stringFault as sf } from '../../src/canvas/languagePack';
describe('a direction override hidden behind a newline', () => {
  it('is reported as hidden/direction characters, not as a multi-line slip', () => {
    expect(sf('x\n‮ಅಆ', 'kn', /\p{Script=Kannada}/u)).toBe('hidden or direction characters');
    expect(sf('ಅಆ\nಇಈ', 'kn', /\p{Script=Kannada}/u)).toBe('more than one line');
  });
});
