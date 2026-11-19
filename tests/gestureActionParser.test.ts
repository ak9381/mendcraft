import { describe, expect, it } from 'vitest';
import { parseActionText, resolveGestureAction } from '../src/canvas/gestureActionParser';
import type { DeviceRef } from '../src/canvas/deviceCommands';

const DEVICES: DeviceRef[] = [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp', on: true, brightness: 80 }];

describe('parseActionText', () => {
  it('parses a canvas command', () => {
    expect(parseActionText('save the canvas', [])).toBe('Save the canvas');
  });
  it('parses a device command', () => {
    expect(parseActionText('dim the desk lamp to 30%', DEVICES)).toMatch(/30%/);
  });
  it('returns null for gibberish', () => {
    expect(parseActionText('purple elephant migration', DEVICES)).toBeNull();
  });
});

describe('resolveGestureAction', () => {
  it('resolves via rules without touching any engine', async () => {
    const r = await resolveGestureAction('save the canvas', [], {});
    expect(r).toEqual({ text: 'save the canvas', summary: 'Save the canvas', engine: 'rules' });
  });

  it('falls back to nano when rules fail, labelling the engine', async () => {
    const r = await resolveGestureAction('would you mind illuminating things', DEVICES, {
      nano: async () => 'turn on the lights',
    });
    expect(r?.engine).toBe('nano');
    expect(r?.text).toBe('turn on the lights');
  });

  it('falls back to gemini when nano fails or is absent', async () => {
    const r = await resolveGestureAction('purple elephant migration', [], {
      nano: async () => 'still gibberish',
      gemini: async () => 'undo',
    });
    expect(r?.engine).toBe('gemini');
    expect(r?.summary).toBe('Undo');
  });

  it('returns null when nothing understands it, and never throws on a failing engine', async () => {
    const r = await resolveGestureAction('purple elephant migration', [], {
      nano: async () => { throw new Error('offline'); },
    });
    expect(r).toBeNull();
  });
});
