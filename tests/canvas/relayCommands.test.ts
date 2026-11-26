import { describe, expect, it, vi } from 'vitest';
import { dispatchRelayCommand, TOOLBAR_CMDS } from '../../src/canvas/relayCommands';
import { PHONE_GROUPS, PHONE_PRIMARY } from '../../src/canvas/phoneMenu';

describe('dispatchRelayCommand', () => {
  it('runs a spoken command through the same run() path', () => {
    const run = vi.fn().mockReturnValue(true);
    expect(dispatchRelayCommand({ kind: 'command', text: ' save this ' }, { run, undo: vi.fn() })).toBe(true);
    expect(run).toHaveBeenCalledWith('save this');
  });
  it('undo / mic / nudge hit the matching handlers', () => {
    const undo = vi.fn();
    const toggleMic = vi.fn();
    const nudge = vi.fn();
    expect(dispatchRelayCommand({ kind: 'undo' }, { run: vi.fn(), undo, toggleMic, nudge })).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(dispatchRelayCommand({ kind: 'mic' }, { run: vi.fn(), undo, toggleMic, nudge })).toBe(true);
    expect(toggleMic).toHaveBeenCalledTimes(1);
    expect(dispatchRelayCommand({ kind: 'nudge', dx: 1, dy: 0 }, { run: vi.fn(), undo, toggleMic, nudge })).toBe(true);
    expect(nudge).toHaveBeenCalledWith(1, 0);
  });
  it('ignores an empty command or a nudge with no handler', () => {
    expect(dispatchRelayCommand({ kind: 'command', text: '  ' }, { run: vi.fn(), undo: vi.fn() })).toBe(false);
    expect(dispatchRelayCommand({ kind: 'nudge', dx: 1, dy: 0 }, { run: vi.fn(), undo: vi.fn() })).toBe(false);
  });
});

describe('toolbar / phone menu wiring', () => {
  it('every phone-menu and primary cmd is a known toolbar cmd (no dead sheet buttons)', () => {
    const all = new Set<string>(TOOLBAR_CMDS);
    for (const c of PHONE_PRIMARY) expect(all, c).toContain(c);
    for (const g of PHONE_GROUPS) {
      for (const c of g.cmds) expect(all, c).toContain(c);
    }
  });
});
