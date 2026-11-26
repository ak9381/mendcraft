// The ONE facing gate for the laptop hands. While the user is not facing
// this screen nothing from the hands acts or moves: no cursor, no highlight,
// no hold progress, no tap, no button gesture, no scroll, no drag / orbit.
//
//  - presenceHandFacing(): the presence frame → one strict boolean. Only a
//    settled operator face that faces the screen counts as facing. No face
//    (head turned past what the face model can see), a face that has not
//    settled, a stranger, or a turned head = NOT facing. (Before this, "no
//    face" read as unknown and never locked the hands: looking away far
//    enough to lose the face left every gesture live.)
//  - The lock itself lives in the hand pointer (handPointer.setFacing /
//    handsLocked): it locks at once, cancels a running grab, and resumes only
//    after FACING_RESUME_MS of continuous facing.
//  - createLaptopHandRouter(): one laptop hand frame in the fixed order the
//    canvas uses (shape read → pointer → plan peace → button gestures →
//    taught gestures), every stage reading the same lock.
import type { PresenceFrame } from '../input/presence';
import type { Pt } from '../input/handLogic';
import type { HandPointer } from './handPointer';
export { FACING_RESUME_MS } from './handPointer';
import type { GestureControl, GestureFrameContext } from './gestureControl';
import { cameraHandsFromSelfie } from './handSpace';

/** Strict hand-facing signal from one presence frame: true only for a
 *  settled operator face that faces the screen. */
export function presenceHandFacing(f: Pick<PresenceFrame, 'faces'> & { handGate?: boolean | null }): boolean {
  const gate = f.handGate !== undefined ? f.handGate : (f.faces.find((x) => x.isOperator)?.handGate ?? null);
  return gate === true;
}

type Hands = readonly (readonly Pt[])[];

/** No face seen this long while her hands are in view: it is the camera
 *  (dark room, too close), not her looking away — say so. */
export const CANT_SEE_FACE_MS = 2000;
export const CANT_SEE_FACE_LINE = 'I can’t see your face — add light or sit a little further back.';
/** The pill while the "hands always on" override is set. */
export const HANDS_ALWAYS_LINE = 'Hands: always on';
export const CANT_SEE_PILL = 'Can’t see your face';
/** Per-device override: hands act whether or not she faces this device. */
export const HANDS_ALWAYS_KEY = 'mc.handsAlwaysOn';

export function readHandsAlways(storage?: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(HANDS_ALWAYS_KEY) === '1'; } catch { return false; }
}
export function writeHandsAlways(on: boolean, storage?: Pick<Storage, 'setItem' | 'removeItem'> | null): void {
  try { if (on) storage?.setItem(HANDS_ALWAYS_KEY, '1'); else storage?.removeItem(HANDS_ALWAYS_KEY); } catch { /* storage off */ }
}

/** "No face seen" (as opposed to a seen, turned head): no face at all and
 *  the gate not holding a state through its lost grace. */
export function noFaceSeen(f: Pick<PresenceFrame, 'faces'> & { handGate?: boolean | null }): boolean {
  const gate = f.handGate !== undefined ? f.handGate : (f.faces.find((x) => x.isOperator)?.handGate ?? null);
  return f.faces.length === 0 && gate === null;
}

/** What the facing pill shows: the gate, or an override's honest text. */
export interface FacingView { facing: boolean | null; text?: string }

export interface LaptopHandRouterDeps {
  pointer: Pick<HandPointer, 'update' | 'isGrabActive'> & Partial<Pick<HandPointer, 'setFacing' | 'handsLocked' | 'setLockHint'>> | null;
  gestures: Pick<GestureControl, 'read' | 'frame' | 'busy'> | null;
  cameraAspect?: () => number | undefined;
  /** Something else owns the hands (a point-to-connect capture). */
  extraBlocked?: () => boolean;
  suppressCounts?: () => boolean;
  /** Plan peace-and-move + plan hand UI refresh (canvasApp.planHandFrame). */
  planFrame?: (hands: Hands, now: number, facing: boolean | null) => Pick<GestureFrameContext, 'claimedPeace' | 'noScrollPeace'>;
  /** Taught gestures — only called while the hands may act. */
  teach?: (hands: Hands, now: number) => void;
  /** Point-to-connect capture: intentionally NOT facing-gated (you look at
   *  the device you point at, not at this screen). */
  pointWait?: (cam: Hands, now: number) => void;
  now?: () => number;
  /** "Hands always on" (per device): presence never locks the hands. */
  alwaysOn?: () => boolean;
  /** A status line (said once per can't-see-your-face episode). */
  say?: (text: string) => void;
}

