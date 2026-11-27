// @vitest-environment happy-dom
// The canvas's hand gestures are open palm to point, fist tap to click, hold a
// fist to drag and two fists to zoom — never a pinch. No line she can read on
// the canvas may tell her to pinch. (Internal identifiers such as
// 'pinch-hold-still' are not wording and stay.)
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { speechErrorMessage } from '../../src/input/voice';
import { renderProposalCard } from '../../src/ux/proposal';
import { PINCH_HOLD_SEND, PINCH_KEEP } from '../../src/ux/wording';

const root = path.resolve(__dirname, '../..');

/** String literals with a space in them (wording, not identifiers), comments stripped. */
function wordingLiterals(file: string): string[] {
  const src = fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
  const out: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of src.matchAll(re)) {
    const s = m[1] ?? m[2] ?? m[3] ?? '';
    if (/\s/.test(s)) out.push(s);
  }
  return out;
}

describe('no "pinch" in canvas wording', () => {
  it('speech errors never say pinch; the offline one is honest and offers typing', () => {
    for (const code of ['not-allowed', 'audio-capture', 'network', 'language-not-supported', 'service-not-allowed', 'no-speech', 'aborted', '']) {
      expect(speechErrorMessage(code)).not.toMatch(/pinch/i);
    }
    expect(speechErrorMessage('network')).toBe('Speech recognition needs the network and could not reach it. Tap Talk with a fist to try again, or type it.');
    expect(speechErrorMessage('no-speech')).toBe('Nothing was heard. Tap Talk with a fist and speak again.');
  });

  it('proposal cards never say pinch', () => {
    for (const status of ['waiting', 'guess', 'changed', 'leave'] as const) {
      const el = renderProposalCard(document, { id: 'p', title: 'Door', youAsked: 'x', why: 'y', status, catalog: { byLine: 'Quick', whyLabel: 'Why here', routeLine: 'on device' } } as never);
      expect(el.textContent ?? '').not.toMatch(/pinch/i);
    }
    expect(PINCH_KEEP).not.toMatch(/pinch/i);
    expect(PINCH_HOLD_SEND).not.toMatch(/pinch/i);
  });

  it.each([
    'src/input/voice.ts',
    'src/ux/proposal.ts',
    'src/ux/wording.ts',
    'src/ux/leaveApp.ts',
    'src/canvas/morphCard.ts',
    'src/canvas/morphFlow.ts',
    'src/canvas/reviewDialog.ts',
    'src/canvas/canvasApp.ts',
    'src/plan/engine.ts',
    'src/core/modes.ts',
  ])('%s has no pinch wording', (file) => {
    expect(wordingLiterals(file).filter((s) => /pinch/i.test(s))).toEqual([]);
  });
});

describe('teach panel built-in conflict line', () => {
  it('never names a pinch gesture from the old studio catalog', async () => {
    const { teachConflictLine } = await import('../../src/canvas/teachPanel');
    const { GESTURE_CATALOG } = await import('../../src/input/gestureCatalog');
    for (const g of GESTURE_CATALOG) expect(teachConflictLine(g)).not.toMatch(/pinch/i);
    expect(teachConflictLine({ label: 'Thumbs up', does: 'Confirm' } as never)).toContain('“Thumbs up” (Confirm)');
    expect(teachConflictLine(undefined)).toBe('');
  });
});
