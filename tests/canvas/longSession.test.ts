// Final review M13: a tab open for hours with hands and camera froze its
// renderer. Soak-style checks that nothing a long session feeds grows
// without limit, and that the camera loop never runs inference twice on the
// same video frame or dies on one bad frame.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCanvasLedger, LEDGER_KEEP } from '../../src/canvas/ledger';
import { createGestureTrace } from '../../src/canvas/gestureTrace';
import { createFrameGate, STALE_CLOCK_MS } from '../../src/input/frameGate';

describe('canvas ledger over a long session', () => {
  it('100 000 records keep at most LEDGER_KEEP entries; the totals and lines stay exact', () => {
    const l = createCanvasLedger();
    let bytes = 0, ai = 0, spotify = 0, sim = 0;
    let last = null as ReturnType<typeof l.record> | null;
    for (let i = 0; i < 100_000; i++) {
      const engine = i % 3 === 0 ? 'spotify' : i % 3 === 1 ? 'gemini' : 'nano';
      const isSim = i % 10 === 0 && engine !== 'spotify';
      last = l.record({ engine, sentText: 'abcd', sim: isSim });
      if (engine === 'spotify') spotify++; else ai++;
      if (isSim) { if (engine !== 'nano') sim += 4; } else if (engine !== 'nano') bytes += 4;
    }
    expect(l.entries().length).toBeLessThanOrEqual(LEDGER_KEEP);
    const t = l.totals();
    expect(t.count).toBe(100_000);
    expect(t.aiCount).toBe(ai);
    expect(t.spotifyCount).toBe(spotify);
    expect(t.totalBytes).toBe(bytes);
    expect(t.simBytes).toBe(sim);
    // a late send on a recent turn is still booked; on a folded one too
    const old = l.record({ engine: 'gemini', sentText: '' });
    for (let i = 0; i < LEDGER_KEEP + 5; i++) l.record({ engine: 'nano' });
    l.addBytes(old, 10);
    l.addBytes(last!, 0);
    expect(l.totals().totalBytes).toBe(bytes + 10);
    expect(l.formatSpotifyLine()).toContain(`${spotify} calls`);
    expect(l.formatLine()).toMatch(/sent to Gemini/);
    l.clear();
    expect(l.totals()).toMatchObject({ count: 0, totalBytes: 0, simBytes: 0 });
  });
});

describe('gesture trace', () => {
  it('stays at its cap over 100 000 frames, and costs nothing while disabled', () => {
    const t = createGestureTrace(240);
    const frame = { t: 0, hand: 0, classification: 'open', pinchDistance: 1, focusedTargetId: null, raw: { x: 0, y: 0 }, eased: { x: 0, y: 0 }, clickTarget: null };
    for (let i = 0; i < 100_000; i++) t.push({ ...frame, t: i });
    expect(t.frames.length).toBe(0);
    t.enable();
    for (let i = 0; i < 100_000; i++) t.push({ ...frame, t: i });
    expect(t.frames.length).toBe(240);
    // the hand pointer builds a snapshot per frame only while the trace is on
    const hp = readFileSync(new URL('../../src/canvas/handPointer.ts', import.meta.url), 'utf8');
    expect(hp).toContain('if (trace.enabled) trace.push({ t, hand: i, ...slots[i].snapshot() });');
  });
});

describe('camera loop: one inference per new video frame, never dies on a bad frame', () => {
  it('a 120 Hz display over a 30 fps camera runs the model once per camera frame (100 000 animation frames)', () => {
    const gate = createFrameGate();
    let runs = 0;
    for (let f = 0; f < 100_000; f++) {
      const now = f * (1000 / 120);
      const videoTime = Math.floor(f / 4) / 30; // a new camera frame every 4th display frame
      if (gate.isNewFrame(videoTime, now)) runs++;
    }
    expect(runs).toBe(25_000);
  });
  it('a video clock that does not move still runs, at about the camera rate (never stops, never every frame)', () => {
    const gate = createFrameGate();
    let runs = 0;
    for (let f = 0; f < 12_000; f++) if (gate.isNewFrame(0, f * (1000 / 120))) runs++; // 100 s at 120 Hz
    expect(runs).toBeGreaterThan(100 * (1000 / STALE_CLOCK_MS) * 0.7);
    expect(runs).toBeLessThanOrEqual(100 * (1000 / STALE_CLOCK_MS) + 1);
    gate.reset();
    expect(gate.isNewFrame(0, 0)).toBe(true);
  });
  it('the presence and hand loops use the gate and keep looping when detectForVideo throws', () => {
    for (const file of ['presence.ts', 'hands.ts']) {
      const src = readFileSync(new URL(`../../src/input/${file}`, import.meta.url), 'utf8');
      expect(src, file).toContain('frameGate.isNewFrame(video.currentTime)');
      expect(src, file).toMatch(/catch \(err\) \{[^}]*trackingErrors/);
    }
  });
});
