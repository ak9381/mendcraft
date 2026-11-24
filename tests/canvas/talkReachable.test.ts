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
      [canvasCss, '.mc-facing-banner'],
      [canvasCss, '.mc-talk-caption'],
    ] as const) {
      const rule = ruleFor(css, cls);
      expect(rule, `${cls} must exist`).not.toBe('');
      expect(rule, `${cls} must be pointer-events: none`).toContain('pointer-events: none');
    }
    // .mc-hand-cursor shares the .mc-hand-frame rule line.
    expect(canvasCss).toMatch(/\.mc-hand-frame, \.mc-hand-cursor \{[^}]*pointer-events: none/);
  });

  it('no solid dark dot cursor: the empty-space cursor is a small coral arrow, not a dot or a big ring', () => {
    const cursor = ruleFor(canvasCss, '.mc-hand-cursor');
    expect(cursor).not.toContain('radial-gradient'); // the old dark dot
    expect(cursor).not.toContain('border-radius: 50%'); // no circular dot/ring shape
    expect(cursor).toContain('background-image'); // the small SVG arrow
    expect(ruleFor(canvasCss, '.mc-hand-cursor.is-pinched')).toContain('scale: 0.92'); // shrinks on pinch
  });

  it('clicking Talk starts speech recognition (handler wiring)', () => {
    // Same fake-root pattern as handPointer.test.ts's mic tests, kept here so
    // the Talk regression suite is self-contained.
    const listeners: Record<string, () => void> = {};
    const el = {
      type: '', className: '', innerHTML: '', attrs: {} as Record<string, string>, hidden: false,
      classList: { toggle: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      addEventListener(t: string, f: () => void) { listeners[t] = f; },
      querySelector: () => ({ textContent: '' }),
      append() {},
      remove: vi.fn(),
    };
    const root = { ownerDocument: { createElement: () => el }, append: vi.fn(), querySelectorAll: () => [] } as unknown as HTMLElement;
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
    expect(ruleFor(canvasCss, '.mc-review-dialog')).toContain('top: calc(var(--mc-bar-h');
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

describe('hand cluster sits mid-screen on the right, clear of the tools bar', () => {
  it('the cluster is a vertically-centred inset column with 120×52px equal-width targets, 24px apart', () => {
    const rule = ruleFor(canvasCss, '.mc-hand-cluster');
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('top: 50%');
    expect(rule).toContain('transform: translateY(-50%)');
    expect(rule).toContain('right: max(180px, 13vw, calc(min(var(--mc-ai-w, 320px), 340px) + 40px))');
    expect(rule).toContain('flex-direction: column');
    expect(rule).toContain('gap: 24px');
    expect(rule).toContain('align-items: stretch');
    expect(ruleFor(canvasCss, '.mc-hand-cluster .mc-fab-mic')).toContain('min-height: 52px');
    expect(ruleFor(canvasCss, '.mc-hand-cluster .mc-fab-mic')).toContain('min-width: 120px');
    expect(ruleFor(canvasCss, '.mc-hand-cluster .mc-fab-mic')).toContain('width: 100%');
  });

  it('the facing pill is a large, high-contrast bottom-right chip above the face preview, clear of the AI panel, cluster and engine bar', () => {
    const base = ruleFor(canvasCss, '.mc-facing-banner');
    expect(base).toContain('pointer-events: none');
    // The later .mc-canvas override moves it to the bottom-right corner.
    const chip = canvasCss.match(/\.mc-canvas \.mc-facing-banner \{[^}]*\}/)?.[0] ?? '';
    expect(chip).toContain('top: auto');
    expect(chip).toMatch(/right:\s*16px/);
    expect(chip).toMatch(/bottom:\s*calc\(16px/);
    expect(chip).toMatch(/max-width:\s*300px/);
    // Readable on camera: ≥20px pill text, a ≥200×150 face chip.
    expect(chip).toMatch(/font-size:\s*20px/);
    const face = canvasCss.match(/\.mc-canvas \.mc-face-preview \{[^}]*\}/)?.[0] ?? '';
    expect(face).toMatch(/right:\s*16px/);
    expect(face).toMatch(/width:\s*200px/);
    expect(face).toMatch(/height:\s*150px/);
    // …and lifted above the bottom-centre engine bar on narrower screens.
    expect(canvasCss).toMatch(/@media \(max-width: 1240px\)[^@]*\.mc-canvas \.mc-face-preview \{ bottom: calc\(96px/);
    expect(ruleFor(canvasCss, '.mc-facing-banner-hide')).toContain('pointer-events: auto');
  });
});

describe('engine bar sits bottom-centre with the phones strip directly above it', () => {
  it('is a fixed bottom-centre bar, hidden in the phone shell', () => {
    const bar = ruleFor(canvasCss, '.mc-engine-bar');
    expect(bar).toContain('position: fixed');
    expect(bar).toContain('left: 50%');
    expect(bar).toContain('bottom: 16px');
    expect(canvasCss).toMatch(/\.mc-phone-simple \.mc-engine-bar/);
  });

  it('replaces the swarm pill and lifts the phones strip above the bar', () => {
    expect(canvasCss).toMatch(/\.mc-canvas:has\(\.mc-engine-bar\) \.mc-swarm-pill \{ display: none/);
    expect(canvasCss).toMatch(/\.mc-canvas:has\(\.mc-engine-bar\) \.mc-arrange \{ bottom: 92px/);
  });

  it('Nano and Gemini dots use different colours', () => {
    expect(canvasCss).toMatch(/\.mc-engine-card\[data-engine="gemini"\] \{ --eng: var\(--accent-2\)/);
    expect(canvasCss).toMatch(/\.mc-engine-card \{\s*--eng: var\(--accent\)/);
  });
});

describe('hand skeleton paints above the tools bar', () => {
  it('the canvas hand overlay sits above .mc-bar so bones are not hidden behind Tools', () => {
    const overlayZ = Number(ruleFor(canvasCss, '.mc-canvas .hand-overlay').match(/z-index:\s*(\d+)/)?.[1]);
    const barZ = zIndex('.mc-bar');
    const cursorZ = zIndex('.mc-hand-frame');
    expect(overlayZ).toBeGreaterThan(barZ);
    expect(cursorZ).toBeGreaterThan(overlayZ);
    expect(ruleFor(canvasCss, '.mc-canvas .hand-overlay')).toContain('pointer-events: none');
  });
});

describe('on a phone, the floating review stays clear of the bottom Tools bar', () => {
  it('the 600px review rule caps height above the thumb bar', () => {
    const all = ruleFor(canvasCss, '.mc-review-dialog');
    expect(all).toContain('max-height: calc(100dvh - var(--mc-bar-h');
    expect(all).toContain('width: min(360px');
  });
});

describe('Talk stop clears a stale "Listening…" line (A7-020)', () => {
  function mk(status: { text: string }) {
    const listeners: Record<string, () => void> = {};
    const el = {
      type: '', className: '', innerHTML: '', attrs: {} as Record<string, string>, hidden: false,
      classList: { toggle: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      addEventListener(t: string, f: () => void) { listeners[t] = f; },
      querySelector: () => ({ textContent: '' }),
      append() {},
      remove: vi.fn(),
    };
    const root = { ownerDocument: { createElement: () => el }, append: vi.fn() } as unknown as HTMLElement;
    const voice = { supported: true, pushToTalkStart: vi.fn(), pushToTalkStop: vi.fn() };
    let fire: (() => void) | null = null;
    const fab = mountMicFab(root, voice, (t) => { status.text = t; }, { setTimer: ((f: () => void) => { fire = f; return 1; }) as never, clearTimer: (() => {}) as never, getStatus: () => status.text });
    return { fab, click: () => listeners.click(), timeout: () => fire?.() };
  }
  it('a second tap with nothing heard shows the caption once, not a status toast', () => {
    const s = { text: '' }; const m = mk(s);
    m.click(); expect(s.text).toBe('Listening…');
    m.click(); expect(m.fab.listening).toBe(false);
    expect(s.text).toBe('Listening…'); // status bar / toast is not also written
    expect(m.fab.captionEl.textContent).toMatch(/Stopped listening/);
    expect(m.fab.captionEl.hidden).toBe(false);
  });
  it('the 15s safety stop shows “nothing heard” once as the caption', () => {
    const s = { text: '' }; const m = mk(s);
    m.click(); m.timeout();
    expect(s.text).toBe('Listening…');
    expect(m.fab.captionEl.textContent).toBe('Stopped listening — nothing heard.');
    expect(m.fab.captionEl.hidden).toBe(false);
  });
  it('never overwrites a turn that already replaced the line', () => {
    const s = { text: '' }; const m = mk(s);
    m.click(); s.text = 'Building your dashboard…'; m.click(); expect(s.text).toBe('Building your dashboard…');
  });
});

describe('AI activity drawer stays compact and closable, cluster stays on screen', () => {
  it('the drawer is a compact ~320px side panel, not half the canvas', () => {
    const ai = ruleFor(canvasCss, '.mc-ai');
    expect(canvasCss).toContain('--mc-ai-w: 320px');
    expect(ai).toMatch(/width:\s*min\(var\(--mc-ai-w, 320px\), 340px\)/);
    expect(ai).not.toContain('min-width: 560px');
    expect(ai).not.toMatch(/min\(720px/);
  });

  it('the Close button is at least 44px so a pinch can hit it', () => {
    const close = ruleFor(canvasCss, '.mc-ai-close');
    expect(close).toContain('min-width: 44px');
    expect(close).toContain('min-height: 44px');
  });

  it('when the AI panel is open, cluster children keep right: auto so they stay in the viewport', () => {
    const blob = ruleFor(canvasCss, '.mc-hand-cluster .mc-fab-mic');
    expect(blob).toContain('right: auto');
    const cluster = ruleFor(canvasCss, '.mc-hand-cluster');
    expect(cluster).toContain('var(--mc-ai-w');
  });
});

describe('empty board offers a Talk button on the frame', () => {
  it('the empty-board Talk control is pinch-sized', () => {
    const talk = ruleFor(canvasCss, '.mc-empty-talk');
    expect(talk).toContain('min-height: 56px');
    expect(talk).toContain('min-width: 180px');
  });
});

describe('review Approve/Reject sit high enough to reach, off the edges', () => {
  it('keeps Approve/Reject 140×60 and 48px apart inside the floating window', () => {
    const actions = ruleFor(canvasCss, '.mc-review-actions');
    expect(ruleFor(canvasCss, '.mc-review-dialog')).toContain('width: min(560px');
    // row-gap may be tighter (Ask-else wraps below); Approve↔Reject stay 48px apart.
    expect(actions).toMatch(/gap: \d+px 48px/);
    const approve = ruleFor(canvasCss, '.mc-review-approve');
    expect(approve).toContain('min-height: 60px');
    expect(approve).toContain('min-width: 140px');
  });
});
