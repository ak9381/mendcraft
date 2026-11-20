// Pure (DOM-free) mapper from a camera / hand-tracking start failure to the
// one honest sentence the status line shows. The old canvas said "No camera
// here — hands stay off." for EVERY failure — permission denied, busy webcam,
// a CSP that blocked MediaPipe's wasm — which made real problems undiagnosable.

/** Thrown by presence.start() when the page cannot ask for a camera at all. */
export const INSECURE_CONTEXT_MESSAGE = 'camera needs a secure context (no navigator.mediaDevices)';

interface ErrLike {
  name?: string;
  message?: string;
}

function errParts(err: unknown): ErrLike {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; type?: unknown };
    return {
      name: typeof e.name === 'string' ? e.name : undefined,
      message: typeof e.message === 'string' ? e.message : undefined,
    };
  }
  if (typeof err === 'string') return { message: err };
  return {};
}

/** A DOM Event (e.g. a <script>/importScripts error event) — MediaPipe's
 *  loader rejects with one of these when the CSP or network blocks its wasm. */
function isEventLike(err: unknown): boolean {
  if (typeof Event !== 'undefined' && err instanceof Event) return true;
  return !!err && typeof err === 'object' && typeof (err as { type?: unknown }).type === 'string' &&
    typeof (err as { target?: unknown }).target === 'object' && !(err as ErrLike).message;
}

const LOAD_FAILURE_RE =
  /failed to fetch|content security policy|importscripts|vision_wasm|\.task\b|failed to load|networkerror|dynamically imported module|fetchholder|wasm/i;

/** Map any error thrown while starting the camera + hand tracking to a short,
 *  actionable status-line sentence. Pure; never throws. */
export function describeCameraError(err: unknown): string {
  const { name, message } = errParts(err);
  const msg = message ?? '';

  if (msg.includes(INSECURE_CONTEXT_MESSAGE) || /secure context|insecure/i.test(msg)) {
    return 'Camera needs a secure (https) page — hands stay off.';
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    if (/system/i.test(msg)) {
      return 'Camera blocked by macOS — System Settings › Privacy & Security › Camera › turn on Chrome, then press Hands.';
    }
    return 'Camera blocked — click the camera icon in the address bar, choose Allow, then press Hands.';
  }
  if (name === 'SecurityError') {
    return 'Camera blocked — click the camera icon in the address bar, choose Allow, then press Hands.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'No camera found — plug one in, then press Hands.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'Camera is busy in another app or tab — close it, then press Hands.';
  }
  if (isEventLike(err) || LOAD_FAILURE_RE.test(msg)) {
    return 'Hand-tracking engine couldn’t load (network or an extension blocked cdn.jsdelivr.net / storage.googleapis.com) — reload to retry.';
  }
  const short = name || msg.slice(0, 80) || 'unknown error';
  return `Camera didn't start (${short}) — press Hands to retry.`;
}
