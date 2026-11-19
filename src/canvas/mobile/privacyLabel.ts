// Pure chooser for the one privacy-route label chip shown wherever a change
// or proposal appears. Exactly one of three honest sentences — never a blend.

export const PRIVACY_LABEL_ON_DEVICE = 'on this device';
export const PRIVACY_LABEL_ROUTED_VIA_HUB = 'routed via Mac: Nano cleaned, then Gemini';
export const PRIVACY_LABEL_NO_NANO = 'Gemini (no Nano on this phone)';

export interface PrivacyLabelInput {
  /** This surface is a phone companion (not the desktop hub itself). */
  isPhone: boolean;
  /** This phone has a usable on-device model (rare today; most phones don't). */
  hasNanoOnThisPhone: boolean;
  /** The phone sent this ask to the desktop hub for redaction before Gemini. */
  wasRoutedViaHub: boolean;
}

/**
 * Resolution order: a phone with real on-device Nano always says so first —
 * that's the strongest privacy claim. Otherwise a phone either went through
 * the hub (redacted before Gemini) or straight to Gemini with no Nano at all.
 * Off-phone (the hub itself) is always "on this device": Nano runs there.
 */
export function choosePrivacyLabel(input: PrivacyLabelInput): string {
  if (!input.isPhone) return PRIVACY_LABEL_ON_DEVICE;
  if (input.hasNanoOnThisPhone) return PRIVACY_LABEL_ON_DEVICE;
  if (input.wasRoutedViaHub) return PRIVACY_LABEL_ROUTED_VIA_HUB;
  return PRIVACY_LABEL_NO_NANO;
}
