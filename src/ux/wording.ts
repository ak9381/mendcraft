// Words she sees. The engineering names (Nano, Gemini, pending, queue)
// stay in code; the interface uses this glossary from the UX spec.

export const QUICK = 'Quick';
export const DEEP = 'Deep';
export const ON_THIS_DEVICE = 'on this device';
export const ONLINE = 'online';

export const BY_QUICK = 'Quick · on this device';
export const BY_DEEP = 'Deep · online';

export const GUESS = 'Guess';
export const WAITING_FOR_YOU = 'Waiting for you';
export const LATER_LIST = 'Later list';
export const LATER_LIST_PROMISE = "I'll do these when you're back online";
export const GETTING_QUICK_READY = 'Getting Quick ready';
export const QUICK_READY = 'Quick ready';
export const OFFLINE_QUICK_ONLY = 'Offline · Quick only';
export const STAYS_ON_THIS_DEVICE = 'Stays on this device';
export const ESCALATION_LINE = "Quick wasn't sure, so Deep checked";
export const ESCALATION_ROUTE = "Quick wasn't sure, so Deep double-checked.";
export const KEEP_WORKING = 'keep working';
export const WHAT_WAS_SENT = 'What was sent';
export const WHY_HERE = 'Why here';
export const WHY_ONLINE = 'Why online';

export const PINCH_KEEP = 'PINCH  keep';
export const BRUSH_DROP = 'BRUSH  drop';
export const PINCH_HOLD_SEND = 'PINCH AND HOLD  send';

export type HelperName = 'Quick' | 'Deep' | 'Browser';

/** Actor stored on a change → the line she reads on a card. */
export function actorByLine(actor: 'her' | 'nano' | 'gemini' | 'rules'): string {
  if (actor === 'her') return 'You';
  if (actor === 'gemini') return BY_DEEP;
  return BY_QUICK;
}

export function helperFromSource(source: 'on-device' | 'cloud' | 'rules' | 'nano' | 'gemini'): HelperName {
  return source === 'cloud' || source === 'gemini' ? 'Deep' : 'Quick';
}

export function byLineFor(helper: HelperName): string {
  if (helper === 'Deep') return BY_DEEP;
  if (helper === 'Browser') return 'Opened in your browser';
  return BY_QUICK;
}
