// DEFAULT GESTURE CATALOG (pure data + lookups, DOM-free).
//
// Every default gesture, what it does, which scope it belongs to, and the
// button/command it drives. The hints on buttons, the Gestures guide, the setup
// wizard's pick-lists and the dispatcher all read this one table, so a gesture
// shown on a button is exactly the gesture that runs it. Chosen for arthritic
// hands: no tight fists, no fast flicks; static poses must be HELD briefly.

export type GestureScope = 'core' | 'studio' | 'devices' | 'safety';

export interface CatalogGesture {
  id: string;
  label: string;
  /** Kannada label for the guide. */
  kn: string;
  scope: GestureScope;
  /** Plain description of what it does. */
  does: string;
  /** Button id or command id it drives (pointer gestures have none). */
  target?: string;
  /** Short glyph for the on-button hint. */
  glyph: string;
  /** 'pointer' = handled by the pinch pointer itself; 'discrete' fires once;
   *  'continuous' emits steps while held. */
  kind: 'pointer' | 'discrete' | 'continuous';
  /** False when recognised but its action waits on other work. */
  wired: boolean;
  /** Short reason when not wired. */
  note?: string;
}

export const GESTURE_CATALOG: readonly CatalogGesture[] = [
  // ---- core ----
  { id: 'point', label: 'Point', kn: 'ಬೆರಳು ತೋರಿಸು', scope: 'core', does: 'Move the cursor (snaps to nearby objects)', glyph: '☝', kind: 'pointer', wired: true },
  { id: 'pinch', label: 'Soft pinch', kn: 'ಮೆತ್ತಗೆ ಚಿವುಟು', scope: 'core', does: 'Select an object or click a button', glyph: '🤏', kind: 'pointer', wired: true },
  { id: 'pinch-drag', label: 'Pinch and hold, move', kn: 'ಚಿವುಟಿ ಎಳೆ', scope: 'core', does: 'Hold the pinch and move to drag the object', glyph: '🤏↔', kind: 'pointer', wired: true },
  { id: 'double-pinch', label: 'Double pinch', kn: 'ಎರಡು ಬಾರಿ ಚಿವುಟು', scope: 'core', does: 'Open the palette (or confirm; set in Gestures)', glyph: '🤏🤏', kind: 'discrete', wired: true },
  { id: 'palm-hold', label: 'Open palm, hold 0.8 s', kn: 'ಅಂಗೈ ತೋರಿಸಿ ಹಿಡಿ', scope: 'core', does: 'Palm menu and Here card', target: 'cancel', glyph: '✋', kind: 'discrete', wired: true },
  { id: 'pinch-hold-still', label: 'Hold a pinch still', kn: 'ಚಿವುಟಿ ಹಿಡಿ', scope: 'core', does: 'Talk (voice on/off)', target: 'btn-mic', glyph: '🤏🎙', kind: 'discrete', wired: true },
  { id: 'thumbs-up', label: 'Thumbs up', kn: 'ಹೆಬ್ಬೆರಳು ಮೇಲೆ', scope: 'core', does: 'Confirm a send', glyph: '👍', kind: 'discrete', wired: true },
  { id: 'palm-swipe-left', label: 'Palm swipe left', kn: 'ಅಂಗೈ ಎಡಕ್ಕೆ', scope: 'core', does: 'Back (close the top panel)', target: 'nav-back', glyph: '✋←', kind: 'discrete', wired: true },
  { id: 'palm-swipe-right', label: 'Palm swipe right', kn: 'ಅಂಗೈ ಬಲಕ್ಕೆ', scope: 'core', does: 'Forward (reopen it)', target: 'nav-forward', glyph: '✋→', kind: 'discrete', wired: true },
  { id: 'two-finger-swipe-up', label: 'Two fingers swipe up', kn: 'ಎರಡು ಬೆರಳು ಮೇಲೆ', scope: 'core', does: 'Scroll up', target: 'scroll-up', glyph: '✌↑', kind: 'discrete', wired: true },
  { id: 'two-finger-swipe-down', label: 'Two fingers swipe down', kn: 'ಎರಡು ಬೆರಳು ಕೆಳಗೆ', scope: 'core', does: 'Scroll down', target: 'scroll-down', glyph: '✌↓', kind: 'discrete', wired: true },
  { id: 'two-hand-zoom', label: 'Two-hand pinch apart / together', kn: 'ಎರಡು ಕೈ ಚಿವುಟಿ ದೂರ/ಹತ್ತಿರ', scope: 'core', does: 'Zoom in or out', glyph: '🤏🤏↔', kind: 'continuous', wired: true },
  { id: 'twist', label: 'Twist the pinched hand', kn: 'ಚಿವುಟಿ ತಿರುಗಿಸು', scope: 'core', does: 'Rotate the selection', target: 'rotate', glyph: '🤏⟳', kind: 'continuous', wired: true },
  // ---- studio ----
  { id: 'air-tap', label: 'Air tap with the index', kn: 'ಗಾಳಿಯಲ್ಲಿ ತಟ್ಟು', scope: 'studio', does: 'Add the selected tool / tap where you point', target: 'tap', glyph: '☝·', kind: 'discrete', wired: true },
  { id: 'v-sign', label: 'V sign (hold)', kn: 'ವಿ ಸನ್ನೆ', scope: 'studio', does: 'Undo', target: 'btn-undo', glyph: '✌', kind: 'discrete', wired: true },
  { id: 'three-fingers', label: 'Three fingers (hold)', kn: 'ಮೂರು ಬೆರಳು', scope: 'studio', does: 'Redo', target: 'btn-redo', glyph: '3☝', kind: 'discrete', wired: true },
  { id: 'palm-flip', label: 'Palm flip', kn: 'ಅಂಗೈ ತಿರುಗಿಸು', scope: 'studio', does: 'Open the More menu', target: 'btn-more', glyph: '✋⇄', kind: 'discrete', wired: true },
  { id: 'circle', label: 'Draw a circle with a fingertip', kn: 'ಬೆರಳಿನಿಂದ ವೃತ್ತ', scope: 'studio', does: 'Select what is inside', target: 'select-area', glyph: '☝◯', kind: 'discrete', wired: true },
  { id: 'ref-pick', label: 'Pinch a numbered card', kn: 'ಸಂಖ್ಯೆಯನ್ನು ಚಿವುಟು', scope: 'studio', does: 'Pick a reference picture on the canvas', target: 'ref-pick', glyph: '🤏#', kind: 'pointer', wired: true },
  // ---- devices (active while the lamp panel is open) ----
  { id: 'palm-raise', label: 'Raise the palm slowly', kn: 'ಅಂಗೈ ಮೇಲೆತ್ತು', scope: 'devices', does: 'Lamp brighter', target: 'lamp-up', glyph: '✋↑', kind: 'continuous', wired: true },
  { id: 'palm-lower', label: 'Lower the palm slowly', kn: 'ಅಂಗೈ ಇಳಿಸು', scope: 'devices', does: 'Lamp dimmer', target: 'lamp-down', glyph: '✋↓', kind: 'continuous', wired: true },
  { id: 'palm-tap', label: 'Palm tap (toward the screen)', kn: 'ಅಂಗೈ ತಟ್ಟು', scope: 'devices', does: 'Lamp on / off', target: 'lamp-toggle', glyph: '✋•', kind: 'discrete', wired: true },
  { id: 'pinch-slide', label: 'Pinch and slide sideways', kn: 'ಚಿವುಟಿ ಸರಿಸು', scope: 'devices', does: 'Music volume', target: 'volume', glyph: '🤏⇆', kind: 'continuous', wired: true },
  { id: 'two-finger-swipe-side', label: 'Two fingers swipe sideways', kn: 'ಎರಡು ಬೆರಳು ಪಕ್ಕಕ್ಕೆ', scope: 'devices', does: 'Skip track', target: 'next-track', glyph: '✌→', kind: 'discrete', wired: true },
  // ---- safety ----
  { id: 'both-palms', label: 'Both palms open', kn: 'ಎರಡೂ ಅಂಗೈ', scope: 'safety', does: 'Rest mode (pause all gestures)', target: 'rest-toggle', glyph: '🙌', kind: 'discrete', wired: true },
  { id: 'wave', label: 'Wave', kn: 'ಕೈ ಬೀಸು', scope: 'safety', does: 'Wake up from rest', target: 'wake', glyph: '👋', kind: 'discrete', wired: true },
  { id: 'dwell', label: 'Hover and wait', kn: 'ಮೇಲೆ ಇಟ್ಟು ಕಾಯಿ', scope: 'safety', does: 'Hover and wait to select, if a pinch is hard', glyph: '⏱', kind: 'pointer', wired: true },
];

export const SCOPE_LABELS: Record<GestureScope, string> = {
  core: 'Works everywhere', studio: 'Studio (design)', devices: 'Devices (lamp panel open)', safety: 'Safety and rest',
};

const BY_ID = new Map(GESTURE_CATALOG.map((g) => [g.id, g]));

export function catalogGesture(id: string): CatalogGesture | undefined {
  return BY_ID.get(id);
}

/** Default gesture for a button/command id (first match). */
export function defaultGestureFor(target: string): CatalogGesture | undefined {
  return GESTURE_CATALOG.find((g) => g.target === target);
}

/** Gestures she can bind in setup (discrete ones; pointer/continuous excluded). */
export function bindableGestures(): CatalogGesture[] {
  return GESTURE_CATALOG.filter((g) => g.kind === 'discrete');
}
