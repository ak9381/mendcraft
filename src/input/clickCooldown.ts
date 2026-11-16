// After a pinch or dwell click, ignore further clicks for a short window so
// a shaky hold or a second pinch cannot fire twice.

export interface ClickCooldown {
  ready(nowMs: number): boolean;
  arm(nowMs: number): void;
  reset(): void;
}

export const DEFAULT_CLICK_COOLDOWN_MS = 500;

export function createClickCooldown(ms = DEFAULT_CLICK_COOLDOWN_MS): ClickCooldown {
  let last = -Infinity;
  const windowMs = Math.max(0, ms);
  return {
    ready(nowMs) {
      return nowMs - last >= windowMs;
    },
    arm(nowMs) {
      last = nowMs;
    },
    reset() {
      last = -Infinity;
    },
  };
}
