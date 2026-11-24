// Web Speech API voice commands: push-to-talk or always-on continuous
// recognition, with a text-box fallback for unsupported browsers.
// lib.dom.d.ts doesn't ship (webkit-prefixed, non-standard) Speech types.
// Errors and interim transcripts are surfaced to the UI — never swallowed —
// so a failed or empty Talk turn is visible, not a silent no-op.

// Do not redeclare SpeechRecognitionEvent — lib.dom already has it, and a
// narrower `results` type here breaks tsc (TS2717).
declare global {
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: ((this: SpeechRecognition, ev: Event) => void) | null;
    onerror: ((this: SpeechRecognition, ev: Event) => void) | null;
    onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  }
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  return (typeof window !== 'undefined' ? (window.SpeechRecognition ?? window.webkitSpeechRecognition) : undefined) ?? null;
}

export type VoiceInterimFn = (utterance: string) => void;

export interface VoiceHooks {
  onInterim?: VoiceInterimFn;
  /** Fired for fatal recognition errors (not no-speech / aborted). */
  onError?: (code: string, message: string) => void;
  onListening?: (listening: boolean) => void;
  /** Injectable ctor for tests. */
  recognitionCtor?: SpeechRecognitionCtor | null;
}

export interface VoiceController {
  readonly supported: boolean;
  /** Set the recognition language (BCP-47, e.g. 'en-US', 'kn-IN'). */
  setLang(lang: string): void;
  /** Always-on continuous listening toggle. */
  setAlwaysOn(on: boolean): void;
  /** Push-to-talk: start listening until the matching stop call. */
  pushToTalkStart(): void;
  pushToTalkStop(): void;
  /** Feed a command directly, e.g. from the text-box fallback. */
  submitText(text: string): void;
  stop(): void;
}

const TRANSIENT = new Set(['no-speech', 'aborted']);
const LANG_FALLBACKS = ['en-IN', 'en-US'];

/** Honest one-line reason for a SpeechRecognition error code. */
export function speechErrorMessage(code: string, lang = 'en-US'): string {
  switch (code) {
    case 'not-allowed':
      return 'Microphone permission is off, so Talk cannot hear you.';
    case 'audio-capture':
      return 'Could not reach the microphone — another app may be using it, or the mic failed.';
    case 'network':
      return 'Speech recognition needs the network and could not reach it. Pinch Talk and try again.';
    case 'language-not-supported':
      return `This browser cannot transcribe ${lang}. Try English, or type in the say box.`;
    case 'service-not-allowed':
      return 'Speech recognition is blocked in this browser. You can type in the say box.';
    case 'no-speech':
      return 'Nothing was heard. Pinch Talk and speak again.';
    default:
      return `Talk could not start (${code || 'unknown'}). You can type in the say box.`;
  }
}

function hooksOf(arg?: VoiceInterimFn | VoiceHooks): VoiceHooks {
  if (!arg) return {};
  if (typeof arg === 'function') return { onInterim: arg };
  return arg;
}

export function createVoiceController(
  onCommand: (utterance: string) => void,
  onInterimOrHooks?: VoiceInterimFn | VoiceHooks,
): VoiceController {
  const hooks = hooksOf(onInterimOrHooks);
  const Ctor = hooks.recognitionCtor === undefined ? getRecognitionCtor() : hooks.recognitionCtor;
  const supported = Ctor !== null;
  let recognition: SpeechRecognition | null = null;
  let alwaysOn = false;
  let pushToTalkActive = false;
  let wantListening = false;
  let lastInterim = '';
  let langTriedFallback = false;

  if (Ctor) {
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e: Event) => {
      const ev = e as Event & { results?: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }> };
      const last = ev.results?.[ev.results.length - 1] as { isFinal?: boolean; 0?: { transcript?: string } } | undefined;
      const text = last?.[0]?.transcript?.trim();
      if (!text) return;
      if (last?.isFinal === false) {
        lastInterim = text;
        hooks.onInterim?.(text);
        return;
      }
      lastInterim = '';
      onCommand(text);
    };

    recognition.onerror = (ev: Event) => {
      const code = (ev as Event & { error?: string }).error || 'unknown';
      if (TRANSIENT.has(code)) return;
      if (code === 'language-not-supported' && recognition && !langTriedFallback) {
        langTriedFallback = true;
        const next = LANG_FALLBACKS.find((l) => l !== recognition!.lang) ?? 'en-US';
        recognition.lang = next;
        if (wantListening) {
          try { recognition.stop(); } catch { /* onend restarts */ }
        }
        return;
      }
      // Fatal: stop the hidden retry loop and tell the UI why.
      wantListening = false;
      pushToTalkActive = false;
      hooks.onListening?.(false);
      hooks.onError?.(code, speechErrorMessage(code, recognition?.lang ?? 'en-US'));
    };

    recognition.onend = () => {
      if (wantListening) {
        try {
          recognition?.start();
        } catch {
          // Already starting; ignore.
        }
        return;
      }
      // Don't throw away the last heard words just because a final never arrived.
      if (lastInterim) {
        const leftover = lastInterim;
        lastInterim = '';
        onCommand(leftover);
      }
      hooks.onListening?.(false);
    };
  }

  function updateListening(): void {
    wantListening = alwaysOn || pushToTalkActive;
    hooks.onListening?.(wantListening);
    if (!recognition) return;
    if (wantListening) {
      lastInterim = '';
      try {
        recognition.start();
      } catch (err) {
        // InvalidStateError = already started, fine. Anything else is fatal.
        const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
        if (name && name !== 'InvalidStateError') {
          wantListening = false;
          pushToTalkActive = false;
          hooks.onListening?.(false);
          hooks.onError?.('start-failed', speechErrorMessage('audio-capture', recognition.lang));
        }
      }
    } else {
      try { recognition.stop(); } catch { /* already stopped */ }
    }
  }

  function setLang(lang: string): void {
    if (!recognition || !lang || recognition.lang === lang) return;
    langTriedFallback = false;
    recognition.lang = lang;
    // A running recognizer keeps its old language until restarted; bounce it so
    // the new language takes effect immediately (onend auto-restarts if wanted).
    if (wantListening) {
      try { recognition.stop(); } catch { /* ignore */ }
    }
  }

  function setAlwaysOn(on: boolean): void {
    alwaysOn = on;
    updateListening();
  }

  function pushToTalkStart(): void {
    pushToTalkActive = true;
    updateListening();
  }

  function pushToTalkStop(): void {
    pushToTalkActive = false;
    updateListening();
  }

  function submitText(text: string): void {
    const trimmed = text.trim();
    if (trimmed) onCommand(trimmed);
  }

  function stop(): void {
    alwaysOn = false;
    pushToTalkActive = false;
    wantListening = false;
    lastInterim = '';
    try { recognition?.stop(); } catch { /* ignore */ }
    hooks.onListening?.(false);
  }

  return { supported, setLang, setAlwaysOn, pushToTalkStart, pushToTalkStop, submitText, stop };
}
