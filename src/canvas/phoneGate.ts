// What a phone's command may decide on the laptop. A phone's words run through
// the same turn path as the say box, so without a gate a phone could say
// "keep" and approve whatever review is open here (R1), or switch the laptop
// mic on without her knowing (R2). The review rules stay the laptop's: she
// keeps on the laptop; a phone may only take back a review it asked for itself.

export const PHONE_KEEP_LINE = 'Approve it here on the laptop — a phone can’t keep a change.';
export const PHONE_DROP_LINE = 'That review was opened on the laptop — drop it here.';
export const PHONE_MIC_ON_LINE = 'The phone asked for the laptop mic — tap Talk here to turn it on.';
export const PHONE_MIC_OFF_LINE = 'Mic off — the phone turned it off.';

/** A phone said keep or drop. Returns the refusal line, or null when allowed. */
export function phoneDecision(kind: 'keep' | 'drop', reviewFrom: 'phone' | undefined): string | null {
  if (kind === 'keep') return PHONE_KEEP_LINE;
  return reviewFrom === 'phone' ? null : PHONE_DROP_LINE;
}

/** A phone's mic button: it may switch the laptop mic off, never on. Both are said. */
export function phoneMic(mic: { readonly listening: boolean; stop(): void } | null, say: (line: string) => void): void {
  if (mic?.listening) { mic.stop(); say(PHONE_MIC_OFF_LINE); return; }
  say(PHONE_MIC_ON_LINE);
}
