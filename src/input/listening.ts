// Voice sleep/wake. Background speech must not fire commands while asleep.
// Distinct from gesture rest mode ("rest" / "wake up"): these phrases are
// always "Mendcraft sleep" and "Mendcraft wake".

import { normalizePhrase } from '../setup/setupState';

export type ListenPhrase = 'sleep' | 'wake';

export function parseListenPhrase(utterance: string): ListenPhrase | null {
  const n = normalizePhrase(utterance);
  if (n === 'mendcraft sleep') return 'sleep';
  if (n === 'mendcraft wake' || n === 'mendcraft wake up') return 'wake';
  return null;
}
