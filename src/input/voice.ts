// Web Speech API voice commands: push-to-talk or always-on continuous
// recognition, with a text-box fallback for unsupported browsers.
// lib.dom.d.ts doesn't ship (webkit-prefixed, non-standard) Speech types.

declare global {
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
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
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
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

export function createVoiceController(onCommand: (utterance: string) => void): VoiceController {
  const Ctor = getRecognitionCtor();
  const supported = Ctor !== null;
  let recognition: SpeechRecognition | null = null;
  let alwaysOn = false;
  let pushToTalkActive = false;
  let wantListening = false;

  if (Ctor) {
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const last = e.results[e.results.length - 1];
      const text = last?.[0]?.transcript?.trim();
      if (text) onCommand(text);
    };

    recognition.onerror = () => {
      // Swallow transient errors (no-speech, aborted); restart below if still wanted.
    };

    recognition.onend = () => {
      if (wantListening) {
        try {
          recognition?.start();
        } catch {
          // Already starting; ignore.
        }
      }
    };
  }

  function updateListening(): void {
    wantListening = alwaysOn || pushToTalkActive;
    if (!recognition) return;
    if (wantListening) {
      try {
        recognition.start();
      } catch {
        // Already started; ignore.
      }
    } else {
      recognition.stop();
    }
  }

  function setLang(lang: string): void {
    if (!recognition || !lang || recognition.lang === lang) return;
    recognition.lang = lang;
    // A running recognizer keeps its old language until restarted; bounce it so
    // the new language takes effect immediately (onend auto-restarts if wanted).
    if (wantListening) recognition.stop();
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
    recognition?.stop();
  }

  return { supported, setLang, setAlwaysOn, pushToTalkStart, pushToTalkStop, submitText, stop };
}
