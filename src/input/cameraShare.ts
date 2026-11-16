// One camera, many features. iOS (and many browsers) let only one getUserMedia
// caller own the lens at a time, so setup, Add a device, and hand tracking must
// share a live stream instead of asking again — a second request fails or
// blanks the preview that is already on screen.

export type VideoTrackLike = { readyState?: string };
export type StreamLike = { getVideoTracks(): ReadonlyArray<VideoTrackLike> };
export type VideoLike = { srcObject?: unknown | null };
export type VideoSource = Iterable<VideoLike> | { querySelectorAll(sel: string): Iterable<VideoLike> };

export function isLiveVideoStream(stream: unknown): stream is MediaStream {
  if (!stream || typeof stream !== 'object') return false;
  const getTracks = (stream as StreamLike).getVideoTracks;
  if (typeof getTracks !== 'function') return false;
  return getTracks.call(stream).some((t) => t != null && t.readyState === 'live');
}

export function streamFromVideo(video: VideoLike | null | undefined): MediaStream | null {
  const src = video?.srcObject;
  return isLiveVideoStream(src) ? src : null;
}

function videosOf(source?: VideoSource): Iterable<VideoLike> {
  if (source && typeof (source as { querySelectorAll?: unknown }).querySelectorAll === 'function') {
    return (source as { querySelectorAll(sel: string): Iterable<VideoLike> }).querySelectorAll('video');
  }
  if (source && typeof (source as Iterable<VideoLike>)[Symbol.iterator] === 'function') {
    return source as Iterable<VideoLike>;
  }
  if (typeof document !== 'undefined') return document.querySelectorAll('video');
  return [];
}

/** First live camera MediaStream already attached to a <video> in this document
 *  (or the given list/root). Null when nothing is capturing. */
export function findLiveCameraStream(source?: VideoSource): MediaStream | null {
  for (const video of videosOf(source)) {
    const stream = streamFromVideo(video);
    if (stream) return stream;
  }
  return null;
}

export function hasLiveCameraStream(source?: VideoSource): boolean {
  return findLiveCameraStream(source) !== null;
}

/** Prefer a stream that is already live — do not call getUserMedia again. */
export function resolveCameraStream(
  preferred?: MediaStream | null,
  source?: VideoSource,
): { stream: MediaStream; owned: false } | { stream: null; owned: true } {
  if (isLiveVideoStream(preferred)) return { stream: preferred, owned: false };
  const found = findLiveCameraStream(source);
  if (found) return { stream: found, owned: false };
  return { stream: null, owned: true };
}

/** Used by setup's gesture recorder: start tracking on a live preview (or open
 *  the camera) instead of stopping with "Turn on the camera first." */
export async function ensureCameraReady(opts: {
  cameraOn: () => boolean;
  enableCamera: () => Promise<boolean>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (opts.cameraOn()) return { ok: true };
  const started = await opts.enableCamera();
  if (started || opts.cameraOn()) return { ok: true };
  return { ok: false, message: 'Turn on the camera first.' };
}
