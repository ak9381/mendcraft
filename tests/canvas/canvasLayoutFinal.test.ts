// Focused-board fit is display-only (boards grow back and keep their size
// across reloads); the replay's routeOf claims lines in run()'s order;
// destroy() clears every timer and session it owns; /monitor and /canvas
// rewrite to their pages.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fitFocusedSize } from '../../src/canvas/canvasApp';
import { createNextStepChips } from '../../src/canvas/nextSteps';

const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
const body = (start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

describe('fitBoardWidth is display-only (C5)', () => {
  it('fits a big board into the free space, and gives its own size back when it fits', () => {
    expect(fitFocusedSize({ w: 1400, h: 900 }, { free: 1000, freeH: 600, phone: false })).toEqual({ w: 1000, h: 600 });
    expect(fitFocusedSize({ w: 800, h: 500 }, { free: 1000, freeH: 600, phone: false })).toBeNull();
    // Never narrower than 480; a phone never clamps height.
    expect(fitFocusedSize({ w: 1400, h: 900 }, { free: 400, freeH: 600, phone: true })).toBeNull();
  });
  it('a fitted size is computed from the board\'s own size every time, so it grows back', () => {
    // Space shrinks then returns: the second fit comes from the stored 1400×900, not the shown 1000×600.
    const own = { w: 1400, h: 900 };
    expect(fitFocusedSize(own, { free: 1000, freeH: 600, phone: false })).toEqual({ w: 1000, h: 600 });
    expect(fitFocusedSize(own, { free: 1600, freeH: 1000, phone: false })).toBeNull();
  });
  it('never writes the fitted size to the registry or storage', () => {
    const fit = body('function fitBoardWidth(', 'function focusCam(');
    expect(fit).not.toMatch(/reg\.setRect|persist\(/);
    expect(src).toContain('const fit = focusId === f.id ? focusFit.get(f.id) : undefined;');
  });
});

describe('replay.routeOf follows run()\'s claim order (C8)', () => {
  it('morph, pair-first and a pending point-choice are checked before routeLine', () => {
    const r = body('routeOf: (text) => {', 'isReviewOpen:');
    const order = ['morphFlow?.claimsSpeech(text)', 'isBuildDashboard(text)', 'pickPointChoice(text', 'routeLine(text'];
    const at = order.map((k) => r.indexOf(k));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('destroy() clears what it owns (C9)', () => {
  it('persist timers, the edge controller, the relay session and the next-step chips', () => {
    const d = body('  function destroy(): void {', '  // ---- zoom + pan');
    // A pending board write is flushed (persist(true) clears its timer), not dropped.
    expect(d).toContain('if (persistTimer) persist(true)');
    expect(d).not.toContain('clearTimeout(persistTimer)');
    for (const k of [ 'clearTimeout(wheelPersistTimer)', 'boardEdge.reset()', 'pairingStop()', 'hostSession = null', 'nextChips?.destroy()', 'takePointChoice()']) {
      expect(d).toContain(k);
    }
  });
  it('NextChips.destroy removes its rows', () => {
    const removed: string[] = [];
    const row = { parentElement: null, remove: () => removed.push('row') };
    const chips = createNextStepChips({
      root: { querySelectorAll: () => [row] } as unknown as ParentNode,
      focused: () => null,
      ctx: () => ({}) as never,
      run: () => {},
    });
    chips.destroy();
    expect(removed).toEqual(['row']);
  });
});

describe('hosting rewrites (C7)', () => {
  it('/monitor and /canvas go to their pages before the catch-all', () => {
    const fb = JSON.parse(readFileSync('firebase.json', 'utf8')) as { hosting: { rewrites: { source: string; destination: string }[] } };
    const r = fb.hosting.rewrites;
    expect(r.map((x) => x.source)).toEqual(['/monitor', '/canvas', '**']);
    expect(r[0].destination).toBe('/monitor.html');
    expect(r[1].destination).toBe('/canvas.html');
  });
});

describe('corner chip + Facing pill never sit on the AI panel (C1); phone pill clears the mic (C2)', () => {
  const css = readFileSync('src/canvas/canvas.css', 'utf8');
  it('the AI panel foot rises above the chip and the pill while they show', () => {
    expect(css).toContain('.mc-canvas:has(.mc-face-preview) .mc-ai { bottom: calc(242px');
    expect(css).toContain('.mc-canvas:has(.mc-facing-banner:not([hidden])) .mc-ai { bottom: calc(290px');
  });
  it('the phone Hands pill is short and capped beside the centre mic', async () => {
    const { PHONE_HANDS_FACE_LINE } = await import('../../src/canvas/phoneHands');
    expect(PHONE_HANDS_FACE_LINE).toBe('Face phone');
    expect(css).toMatch(/\.mc-phone-simple \.mc-phone-hands-pill \{[^}]*max-width: calc\(50vw - 58px/);
  });
  it('review buttons never wrap their label', () => {
    expect(css).toMatch(/\.mc-review-approve, \.mc-review-reject, \.mc-review-ask-else \{[^}]*white-space: nowrap/);
  });
});
