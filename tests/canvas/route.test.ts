import { describe, expect, it } from 'vitest';
import { canvasUrl, mobileUrl, wantsCanvas } from '../../src/canvas/route';
import { isMobileRoute, isLandingRoute } from '../../src/relay/protocol';

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

describe('mobile route', () => {
  it('matches /mobile and ?view=mobile, but not the canvas', () => {
    expect(isMobileRoute('/mobile', '')).toBe(true);
    expect(isMobileRoute('/', '?view=mobile')).toBe(true);
    expect(isMobileRoute('/canvas', '')).toBe(false);
  });
  it('/mobile is not the landing page', () => {
    expect(isLandingRoute('/', '?view=mobile')).toBe(false);
  });
  it('mobileUrl drops view=mobile but keeps sim/platform/screen flags', () => {
    expect(mobileUrl('?view=mobile&sim=1&platform=android')).toBe('/mobile.html?sim=1&platform=android');
    expect(mobileUrl('')).toBe('/mobile.html');
  });
});
