// FIRST-RUN SETUP STATE (pure, DOM-free, storage-injectable).
//
// The wizard's steps, its progress, and everything it saves: calibration,
// custom gesture templates, button→gesture / button→voice-phrase bindings, and
// whether face cues and gesture hints are on. Persisted to this browser's
// localStorage only. Unit-tested without a DOM.

import { coerceCalibration, type Calibration } from './calibration';
import { coerceTemplate, type GestureTemplate } from '../input/gestureTemplates';
import type { FaceRatios } from '../input/faceCues';

export const SETUP_STEPS = ['welcome', 'reach', 'pinch', 'still', 'gestures', 'shortcuts', 'face', 'chrome', 'done'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Steps that need the camera (skipped with a note when it is off). */
export const CAMERA_STEPS: readonly SetupStep[] = ['reach', 'pinch', 'still', 'face'];

export const STEP_TITLES: Record<SetupStep, { en: string; kn: string }> = {
  welcome: { en: 'Set up Mendcraft for your hands', kn: 'ನಿಮ್ಮ ಕೈಗಳಿಗೆ ಹೊಂದಿಸೋಣ' },
  reach: { en: 'Point at five spots', kn: 'ಐದು ಚುಕ್ಕೆಗಳನ್ನು ತೋರಿಸಿ' },
  pinch: { en: 'Pinch a few times, gently', kn: 'ಮೆತ್ತಗೆ ಕೆಲವು ಬಾರಿ ಚಿವುಟಿ' },
  still: { en: 'Point and hold still', kn: 'ಬೆರಳು ತೋರಿಸಿ, ಸ್ಥಿರವಾಗಿ ಇಡಿ' },
  gestures: { en: 'Your gestures', kn: 'ನಿಮ್ಮ ಸನ್ನೆಗಳು' },
  shortcuts: { en: 'Buttons, gestures and voice', kn: 'ಬಟನ್, ಸನ್ನೆ, ಧ್ವನಿ' },
  face: { en: 'Face cues (optional)', kn: 'ಮುಖದ ಸೂಚನೆ (ಐಚ್ಛಿಕ)' },
  chrome: { en: 'Connect Chrome', kn: 'ಕ್ರೋಮ್ ಸೇರಿಸಿ' },
  done: { en: 'All set', kn: 'ಸಿದ್ಧ' },
};

export interface ButtonBinding {
  /** DOM id of the button (e.g. 'btn-undo') or a command id ('add-device'). */
  target: string;
  /** Gesture id from the catalog or a custom template id ('custom:<id>'). */
  gesture?: string;
  /** Spoken phrase (any language; Kannada kept as-is). */
  phrase?: string;
}

export interface SetupData {
  version: 1;
  completed: boolean;
  step: SetupStep;
  calibration: Calibration | null;
  templates: GestureTemplate[];
  bindings: ButtonBinding[];
  faceCues: boolean;
  faceBaseline: FaceRatios | null;
  showHints: boolean;
  /** Hover-and-wait clicks buttons. First-class with pinch and voice (pinch can hurt). */
  dwellClick: boolean;
}

export const SETUP_KEY = 'mendcraft.setup';

export function defaultSetup(): SetupData {
  return {
    version: 1, completed: false, step: 'welcome', calibration: null, templates: [],
    bindings: [], faceCues: false, faceBaseline: null, showHints: true, dwellClick: true,
  };
}

export function nextStep(step: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(step);
  return SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, i + 1)];
}
export function prevStep(step: SetupStep): SetupStep {
  const i = SETUP_STEPS.indexOf(step);
  return SETUP_STEPS[Math.max(0, i - 1)];
}
export function stepProgress(step: SetupStep): { index: number; total: number } {
  return { index: SETUP_STEPS.indexOf(step), total: SETUP_STEPS.length - 1 };
}

