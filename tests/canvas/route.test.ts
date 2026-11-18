import { describe, expect, it } from 'vitest';
import { canvasUrl, wantsCanvas } from '../../src/canvas/route';

describe('canvas route', () => {
  it('native shells always open the canvas', () => {
    expect(wantsCanvas('/', '', true)).toBe(true);
    expect(wantsCanvas('/canvas.html', '', true)).toBe(false);
  });
  it('web opens it on /canvas or ?canvas=1 only', () => {
    expect(wantsCanvas('/', '', false)).toBe(false);
    expect(wantsCanvas('/canvas', '', false)).toBe(true);
    expect(wantsCanvas('/', '?canvas=1&seed=1', false)).toBe(true);
    expect(wantsCanvas('/remote', '', false)).toBe(false);
  });
  it('keeps other params', () => {
    expect(canvasUrl('?canvas=1&seed=1')).toBe('/canvas.html?seed=1');
    expect(canvasUrl('')).toBe('/canvas.html');
  });
});
