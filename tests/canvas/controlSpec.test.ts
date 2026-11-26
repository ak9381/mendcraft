// The controls a generated tile may carry are checked against the fixed
// class tables: anything foreign, out of range or malformed is dropped and
// counted, never clamped.
import { describe, expect, it } from 'vitest';
import { coerceControls, standardControls, CONTROLS_SCHEMA_LINE, MAX_CONTROLS } from '../../src/canvas/controlSpec';

describe('coerceControls', () => {
  it('keeps a lamp toggle, a brightness slider and scene chips', () => {
    const raw = [
      { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } },
      { kind: 'slider', label: 'Brightness', key: 'brightness', min: 0, max: 900 },
      { kind: 'chips', label: 'Scenes', options: [
        { label: 'Relax', intent: { sceneId: 16 } },
        { label: 'Focus', intent: { sceneId: 15 } },
        { label: 'Cozy', intent: { sceneId: 6 } },
      ] },
    ];
    const r = coerceControls(raw, 'lamp');
    expect(r.dropped).toBe(0);
    expect(r.controls).toEqual([
      { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } },
      // The model cannot set a slider's range: min and max are not kept.
      { kind: 'slider', label: 'Brightness', key: 'brightness' },
      { kind: 'chips', label: 'Scenes', options: [
        { label: 'Relax', intent: { sceneId: 16 } },
        { label: 'Focus', intent: { sceneId: 15 } },
        { label: 'Cozy', intent: { sceneId: 6 } },
      ] },
    ]);
  });

  it('drops foreign and out-of-range controls', () => {
    const r = coerceControls([{ kind: 'slider', label: 'Volume', key: 'volume' },
      { kind: 'button', label: 'Max', intent: { brightness: 500 } },
      { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } }], 'lamp');
    expect(r.controls).toEqual([{ kind: 'toggle', label: 'Power', intent: { on: 'toggle' } }]);
    expect(r.dropped).toBe(2);
  });

  it('drops an intent with two keys, a label with markup, and controls past the eighth', () => {
    const two = coerceControls([{ kind: 'button', label: 'Both', intent: { on: true, brightness: 50 } }], 'lamp');
    expect(two).toEqual({ controls: [], dropped: 1 });
    const markup = coerceControls([{ kind: 'button', label: '<b>Bright</b>', intent: { brightness: 80 } }], 'lamp');
    expect(markup).toEqual({ controls: [], dropped: 1 });
    const long = coerceControls([{ kind: 'button', label: 'x'.repeat(25), intent: { brightness: 80 } }], 'lamp');
    expect(long).toEqual({ controls: [], dropped: 1 });
    const many = Array.from({ length: 10 }, (_, i) => ({ kind: 'button', label: `Level ${i}`, intent: { brightness: 10 + i * 10 } }));
    const r = coerceControls(many, 'lamp');
    expect(r.controls).toHaveLength(MAX_CONTROLS);
    expect(r.dropped).toBe(2);
  });

  it('drops bad chip options one by one, and the chips when none is left', () => {
    const r = coerceControls([{ kind: 'chips', label: 'Looks', options: [
      { label: 'Red', intent: { rgb: { r: 255, g: 0, b: 0 } } },
      { label: 'Too red', intent: { rgb: { r: 300, g: 0, b: 0 } } },
      { label: 'Loud', intent: { volume: 50 } },
    ] }, { kind: 'chips', label: 'None', options: [{ label: 'No', intent: { sceneId: 999 } }] }], 'lamp');
    expect(r.controls).toEqual([{ kind: 'chips', label: 'Looks', options: [{ label: 'Red', intent: { rgb: { r: 255, g: 0, b: 0 } } }] }]);
    expect(r.dropped).toBe(4);
  });

  it('refuses a $value on a control that never sends one, and a bad step', () => {
    const r = coerceControls([
      { kind: 'button', label: 'Set', intent: { brightness: '$value' } },
      { kind: 'button', label: 'Up', intent: { brightness: { step: 2 } } },
      { kind: 'button', label: 'Down', intent: { brightness: { step: -1 } } },
    ], 'lamp');
    expect(r.controls).toEqual([{ kind: 'button', label: 'Down', intent: { brightness: { step: -1 } } }]);
    expect(r.dropped).toBe(2);
  });

  it('nothing written is no controls and nothing dropped', () => {
    expect(coerceControls(undefined, 'lamp')).toEqual({ controls: [], dropped: 0 });
    expect(coerceControls('lots', 'lamp')).toEqual({ controls: [], dropped: 1 });
  });

  it('standardControls(lamp) is a power toggle, a brightness slider and a temp slider', () => {
    const c = standardControls('lamp');
    expect(c.map((x) => x.kind)).toEqual(['toggle', 'slider', 'slider']);
    expect(c[0]).toMatchObject({ kind: 'toggle', intent: { on: 'toggle' } });
    expect(c[1]).toMatchObject({ kind: 'slider', key: 'brightness' });
    expect(c[2]).toMatchObject({ kind: 'slider', key: 'temp' });
    // Derived, but still passes its own check.
    expect(coerceControls(c, 'lamp')).toEqual({ controls: c, dropped: 0 });
  });

  it('standardControls(music) is play/pause, volume, previous, next', () => {
    const c = standardControls('music');
    expect(c.map((x) => x.kind)).toEqual(['toggle', 'slider', 'button', 'button']);
    expect(c[0]).toMatchObject({ intent: { playing: 'toggle' } });
    expect(c[1]).toMatchObject({ key: 'volume' });
    expect(c[2]).toMatchObject({ intent: { previous: true } });
    expect(c[3]).toMatchObject({ intent: { next: true } });
    expect(coerceControls(c, 'music').dropped).toBe(0);
  });

  it('the prompt line lists the class tables and the ranges', () => {
    expect(CONTROLS_SCHEMA_LINE).toContain('lamp: on, brightness, temp, rgb, sceneId');
    expect(CONTROLS_SCHEMA_LINE).toContain('music: playing, volume, next, previous');
    expect(CONTROLS_SCHEMA_LINE).toContain('brightness 10-100');
    expect(CONTROLS_SCHEMA_LINE).toContain('temp 2200-6500');
  });
});
