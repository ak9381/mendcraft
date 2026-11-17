// Speculative Copilot: while she is still speaking, Nano may draft an answer
// or a pending canvas change ("Nano's guess"). Gemini can fire once early on
// the partial transcript, and again on the final if it changed materially.
// Nothing is auto-applied. Pure state machine — the app wires models + UI.

export const SPECULATIVE_DEBOUNCE_MS = 500;
export const SPECULATIVE_MIN_WORDS = 4;

export type GuessState = 'draft' | 'confirmed' | 'corrected' | 'withdrawn';

export interface SpeculativeDraft {
  id: string;
  utterance: string;
  state: GuessState;
  /** Shown as "Nano's guess" until confirmed or corrected. */
  answer?: string;
  tool?: string;
  args?: Record<string, unknown>;
  why?: string;
  visibleAt: number;
  confirmedAt?: number;
  /** Set when Gemini confirmed or replaced the guess. */
  geminiAnswer?: string;
  geminiModel?: string;
}

export interface SpeculativeStats {
  compared: number;
  agreed: number;
  secondsSaved: number;
}

export interface SpeculativeCloudAnswer {
  answer: string;
  calls: { tool: string; args?: Record<string, unknown> }[];
  why?: string;
  model?: string;
}

export interface SpeculativeNanoPick {
  call: { tool: string; args?: Record<string, unknown> };
  confidence: number;
  answer?: string;
}

export interface SpeculativeDeps {
  now?: () => number;
  debounceMs?: number;
  online: () => boolean;
  isSimplePlan?: (s: string) => boolean;
  isJudgement?: (s: string) => boolean;
  isHard?: (s: string) => boolean;
  answerPlan?: (s: string) => { text: string } | null;
  pickNano?: (s: string) => Promise<SpeculativeNanoPick | null>;
  askCloud?: (s: string) => Promise<SpeculativeCloudAnswer | null>;
  onUpdate?: (draft: SpeculativeDraft | null, stats: SpeculativeStats) => void;
}

export function looksReadyToGuess(text: string, minWords = SPECULATIVE_MIN_WORDS): boolean {
  const t = text.trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= minWords) return true;
  return /[?]$/.test(t) && words.length >= 3;
}

export function transcriptChangedMaterially(prev: string, next: string): boolean {
  const a = prev.trim().toLowerCase().replace(/\s+/g, ' ');
  const b = next.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!b) return false;
  if (!a) return b.split(' ').length >= SPECULATIVE_MIN_WORDS;
  if (a === b) return false;
  // A short trailing filler ("please", "um") is not material.
  if (b.startsWith(a)) {
    const extra = b.slice(a.length).trim();
    if (!extra) return false;
    const extraWords = extra.split(/\s+/);
    if (extraWords.length <= 1 && extra.length <= 12 && !/\b(and|between|or|but|kitchen|living|bathroom|bedroom)\b/.test(extra)) {
      return false;
    }
  }
  return true;
}

export function guessesAgree(
  draft: Pick<SpeculativeDraft, 'answer' | 'tool'>,
  cloud: SpeculativeCloudAnswer,
): boolean {
  if (draft.tool) {
    const call = cloud.calls[0];
    if (call && call.tool === draft.tool) return true;
    // An advice-only cloud answer disagrees with a canvas-edit guess.
    if (cloud.answer && !call) return false;
  }
  if (draft.answer && cloud.answer) {
    const a = normalizeWords(draft.answer);
    const b = normalizeWords(cloud.answer);
    if (!a.length || !b.length) return false;
    const overlap = a.filter((w) => b.includes(w)).length;
    return overlap / Math.min(a.length, b.length) >= 0.35;
  }
  return false;
}

function normalizeWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
}

export interface SpeculativeEngine {
  onInterim(text: string): void;
  onFinal(text: string): Promise<{ handled: boolean; draft: SpeculativeDraft | null }>;
  getDraft(): SpeculativeDraft | null;
  stats(): SpeculativeStats;
  reset(): void;
  /** Test hook: flush a pending debounce. */
  flush(): Promise<void>;
}

