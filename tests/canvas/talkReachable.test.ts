// The Talk (floating mic) button must stay pressable by mouse AND pinch.
// Every fixed/full-screen overlay the hands layer mounts (skeleton canvas,
// face canvas, cursor ring, target frame, registration chip) must declare
// pointer-events: none, or it would swallow clicks aimed at the mic — the
// browser smoke test checks elementFromPoint live; this pins the CSS contract.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountMicFab } from '../../src/canvas/micFab';

const canvasCss = readFileSync(new URL('../../src/canvas/canvas.css', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');

/** The CSS block that styles `cls` (first rule whose selector mentions it). */
function ruleFor(css: string, cls: string): string {
  const rules = css.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  return rules.filter((r) => r.slice(0, r.indexOf('{')).includes(cls)).join('\n');
}

describe('overlays never cover the Talk button', () => {
  it('every hands/face overlay declares pointer-events: none', () => {
    for (const [css, cls] of [
      [styleCss, '.hand-overlay'],
      [styleCss, '.face-overlay'],
      [canvasCss, '.mc-hand-frame'],
      [canvasCss, '.mc-reg-chip'],
    ] as const) {
      const rule = ruleFor(css, cls);
      expect(rule, `${cls} must exist`).not.toBe('');
      expect(rule, `${cls} must be pointer-events: none`).toContain('pointer-events: none');
    }
    // .mc-hand-shadow and .mc-hand-ring share the .mc-hand-frame rule line.
    expect(canvasCss).toMatch(/\.mc-hand-frame, \.mc-hand-shadow, \.mc-hand-ring \{[^}]*pointer-events: none/);
  });

  it('no solid dark dot cursor: the empty-space cursor is a soft sage ring', () => {
    const shadow = ruleFor(canvasCss, '.mc-hand-shadow');
    expect(shadow).not.toContain('radial-gradient'); // the old dark dot
    expect(shadow).toContain('border: 2px solid rgb(107 143 113'); // warm sage ring
    expect(ruleFor(canvasCss, '.mc-hand-shadow.is-pinched')).toContain('scale: 0.55'); // tightens on pinch
  });

  it('clicking Talk starts speech recognition (handler wiring)', () => {
    // Same fake-root pattern as handPointer.test.ts's mic tests, kept here so
    // the Talk regression suite is self-contained.
    const listeners: Record<string, () => void> = {};
    const el = {
      type: '', className: '', innerHTML: '', attrs: {} as Record<string, string>,
      classList: { toggle: vi.fn() },
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      addEventListener(t: string, f: () => void) { listeners[t] = f; },
      querySelector: () => ({ textContent: '' }),
      remove: vi.fn(),
    };
    const root = { ownerDocument: { createElement: () => el }, append: vi.fn() } as unknown as HTMLElement;
    const voice = { supported: true, pushToTalkStart: vi.fn(), pushToTalkStop: vi.fn() };
    const said: string[] = [];
    const fab = mountMicFab(root, voice, (t) => said.push(t), { setTimer: (() => 1) as never, clearTimer: (() => {}) as never });
    listeners.click(); // mouse click OR handPointer pinch — both end in el.click()
    expect(voice.pushToTalkStart).toHaveBeenCalledTimes(1);
    expect(fab.listening).toBe(true);
    expect(said).toContain('Listening…');
  });
});

describe('the full-screen review dialog never traps clicks on the Tools bar', () => {
  // A dashboard's second (Gemini "Better: …") review can land while the bar
  // is showing Save/Tools/etc. — the bar must stay on top and clickable, not
  // buried under the review's full-screen (inset: 0) overlay.
  it('the Tools bar sits above the review dialog in stacking order', () => {
    const barZ = Number(ruleFor(canvasCss, '.mc-bar').match(/z-index:\s*(\d+)/)?.[1]);
    const reviewZ = Number(ruleFor(canvasCss, '.mc-review-dialog').match(/z-index:\s*(\d+)/)?.[1]);
    expect(Number.isNaN(barZ)).toBe(false);
    expect(Number.isNaN(reviewZ)).toBe(false);
    expect(barZ).toBeGreaterThan(reviewZ);
  });

  it('the review dialog reserves the bar\'s own height instead of running content under it', () => {
    expect(ruleFor(canvasCss, '.mc-review-dialog')).toContain('padding-top: var(--mc-bar-h');
  });
});

function zIndex(cls: string): number {
  const n = Number(ruleFor(canvasCss, cls).match(/z-index:\s*(\d+)/)?.[1]);
  return n;
}

function bottomPx(cls: string): number | null {
  const m = ruleFor(canvasCss, cls).match(/bottom:\s*(\d+)px/);
  return m ? Number(m[1]) : null;
}

describe('chrome stacking: canvas bits stay under a full-screen review', () => {
  // The morph card, hold ring, self-check marks, and the non-interactive
  // "Registered" pill must not punch through the review (item 11 glitch hunt:
  // the morph card at z=60 sat on top of the z=50 review and covered the plan).
  it('morph card, hold ring, self-check marks, and the registered pill sit below the review', () => {
    const reviewZ = zIndex('.mc-review-dialog');
    expect(reviewZ).toBeGreaterThan(0);
    expect(zIndex('.mc-morph-card')).toBeLessThan(reviewZ);
    expect(zIndex('.mc-morph-ring')).toBeLessThan(reviewZ);
    expect(zIndex('.mc-self-check')).toBeLessThan(reviewZ);
    expect(zIndex('.mc-reg-chip')).toBeLessThan(reviewZ);
  });

  it('the Tools bar still sits above the review (Approve stays reachable, bar stays usable)', () => {
    expect(zIndex('.mc-bar')).toBeGreaterThan(zIndex('.mc-review-dialog'));
  });
});

describe('Edit Reset layout does not cover the Register chip', () => {
  // Both chips share the right-side column. They used to share bottom: 236px,
  // so Reset was untappable and Register looked clipped.
  it('Reset is stacked above Register with a gap at least as tall as the Register chip', () => {
    const reset = bottomPx('.mc-edit-reset');
    const register = bottomPx('.mc-register-chip');
    expect(reset).not.toBeNull();
    expect(register).not.toBeNull();
    expect(reset).toBeGreaterThan(register! + 52);
  });
});

describe('on a phone, the review reserves the bottom Tools bar so Approve stays visible', () => {
  it('the 600px review rule adds padding-bottom: var(--mc-bar-h)', () => {
    // The phone media block re-declares .mc-review-dialog; ruleFor joins every
    // rule that mentions the class, so the phone padding-bottom is in the blob.
    const all = ruleFor(canvasCss, '.mc-review-dialog');
    expect(all).toContain('padding-bottom: var(--mc-bar-h');
  });
});
