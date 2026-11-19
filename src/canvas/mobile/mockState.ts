// Deterministic mock data for the mobile companion under ?sim=1 — no network,
// camera, or hub required, so Puppeteer screenshots are stable and headless-safe.
import { formatPairingCode } from '../connectSheet';
import { NO_GIMBAL_WHY } from '../gimbalCanvas';
import type { MobileScreen } from './mobileRoute';
import type { PrivacyLabelInput } from './privacyLabel';

export interface MobilePairState {
  paired: boolean;
  hubName: string;
  code: string;
}

export interface MobileBoard {
  id: string;
  title: string;
  active: boolean;
}

export interface MobileDeviceTile {
  id: string;
  label: string;
  kind: 'lamp' | 'music' | 'switch';
  on: boolean;
  detail: string;
}

export interface MobileRecentChange {
  summary: string;
  who: 'you' | 'quick' | 'deep';
  when: string;
}

export interface MobileProposal {
  prompt: string;
  summary: string;
  working: boolean;
  engine: 'nano' | 'gemini';
}

export interface MobileGimbalState {
  following: boolean;
  why: string;
}

export interface SimMobileState {
  pair: MobilePairState;
  boards: MobileBoard[];
  devices: MobileDeviceTile[];
  recent: MobileRecentChange[];
  proposal: MobileProposal;
  gimbal: MobileGimbalState;
  privacy: PrivacyLabelInput;
}

/** Same canonical dataset for every screen (coherent demo), paired everywhere
 *  except the pairing screen itself, which demonstrates the unpaired state.
 *  `pairedOverride` lets a deep link force either state on any screen (used
 *  by the a11y audit to cover both branches of the pairing screen). */
export function buildSimMobileState(screen: MobileScreen, pairedOverride?: boolean): SimMobileState {
  return {
    pair: {
      paired: pairedOverride ?? screen !== 'pair',
      hubName: 'Mac Studio',
      code: formatPairingCode('K7MP2Q4X'),
    },
    boards: [
      { id: 'b-living', title: 'Living room', active: true },
      { id: 'b-plan', title: 'Floor plan', active: false },
      { id: 'b-kitchen', title: 'Kitchen', active: false },
    ],
    devices: [
      { id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp', on: false, detail: '40% bright' },
      { id: 'wiz-ceiling', label: 'Ceiling light', kind: 'lamp', on: true, detail: '70% bright' },
      { id: 'speaker-1', label: 'Speaker', kind: 'music', on: false, detail: 'Morning light' },
    ],
    recent: [
      { summary: 'Kept: grouped lights + a room plan', who: 'deep', when: '2 min ago' },
      { summary: 'Connected: Speaker', who: 'you', when: '9 min ago' },
      { summary: 'Dimmed Desk lamp', who: 'you', when: '22 min ago' },
    ],
    proposal: {
      prompt: 'add kannada',
      summary: 'Kannada labels on 3 devices · Gemini planned, Nano wrote them',
      working: false,
      engine: 'gemini',
    },
    gimbal: { following: true, why: NO_GIMBAL_WHY },
    privacy: { isPhone: true, hasNanoOnThisPhone: false, wasRoutedViaHub: true },
  };
}