export function createSpeculativeEngine(deps: SpeculativeDeps): SpeculativeEngine {
  const now = deps.now ?? Date.now;
  const debounceMs = deps.debounceMs ?? SPECULATIVE_DEBOUNCE_MS;
  let draft: SpeculativeDraft | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  let flushWait: Promise<void> | null = null;
  let flushResolve: (() => void) | null = null;
  let seq = 0;
  let earlyCloudFor: string | null = null;
  let earlyCloudText = '';
  let earlyCloudPromise: Promise<SpeculativeCloudAnswer | null> | null = null;
  const stats: SpeculativeStats = { compared: 0, agreed: 0, secondsSaved: 0 };
  let generation = 0;
  const notify = () => { try { deps.onUpdate?.(draft, { ...stats }); } catch { /* UI must not fail the engine */ } };

  const clearTimer = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const looksRelevant = (s: string): boolean => {
    if (!looksReadyToGuess(s)) return false;
    if (deps.isSimplePlan?.(s) || deps.isJudgement?.(s) || deps.isHard?.(s)) return true;
    return /[?]/.test(s) || /\b(should|could|would|can we|what|how|is this|does)\b/i.test(s);
  };

  const startDraft = async (text: string, allowEarlyCloud: boolean): Promise<SpeculativeDraft | null> => {
    const id = `g${++seq}`;
    const visibleAt = now();
    const plan = deps.answerPlan?.(text);
    let answer = plan?.text;
    let tool: string | undefined;
    let args: Record<string, unknown> | undefined;
    let why = "Nano's guess while you were still speaking.";
    if (!answer && deps.pickNano) {
      const pick = await deps.pickNano(text);
      if (pick && pick.confidence >= 0.45) {
        if (pick.call.tool !== 'ask_gemini') {
          tool = pick.call.tool;
          args = pick.call.args;
        }
        if (pick.answer) answer = pick.answer;
      }
    }
    if (!answer && !tool) {
      // Still allow an early cloud call with no Nano draft.
    } else {
      draft = {
        id, utterance: text, state: 'draft', answer, tool, args, why, visibleAt,
      };
    }

    if (allowEarlyCloud && deps.online() && deps.askCloud && !earlyCloudFor && (deps.isHard?.(text) || deps.isJudgement?.(text) || /[?]/.test(text))) {
      earlyCloudFor = id;
      earlyCloudText = text;
      earlyCloudPromise = deps.askCloud(text);
    }
    notify();
    return draft;
  };

  const applyCloud = (cloud: SpeculativeCloudAnswer, fromText: string): void => {
    if (!draft) {
      draft = {
        id: `g${++seq}`,
        utterance: fromText,
        state: 'draft',
        answer: cloud.answer,
        tool: cloud.calls[0]?.tool,
        args: cloud.calls[0]?.args,
        why: 'Gemini · cloud',
        visibleAt: now(),
        geminiAnswer: cloud.answer,
        geminiModel: cloud.model,
        confirmedAt: now(),
      };
      draft.state = 'confirmed';
      return;
    }
    stats.compared += 1;
    const agree = guessesAgree(draft, cloud);
    const t = now();
    draft.geminiAnswer = cloud.answer;
    draft.geminiModel = cloud.model;
    draft.confirmedAt = t;
    if (agree) {
      draft.state = 'confirmed';
      draft.why = `${draft.why ?? ''} Gemini confirmed this guess.`.trim();
      stats.agreed += 1;
      const saved = Math.max(0, (t - draft.visibleAt) / 1000);
      stats.secondsSaved = Math.round((stats.secondsSaved + saved) * 10) / 10;
    } else {
      const hadTool = !!draft.tool;
      const newTool = cloud.calls[0]?.tool;
      if (hadTool && newTool && newTool !== draft.tool) {
        draft.state = 'corrected';
        draft.tool = newTool;
        draft.args = cloud.calls[0]?.args;
        draft.answer = cloud.answer;
        draft.why = `Gemini corrected Nano's guess: ${cloud.why || cloud.answer}`.slice(0, 400);
      } else if (hadTool && !newTool) {
        draft.state = 'withdrawn';
        draft.why = `Withdrawn: Gemini disagreed with Nano's guess. ${cloud.why || cloud.answer}`.slice(0, 400);
        draft.answer = cloud.answer;
        draft.tool = undefined;
        draft.args = undefined;
      } else {
        draft.state = 'corrected';
        draft.answer = cloud.answer;
        draft.why = `Gemini updated the answer. ${cloud.why ?? ''}`.trim().slice(0, 400);
      }
    }
    notify();
  };

  const schedule = (text: string) => {
    pending = text;
    clearTimer();
    const gen = generation;
    flushWait = new Promise<void>((resolve) => { flushResolve = resolve; });
    timer = setTimeout(() => {
      timer = null;
      const t = pending;
      pending = null;
      const resolveFlush = flushResolve;
      flushResolve = null;
      flushWait = null;
      if (!t || gen !== generation) { resolveFlush?.(); return; }
      if (!looksRelevant(t)) { resolveFlush?.(); return; }
      const allowCloud = deps.online() && !earlyCloudFor;
      void startDraft(t, allowCloud).finally(() => resolveFlush?.());
    }, debounceMs);
  };

  return {
    onInterim(text: string) {
      const t = text.trim();
      if (!t) return;
      schedule(t);
    },
    async onFinal(text: string) {
      const t = text.trim();
      generation += 1;
      clearTimer();
      pending = null;
      if (flushWait) await flushWait;

      if (!t) return { handled: false, draft };

      // If no draft yet, start one from the final text (typed commands, or
      // a final that arrived before the debounce).
      if (!draft || transcriptChangedMaterially(draft.utterance, t)) {
        if (!draft && looksRelevant(t)) {
          await startDraft(t, deps.online() && !earlyCloudFor);
        } else if (draft) {
          draft.utterance = t;
        }
      }

      const shouldCloud = deps.online() && !!deps.askCloud && looksRelevant(t);
      let cloud: SpeculativeCloudAnswer | null = null;
      if (shouldCloud) {
        const reuse = earlyCloudPromise && earlyCloudFor && !transcriptChangedMaterially(earlyCloudText, t);
        if (reuse) cloud = await earlyCloudPromise;
        else cloud = await deps.askCloud!(t);
      }
      earlyCloudPromise = null;
      earlyCloudFor = null;
      earlyCloudText = '';

      if (cloud) applyCloud(cloud, t);
      const handled = !!draft && (draft.state === 'confirmed' || draft.state === 'corrected' || draft.state === 'withdrawn' || !!draft.answer || !!draft.tool);
      return { handled, draft };
    },
    getDraft: () => draft,
    stats: () => ({ ...stats }),
    reset() {
      generation += 1;
      clearTimer();
      pending = null;
      draft = null;
      earlyCloudFor = null;
      earlyCloudText = '';
      earlyCloudPromise = null;
      notify();
    },
    flush() {
      if (timer) {
        const t = pending;
        clearTimer();
        pending = null;
        if (t && looksRelevant(t)) {
          const allowCloud = deps.online() && !earlyCloudFor;
          return startDraft(t, allowCloud).then(() => undefined);
        }
      }
      return flushWait ?? Promise.resolve();
    },
  };
}
