// "is the lamp on?" (final review 5): a reachable lamp is asked for its state
// before the answer, as the speaker is. Bounded: a lamp that has not answered
// in LAMP_REREAD_MS is answered from its last known state ("last I heard").
import type { LampState } from '../devices/wiz';

export const LAMP_REREAD_MS = 1500;

/** Read every lamp at once; apply each answer that arrives in time. Returns
 *  the ids that did not answer (threw, or too slow). */
export async function rereadLamps(
  ids: readonly string[],
  read: (id: string) => Promise<LampState | null>,
  apply: (id: string, state: LampState) => void,
  ms: number = LAMP_REREAD_MS,
): Promise<Set<string>> {
  const stale = new Set(ids);
  if (!ids.length) return stale;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((r) => { timer = setTimeout(r, ms); });
  let done = false;
  const reads = ids.map(async (id) => {
    try {
      const s = await read(id);
      if (s && !done) { apply(id, s); stale.delete(id); }
    } catch { /* not answering: stays stale */ }
  });
  await Promise.race([Promise.all(reads), deadline]);
  done = true;
  clearTimeout(timer);
  return stale;
}
