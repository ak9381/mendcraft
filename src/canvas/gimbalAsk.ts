// "Add the gimbal" asks two short questions before the board turn runs:
// is the gimbal on, then is the iPhone on it. The second "yes" is checked
// against what the iPhone really reports (a DockKit stand), never taken on
// her word. Fixed code, no model. Pure: the canvas passes what it needs.

export const GIMBAL_ASK_ON = 'Is the gimbal switched on?';
export const GIMBAL_ASK_DOCK = 'Put the iPhone on the gimbal. Is it on?';
export const GIMBAL_ASK_DOCKED = 'Gimbal connected. The iPhone is on it.';
export const GIMBAL_ASK_NOT_DOCKED = 'I don’t see the iPhone on the gimbal yet. Is it docked now?';
export const GIMBAL_ASK_WAIT = 'Okay. Say yes when it’s ready.';
export const GIMBAL_ASK_CANCEL = 'Okay, I won’t add the gimbal.';

const YES_RE = /^\s*(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|done|ready|it(?:'|’)?s\s+(?:on|ready|done|there|docked)|it\s+is(?:\s+on)?|(?:it(?:'|’)?s\s+)?switched\s+on|turned\s+on)[\s,.!]*)+(?:please|it\s+is|it(?:'|’)?s\s+on|go\s+ahead)?[\s.!]*$/i;
const WAIT_RE = /^\s*(?:not\s+yet|wait|hold\s+on|one\s+(?:sec(?:ond)?|moment|minute)|just\s+a\s+(?:sec(?:ond)?|moment|minute))\b[\s\S]*$/i;
const NO_RE = /^\s*(?:no|nope|nah|cancel|stop|never\s*mind|forget\s+it)\b[\s.!]*$/i;

export interface GimbalAskDeps {
  say(line: string): void;
  standReported(): boolean;
  proceed(text: string): void;
  /** Put the question on screen (Yes / No); null takes it down. */
  show?(question: string | null): void;
}

export interface GimbalAsk {
  start(text: string): void;
  /** True when the line was an answer to the open question. */
  handle(text: string): boolean;
  active(): boolean;
  cancel(): void;
}

export function createGimbalAsk(d: GimbalAskDeps): GimbalAsk {
  let step: 'on' | 'dock' | null = null;
  let original = '';
  return {
    start(text) { original = text; step = 'on'; d.say(GIMBAL_ASK_ON); d.show?.(GIMBAL_ASK_ON); },
    active: () => step !== null,
    cancel() { step = null; d.show?.(null); },
    handle(text) {
      if (!step) return false;
      if (NO_RE.test(text)) { step = null; d.show?.(null); d.say(GIMBAL_ASK_CANCEL); return true; }
      if (WAIT_RE.test(text)) { d.say(GIMBAL_ASK_WAIT); return true; }
      if (!YES_RE.test(text)) return false; // the question stays up; the canvas refuses other lines while it waits
      if (step === 'on') { step = 'dock'; d.say(GIMBAL_ASK_DOCK); d.show?.(GIMBAL_ASK_DOCK); return true; }
      if (!d.standReported()) { d.say(GIMBAL_ASK_NOT_DOCKED); d.show?.(GIMBAL_ASK_NOT_DOCKED); return true; }
      step = null;
      d.show?.(null);
      d.say(GIMBAL_ASK_DOCKED);
      d.proceed(original);
      return true;
    },
  };
}
