import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { boardPurpose, hear, MISHEARD } from '../../src/canvas/hearing';
import { INTENT_ACTIONS } from '../../src/canvas/intentRouter';
import { routeLine, type RouteWorld } from '../../src/canvas/routeLine';

describe('hear(): the mishearing table', () => {
  const table: [string, string, ReturnType<typeof boardPurpose>][] = [
    ['connect the gymbo', 'connect the gimbal', null],
    ['add my kimbo', 'add my gimbal', null],
    ['Connect the Jimbo stand', 'Connect the gimbal stand', null],
    ['pair the gimble', 'pair the gimbal', null],
    ['build me about to keep track of my devices', 'build me a board to keep track of my devices', 'status'],
    ['Build me a bored to keep track of my devices', 'Build me a board to keep track of my devices', 'status'],
    ['make a bird for my lamp', 'make a board for my lamp', null],
    ['belt me a bored to keep track of all my devices and their status', 'build me a board to keep track of all my devices and their status', 'status'],
    ['bolt a dashboard to control my lamp', 'build a dashboard to control my lamp', 'controls'],
    ['built the floor plan', 'build the floor plan', 'plan'],
    ['build me a dash board', 'build me a dashboard', null],
    ['draw a flaw plan of my flat', 'draw a floor plan of my flat', 'plan'],
    ['show the floor plane', 'show the floor plan', 'plan'],
  ];
  it.each(table)('%s → %s', (raw, text, purpose) => {
    const h = hear(raw);
    expect(h.text).toBe(text);
    expect(h.raw).toBe(raw);
    expect(h.purpose).toBe(purpose);
    expect(h.fixes.length).toBeGreaterThan(0);
  });

  const untouched = [
    'tell me about gimbals', 'a bird flew by', 'belt of Orion', 'what is the belt of Orion', 'tell me about the board',
    'bill the customer', 'the bell rang', 'my friend Jimbo called', 'how does the gimbal work', 'build the dashboard',
    'show my devices', 'connect the gimbal', 'the flow of the plan', 'bolt the door',
  ];
  it.each(untouched)('leaves "%s" alone', (raw) => {
    const h = hear(raw);
    expect(h.text).toBe(raw);
    expect(h.fixes).toEqual([]);
  });

  it('is idempotent', () => {
    for (const raw of [...table.map((r) => r[0]), ...untouched]) {
      const once = hear(raw).text;
      expect(hear(once).text, raw).toBe(once);
    }
  });
  it('every rule notes what it fixed', () => {
    for (const r of MISHEARD) expect(r.note.length).toBeGreaterThan(0);
    expect(hear('connect the gymbo').fixes).toEqual(['connect the gymbo→connect the gimbal']);
  });
});

describe('boardPurpose: purpose over the noun', () => {
  it('status, controls, plan, none', () => {
    expect(boardPurpose('a dashboard to keep track of my devices and their status')).toBe('status');
    expect(boardPurpose('a board to control my lamp and see its status')).toBe('controls');
    expect(boardPurpose('make a dashboard with buttons to turn on my devices')).toBe('controls');
    expect(boardPurpose('a floor plan of a two bedroom flat')).toBe('plan');
    expect(boardPurpose('make a weather board')).toBeNull();
  });
});

// ---- Parity guard: a line that is already right routes exactly the same after hear(). ----
const lamp = { id: 'lamp-a', label: 'Desk lamp', kind: 'lamp' as const };
const speaker = { id: 'speaker-a', label: 'Speaker', kind: 'music' as const };
const worlds: RouteWorld[] = [
  { hasPlanBoard: false, devices: [lamp, speaker] },
  { hasPlanBoard: true, planBoardExists: true, planFocused: true, planRooms: ['Bedroom 2', 'Kitchen'], devices: [lamp, speaker], spotifyConnected: true },
  { hasPlanBoard: false, devices: [] },
];
/** Every first-column string literal in the routing tests' tables. */
function phrasesIn(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out = new Set<string>();
  const re = /\[\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,\s*'[a-zA-Z]+'/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.add((m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1'));
  const lists = /for \(const t of \[([\s\S]*?)\]\)/g;
  for (let m = lists.exec(src); m; m = lists.exec(src)) {
    for (const s of m[1]!.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) out.add((s[1] ?? s[2] ?? '').replace(/\\(.)/g, '$1'));
  }
  return [...out].filter(Boolean);
}
const CHIP_PHRASES = [
  'Build the dashboard', 'Play music', 'Connect my phones', 'Show my devices', 'Draw a floor plan', 'Turn on the lamp',
  'New board', 'Connect the gimbal', 'connect what I am pointing at', 'Check accessibility', 'Show 3D', 'Save', 'Undo',
  'show everything', 'connect the speaker', 'connect the lamp', 'add the gimbal', 'add the speaker to the dashboard',
];

describe('parity guard: hear() never changes the route of a right line', () => {
  const phrases = [
    ...phrasesIn('tests/canvas/routeLine.test.ts'),
    ...phrasesIn('tests/canvas/devicesBoardAsk.test.ts'),
    ...CHIP_PHRASES,
    ...INTENT_ACTIONS.map((a) => a.phrase('of a two bedroom flat')),
  ];
  it('collects the tables', () => { expect(phrases.length).toBeGreaterThan(60); });
  it('same route in every world', () => {
    const diffs: string[] = [];
    for (const p of phrases) for (const w of worlds) {
      const before = routeLine(p, w);
      const after = routeLine(hear(p).text, w);
      if (JSON.stringify(before) !== JSON.stringify(after)) diffs.push(`${p}: ${before.name} → ${after.name}`);
    }
    expect(diffs).toEqual([]);
  });
});
