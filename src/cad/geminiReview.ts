// Visible "Gemini review" checklist for answers given while offline.
// Local only (same KV seam as the site checklist). Gemini's check is staged
// as a Proposal; nothing overwrites the offline answer until she pinches.

export type GeminiReviewStatus = 'waiting' | 'confirmed' | 'corrected' | 'checked';

export interface GeminiReviewItem {
  id: string;
  question: string;
  offlineAnswer: string;
  status: GeminiReviewStatus;
  /** Set once Gemini has reviewed; shown on the Proposal and after she keeps it. */
  geminiAnswer?: string;
  because?: string;
  /** Gemini has answered and a Proposal is waiting for her pinch. */
  awaitingPinch?: boolean;
  at: number;
  decidedAt?: number;
  jobId?: string;
}

export const GEMINI_REVIEW_KEY = 'mendcraft.gemini-review';
const MAX_ITEMS = 80;

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

const STATUSES: readonly GeminiReviewStatus[] = ['waiting', 'confirmed', 'corrected', 'checked'];

export function sanitizeReviewItem(raw: unknown): GeminiReviewItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.question !== 'string' || !o.question.trim()) return null;
  if (typeof o.offlineAnswer !== 'string') return null;
  if (typeof o.at !== 'number') return null;
  const status = STATUSES.includes(o.status as GeminiReviewStatus) ? (o.status as GeminiReviewStatus) : 'waiting';
  const item: GeminiReviewItem = {
    id: o.id.slice(0, 40),
    question: o.question.trim().slice(0, 400),
    offlineAnswer: o.offlineAnswer.slice(0, 2000),
    status,
    at: o.at,
  };
  if (typeof o.geminiAnswer === 'string' && o.geminiAnswer.trim()) item.geminiAnswer = o.geminiAnswer.slice(0, 2000);
  if (typeof o.because === 'string' && o.because.trim()) item.because = o.because.slice(0, 400);
  if (o.awaitingPinch === true) item.awaitingPinch = true;
  if (typeof o.decidedAt === 'number') item.decidedAt = o.decidedAt;
  if (typeof o.jobId === 'string' && o.jobId) item.jobId = o.jobId.slice(0, 40);
  return item;
}

/** Items still waiting for Gemini (not yet reviewed, or review not yet kept). */
export function waitingForGemini(items: readonly GeminiReviewItem[]): GeminiReviewItem[] {
  return items.filter((i) => i.status === 'waiting' && !i.awaitingPinch);
}

export function awaitingPinch(items: readonly GeminiReviewItem[]): GeminiReviewItem[] {
  return items.filter((i) => i.awaitingPinch === true);
}

export function unresolvedReview(items: readonly GeminiReviewItem[]): GeminiReviewItem[] {
  return items.filter((i) => i.status === 'waiting' || i.awaitingPinch);
}

export function waitingCountLine(items: readonly GeminiReviewItem[]): string {
  const n = waitingForGemini(items).length;
  const pinch = awaitingPinch(items).length;
  if (n === 0) {
    if (pinch === 1) return '1 Gemini review waiting for you';
    if (pinch > 1) return `${pinch} Gemini reviews waiting for you`;
    return 'No offline answers waiting for Gemini';
  }
  const wait = n === 1
    ? '1 offline answer waiting for Gemini'
    : `${n} offline answers waiting for Gemini`;
  if (pinch === 1) return `${wait} · 1 waiting for you`;
  if (pinch > 1) return `${wait} · ${pinch} waiting for you`;
  return wait;
}

export function reviewStatusLabel(item: GeminiReviewItem): string {
  if (item.awaitingPinch) {
    if (item.status === 'confirmed' || item.because?.startsWith('confirmed')) return 'Waiting for you · Gemini confirmed';
    if (item.status === 'corrected' || item.because?.startsWith('corrected')) return 'Waiting for you · Gemini corrected';
    return 'Waiting for you';
  }
  if (item.status === 'waiting') return 'Waiting';
  if (item.status === 'confirmed') return 'Gemini confirmed';
  if (item.status === 'corrected') return item.because ? `Gemini corrected because ${item.because}` : 'Gemini corrected';
  return 'Checked';
}

