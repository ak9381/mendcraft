// Pure guided-tour logic (no DOM) for the judges' tour. The spotlight engine
// that renders these steps over the REAL running app lives in main.ts; this
// module owns the ordering, missing-element skipping, next/back bounds, the
// step counter and the "seen" persistence so all of it is unit-testable.

export interface TourStepDef {
  id: string;
  /** CSS selector for the REAL control this step spotlights. If no element
   *  matches at tour time, the step is dropped (see resolveTourSteps). */
  selector: string;
  title: string;
  body: string;
}

/**
 * The steps the judges' tour walks through, each pointing at a real control in
 * the running editor. Any step whose element is absent in the current mode is
 * skipped gracefully by resolveTourSteps — nothing here is assumed to exist.
 */
export const TOUR_STEPS: TourStepDef[] = [
  {
    id: 'mode',
    selector: '#mode-switch',
    title: 'Pick a design mode',
    body: 'Plan is a 2D floor plan, Part is a 3D printable part, UI is a screen design. Everything in the tour works the same in all three.',
  },
  {
    id: 'palette',
    selector: '.mc-palette',
    title: 'The tool palette',
    body: 'Big targets you can pinch with a camera or tap. Walls, doors, fixtures, text — all reachable without fine finger control.',
  },
  {
    id: 'command',
    selector: '#command-box',
    title: 'Say it or type it',
    body: 'Speak a command (“make this wall 4 meters”) or type it. The same pipeline runs for voice, text and the sim — no mouse precision needed.',
  },
  {
    id: 'badge',
    selector: '#source-badge',
    title: 'Honest AI-source badge',
    body: 'Every result shows where it came from — RULES, ON-DEVICE (Gemini Nano), CLOUD (gemini flash-lite) or SIM — with the router’s reason. It never pretends.',
  },
  {
    id: 'ledger',
    selector: '#btn-ledger',
    title: 'What left this device',
    body: 'Open the ledger to see every cloud call and its bytes, side by side with the private on-device events. Nothing leaves silently.',
  },
  {
    id: 'language',
    selector: '#lang-select',
    title: 'Her language',
    body: 'Switch to Kannada and speak. Non-English goes to the cloud for translate + intent in one call, and the badge says so honestly.',
  },
  {
    id: 'network',
    selector: '#net-state',
    title: 'Works offline',
    body: 'Toggle offline and big jobs queue on-device, then drain to an Apply/Reject preview when the network returns.',
  },
  {
    id: 'a11y',
    selector: '#btn-a11y',
    title: 'Accessibility check',
    body: 'Runs code checks for door widths, turning circles and contrast, then explains fixes you can accept with one pinch.',
  },
];

/** Keep only the steps whose target element is actually present, in order.
 *  `present` is a predicate — DOM-backed in the app, a Set in tests. */
export function resolveTourSteps(
  defs: TourStepDef[],
  present: (selector: string) => boolean,
): TourStepDef[] {
  return defs.filter((d) => present(d.selector));
}

/** Clamp an index into [0, length-1]; 0 for an empty tour. */
export function clampStep(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function stepForward(index: number, length: number): number {
  return clampStep(index + 1, length);
}

export function stepBack(index: number, length: number): number {
  return clampStep(index - 1, length);
}

export function atFirst(index: number): boolean {
  return index <= 0;
}

export function atLast(index: number, length: number): boolean {
  return index >= length - 1;
}

/** Human "3 of 7" counter (1-based, clamped). */
export function stepCounter(index: number, length: number): string {
  if (length <= 0) return '0 of 0';
  return `${clampStep(index, length) + 1} of ${length}`;
}

// ---- persistence ------------------------------------------------------------

export const TOUR_SEEN_KEY = 'mendcraft.tourSeen';

type Getter = Pick<Storage, 'getItem'>;
type Setter = Pick<Storage, 'setItem'>;

/** Has the judge dismissed / finished the tour before? Storage-blocked → false. */
export function tourDismissed(store: Getter): boolean {
  try {
    return store.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the tour was seen so it does not auto-open again. */
export function markTourDismissed(store: Setter): void {
  try {
    store.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* private mode / storage blocked — tour just re-offers next load */
  }
}
