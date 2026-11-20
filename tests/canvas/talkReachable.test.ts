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
