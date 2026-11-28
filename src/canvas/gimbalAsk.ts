// "Add the gimbal" asks two short questions before the board turn runs:
// is the gimbal on, then is the iPhone on it. The second "yes" is checked
// against what the iPhone really reports (a DockKit stand), never taken on
// her word. Fixed code, no model. Pure: the canvas passes what it needs.

export const GIMBAL_ASK_ON = 'Is the gimbal switched on?';
export const GIMBAL_ASK_DOCK = 'Put the iPhone on the gimbal, then say yes.';
export const GIMBAL_ASK_DOCKED = 'The iPhone is on the gimbal. Adding it.';
export const GIMBAL_ASK_NOT_DOCKED = 'I don’t see the iPhone on the gimbal yet. Dock it, then say yes.';
export const GIMBAL_ASK_WAIT = 'Okay. Say yes when it’s ready.';
export const GIMBAL_ASK_CANCEL = 'Okay, I won’t add the gimbal.';

const YES_RE = /^\s*(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|done|ready|it(?:'|’)?s\s+(?:on|ready|done|there|docked)|it\s+is(?:\s+on)?|(?:it(?:'|’)?s\s+)?switched\s+on|turned\s+on)[\s,.!]*)+(?:please|it\s+is|it(?:'|’)?s\s+on|go\s+ahead)?[\s.!]*$/i;
const WAIT_RE = /^\s*(?:not\s+yet|wait|hold\s+on|one\s+(?:sec(?:ond)?|moment|minute)|just\s+a\s+(?:sec(?:ond)?|moment|minute))\b[\s\S]*$/i;
const NO_RE = /^\s*(?:no|nope|nah|cancel|stop|never\s*mind|forget\s+it)\b[\s.!]*$/i;

export interface GimbalAskDeps {
  say(line: string): void;
  standReported(): boolean;
  proceed(text: string): void;
  /** Open the mic for her answer once the question has been spoken. */
  listen?(): void;
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
    start(text) { original = text; step = 'on'; d.say(GIMBAL_ASK_ON); d.listen?.(); },
    active: () => step !== null,
    cancel() { step = null; },
    handle(text) {
      if (!step) return false;
      if (NO_RE.test(text)) { step = null; d.say(GIMBAL_ASK_CANCEL); return true; }
      if (WAIT_RE.test(text)) { d.say(GIMBAL_ASK_WAIT); d.listen?.(); return true; }
      if (!YES_RE.test(text)) { step = null; return false; } // something else: the ask ends, the line runs normally
      if (step === 'on') { step = 'dock'; d.say(GIMBAL_ASK_DOCK); d.listen?.(); return true; }
      if (!d.standReported()) { d.say(GIMBAL_ASK_NOT_DOCKED); d.listen?.(); return true; }
      step = null;
      d.say(GIMBAL_ASK_DOCKED);
      d.proceed(original);
      return true;
    },
  };
}
