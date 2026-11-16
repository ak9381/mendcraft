// Voice → music intent (pure). English is the polished path; a few Kannada and
// Hindi phrases are recognised so "we support other languages" is honest.
// Design-ish "play the demo / tour" is left alone so the studio walk stays
// reachable.

import { clampVolume } from './player';

export type MusicIntent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'volume'; volume: number }
  | { type: 'volumeAdjust'; delta: number }
  | { type: 'searchPlay'; query: string }
  | { type: 'connect' }
  | { type: 'disconnect' };

function norm(utterance: string): string {
  return utterance.trim().toLowerCase().replace(/[.!?।]+$/u, '').replace(/\s+/g, ' ');
}

const BLOCKED_PLAY = /^(play\s+)?(the\s+)?(demo|tour|walkthrough|video|simulation|sim)\b/;

const PLAY_BARE = /^(play|resume|continue|start)(\s+(the\s+)?(music|song|track|playback|tunes?))?$/;
const PAUSE = /^(pause|stop)(\s+(the\s+)?(music|song|track|playback|tunes?))$|^(pause)$/;
const NEXT = /^(next|skip)(\s+(this\s+)?(song|track|one|tune))?$|^skip(\s+it)?$/;
const PREV = /^(previous|prev|last|back)(\s+(song|track|one|tune))?$|^(go\s+back|play\s+(the\s+)?(previous|last)\s+(song|track))$/;
const VOL_UP = /^(turn\s+)?((the\s+)?(music\s+)?)?(volume\s+)?(up|louder)$|^(louder|volume up|turn it up)$/;
const VOL_DOWN = /^(turn\s+)?((the\s+)?(music\s+)?)?(volume\s+)?(down|quieter|softer)$|^(quieter|softer|volume down|turn it down)$/;
const CONNECT = /^(connect|log\s*in\s+to|sign\s+in\s+to|link)\s+spotify$/;
const DISCONNECT = /^(disconnect|log\s*out\s+of|sign\s+out\s+of|unlink)\s+spotify$/;

// Kannada / Hindi (fixed phrases only — English remains the polished path).
const KN_HI: Array<[RegExp, MusicIntent]> = [
  [/^(ಹಾಡು\s*)?(ಹಾಕು|ಪ್ಲೇ)|^(गाना\s*)?(चलाओ|प्ले)$/u, { type: 'play' }],
  [/^(ಹಾಡು\s*)?(ನಿಲ್ಲಿಸು|ವಿರಾಮ)|^(गाना\s*)?(रोको|बंद करो)$/u, { type: 'pause' }],
  [/^(ಮುಂದಿನ\s*ಹಾಡು|ಸ್ಕಿಪ್)|^(अगला\s*गाना|स्किप)$/u, { type: 'next' }],
  [/^(ಹಿಂದಿನ\s*ಹಾಡು)|^(पिछला\s*गाना)$/u, { type: 'prev' }],
];

export function parseMusicIntent(utterance: string): MusicIntent | null {
  const t = norm(utterance);
  if (!t) return null;
  if (BLOCKED_PLAY.test(t)) return null;

  if (CONNECT.test(t)) return { type: 'connect' };
  if (DISCONNECT.test(t)) return { type: 'disconnect' };

  if (PAUSE.test(t)) return { type: 'pause' };
  if (PLAY_BARE.test(t)) return { type: 'play' };
  if (NEXT.test(t)) return { type: 'next' };
  if (PREV.test(t)) return { type: 'prev' };
  if (VOL_UP.test(t)) return { type: 'volumeAdjust', delta: 0.1 };
  if (VOL_DOWN.test(t)) return { type: 'volumeAdjust', delta: -0.1 };

  const pct = t.match(/^(set\s+)?(the\s+)?volume(\s+to)?\s+(\d+)\s*%?$/);
  if (pct) return { type: 'volume', volume: clampVolume(Number(pct[4]) / 100) };

  for (const [re, intent] of KN_HI) if (re.test(t)) return intent;

  const playQ = t.match(/^play(?:\s+(?:some|me|a))?\s+(.+)$/);
  if (playQ) {
    const q = playQ[1].replace(/^(the|a|some|me)\s+/, '').trim();
    if (!q || BLOCKED_PLAY.test(`play ${q}`)) return null;
    if (/^(music|song|track|playback|tunes?)$/.test(q)) return { type: 'play' };
    return { type: 'searchPlay', query: q };
  }
  return null;
}