/** Normalise a voice phrase for matching (keeps Kannada vowel signs, \p{M}). */
export function normalizePhrase(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const TARGET_RE = /^[a-z0-9-]{1,40}$/;
const GESTURE_RE = /^(custom:)?[a-z0-9-]{1,40}$/;

/** Add or replace a binding. A gesture can drive only one target; binding it
 *  elsewhere moves it. Same for a phrase. */
export function setBinding(data: SetupData, b: ButtonBinding): SetupData {
  if (!TARGET_RE.test(b.target)) return data;
  const gesture = b.gesture && GESTURE_RE.test(b.gesture) ? b.gesture : undefined;
  const phrase = b.phrase ? normalizePhrase(b.phrase).slice(0, 60) || undefined : undefined;
  const others = data.bindings
    .filter((x) => x.target !== b.target)
    .map((x) => ({
      ...x,
      gesture: gesture && x.gesture === gesture ? undefined : x.gesture,
      phrase: phrase && x.phrase === phrase ? undefined : x.phrase,
    }))
    .filter((x) => x.gesture || x.phrase);
  const next = gesture || phrase ? [...others, { target: b.target, gesture, phrase }] : others;
  return { ...data, bindings: next };
}

export function bindingForPhrase(data: SetupData, utterance: string): string | null {
  const n = normalizePhrase(utterance);
  if (!n) return null;
  return data.bindings.find((b) => b.phrase && b.phrase === n)?.target ?? null;
}

export function bindingForGesture(data: SetupData, gesture: string): string | null {
  return data.bindings.find((b) => b.gesture === gesture)?.target ?? null;
}

export function addTemplate(data: SetupData, t: GestureTemplate): SetupData {
  return { ...data, templates: [...data.templates.filter((x) => x.id !== t.id), t].slice(-24) };
}

export function removeTemplate(data: SetupData, id: string): SetupData {
  return {
    ...data,
    templates: data.templates.filter((t) => t.id !== id),
    bindings: data.bindings.map((b) => (b.gesture === `custom:${id}` ? { ...b, gesture: undefined } : b)).filter((b) => b.gesture || b.phrase),
  };
}

export function coerceSetup(raw: unknown): SetupData {
  const out = defaultSetup();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.completed = r.completed === true;
  out.step = (SETUP_STEPS as readonly string[]).includes(r.step as string) ? (r.step as SetupStep) : 'welcome';
  out.calibration = coerceCalibration(r.calibration);
  out.templates = Array.isArray(r.templates) ? r.templates.map(coerceTemplate).filter((t): t is GestureTemplate => t !== null).slice(0, 24) : [];
  if (Array.isArray(r.bindings)) {
    let d = out;
    for (const b of r.bindings) {
      if (b && typeof b === 'object' && typeof (b as ButtonBinding).target === 'string') {
        const bb = b as ButtonBinding;
        d = setBinding(d, { target: bb.target, gesture: typeof bb.gesture === 'string' ? bb.gesture : undefined, phrase: typeof bb.phrase === 'string' ? bb.phrase : undefined });
      }
    }
    out.bindings = d.bindings;
  }
  out.faceCues = r.faceCues === true;
  const fb = r.faceBaseline as Record<string, unknown> | null;
  out.faceBaseline = fb && typeof fb.smile === 'number' && typeof fb.brow === 'number' && Number.isFinite(fb.smile) && Number.isFinite(fb.brow)
    ? { smile: fb.smile, brow: fb.brow } : null;
  out.showHints = r.showHints !== false;
  out.dwellClick = r.dwellClick !== false;
  return out;
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

function store(s?: StorageLike): StorageLike | undefined {
  return s ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
}

export function loadSetup(s?: StorageLike): SetupData {
  try {
    const raw = store(s)?.getItem(SETUP_KEY);
    return raw ? coerceSetup(JSON.parse(raw)) : defaultSetup();
  } catch {
    return defaultSetup();
  }
}

export function saveSetup(data: SetupData, s?: StorageLike): boolean {
  try {
    const st = store(s);
    if (!st) return false;
    st.setItem(SETUP_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

const SETUP_PHRASES = new Set(['set up', 'setup', 'set up my hands', 'calibrate', 'calibration', 'open setup', 'ಹೊಂದಿಸು', 'ಸೆಟಪ್', 'ಕೈ ಹೊಂದಿಸು']);
/** "set up" / "calibrate" / Kannada "ಹೊಂದಿಸು" opens the setup wizard. */
export function isSetupPhrase(utterance: string): boolean {
  return SETUP_PHRASES.has(normalizePhrase(utterance));
}

const REST_PHRASES = new Set(['rest', 'rest mode', 'pause gestures', 'ವಿಶ್ರಾಂತಿ']);
const WAKE_PHRASES = new Set(['wake up', 'resume gestures', 'ಎದ್ದೇಳು']);
export function restPhrase(utterance: string): 'rest' | 'wake' | null {
  const n = normalizePhrase(utterance);
  return REST_PHRASES.has(n) ? 'rest' : WAKE_PHRASES.has(n) ? 'wake' : null;
}
