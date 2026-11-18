import {
  GETTING_QUICK_READY,
  OFFLINE_QUICK_ONLY,
  QUICK_READY,
  STAYS_ON_THIS_DEVICE,
} from './wording';

export type MicState = 'listening' | 'sleep' | 'off';
export type HandState = 'seen' | 'paused' | 'off';
export type QuickState = 'ready' | 'getting-ready' | 'unavailable' | 'checking';

export interface StatusSnapshot {
  online: boolean;
  keepOnDevice?: boolean;
  quick: QuickState;
  /** 0–100 while Getting Quick ready. */
  quickPercent?: number;
  mic: MicState;
  hand: HandState;
}

export interface StatusPhrases {
  network: string;
  quick: string;
  mic: string;
  hand: string;
  /** One spoken summary for the live region. */
  summary: string;
}

export function micPhrase(mic: MicState): string {
  if (mic === 'listening') return 'Mic on';
  if (mic === 'sleep') return 'Mic sleeping';
  return 'Mic off';
}

export function handPhrase(hand: HandState): string {
  if (hand === 'seen') return 'Hand seen';
  if (hand === 'paused') return 'Hands paused';
  return 'Hand not seen';
}

export function quickPhrase(quick: QuickState, percent?: number): string {
  if (quick === 'ready') return QUICK_READY;
  if (quick === 'getting-ready') {
    const n = typeof percent === 'number' && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, Math.round(percent)))
      : null;
    return n === null ? GETTING_QUICK_READY : `${GETTING_QUICK_READY} ${n}%`;
  }
  if (quick === 'checking') return 'Checking Quick';
  return 'Quick unavailable';
}

export function networkPhrase(online: boolean, keepOnDevice?: boolean): string {
  if (!online) return OFFLINE_QUICK_ONLY;
  if (keepOnDevice) return STAYS_ON_THIS_DEVICE;
  return 'Online';
}

export function formatStatus(s: StatusSnapshot): StatusPhrases {
  const network = networkPhrase(s.online, s.keepOnDevice);
  const quick = quickPhrase(s.quick, s.quickPercent);
  const mic = micPhrase(s.mic);
  const hand = handPhrase(s.hand);
  return {
    network,
    quick,
    mic,
    hand,
    summary: `${network}. ${quick}. ${mic}. ${hand}.`,
  };
}
