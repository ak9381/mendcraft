// First run v1: about 7 minutes, skippable at every step, resumable.

export const FIRST_RUN_KEY = 'mendcraft:first-run-v1';
export const FIRST_RUN_MINUTES = 7;

export interface FirstRunStep {
  id: string;
  title: string;
  says: string;
  caption: string;
  setsUp: string;
}

export const FIRST_RUN_STEPS: readonly FirstRunStep[] = [
  {
    id: 'language',
    title: 'Hello',
    says: 'Hello. Say English, Kannada, or both.',
    caption: 'Say English, Kannada, or both.',
    setsUp: 'Language',
  },
  {
    id: 'permissions',
    title: 'Microphone, then camera',
    says: 'Your camera picture never leaves this device.',
    caption: 'Allow the microphone, then the camera. The picture stays on this device.',
    setsUp: 'Permissions',
  },
  {
    id: 'rest',
    title: 'Rest your hands',
    says: 'Hands down out of this box pauses everything.',
    caption: 'Rest your hands wherever is comfortable. The active zone is drawn around them.',
    setsUp: 'Active zone, pause',
  },
  {
    id: 'pinch',
    title: 'A comfortable pinch',
    says: 'Not comfortable? Try a gentle hand close, a tap on the desk, or just say yes.',
    caption: 'Bring thumb toward finger only as far as feels easy, three times. We set your pinch at 70% of that range.',
    setsUp: 'Keep gesture',
  },
  {
    id: 'brush',
    title: 'A brush drops it',
    says: "That's a brush. It drops whatever is waiting.",
    caption: 'Slide your hand a little sideways to drop a proposal.',
    setsUp: 'Drop gesture',
  },
  {
    id: 'palm',
    title: 'Open palm',
    says: "Glide toward any slice and pinch, or say its name. Try: what can I do.",
    caption: 'Hold an open palm still. The palm menu and the Here card appear.',
    setsUp: 'Palm menu, Here card',
  },
  {
    id: 'voice',
    title: 'Speak naturally',
    says: 'Yes, no, undo, and stop work in English and Kannada. You can record your own words later.',
    caption: 'Read one mixed sentence aloud so recognition can tune to you.',
    setsUp: 'Voice',
  },
  {
    id: 'first-win',
    title: 'Keep your first room',
    says: 'Draw a room 4 by 5 metres. Pinch to keep it. You can say make it 5 by 6, then undo.',
    caption: 'A faint guess appears while you speak, then a card. Pinch keeps it. Brush drops it.',
    setsUp: 'First win, guess, undo',
  },
  {
    id: 'history',
    title: 'Review & History',
    says: 'By Quick, on this device. Small edit, nothing sent.',
    caption: 'Open your palm and choose Review & History to see who changed what and why.',
    setsUp: 'History, route line',
  },
  {
    id: 'done',
    title: "That's all you need",
    says: "That's all you need. Open your palm whenever you wonder what's possible.",
    caption: 'Start a new project, load the sample house, or do this later.',
    setsUp: 'Done',
  },
];

export interface FirstRunState {
  step: number;
  done: boolean;
  skipped?: boolean;
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function loadFirstRun(store: KV): FirstRunState {
  try {
    const raw = JSON.parse(store.getItem(FIRST_RUN_KEY) || 'null') as unknown;
    if (!raw || typeof raw !== 'object') return { step: 0, done: false };
    const o = raw as Record<string, unknown>;
    const step = typeof o.step === 'number' && o.step >= 0 ? Math.min(FIRST_RUN_STEPS.length - 1, Math.floor(o.step)) : 0;
    return { step, done: o.done === true, skipped: o.skipped === true };
  } catch {
    return { step: 0, done: false };
  }
}

export function saveFirstRun(store: KV, state: FirstRunState): void {
  store.setItem(FIRST_RUN_KEY, JSON.stringify({
    step: state.step,
    done: state.done,
    ...(state.skipped ? { skipped: true } : {}),
  }));
}

export function shouldOfferFirstRun(store: KV): boolean {
  const s = loadFirstRun(store);
  return !s.done && !s.skipped;
}

export function skipCurrentStep(state: FirstRunState): FirstRunState {
  if (state.done) return state;
  const next = state.step + 1;
  if (next >= FIRST_RUN_STEPS.length) return { step: FIRST_RUN_STEPS.length - 1, done: true, skipped: true };
  return { step: next, done: false };
}

export function skipAll(state: FirstRunState): FirstRunState {
  return { step: state.step, done: true, skipped: true };
}

export function advanceStep(state: FirstRunState): FirstRunState {
  if (state.done) return state;
  const next = state.step + 1;
  if (next >= FIRST_RUN_STEPS.length) return { step: FIRST_RUN_STEPS.length - 1, done: true };
  return { step: next, done: false };
}

export function backStep(state: FirstRunState): FirstRunState {
  if (state.step <= 0) return { ...state, step: 0, done: false };
  return { step: state.step - 1, done: false };
}

export function isSkipUtterance(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  return t === 'skip' || t === 'saku' || t === 'sāku' || t === 'ಸಾಕು' || t === "that's enough" || t === 'skip this';
}
