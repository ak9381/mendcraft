import { describe, expect, it } from 'vitest';
import {
  createGeminiReview, waitingCountLine, reviewStatusLabel, proposalForReview, GEMINI_REVIEW_KEY,
} from '../src/cad/geminiReview';

function kv() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; }

describe('Gemini review checklist', () => {
  it('records offline answers and counts them for the demo line', () => {
    const s = kv();
    const r = createGeminiReview(s, () => 1000);
    r.recordOffline({ question: 'Is the kitchen 3 m wide?', offlineAnswer: 'Yes, 3.1 m.' });
    r.recordOffline({ question: 'Door clear width?', offlineAnswer: '800 mm' });
    r.recordOffline({ question: 'Ramp slope?', offlineAnswer: '1:12' });
    expect(r.waitingCountLine()).toBe('3 offline answers waiting for Gemini');
    expect(JSON.parse(s.m.get(GEMINI_REVIEW_KEY)!)).toHaveLength(3);
  });

  it('dedupes the same waiting question', () => {
    const r = createGeminiReview(null);
    const a = r.recordOffline({ question: 'Ramp slope?', offlineAnswer: '1:12' });
    const b = r.recordOffline({ question: 'ramp slope? ', offlineAnswer: '1:14' });
    expect(b.id).toBe(a.id);
    expect(r.items()).toHaveLength(1);
    expect(r.get(a.id)!.offlineAnswer).toBe('1:14');
  });

  it('Gemini correction becomes a Proposal; pinch keeps corrected, drop marks checked', () => {
    const r = createGeminiReview(null);
    const a = r.recordOffline({ question: 'Door width?', offlineAnswer: '700 mm' });
    const b = r.recordOffline({ question: 'Hall width?', offlineAnswer: '1.2 m' });
    r.recordGeminiResult(a.id, { geminiAnswer: '800 mm', agreed: false, because: 'the plan door is 800 mm' });
    r.recordGeminiResult(b.id, { geminiAnswer: '1.2 m', agreed: true });
    expect(waitingCountLine(r.items())).toBe('2 Gemini reviews waiting for you'); // both awaiting pinch
    const p = proposalForReview(r.get(a.id)!);
    expect(p.verdict).toBe('corrected');
    expect(p.why).toContain('the plan door is 800 mm');
    r.accept(a.id);
    expect(reviewStatusLabel(r.get(a.id)!)).toBe('Gemini corrected because the plan door is 800 mm');
    r.drop(b.id);
    expect(reviewStatusLabel(r.get(b.id)!)).toBe('Checked');
    expect(r.waitingCountLine()).toBe('No offline answers waiting for Gemini');
  });

  it('survives reload and ignores junk', () => {
    const s = kv();
    const r = createGeminiReview(s);
    r.recordOffline({ question: 'Q?', offlineAnswer: 'A' });
    s.m.set(GEMINI_REVIEW_KEY, JSON.stringify([...JSON.parse(s.m.get(GEMINI_REVIEW_KEY)!), { bad: 1 }]));
    expect(createGeminiReview(s).items()).toHaveLength(1);
  });
});
