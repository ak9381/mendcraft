// TEACH-A-GESTURE — recording, matching and local-only storage for gestures
// she trains herself (pure, DOM-free, camera-free; storage is injectable so
// all of this unit-tests without IndexedDB or a camera).
//
// Recording: 2–3 samples, each a short sequence of raw hand landmarks. The
// first sample decides whether this is a held POSE (nearest-template match,
// reusing gestureTemplates.ts) or a MOTION (DTW over the normalised
// sequence); later samples are checked against it for consistency, same
// spirit as gestureTemplates.ts's three-try pose recorder.
//
// Conflict / runtime precedence: at save time a candidate is tested against
// the built-in catalog (classifyGesture/classifyPose) on the SAME recorded
// frames — if a built-in already recognises them, that's surfaced as a
// conflict to warn about (she may still save; "her own bindings win" is
// already this app's rule — see gestureDispatch.ts). At RUNTIME a custom
// match is only allowed to fire when the live pose does NOT also strictly
// classify as a *different* built-in than the one it was warned about —
// so an accidental resemblance to an unrelated built-in always defers to
// that built-in, while the intended, acknowledged overlap (e.g. teaching
// "thumbs up" to also save the canvas) still fires.
import { classifyGesture } from './gestures';
import { classifyPose } from './motionGestures';
import { catalogGesture, type CatalogGesture } from './gestureCatalog';
import {
  coerceMotionTemplate,
  coerceTemplate,
  matchMotionTemplate,
  matchTemplate,
  meanVector,
  normalizePose,
  poseDistance,
  sequenceMotion,
  steadiestFrame,
  dtwDistance,
  MATCH_THRESHOLD,
  MOTION_MATCH_THRESHOLD,
  type GestureTemplate,
  type MotionTemplate,
} from './gestureTemplates';
import type { Pt } from './handLogic';

export const SAMPLES_NEEDED = 3;
export const SAMPLES_MIN = 2;
/** Above this mean per-frame drift (sequenceMotion), a sample is a motion,
 *  not a held pose. */
export const MOTION_KIND_THRESHOLD = 0.03;
/** Max mean distance a sample may sit from the others already collected. */
export const SAMPLE_CONSISTENCY = 0.16;
/** A match must beat the runner-up by at least this much to count as
 *  confident (stops two near-identical taught gestures from flapping). */
export const MATCH_MARGIN = 0.03;

