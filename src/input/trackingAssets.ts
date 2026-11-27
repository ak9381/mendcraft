// The MediaPipe files the hand and face trackers load at runtime. Exact,
// versioned URLs (tasks-vision@1.2.3 matches package.json; the models are the
// float16/1 releases), so they never change under one URL: the service worker
// (public/sw.js, filled in at build time by src/offline/swBuild.ts) keeps a
// copy of each one and serves it cache-first, so an offline reload still
// starts hand tracking. Bump the version here and the cache name follows.

export const MEDIAPIPE_VERSION = '1.2.3';
export const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Every file FilesetResolver.forVisionTasks(WASM_BASE) and the two
 *  landmarkers fetch (the non-module loader + binary is its default). */
export const TRACKING_ASSET_URLS: readonly string[] = [
  `${WASM_BASE}/vision_wasm_internal.js`,
  `${WASM_BASE}/vision_wasm_internal.wasm`,
  HAND_MODEL_URL,
  FACE_MODEL_URL,
];

/** Cache name for those files: versioned, so a new MediaPipe never reads an old copy. */
export const TRACKING_CACHE = `mendcraft-tracking-mp-${MEDIAPIPE_VERSION}-v1`;
