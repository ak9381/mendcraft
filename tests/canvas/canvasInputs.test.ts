import { describe, expect, it, vi } from 'vitest';
import { createCanvasInputs, type CanvasInputsCallbacks } from '../../src/canvas/canvasInputs';
import type { CanvasHandEvent, CanvasHandsStop } from '../../src/canvas/canvasHands';
import type { Box, GimbalCanvasController } from '../../src/canvas/gimbalCanvas';

function createFakeGimbal(overrides: Partial<GimbalCanvasController> = {}): GimbalCanvasController {
  return {
    mode: vi.fn(() => 'hands'),
    setMode: vi.fn(async () => ({ ok: false, why: 'The gimbal works in the iPhone app' })),
    onPoint: vi.fn(async () => ({ ok: true })),
    onHandsFrame: vi.fn(async () => ({ ok: true })),
    scan: vi.fn(async () => ({ ok: false, why: 'The gimbal works in the iPhone app' })),
    release: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe('canvasInputs', () => {
  it('wires canvasHands events to callbacks: pinch->keep, brush->drop, palm->palm', async () => {
    let capturedHandler: ((ev: CanvasHandEvent) => void) | null = null;
    const fakeMount = vi.fn((_root: HTMLElement, onEvent: (ev: CanvasHandEvent) => void) => {
      capturedHandler = onEvent;
      const stopFn = Object.assign(vi.fn(), { stop: vi.fn() });
      return stopFn as unknown as CanvasHandsStop;
    });

    const on: CanvasInputsCallbacks = {
      keep: vi.fn(),
      drop: vi.fn(),
      palm: vi.fn(),
      pointTarget: vi.fn(),
      scanFrame: vi.fn(),
      status: vi.fn(),
    };

    const fakeGimbal = createFakeGimbal();
    const inputs = createCanvasInputs({
      hands: fakeMount,
      gimbal: fakeGimbal,
      on,
    });

    const fakeRoot = {} as HTMLElement;
    await inputs.start(fakeRoot);

    expect(fakeMount).toHaveBeenCalledWith(fakeRoot, expect.any(Function));
    expect(capturedHandler).not.toBeNull();

    // Fire pinch -> keep
    capturedHandler!({ type: 'keep' });
    expect(on.keep).toHaveBeenCalledTimes(1);

    // Fire drop -> drop
    capturedHandler!({ type: 'drop' });
    expect(on.drop).toHaveBeenCalledTimes(1);

    // Fire palm -> palm
    capturedHandler!({ type: 'palm' });
    expect(on.palm).toHaveBeenCalledTimes(1);
  });

  it('feeds point events to gimbal onPoint', async () => {
    let capturedHandler: ((ev: CanvasHandEvent) => void) | null = null;
    const fakeMount = vi.fn((_root: HTMLElement, onEvent: (ev: CanvasHandEvent) => void) => {
      capturedHandler = onEvent;
      return Object.assign(vi.fn(), { stop: vi.fn() }) as unknown as CanvasHandsStop;
    });

    const fakeGimbal = createFakeGimbal();
    const inputs = createCanvasInputs({
      hands: fakeMount,
      gimbal: fakeGimbal,
    });

    await inputs.start({} as HTMLElement);
    capturedHandler!({ type: 'point', point: { x: 0.35, y: 0.65 } });

    expect(fakeGimbal.onPoint).toHaveBeenCalledWith({ x: 0.35, y: 0.65 });
  });

  it('handles speech commands for gimbal and returns true for valid phrases', async () => {
    const onStatus = vi.fn();
    const fakeGimbal = createFakeGimbal({
      setMode: vi.fn(async (m) => ({ ok: false, why: 'The gimbal works in the iPhone app' })),
      scan: vi.fn(async () => ({ ok: false, why: 'The gimbal works in the iPhone app' })),
    });

    const inputs = createCanvasInputs({
      gimbal: fakeGimbal,
      on: { status: onStatus },
    });

    // Valid gimbal commands
    expect(inputs.handleSpeech('follow my hands')).toBe(true);
    expect(fakeGimbal.setMode).toHaveBeenCalledWith('hands');

    expect(inputs.handleSpeech('stop following')).toBe(true);
    expect(fakeGimbal.setMode).toHaveBeenCalledWith('hold');

    expect(inputs.handleSpeech('connect what I am pointing at')).toBe(true);
    expect(fakeGimbal.setMode).toHaveBeenCalledWith('point');

    expect(inputs.handleSpeech('scan the room')).toBe(true);
    expect(fakeGimbal.scan).toHaveBeenCalled();

    // Allow async setMode/scan callbacks to resolve and update status
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onStatus).toHaveBeenCalledWith('The gimbal works in the iPhone app');

    // Unrelated speech returns false
    expect(inputs.handleSpeech('turn on the light')).toBe(false);
    expect(inputs.handleSpeech('new board')).toBe(false);
  });

  it('stop() releases gimbal and stops hands tracking', async () => {
    const stopFn = Object.assign(vi.fn(), { stop: vi.fn() });
    const fakeMount = vi.fn(() => stopFn as unknown as CanvasHandsStop);
    const fakeGimbal = createFakeGimbal();

    const inputs = createCanvasInputs({
      hands: fakeMount,
      gimbal: fakeGimbal,
    });

    await inputs.start({} as HTMLElement);
    inputs.stop();

    expect(stopFn.stop).toHaveBeenCalled();
    expect(fakeGimbal.release).toHaveBeenCalled();
  });
});
