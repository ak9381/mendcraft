import { describe, it, expect } from 'vitest';
import {
  isLiveVideoStream,
  streamFromVideo,
  findLiveCameraStream,
  hasLiveCameraStream,
  resolveCameraStream,
  ensureCameraReady,
} from '../src/input/cameraShare';

function fakeStream(state: 'live' | 'ended', id = 'cam'): MediaStream {
  const track = { kind: 'video', readyState: state, id, stop() { track.readyState = 'ended'; } };
  return {
    id,
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function video(stream: MediaStream | null | undefined): { srcObject: MediaStream | null } {
  return { srcObject: stream ?? null };
}

describe('camera share: live preview detection', () => {
  it('treats a stream with a live video track as live', () => {
    expect(isLiveVideoStream(fakeStream('live'))).toBe(true);
    expect(isLiveVideoStream(fakeStream('ended'))).toBe(false);
    expect(isLiveVideoStream(null)).toBe(false);
    expect(isLiveVideoStream({})).toBe(false);
  });

  it('finds the live Add-a-device (or any) camera preview among videos', () => {
    const live = fakeStream('live', 'preview');
    const ended = fakeStream('ended', 'old');
    const found = findLiveCameraStream([video(ended), video(null), video(live)]);
    expect(found).toBe(live);
    expect(hasLiveCameraStream([video(ended)])).toBe(false);
    expect(streamFromVideo(video(live))).toBe(live);
  });

  it('also walks a document-like root of <video> elements', () => {
    const live = fakeStream('live');
    const root = {
      querySelectorAll: (sel: string) => sel === 'video' ? [video(live)] : [],
    };
    expect(findLiveCameraStream(root)).toBe(live);
  });
});

describe('camera share: attach tracking to an existing stream', () => {
  it('reuses a preferred live stream instead of asking for a new one', () => {
    const preview = fakeStream('live', 'preview');
    const other = fakeStream('live', 'other');
    const picked = resolveCameraStream(preview, [video(other)]);
    expect(picked.owned).toBe(false);
    expect(picked.stream).toBe(preview);
  });

  it('falls back to a live preview already on a video element', () => {
    const preview = fakeStream('live', 'preview');
    const picked = resolveCameraStream(null, [video(preview)]);
    expect(picked).toEqual({ stream: preview, owned: false });
  });

  it('only asks getUserMedia when nothing is already capturing', () => {
    const picked = resolveCameraStream(fakeStream('ended'), [video(null)]);
    expect(picked).toEqual({ stream: null, owned: true });
  });
});

describe('setup gesture recorder: share or auto-start the camera', () => {
  it('does not say “Turn on the camera first.” when tracking is already on', async () => {
    let started = 0;
    const result = await ensureCameraReady({
      cameraOn: () => true,
      enableCamera: async () => { started += 1; return true; },
    });
    expect(result).toEqual({ ok: true });
    expect(started).toBe(0);
  });

  it('auto-starts the tracker on a live preview instead of showing the message', async () => {
    const preview = fakeStream('live');
    let tracker: MediaStream | null = null;
    const result = await ensureCameraReady({
      cameraOn: () => tracker !== null,
      enableCamera: async () => {
        const picked = resolveCameraStream(null, [video(preview)]);
        if (!picked.stream) return false;
        tracker = picked.stream;
        return true;
      },
    });
    expect(result).toEqual({ ok: true });
    expect(tracker).toBe(preview);
  });

  it('auto-starts enableCamera when no preview is up yet, and only then shows the message if that fails', async () => {
    const started: boolean[] = [];
    const fail = await ensureCameraReady({
      cameraOn: () => false,
      enableCamera: async () => { started.push(false); return false; },
    });
    expect(fail).toEqual({ ok: false, message: 'Turn on the camera first.' });

    const ok = await ensureCameraReady({
      cameraOn: () => false,
      enableCamera: async () => { started.push(true); return true; },
    });
    expect(ok).toEqual({ ok: true });
    expect(started).toEqual([false, true]);
  });
});
