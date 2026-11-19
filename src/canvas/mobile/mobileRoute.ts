// Which load opens the mobile companion shell, and which of its six screens
// a deep link asks for. Mirrors the style of ../route.ts.

export const MOBILE_SCREENS = ['pair', 'canvas', 'dashboard', 'approval', 'gimbal', 'tablet'] as const;
export type MobileScreen = (typeof MOBILE_SCREENS)[number];

export function parseMobileScreen(search: string): MobileScreen {
  const v = new URLSearchParams(search).get('mobileScreen');
  return (MOBILE_SCREENS as readonly string[]).includes(v ?? '') ? (v as MobileScreen) : 'pair';
}
