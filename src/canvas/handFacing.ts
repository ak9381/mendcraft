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

export interface LaptopHandRouterDeps {
  pointer: Pick<HandPointer, 'update' | 'isGrabActive'> & Partial<Pick<HandPointer, 'setFacing' | 'handsLocked'>> | null;
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
}

export function createLaptopHandRouter(d: LaptopHandRouterDeps): LaptopHandRouter {
  let facing: boolean | null = null;
  let faceX: number | null = null;
  let lastFrameAt: number | null = null;
  const locked = (): boolean => !!d.pointer?.handsLocked?.();
  const blocked = (): boolean => !!d.pointer?.isGrabActive() || locked() || !!d.extraBlocked?.();
  const gateFacing = (): boolean | null => (locked() ? false : facing);
  return {
    presence(f, now) {
      const v = presenceHandFacing(f);
      facing = v;
      faceX = f.faces.find((x) => x.isOperator)?.box.cx ?? null;
      d.pointer?.setFacing?.(v, now);
    },
    setFacing(v, now) {
      facing = v;
      d.pointer?.setFacing?.(v, now ?? lastFrameAt ?? d.now?.() ?? 0);
    },
    frame(hands, now) {
      lastFrameAt = now;
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
  };
}