export interface LaptopHandRouter {
  /** A presence frame from the camera: sets the facing gate. */
  presence(f: Pick<PresenceFrame, 'faces'> & { handGate?: boolean | null }, now: number): void;
  /** Set the gate directly (sim/test): false = not facing, null = no signal.
   *  `now` defaults to the last hand frame's clock, so a synthetic-clock
   *  replay and the resume settle agree. */
  setFacing(v: boolean | null, now?: number): void;
  /** One selfie-space hand frame (may be empty). */
  frame(hands: Hands, now: number): void;
  /** The hands are locked (not facing, or still settling after facing again). */
  locked(): boolean;
  /** Gestures are paused: locked, a fist grab, or a point capture. */
  blocked(): boolean;
  /** The facing value the gestures see: false while locked. */
  facing(): boolean | null;
  faceX(): number | null;
  /** What the Facing pill shows. */
  view(): FacingView;
  /** The strict presence signal (she faces THIS screen), for the attention
   *  the host shares; false while hands are off / no camera frames. */
  faceSeenFacing(): boolean;
}

export function createLaptopHandRouter(d: LaptopHandRouterDeps): LaptopHandRouter {
  let facing: boolean | null = null;
  let faceX: number | null = null;
  let lastFrameAt: number | null = null;
  let strict = false;
  let strictAt = -Infinity;
  let noFaceSince: number | null = null;
  let handsAt = -Infinity;
  let cantSee = false;
  let said = false;
  const locked = (): boolean => !!d.pointer?.handsLocked?.();
  const blocked = (): boolean => !!d.pointer?.isGrabActive() || locked() || !!d.extraBlocked?.();
  const gateFacing = (): boolean | null => (locked() ? false : facing);
  return {
    presence(f, now) {
      const v = presenceHandFacing(f);
      strict = v; strictAt = now;
      faceX = f.faces.find((x) => x.isOperator)?.box.cx ?? null;
      noFaceSince = noFaceSeen(f) ? (noFaceSince ?? now) : null;
      // Her hands are in view but no face for 2 s: the camera can't see her.
      cantSee = noFaceSince !== null && now - noFaceSince >= CANT_SEE_FACE_MS && now - handsAt < 500;
      if (noFaceSince === null) said = false;
      const always = !!d.alwaysOn?.();
      d.pointer?.setLockHint?.(cantSee && !always ? CANT_SEE_FACE_LINE : null);
      if (cantSee && !always && !said) { said = true; d.say?.(CANT_SEE_FACE_LINE); }
      // The override: presence never locks (null = no signal = allowed).
      facing = always ? null : v;
      d.pointer?.setFacing?.(facing, now);
    },
    setFacing(v, now) {
      facing = v;
      d.pointer?.setFacing?.(v, now ?? lastFrameAt ?? d.now?.() ?? 0);
    },
    frame(hands, now) {
      lastFrameAt = now;
      if (hands.length) handsAt = now;
      const aspect = d.cameraAspect?.();
      d.gestures?.read(hands, { faceX, cameraAspect: aspect });
      // Presence hands are selfie-mirrored; the pointer expects camera space.
      const cam = cameraHandsFromSelfie(hands);
      d.pointer?.update(cam, now);
      // Read AFTER the pointer update: the pointer evaluates the gate first
      // thing in update(), so every stage below sees this frame's lock.
      const f = gateFacing();
      const plan = d.planFrame?.(hands, now, f) ?? {};
      d.gestures?.frame(hands, now, {
        facing: f, faceX, blocked: blocked(), cameraAspect: aspect,
        suppressCounts: d.suppressCounts?.() ?? false,
        ...plan,
      });
      if (!hands.length) return;
      // Taught gestures obey the same guards as built-ins: never while the
      // hands are locked or a fist grab is running — and never over a fixed
      // button gesture (held, or its shape showing).
      if (!locked() && !d.pointer?.isGrabActive() && !d.gestures?.busy()) d.teach?.(hands, now);
      d.pointWait?.(cam, now);
    },
    locked,
    blocked,
    facing: gateFacing,
    faceX: () => faceX,
    view() {
      if (d.alwaysOn?.()) return { facing: true, text: HANDS_ALWAYS_LINE };
      if (cantSee) return { facing: false, text: CANT_SEE_PILL };
      return { facing: strict && !locked() };
    },
    faceSeenFacing: () => strict && (d.now?.() ?? lastFrameAt ?? 0) - strictAt < 1500,
  };
}
