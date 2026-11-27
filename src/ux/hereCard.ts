import type { FocusKind, Focusable } from './focusModel';
import { kindLabel } from './focusModel';
import type { SuggestionLevel } from './suggestions';

export interface HereAction {
  phrase: string;
  detail: string;
}

const BY_KIND: Record<FocusKind, HereAction[]> = {
  plan: [
    { phrase: 'Draw a room 4 by 5 metres', detail: 'start a room on the plan' },
    { phrase: 'Check everything', detail: 'run the guidelines' },
    { phrase: 'Walk in', detail: 'see it in 3D' },
    { phrase: 'Email the client', detail: 'draft from today\'s changes' },
    { phrase: 'Three ideas for this', detail: 'options on the canvas' },
  ],
  room: [
    { phrase: 'Check this room', detail: 'sizes, door widths, turning' },
    { phrase: 'Walk in', detail: 'see it in 3D' },
    { phrase: 'Three ideas for this', detail: 'options on the canvas' },
    { phrase: 'Make this 4 metres', detail: 'resize the room' },
    { phrase: 'Warm evening light', detail: 'materials and light, online' },
  ],
  wall: [
    { phrase: 'Make this 4 metres', detail: 'set the wall length' },
    { phrase: 'Move this wall 300 mm', detail: 'nudge it' },
    { phrase: 'Put a door here', detail: 'add a door on this wall' },
    { phrase: 'Put a window here', detail: 'add a window on this wall' },
  ],
  door: [
    { phrase: 'Make this 900 mm', detail: 'set the clear width' },
    { phrase: 'Check this door', detail: 'wheelchair clearance' },
    { phrase: 'Flip the swing', detail: 'change which way it opens' },
  ],
  window: [
    { phrase: 'Make this 1200 mm', detail: 'set the width' },
    { phrase: 'Set the sill to 900 mm', detail: 'height from the floor' },
  ],
  stair: [
    { phrase: 'Check this stair', detail: 'rise, going, and legend' },
    { phrase: 'Set rise to 175 mm', detail: 'change the step height' },
    { phrase: 'Walk in', detail: 'see it in 3D' },
  ],
  view3d: [
    { phrase: 'Warm evening light, terracotta floor', detail: 'materials and light' },
    { phrase: 'Save this view', detail: 'keep the camera' },
    { phrase: 'Send this to the client', detail: 'share the view' },
  ],
  none: [
    { phrase: 'Draw a room 4 by 5 metres', detail: 'start with a room' },
    { phrase: 'What can I do', detail: 'open this card' },
    { phrase: 'Undo', detail: 'drop the last kept change' },
  ],
};

export function hereTitle(focus: Focusable | null): string {
  if (!focus || focus.kind === 'none') return 'HERE: the plan';
  if (focus.kind === 'plan') return 'HERE: the whole plan';
  const name = focus.name?.trim();
  return name ? `HERE: ${name} (${kindLabel(focus.kind)})` : `HERE: ${kindLabel(focus.kind)}`;
}

export function hereActions(focus: Focusable | null, level: SuggestionLevel, more = false): HereAction[] {
  const kind: FocusKind = focus?.kind ?? 'none';
  const all = BY_KIND[kind] ?? BY_KIND.none;
  // Level only trims the default three; "more" lists every action.
  if (more) return all;
  const unlocked = all.filter((a) => actionUnlocked(a, level, kind));
  return unlocked.slice(0, 3);
}

function actionUnlocked(a: HereAction, level: SuggestionLevel, kind: FocusKind): boolean {
  if (level >= 3) return true;
  if (level >= 2) return !/light|email|reference|pinterest/i.test(a.phrase + a.detail);
  // First session: drawing, change, undo, keep/drop — not stairs/devices/email/site.
  if (kind === 'none' || kind === 'plan') return /draw|check everything|undo|what can i do/i.test(a.phrase);
  return /make this|put a door|put a window|check this|flip/i.test(a.phrase);
}

export const HERE_HANDS_LINE = 'Hands: pinch = keep · brush = drop · palm = this card';
export const HERE_SAY_LINE = 'Say a number, or "more" for everything you can do here';