export interface CustomGesture {
  id: string;
  name: string;
  kind: 'pose' | 'motion';
  pose?: GestureTemplate;
  motion?: MotionTemplate;
  /** Opaque, caller-defined action payload (a canvas command / device intent). */
  action: Record<string, unknown>;
  /** Human-readable summary shown in the gestures list and history ("Save the canvas"). */
  actionSummary: string;
  /** Catalog id flagged as a conflict when this was saved, if any — the
   *  runtime matcher uses this to tell an intended overlap from an
   *  accidental one. */
  conflictsWith?: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Recording

export type RecorderResult =
  | { status: 'retry'; samples: number; reason: string }
  | { status: 'ready'; samples: number; kind: 'pose' | 'motion' }
  | { status: 'done'; samples: number; kind: 'pose' | 'motion'; pose?: GestureTemplate; motion?: MotionTemplate };

/** Mean pairwise distance of `vectors[i]` against every other vector, using
 *  `dist` as the per-pair metric. */
function meanDistanceToOthers<T>(items: readonly T[], i: number, dist: (a: T, b: T) => number): number {
  const others = items.filter((_, j) => j !== i);
  if (!others.length) return 0;
  return others.reduce((sum, o) => sum + dist(items[i], o), 0) / others.length;
}

export function createGestureRecorder() {
  let kind: 'pose' | 'motion' | null = null;
  const poseVectors: number[][] = [];
  const motionSeqs: number[][][] = [];

  function reset(): void {
    kind = null;
    poseVectors.length = 0;
    motionSeqs.length = 0;
  }

  function finalize(samples: number): RecorderResult {
    if (kind === 'pose') {
      return { status: 'done', samples, kind, pose: { id: '', label: '', vector: meanVector(poseVectors).map((n) => Math.round(n * 1e4) / 1e4), createdAt: 0 } };
    }
    // Motion: no clean barycenter for variable-length DTW-matched sequences,
    // so the template is the sample closest (by DTW) to the others — the
    // most "typical" take, not an arbitrary one (e.g. always the first).
    let best = 0, bestD = Infinity;
    motionSeqs.forEach((_seq, i) => {
      const d = meanDistanceToOthers(motionSeqs, i, dtwDistance);
      if (d < bestD) { bestD = d; best = i; }
    });
    return { status: 'done', samples, kind: 'motion', motion: { id: '', label: '', frames: motionSeqs[best], createdAt: 0 } };
  }

  /** Feed one captured sample (raw landmark frames over ~2.5s). */
  function addSample(frames: readonly (readonly Pt[])[]): RecorderResult {
    const steady = frames.length ? (steadiestFrame(frames) ?? frames[frames.length - 1]) : null;
    const steadyVec = steady ? normalizePose(steady) : null;
    if (!steadyVec) {
      return { status: 'retry', samples: poseVectors.length + motionSeqs.length, reason: 'No full hand seen. Keep your whole hand in view and try that one again.' };
    }
    const motionLevel = sequenceMotion(frames);
    const thisKind: 'pose' | 'motion' = motionLevel > MOTION_KIND_THRESHOLD ? 'motion' : 'pose';
    if (kind === null) kind = thisKind;
    if (thisKind !== kind) {
      const samples = poseVectors.length + motionSeqs.length;
      return {
        status: 'retry',
        samples,
        reason: kind === 'pose'
          ? 'That try moved — hold still like the first one, then try again.'
          : 'That try held still — repeat the same motion as the first one.',
      };
    }

    if (kind === 'pose') {
      poseVectors.push(steadyVec);
      const i = poseVectors.length - 1;
      const d = meanDistanceToOthers(poseVectors, i, poseDistance);
      if (poseVectors.length > 1 && d > SAMPLE_CONSISTENCY) {
        poseVectors.pop();
        return { status: 'retry', samples: poseVectors.length, reason: 'That try looked different from the others. Try it again.' };
      }
    } else {
      const seq = frames.map(normalizePose).filter((v): v is number[] => v !== null);
      motionSeqs.push(seq);
      const i = motionSeqs.length - 1;
      const d = meanDistanceToOthers(motionSeqs, i, dtwDistance);
      if (motionSeqs.length > 1 && d > SAMPLE_CONSISTENCY) {
        motionSeqs.pop();
        return { status: 'retry', samples: motionSeqs.length, reason: 'That try looked different from the others. Try it again.' };
      }
    }

    const samples = poseVectors.length + motionSeqs.length;
    if (samples >= SAMPLES_NEEDED) return finalize(samples);
    if (samples >= SAMPLES_MIN) return { status: 'ready', samples, kind: kind! };
    return { status: 'retry', samples, reason: '' }; // reason '' signals "need another, nothing wrong" to the caller
  }

  /** Stop early at 2 consistent samples instead of recording a third. */
  function finishEarly(): RecorderResult | null {
    const samples = poseVectors.length + motionSeqs.length;
    if (samples < SAMPLES_MIN || !kind) return null;
    return finalize(samples);
  }

  return { addSample, finishEarly, reset, samples: () => poseVectors.length + motionSeqs.length };
}

// ---------------------------------------------------------------------------
// Conflict check (save time) and resolution (run time)

/** Which built-in, wired catalog gesture (if any) the SAME recorded frames
 *  already trigger — surfaced as a save-time warning. */
export function builtinConflict(frames: readonly (readonly Pt[])[], kind: 'pose' | 'motion'): CatalogGesture | undefined {
  const sample = steadiestFrame(frames) ?? frames[frames.length - 1];
  if (!sample) return undefined;
  const id = kind === 'motion' ? classifyPose(sample as Pt[]) : classifyGesture(sample as Pt[]);
  if (id === 'none') return undefined;
  const g = catalogGesture(id);
  return g?.wired ? g : undefined;
}

export interface GestureMatch { gesture: CustomGesture; distance: number }

/** Best confident custom-gesture match for a live frame (pose check) and/or
 *  a live sequence (motion check via DTW), or null. A match needs both a
 *  distance under threshold AND a margin over the runner-up. */
export function matchCustomGestures(
  liveFrames: readonly (readonly Pt[])[],
  gestures: readonly CustomGesture[],
): GestureMatch | null {
  if (!liveFrames.length) return null;
  const live = steadiestFrame(liveFrames) ?? liveFrames[liveFrames.length - 1];

  const poseTemplates = gestures.filter((g): g is CustomGesture & { pose: GestureTemplate } => g.kind === 'pose' && !!g.pose);
  const motionTemplates = gestures.filter((g): g is CustomGesture & { motion: MotionTemplate } => g.kind === 'motion' && !!g.motion);

  const poseHits = poseTemplates
    .map((g) => ({ g, d: matchTemplate(live, [g.pose], Infinity)?.distance ?? Infinity }))
    .filter((h) => h.d <= MATCH_THRESHOLD)
    .sort((a, b) => a.d - b.d);
  const motionHits = motionTemplates
    .map((g) => ({ g, d: matchMotionTemplate(liveFrames, [g.motion], Infinity)?.distance ?? Infinity }))
    .filter((h) => h.d <= MOTION_MATCH_THRESHOLD)
    .sort((a, b) => a.d - b.d);

  const hits = [...poseHits, ...motionHits].sort((a, b) => a.d - b.d);
  if (!hits.length) return null;
  const best = hits[0];
  const runnerUp = hits[1];
  if (runnerUp && runnerUp.d - best.d < MATCH_MARGIN) return null; // too ambiguous between two taught gestures

  // Runtime precedence: defer to a DIFFERENT, unrelated built-in that fires
  // on this exact pose. The intended, acknowledged overlap (conflictsWith)
  // still fires the custom action.
  const conflict = builtinConflict(liveFrames, best.g.kind);
  if (conflict && conflict.id !== best.g.conflictsWith) return null;

  return { gesture: best.g, distance: best.d };
}

/** Minimum time between two auto-fires, so holding a taught pose fires it
 *  once instead of every tracking frame while it's held. */
export const GESTURE_COOLDOWN_MS = 1500;

export interface GestureAutoFireState {
  lastFiredAt: number;
}

export function createGestureAutoFireState(): GestureAutoFireState {
  return { lastFiredAt: -Infinity };
}

/**
 * The always-on tracking loop's per-frame check: match the live frame
 * against every saved gesture (threshold, margin and built-in conflict
 * rules all come from matchCustomGestures) and, if it fires, record `now`
 * so the same held pose doesn't retrigger before the cooldown elapses.
 * A non-match never consumes the cooldown.
 */
export function autoFireGesture(
  liveFrames: readonly (readonly Pt[])[],
  gestures: readonly CustomGesture[],
  state: GestureAutoFireState,
  now: number,
  cooldownMs = GESTURE_COOLDOWN_MS,
): CustomGesture | null {
  if (now - state.lastFiredAt < cooldownMs) return null;
  const match = matchCustomGestures(liveFrames, gestures);
  if (!match) return null;
  state.lastFiredAt = now;
  return match.gesture;
}

// ---------------------------------------------------------------------------
// Storage (mirrors ai/phrasebook.ts's IndexedDB-or-memory adapter pair).
// Local-only, by design: never synced, never sent anywhere.

export interface CustomGestureStore {
  load(): Promise<CustomGesture[]>;
  put(gesture: CustomGesture): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createMemoryGestureStore(initial: CustomGesture[] = []): CustomGestureStore {
  const map = new Map<string, CustomGesture>(initial.map((g) => [g.id, clone(g)]));
  return {
    async load() { return [...map.values()].map(clone); },
    async put(g) { map.set(g.id, clone(g)); },
    async remove(id) { map.delete(id); },
  };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const DB_NAME = 'mendcraft-custom-gestures';
const STORE_NAME = 'gestures';

export function createIndexedDbGestureStore(dbName = DB_NAME): CustomGestureStore {
  const idb: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
  if (!idb) return createMemoryGestureStore();

  let dbPromise: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = idb!.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return open().then((db) => new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE_NAME, mode);
      const req = run(t.objectStore(STORE_NAME));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  return {
    async load() {
      try {
        const all = await tx<CustomGesture[]>('readonly', (s) => s.getAll() as IDBRequest<CustomGesture[]>);
        return (all ?? []).filter((g) => coerceCustomGesture(g) !== null);
      } catch {
        return [];
      }
    },
    async put(g) { await tx('readwrite', (s) => s.put(g)); },
    async remove(id) { await tx('readwrite', (s) => s.delete(id)); },
  };
}

/** Validate an untrusted record (e.g. loaded from IndexedDB) before use. */
export function coerceCustomGesture(raw: unknown): CustomGesture | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.name !== 'string' || !r.name) return null;
  if (r.kind !== 'pose' && r.kind !== 'motion') return null;
  if (!r.action || typeof r.action !== 'object') return null;
  if (typeof r.actionSummary !== 'string') return null;
  const pose = r.kind === 'pose' ? coerceTemplate(r.pose) : undefined;
  const motion = r.kind === 'motion' ? coerceMotionTemplate(r.motion) : undefined;
  if (r.kind === 'pose' && !pose) return null;
  if (r.kind === 'motion' && !motion) return null;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    pose: pose ?? undefined,
    motion: motion ?? undefined,
    action: r.action as Record<string, unknown>,
    actionSummary: r.actionSummary,
    conflictsWith: typeof r.conflictsWith === 'string' ? r.conflictsWith : undefined,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  };
}
