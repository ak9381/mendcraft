// Pinch-to-confirm card for Chrome paste (and any future submit). Pure state
// machine, same spirit as assist/policy.ts: a timer or a filled field never
// advances the machine. The only confirm is an explicit pinch or button.

export type ConfirmKind = 'paste' | 'submit';

export type ConfirmPhase = 'idle' | 'pending' | 'confirmed' | 'cancelled';

export interface ConfirmRequest {
  kind: ConfirmKind;
  /** Short preview of the text that would be inserted. */
  preview: string;
  /** Human label for the target field, if known. */
  fieldLabel?: string;
  /** Title of the tab that would receive the paste. */
  tabTitle?: string;
  url?: string;
}

export interface ConfirmState {
  phase: ConfirmPhase;
  request: ConfirmRequest | null;
}

export type ConfirmEvent =
  | { type: 'stage'; request: ConfirmRequest }
  | { type: 'confirm'; source: 'pinch' | 'button' }
  | { type: 'cancel' }
  | { type: 'timer' }
  | { type: 'field-filled' };

export interface ConfirmStep {
  state: ConfirmState;
  /** True exactly when the caller may send pasteHere with confirmed: true. */
  performPaste: boolean;
  /** Always false: forms are never submitted. */
  performSubmit: false;
}

export function initialConfirm(): ConfirmState {
  return { phase: 'idle', request: null };
}

export function describeConfirm(req: ConfirmRequest): string {
  const where = [req.fieldLabel, req.tabTitle].filter(Boolean).join(' on ');
  const preview = req.preview.trim() ? `“${trimPreview(req.preview)}”` : 'the copied text';
  if (req.kind === 'submit') return `Submit ${preview}${where ? ` on ${where}` : ''}? Nothing will be sent until you pinch or press Confirm.`;
  return `Paste ${preview}${where ? ` into ${where}` : ''}? Pinch or press Confirm. Forms are not submitted.`;
}

export function trimPreview(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function reduceConfirm(state: ConfirmState, event: ConfirmEvent): ConfirmStep {
  const stay: ConfirmStep = { state, performPaste: false, performSubmit: false };
  switch (event.type) {
    case 'stage':
      if (event.request.kind === 'submit') {
        // Staging a submit still only shows the card — we never set performSubmit.
        return { state: { phase: 'pending', request: event.request }, performPaste: false, performSubmit: false };
      }
      return { state: { phase: 'pending', request: event.request }, performPaste: false, performSubmit: false };
    case 'confirm':
      if (state.phase !== 'pending' || !state.request) return stay;
      // Paste is the only action we ever perform. A submit request is confirmed
      // in the UI (so the user is heard) but still does not submit the form.
      if (state.request.kind === 'submit') {
        return { state: { phase: 'cancelled', request: state.request }, performPaste: false, performSubmit: false };
      }
      return { state: { phase: 'confirmed', request: state.request }, performPaste: true, performSubmit: false };
    case 'cancel':
      return { state: initialConfirm(), performPaste: false, performSubmit: false };
    case 'timer':
    case 'field-filled':
      return stay;
  }
}
