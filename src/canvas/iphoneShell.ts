// When to show the phone-simple canvas: Capacitor iOS/Android, or a small
// touch-width viewport. Desktop (wide web) stays unchanged.

export const PHONE_SHELL_MAX_WIDTH = 600;

export interface PhoneShellInput {
  capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  } | null;
  viewportWidth: number;
}

/** True on the iOS or Android app, or any viewport under 600px. */
export function isPhoneCanvasShell(input: PhoneShellInput): boolean {
  const cap = input.capacitor;
  if (cap?.isNativePlatform?.() === true) {
    const platform = cap.getPlatform?.();
    if (platform === 'ios' || platform === 'android') return true;
  }
  return input.viewportWidth < PHONE_SHELL_MAX_WIDTH;
}
