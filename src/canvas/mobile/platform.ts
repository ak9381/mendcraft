// Pure platform detection for the mobile companion shell: which OS styling to
// apply (HIG vs Material 3) and whether the viewport is phone or tablet.
// `?platform=` always wins (screenshots can't rely on a real device UA);
// otherwise ask Capacitor; otherwise fall back to 'web'.

export type MobileOS = 'ios' | 'android' | 'web';

/** >=744px is the iPad mini portrait breakpoint: split view kicks in there. */
export const TABLET_MIN_WIDTH = 744;

export interface CapacitorLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export interface PlatformInput {
  /** location.search, e.g. "?platform=ios&mobileScreen=pair". */
  search: string;
  capacitor?: CapacitorLike | null;
  /** window.innerWidth. */
  viewportWidth: number;
}

export interface Platform {
  os: MobileOS;
  /** True when actually running inside a Capacitor native shell. */
  isNative: boolean;
  isTablet: boolean;
  isPhone: boolean;
}

function isMobileOS(v: string | null): v is MobileOS {
  return v === 'ios' || v === 'android' || v === 'web';
}

export function detectPlatform(input: PlatformInput): Platform {
  const override = new URLSearchParams(input.search).get('platform');
  const capOs = input.capacitor?.getPlatform?.();
  const isNative = input.capacitor?.isNativePlatform?.() === true;
  const os: MobileOS = isMobileOS(override)
    ? override
    : capOs === 'ios' || capOs === 'android'
      ? capOs
      : 'web';
  const isTablet = input.viewportWidth >= TABLET_MIN_WIDTH;
  return { os, isNative, isTablet, isPhone: !isTablet };
}
