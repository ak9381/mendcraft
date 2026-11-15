// DWELL-CLICK (pure). Hover the cursor on the same button for dwellMs and it
// clicks once — the fallback for days pinching hurts. Moving off resets it.

export function createDwellClicker(dwellMs = 900) {
  let key: unknown = null;
  let since = 0;
  let fired = false;
  function update(target: unknown, now: number): { progress: number; fire: boolean } {
    if (target !== key) { key = target; since = now; fired = false; }
    if (!key) return { progress: 0, fire: false };
    const progress = Math.min(1, (now - since) / dwellMs);
    if (progress >= 1 && !fired) { fired = true; return { progress, fire: true }; }
    return { progress: fired ? 0 : progress, fire: false };
  }
  function setDwell(ms: number): void { dwellMs = Math.max(300, Math.min(2500, ms)); }
  function reset(): void { key = null; fired = false; }
  return { update, setDwell, reset };
}
