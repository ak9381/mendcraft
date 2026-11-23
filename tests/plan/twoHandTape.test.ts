import { describe, expect, it } from 'vitest';
import { beginTwoHandMeasure, tapeText } from '../../src/plan/twoHandSession';

const mkView = () => { const hints: string[] = []; return { hints, toWorld: (x: number, y: number) => ({ x: x * 10, y: y * 10 }), render: () => {}, showHint: (t: string) => { hints.push(t); } }; };

describe('two-hand tape measure', () => {
  it('formats like a tape', () => {
    expect(tapeText(3420)).toBe('3.42 m');
    expect(tapeText(640.4)).toBe('640 mm');
  });
  it('reads the live distance in world units and keeps the span on release', () => {
    const v = mkView();
    const s = beginTwoHandMeasure(v)!;
    s.move({ x: 0, y: 0 }, { x: 300, y: 400 }); // 500 px → 5000 mm
    expect(v.hints.at(-1)).toBe('Tape: 5.00 m');
    s.end();
    expect(v.hints.at(-1)).toMatch(/5\.00 m — tap to keep/);
    expect(s.span()).toEqual({ a: { x: 0, y: 0 }, b: { x: 3000, y: 4000 } });
  });
  it('a lost hand clears the readout and the span', () => {
    const v = mkView();
    const s = beginTwoHandMeasure(v)!;
    s.move({ x: 0, y: 0 }, { x: 100, y: 0 });
    s.cancel();
    expect(v.hints.at(-1)).toBe('');
    expect(s.span()).toBeNull();
  });
});