export function proposalForReview(item: GeminiReviewItem): { title: string; why: string; verdict: GeminiReviewStatus } {
  const agreed = item.status === 'confirmed' || /confirmed/i.test(item.because ?? '');
  const corrected = item.status === 'corrected' || /corrected/i.test(item.because ?? '');
  if (corrected) {
    return {
      title: 'Gemini corrected an offline answer',
      why: item.because
        ? `Gemini corrected because ${item.because}`
        : `Offline: ${item.offlineAnswer} · Gemini: ${item.geminiAnswer ?? ''}`.slice(0, 400),
      verdict: 'corrected',
    };
  }
  if (agreed) {
    return {
      title: 'Gemini confirmed the offline answer',
      why: item.because || 'Gemini agreed with the answer from your plan.',
      verdict: 'confirmed',
    };
  }
  return {
    title: 'Gemini checked an offline answer',
    why: item.because || 'Gemini looked at the offline answer.',
    verdict: 'checked',
  };
}

export function verdictFromAgreement(agreed: boolean | null): GeminiReviewStatus {
  if (agreed === true) return 'confirmed';
  if (agreed === false) return 'corrected';
  return 'checked';
}

export interface GeminiReviewList {
  items(): GeminiReviewItem[];
  get(id: string): GeminiReviewItem | undefined;
  findByQuestion(question: string): GeminiReviewItem | undefined;
  recordOffline(p: { question: string; offlineAnswer: string; jobId?: string }): GeminiReviewItem;
  recordGeminiResult(id: string, p: { geminiAnswer: string; agreed: boolean | null; because?: string }): GeminiReviewItem | null;
  accept(id: string): GeminiReviewItem | null;
  drop(id: string): GeminiReviewItem | null;
  remove(id: string): boolean;
  waitingCountLine(): string;
  subscribe(fn: () => void): () => void;
}

export function createGeminiReview(storage: KV | null, now: () => number = Date.now): GeminiReviewList {
  let items: GeminiReviewItem[] = load();
  const subs = new Set<() => void>();
  let counter = 0;

  function load(): GeminiReviewItem[] {
    try {
      const raw = storage?.getItem(GEMINI_REVIEW_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      return Array.isArray(arr) ? arr.map(sanitizeReviewItem).filter((x): x is GeminiReviewItem => !!x) : [];
    } catch {
      return [];
    }
  }
  function save(): void {
    try { storage?.setItem(GEMINI_REVIEW_KEY, JSON.stringify(items)); } catch { /* memory only */ }
    for (const fn of subs) fn();
  }
  function patch(id: string, next: Partial<GeminiReviewItem>): GeminiReviewItem | null {
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const updated = { ...items[i], ...next };
    items = items.map((x, j) => (j === i ? updated : x));
    save();
    return updated;
  }

  return {
    items: () => items.slice(),
    get: (id) => items.find((x) => x.id === id),
    findByQuestion(question) {
      const q = question.trim().toLowerCase();
      return items.find((x) => x.question.trim().toLowerCase() === q);
    },
    recordOffline({ question, offlineAnswer, jobId }) {
      const existing = items.find((x) =>
        x.status === 'waiting' && x.question.trim().toLowerCase() === question.trim().toLowerCase());
      if (existing) {
        return patch(existing.id, { offlineAnswer: offlineAnswer.slice(0, 2000), jobId: jobId ?? existing.jobId }) ?? existing;
      }
      counter += 1;
      const it: GeminiReviewItem = {
        id: `gr${now().toString(36)}${counter.toString(36)}`,
        question: question.trim().slice(0, 400),
        offlineAnswer: offlineAnswer.slice(0, 2000),
        status: 'waiting',
        at: now(),
        ...(jobId ? { jobId } : {}),
      };
      items = [...items, it].slice(-MAX_ITEMS);
      save();
      return it;
    },
    recordGeminiResult(id, p) {
      const verdict = verdictFromAgreement(p.agreed);
      const because = p.because
        ?? (verdict === 'confirmed'
          ? 'confirmed the offline answer'
          : verdict === 'corrected'
            ? 'the drawing answer did not match'
            : 'checked the offline answer');
      return patch(id, {
        geminiAnswer: p.geminiAnswer.slice(0, 2000),
        because,
        status: verdict,
        awaitingPinch: true,
      });
    },
    accept(id) {
      const cur = items.find((x) => x.id === id);
      if (!cur) return null;
      const status: GeminiReviewStatus = cur.status === 'waiting' ? 'checked' : cur.status;
      return patch(id, { awaitingPinch: false, status, decidedAt: now() });
    },
    drop(id) {
      // She keeps the offline answer; the check is recorded as looked at.
      return patch(id, { awaitingPinch: false, status: 'checked', decidedAt: now() });
    },
    remove(id) {
      const n = items.length;
      items = items.filter((x) => x.id !== id);
      if (items.length === n) return false;
      save();
      return true;
    },
    waitingCountLine: () => waitingCountLine(items),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
