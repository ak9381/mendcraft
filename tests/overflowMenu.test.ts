// Overflow toolbar: which tools stay in the one-row primary bar, and the
// Kannada webfont we ship so captions never render as tofu.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_OVERFLOW_IDS,
  MENU_ORDER,
  OPTIONAL_PRIMARY_IDS,
  PRIMARY_ORDER,
  pickOverflow,
} from '../src/ui/overflowMenu';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('pickOverflow', () => {
  const optional = ['camera', 'mic', 'undo', 'redo'] as const;
  const always = ['gestures', 'ledger', 'ai'] as const;

  it('keeps every optional item when the full row fits', () => {
    const { kept, overflow } = pickOverflow(optional, always, () => true);
    expect(kept).toEqual([...optional]);
    expect(overflow).toEqual([...always]);
  });

  it('moves the lowest-priority optional items first when the row is tight', () => {
    const { kept, overflow } = pickOverflow(optional, always, (kept) => kept.length <= 2);
    expect(kept).toEqual(['camera', 'mic']);
    expect(overflow).toEqual(['undo', 'redo', ...always]);
  });

  it('moves every optional item into More if even one is too many', () => {
    const { kept, overflow } = pickOverflow(optional, always, () => false);
    expect(kept).toEqual([]);
    expect(overflow).toEqual([...optional, ...always]);
  });

  it('never promotes an always-overflow item into the primary row', () => {
    const { kept, overflow } = pickOverflow(['undo'], always, () => true);
    expect(kept).toEqual(['undo']);
    expect(overflow).toEqual([...always]);
    expect(kept.some((id) => (always as readonly string[]).includes(id))).toBe(false);
  });
});

describe('toolbar id lists', () => {
  it('keeps optional, always-overflow and core ids disjoint', () => {
    const always = new Set<string>(ALWAYS_OVERFLOW_IDS);
    const optional = new Set<string>(OPTIONAL_PRIMARY_IDS);
    for (const id of ALWAYS_OVERFLOW_IDS) expect(optional.has(id)).toBe(false);
    const core = PRIMARY_ORDER.filter((id) => !optional.has(id) && !always.has(id));
    expect(core).toEqual([
      'mode-switch',
      'lang-pick',
      'btn-help',
      'btn-register',
      'btn-reregister',
      'topbar-spacer',
      'btn-export',
      'more-wrap',
    ]);
  });

  it('lists every overflow tool in the More-menu order', () => {
    for (const id of [...OPTIONAL_PRIMARY_IDS, ...ALWAYS_OVERFLOW_IDS, 'progress-wrap']) {
      expect(MENU_ORDER).toContain(id);
    }
  });
});

describe('Noto Sans Kannada webfont', () => {
  const css = readFileSync(join(root, 'src/style.css'), 'utf8');
  const fontPath = join(root, 'public/fonts/NotoSansKannada-var-kannada.woff2');

  it('self-hosts the variable woff2', () => {
    expect(existsSync(fontPath)).toBe(true);
    const bytes = readFileSync(fontPath);
    expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it('declares @font-face with font-display: swap and applies it to captions', () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*['"]Noto Sans Kannada['"]/s);
    expect(css).toMatch(/@font-face\s*\{[^}]*font-display:\s*swap/s);
    expect(css).toMatch(/#lang-select[\s\S]{0,400}Noto Sans Kannada/);
    expect(css).toMatch(/\.caption-heard[\s\S]{0,200}Noto Sans Kannada/);
    expect(css).toMatch(/\.c-caption-heard[\s\S]{0,200}Noto Sans Kannada/);
  });
});
