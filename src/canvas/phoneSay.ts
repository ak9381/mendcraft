// The phone shell's status toast text. The shell hides the tools bar (and the
// status line in it), so say() lines are shown in a toast instead: a short
// confirmation ("Lights on."), a chat reply, a failure reason.

/** Longest toast, in characters (about eight lines at phone width). */
export const PHONE_SAY_MAX = 320;

/** One readable block: whitespace collapsed, capped with an ellipsis. */
export function phoneSayText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > PHONE_SAY_MAX ? `${t.slice(0, PHONE_SAY_MAX - 1).trimEnd()}…` : t;
}
