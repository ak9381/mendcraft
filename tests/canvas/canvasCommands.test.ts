import { describe, expect, it } from 'vitest';
import { parseCanvasCommand, resolveFrame, saveShouldOpenNextBoard, saveShouldPin } from '../../src/canvas/canvasCommands';

const frames = [
  { id: 'f1', title: 'Living room' },
  { id: 'f2', title: 'Floor plan' },
  { id: 'f3', title: 'Bedroom lights' },
];

describe('canvas voice commands', () => {
  it.each([
    ['new canvas', { type: 'newFrame' }],
    ['New board please', { type: 'newFrame' }],
    ['start a new canvas', { type: 'newFrame' }],
    ['show everything', { type: 'showEverything' }],
    ['zoom out', { type: 'showEverything' }],
    ['show me all the boards', { type: 'showEverything' }],
    ['save', { type: 'save' }],
    ['save this', { type: 'save' }],
    ['build next', { type: 'buildNext' }],
    ["let's build the next thing", { type: 'buildNext' }],
    ['go back', { type: 'back' }],
    ['next board', { type: 'step', dir: 1 }],
    ['previous board', { type: 'step', dir: -1 }],
    ['pin this', { type: 'pin', on: true }],
    ['unpin', { type: 'pin', on: false }],
  ])('%s', (text, want) => {
    expect(parseCanvasCommand(text)).toEqual(want);
  });

  it('parses go-to with a target', () => {
    expect(parseCanvasCommand('go to the floor plan')).toEqual({ type: 'goTo', target: 'floor plan' });
    expect(parseCanvasCommand('open living room')).toEqual({ type: 'goTo', target: 'living room' });
    expect(parseCanvasCommand('show me bedroom lights')).toEqual({ type: 'goTo', target: 'bedroom lights' });
  });

  it('leaves device and CAD speech for other parsers', () => {
    expect(parseCanvasCommand('turn on the desk lamp')).toBeNull();
    expect(parseCanvasCommand('add a door here')).toBeNull();
    expect(parseCanvasCommand('')).toBeNull();
  });

  it('resolves a spoken target to a frame, tolerating near-misses', () => {
    expect(resolveFrame(frames, 'floor plan')).toBe('f2');
    expect(resolveFrame(frames, 'the living room')).toBe('f1');
    expect(resolveFrame(frames, 'floor plane')).toBe('f2');
    expect(resolveFrame(frames, 'bedroom')).toBe('f3');
    expect(resolveFrame(frames, 'garage')).toBeNull();
  });

  it('accepts ordinals and "last"', () => {
    expect(resolveFrame(frames, 'second')).toBe('f2');
    expect(resolveFrame(frames, 'board 3')).toBe('f3');
    expect(resolveFrame(frames, 'last one')).toBe('f3');
  });
});

describe('saveShouldPin', () => {
  it('pins an unpinned focused board', () => {
    expect(saveShouldPin({ pinned: false })).toBe(true);
  });
  it('leaves an already-pinned board alone (idempotent; unpin stays the only way off)', () => {
    expect(saveShouldPin({ pinned: true })).toBe(false);
  });
  it('does nothing with no board focused', () => {
    expect(saveShouldPin(null)).toBe(false);
    expect(saveShouldPin(undefined)).toBe(false);
  });
});

describe('saveShouldOpenNextBoard', () => {
  it('opens a new board when saving an unpinned dockable room (so the dock can show)', () => {
    expect(saveShouldOpenNextBoard({ pinned: false }, { kind: 'room' }, true)).toBe(true);
  });
  it('does not open a new board for an already-pinned room, a plan, or a room with no dock tiles', () => {
    expect(saveShouldOpenNextBoard({ pinned: true }, { kind: 'room' }, true)).toBe(false);
    expect(saveShouldOpenNextBoard({ pinned: false }, { kind: 'plan' }, true)).toBe(false);
    expect(saveShouldOpenNextBoard({ pinned: false }, { kind: 'room' }, false)).toBe(false);
    expect(saveShouldOpenNextBoard(null, { kind: 'room' }, true)).toBe(false);
  });
});
