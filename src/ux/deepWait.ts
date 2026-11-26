import { BY_DEEP, KEEP_WORKING, LATER_LIST, LATER_LIST_PROMISE } from './wording';

export type DeepJobKind = 'copilot' | 'lighting' | 'email' | 'connector' | 'plan' | 'other';

export const DEEP_ESTIMATE_SEC: Record<DeepJobKind, number> = {
  copilot: 15,
  lighting: 15,
  email: 12,
  connector: 20,
  plan: 15,
  other: 15,
};

export function estimateSec(kind: DeepJobKind): number {
  return DEEP_ESTIMATE_SEC[kind];
}

export function deepWorkingLabel(kind: DeepJobKind): string {
  const sec = estimateSec(kind);
  return `${BY_DEEP} · about ${sec} s · ${KEEP_WORKING}`;
}

export interface LaterItem {
  id: string;
  title: string;
  kind: DeepJobKind;
}

export function laterListLabel(items: readonly LaterItem[]): string {
  if (!items.length) return `${LATER_LIST}: nothing waiting`;
  const n = items.length;
  return `${LATER_LIST}: ${n} ${n === 1 ? 'thing' : 'things'}. ${LATER_LIST_PROMISE}`;
}

/** Soft tick, then a chime when Deep is ready. No-ops when AudioContext is missing. */
export function playDeepTick(ctx?: AudioContext): void {
  tone(ctx, 660, 0.06, 0.04);
}

export function playDeepChime(ctx?: AudioContext): void {
  tone(ctx, 523.25, 0.09, 0.07);
  setTimeout(() => tone(ctx, 784, 0.16, 0.08), 120);
}

function tone(ctx: AudioContext | undefined, freq: number, seconds: number, gain: number): void {
  if (!ctx) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + seconds);
  } catch {
    // Autoplay or closed context — stay silent.
  }
}
