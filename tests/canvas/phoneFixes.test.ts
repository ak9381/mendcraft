// Phone demo fixes: build/dashboard phrasing is a board turn, a cloud-made
// draft is one Gemini call ("Made by Gemini · N KB"), the phone shows every
// status line in a toast, and the review sheet clears the status bar and mic.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isBuildBoardAsk, routeLine, type RouteWorld } from '../../src/canvas/routeLine';
import { honestyLines, madeByFacts } from '../../src/canvas/reviewDialog';
import { PHONE_SAY_MAX, phoneSayText } from '../../src/canvas/phoneSay';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const lamp = { id: 'lamp-a', label: 'Desk lamp', kind: 'lamp' as const };
const world: RouteWorld = { hasPlanBoard: false, devices: [lamp] };

describe('build / dashboard phrasing routes to a board turn', () => {
  it.each([
    'make a dashboard for my desk lamp',
    'Build me a dashboard',
    'create a control panel for the lamp',
    'I want a dashboard for the living room',
    'set up a dashboard',
  ])('"%s" → connectRoom (a review, not chat)', (text) => {
    expect(isBuildBoardAsk(text)).toBe(true);
    expect(routeLine(text, world).name).toBe('connectRoom');
    expect(routeLine(text, { ...world, devices: [] }).name).toBe('connectRoom');
  });

  it('questions and small talk still go to chat; device and pairing phrases keep their routes', () => {
    expect(routeLine('what is a dashboard?', world).name).toBe('openEnded');
    expect(routeLine('hello there', world).name).toBe('openEnded');
    expect(routeLine('turn on the desk lamp', world).name).toBe('device');
    expect(routeLine('connect my devices and make a dashboard', world).name).toBe('connectDevices');
    expect(routeLine('make a floor plan', world).name).toBe('floorPlan');
  });
});

describe('a draft Gemini already made in the cloud is the whole change', () => {
  it('the review says "Made by Gemini · N KB" and counts that one call', () => {
    const f = madeByFacts({ engine: 'gemini', sentWhat: 'your words, 3 device names', bytes: 2150, why: 'Gemini · cloud — Nano isn\'t available here, so Deep drafted it' });
    const lines = honestyLines(f);
    expect(lines.why).toBe('Made by Gemini · 2.1 KB');
    expect(lines.left).toBe('What left this device: your words, 3 device names · 2.1 KB');
  });

  it('a scripted run never claims real bytes', () => {
    expect(honestyLines(madeByFacts({ engine: 'gemini', sim: true, simBytes: 2048 })).why).toBe('Made by Gemini · SIM would send 2.0 KB');
  });

  it('connectRoom skips the improve pass for a cloud draft and reviews it as made by Gemini', () => {
    const app = read('src/canvas/canvasApp.ts');
    expect(app).toMatch(/const cloudDraft = !draft\.handedOff && draft\.si\.engine === 'gemini';/);
    expect(app).toMatch(/if \(draft\.handedOff \|\| cloudDraft\) \{[\s\S]{0,600}await proposeDraft\(frameId, utterance, draft, cloudDraft\);\s*return;/);
    expect(app).toMatch(/madeBy \? madeByFacts\(reviewFacts\(si, utterance\)\)/);
  });
});

describe('phone status toast', () => {
  it('keeps a short confirmation as is, collapses whitespace, caps a long reply', () => {
    expect(phoneSayText('Lights on.')).toBe('Lights on.');
    expect(phoneSayText('  I\'d love to help!\n\nWhat kind of features?  ')).toBe('I\'d love to help! What kind of features?');
    const long = phoneSayText('word '.repeat(200));
    expect(long.length).toBeLessThanOrEqual(PHONE_SAY_MAX);
    expect(long.endsWith('…')).toBe(true);
    expect(phoneSayText('')).toBe('');
  });

  it('say() feeds the toast on the phone shell (the bar with the status line is hidden there)', () => {
    const app = read('src/canvas/canvasApp.ts');
    expect(app).toMatch(/phoneSayEl\.className = 'mc-phone-say';/);
    expect(app).toMatch(/statusEl\.textContent = t; hideRetry\(\);\s*showPhoneSay\(/);
    const css = read('src/canvas/canvas.css');
    expect(css).toMatch(/\.mc-phone-simple \.mc-bar,/); // still hidden: the toast is the phone's status line
    expect(css).toMatch(/\.mc-phone-simple \.mc-phone-say:not\(\[hidden\]\) \{[^}]*position: fixed/);
  });
});

describe('phone review sheet layout', () => {
  const css = read('src/canvas/canvas.css');
  const rule = (sel: string): string => {
    const i = css.lastIndexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };

  it('every inset reads Capacitor\'s --safe-area-inset-* first, then env()', () => {
    expect(css).not.toMatch(/(?<!var\(--safe-area-inset-(?:top|right|bottom|left), )env\(safe-area-inset-/);
    expect(css).toMatch(/var\(--safe-area-inset-top, env\(safe-area-inset-top, 0px\)\)/);
  });

  it('the sheet starts below the status bar and ends above the mic', () => {
    const r = rule('.mc-phone-simple .mc-review-dialog:not(.is-floating)');
    expect(r).toMatch(/top: calc\(12px \+ var\(--safe-area-inset-top/);
    expect(r).toMatch(/max-height: calc\(100dvh[\s\S]*- 116px - var\(--safe-area-inset-bottom/);
  });

  it('the "What left this device" line wraps instead of truncating', () => {
    expect(rule('.mc-phone-simple .mc-review-left')).toMatch(/white-space: normal/);
    expect(rule('.mc-phone-simple .mc-review-left-what')).toMatch(/text-overflow: clip/);
    expect(rule('.mc-phone-simple .mc-review-why')).toMatch(/-webkit-line-clamp: none/);
  });
});

// 'status bar icons are dark on the light canvas' checks android/** and the iOS
// Swift, which are not part of the canvas port (they come with Task 3).
