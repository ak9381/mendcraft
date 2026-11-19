// Mobile companion shell: applies platform (HIG/Material) + size (phone/
// tablet) root classes, then delegates to the screen for the current state.
import { esc } from './htmlEsc';
import type { SimMobileState } from './mockState';
import type { MobileScreen } from './mobileRoute';
import type { Platform } from './platform';
import { renderApprovalScreen } from './screens/approvalScreen';
import { renderCanvasScreen } from './screens/canvasScreen';
import { renderDashboardScreen } from './screens/dashboardScreen';
import { renderGimbalScreen } from './screens/gimbalScreen';
import { renderPairScreen } from './screens/pairScreen';
import { renderTabletScreen } from './screens/tabletScreen';

export interface MountMobileOptions {
  platform: Platform;
  screen: MobileScreen;
  state: SimMobileState;
  onSay?: (text: string) => void;
}

export interface MobileHandle {
  screen(): MobileScreen;
}

/** Screens with their own full chrome; a slim topbar is added around the rest. */
const BARE_SCREENS: readonly MobileScreen[] = ['pair', 'approval', 'gimbal', 'tablet'];

export function mountMobile(root: HTMLElement, opts: MountMobileOptions): MobileHandle {
  const { platform, state } = opts;
  const onSay = opts.onSay ?? (() => {});
  // A tablet-width viewport (or the explicit deep link) always gets the split
  // view for the canvas; pairing/approval/gimbal stay full-screen at any size.
  const screen: MobileScreen = opts.screen === 'tablet' || (platform.isTablet && opts.screen === 'canvas')
    ? 'tablet'
    : opts.screen;

  root.classList.add('mc-mobile');
  root.classList.remove('mc-ios', 'mc-android', 'mc-web', 'mc-phone', 'mc-tablet');
  root.classList.add(platform.os === 'ios' ? 'mc-ios' : platform.os === 'android' ? 'mc-android' : 'mc-web');
  root.classList.add(platform.isTablet ? 'mc-tablet' : 'mc-phone');
  root.dataset.screen = screen;

  root.innerHTML = `
    ${
      !BARE_SCREENS.includes(screen) && state.pair.paired
        ? `<header class="mc-m-topbar"><span class="mc-m-chip mc-m-chip-paired">Paired · ${esc(state.pair.hubName)}</span></header>`
        : ''
    }
    <main class="mc-m-root" id="mc-m-root"></main>`;
  const main = root.querySelector<HTMLElement>('#mc-m-root')!;

  switch (screen) {
    case 'pair': renderPairScreen(main, state, platform, onSay); break;
    case 'canvas': renderCanvasScreen(main, state, platform, onSay); break;
    case 'dashboard': renderDashboardScreen(main, state, platform, onSay); break;
    case 'approval': renderApprovalScreen(main, state, platform); break;
    case 'gimbal': renderGimbalScreen(main, state, platform); break;
    case 'tablet': renderTabletScreen(main, state, platform, onSay); break;
  }

  return { screen: () => screen };
}
