// Site checklist. At a site with weak or no signal, questions Nano can't answer
// from the drawing ("check the guidelines", "can this wall come down?") are
// saved here instead of failing. Back online, she picks per item: "Ask Gemini"
// (research / run the check) or "Email the client" (Gemini drafts, she reads
// the draft, and NOTHING is sent unless she confirms — it opens her own mail
// app with the draft; she presses send there). Stored locally, synced to
// Firestore when online, shown live on the optional /control dashboard.

export type ChecklistStatus = 'open' | 'answered' | 'emailed' | 'done';

export interface ChecklistItem {
  id: string;
  question: string;
  /** Short plan context captured when asked (abstract geometry only). */
  context: string;
  askedAt: number;
  askedOffline: boolean;
  status: ChecklistStatus;
  answer?: string;
  answeredBy?: 'gemini' | 'rules';
  updatedAt: number;
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}

export const CHECKLIST_KEY = 'mendcraft.sitechecklist';
const MAX_ITEMS = 60;
const STATUSES: readonly ChecklistStatus[] = ['open', 'answered', 'emailed', 'done'];

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function sanitizeItem(raw: unknown): ChecklistItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.question !== 'string' || !o.question.trim()) return null;
  if (typeof o.askedAt !== 'number') return null;
  const status = STATUSES.includes(o.status as ChecklistStatus) ? (o.status as ChecklistStatus) : 'open';
  return {
    id: o.id.slice(0, 40),
    question: o.question.slice(0, 400),
    context: typeof o.context === 'string' ? o.context.slice(0, 400) : '',
    askedAt: o.askedAt,
    askedOffline: o.askedOffline === true,
    status,
    ...(typeof o.answer === 'string' ? { answer: o.answer.slice(0, 2000) } : {}),
    ...(o.answeredBy === 'gemini' || o.answeredBy === 'rules' ? { answeredBy: o.answeredBy } : {}),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : o.askedAt,
  };
}

export function mergeItems(a: readonly ChecklistItem[], b: readonly ChecklistItem[]): ChecklistItem[] {
  const byId = new Map<string, ChecklistItem>();
  for (const it of [...a, ...b]) {
    const cur = byId.get(it.id);
    if (!cur || it.updatedAt > cur.updatedAt) byId.set(it.id, it);
  }
  return [...byId.values()].sort((x, y) => x.askedAt - y.askedAt).slice(-MAX_ITEMS);
}

export interface SiteChecklist {
  items(): ChecklistItem[];
  open(): ChecklistItem[];
  get(id: string): ChecklistItem | undefined;
  add(question: string, context: string, offline: boolean): ChecklistItem;
  answer(id: string, answer: string, by: 'gemini' | 'rules'): boolean;
  mark(id: string, status: ChecklistStatus): boolean;
  remove(id: string): boolean;
  replaceItems(items: ChecklistItem[]): void;
  subscribe(fn: () => void): () => void;
}

export function createSiteChecklist(storage: KV | null, now: () => number = Date.now): SiteChecklist {
  let items: ChecklistItem[] = load();
  const subs = new Set<() => void>();
  let counter = 0;

  function load(): ChecklistItem[] {
    try {
      const raw = storage?.getItem(CHECKLIST_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      return Array.isArray(arr) ? arr.map(sanitizeItem).filter((x): x is ChecklistItem => !!x) : [];
    } catch {
      return [];
    }
  }
  function save(): void {
    try { storage?.setItem(CHECKLIST_KEY, JSON.stringify(items)); } catch { /* keep in memory */ }
    for (const fn of subs) fn();
  }
  function update(id: string, patch: Partial<ChecklistItem>): boolean {
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    items = items.map((x, j) => (j === i ? { ...x, ...patch, updatedAt: now() } : x));
    save();
    return true;
  }

  return {
    items: () => items.slice(),
    open: () => items.filter((x) => x.status === 'open'),
    get: (id) => items.find((x) => x.id === id),
    add(question, context, offline) {
      // Same question asked twice while still open → keep one.
      const dup = items.find((x) => x.status === 'open' && x.question.trim().toLowerCase() === question.trim().toLowerCase());
      if (dup) return dup;
      counter += 1;
      const t = now();
      const it: ChecklistItem = {
        id: `q${t.toString(36)}${counter.toString(36)}`,
        question: question.trim().slice(0, 400), context: context.slice(0, 400),
        askedAt: t, askedOffline: offline, status: 'open', updatedAt: t,
      };
      items = [...items, it].slice(-MAX_ITEMS);
      save();
      return it;
    },
    answer: (id, answer, by) => update(id, { answer: answer.slice(0, 2000), answeredBy: by, status: 'answered' }),
    mark: (id, status) => update(id, { status }),
    remove(id) {
      const n = items.length;
      items = items.filter((x) => x.id !== id);
      if (items.length === n) return false;
      save();
      return true;
    },
    replaceItems(next) {
      items = next.slice(-MAX_ITEMS);
      save();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Offline fallback email (no Gemini): a plain list of the questions. */
export function fallbackEmail(items: readonly ChecklistItem[], projectName = 'the site'): EmailDraft {
  const lines = items.map((it, i) => `${i + 1}. ${it.question}${it.answer ? `\n   Note: ${it.answer}` : ''}`);
  return {
    to: '',
    subject: `Questions from today's visit to ${projectName}`,
    body: `Hello,\n\nI visited ${projectName} today and have a few questions before we go further:\n\n${lines.join('\n')}\n\nCould you let me know when you have a moment?\n\nThank you.`,
  };
}

/** Untrusted Gemini JSON → a draft, or null. */
export function coerceEmailDraft(raw: unknown): EmailDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const subject = typeof o.subject === 'string' ? o.subject.trim().slice(0, 160) : '';
  const body = typeof o.body === 'string' ? o.body.trim().slice(0, 4000) : '';
  if (!subject || !body) return null;
  return { to: '', subject, body };
}

/** A mailto: link that OPENS her mail app with the draft. It never sends. */
export function mailtoUrl(d: EmailDraft): string {
  const enc = (s: string) => encodeURIComponent(s);
  return `mailto:${encodeURIComponent(d.to)}?subject=${enc(d.subject)}&body=${enc(d.body)}`;
}

/** Is this a hard question that needs research (vs a drawing edit)? Used when
 *  nothing local could answer it. */
export function isHardQuestion(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  if (t.length < 8) return false;
  return /\?$/.test(t)
    || /^(can|could|should|would|is|are|does|do|will|what|why|how|which|where|when)\b/.test(t)
    || /\b(check|find out|research|look up|ask the client|confirm with)\b/.test(t);
}
