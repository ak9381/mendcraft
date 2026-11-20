// describeCameraError: every camera / tracking start failure maps to one
// honest, actionable status line — never the old generic "No camera here".
import { describe, expect, it } from 'vitest';
import { describeCameraError, INSECURE_CONTEXT_MESSAGE } from '../src/input/cameraError';

function err(name: string, message = ''): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('describeCameraError', () => {
  it('maps a missing mediaDevices / insecure context to the https message', () => {
    expect(describeCameraError(new Error(INSECURE_CONTEXT_MESSAGE))).toBe(
      'Camera needs a secure (https) page — hands stay off.',
    );
  });

  it('maps a macOS system-level NotAllowedError to the System Settings message', () => {
    expect(describeCameraError(err('NotAllowedError', 'Permission denied by system'))).toContain(
      'System Settings › Privacy & Security › Camera',
    );
  });

  it('maps NotAllowedError / PermissionDeniedError / SecurityError to the address-bar message', () => {
    const want = 'Camera blocked — click the camera icon in the address bar, choose Allow, then press Hands.';
    expect(describeCameraError(err('NotAllowedError', 'Permission denied'))).toBe(want);
    expect(describeCameraError(err('PermissionDeniedError'))).toBe(want);
    expect(describeCameraError(err('SecurityError'))).toBe(want);
  });

  it('maps missing-device errors to the plug-one-in message', () => {
    const want = 'No camera found — plug one in, then press Hands.';
    expect(describeCameraError(err('NotFoundError'))).toBe(want);
    expect(describeCameraError(err('DevicesNotFoundError'))).toBe(want);
    expect(describeCameraError(err('OverconstrainedError'))).toBe(want);
  });

  it('maps busy-device errors to the close-the-other-app message', () => {
    const want = 'Camera is busy in another app or tab — close it, then press Hands.';
    expect(describeCameraError(err('NotReadableError', 'Could not start video source'))).toBe(want);
    expect(describeCameraError(err('TrackStartError'))).toBe(want);
    expect(describeCameraError(err('AbortError'))).toBe(want);
  });

  it('maps script/wasm/model load failures to the engine message', () => {
    const want =
      'Hand-tracking engine couldn’t load (network or an extension blocked cdn.jsdelivr.net / storage.googleapis.com) — reload to retry.';
    expect(describeCameraError(new Error('Failed to fetch'))).toBe(want);
    expect(describeCameraError(new Error("Refused to load the script because it violates the following Content Security Policy directive"))).toBe(want);
    expect(describeCameraError(new Error('importScripts failed'))).toBe(want);
    expect(describeCameraError(new Error('vision_wasm_internal.js could not be loaded'))).toBe(want);
    expect(describeCameraError(new Error('Failed to load model hand_landmarker.task'))).toBe(want);
    // MediaPipe's loader rejects with the raw DOM Event from the failed <script>.
    const fakeEvent = { type: 'error', target: {} };
    expect(describeCameraError(fakeEvent)).toBe(want);
  });

  it('falls back to a short honest line with the error name or message', () => {
    expect(describeCameraError(err('WeirdError'))).toBe("Camera didn't start (WeirdError) — press Hands to retry.");
    expect(describeCameraError('something odd happened')).toBe(
      "Camera didn't start (something odd happened) — press Hands to retry.",
    );
    expect(describeCameraError(undefined)).toBe("Camera didn't start (unknown error) — press Hands to retry.");
  });
});
