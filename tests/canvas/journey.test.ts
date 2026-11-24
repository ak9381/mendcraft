import { describe, expect, it } from 'vitest';
import { boardForJourney, journeyStepOf, type JourneyCtx } from '../../src/canvas/journey';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

const ctx: JourneyCtx = { lang: 'en', online: true, phones: 0 };
const board = (kind: string, tiles: string[], pinned = false) => ({ kind, tiles: tiles.map((k) => ({ kind: k })), pinned });

describe('journeyStepOf', () => {
  it('an empty board is the start of the journey', () => {
    expect(journeyStepOf(board('note', []), ctx)).toBe('empty');
    expect(journeyStepOf(board('room', []), { ...ctx, online: false, lang: 'kn', shared: true })).toBe('empty');
  });
  it('a room with only a connect tile is the devices step', () => {
    expect(journeyStepOf(board('room', ['connect']), ctx)).toBe('devices');
  });
  it('a room with device tiles is a dashboard; with a speaker it is the music step', () => {
    expect(journeyStepOf(board('room', ['lamp', 'lamp', 'connect']), ctx)).toBe('dashboard');
    expect(journeyStepOf(board('room', ['lamp', 'music']), ctx)).toBe('music');
    expect(journeyStepOf(board('room', ['switch', 'stat']), ctx)).toBe('dashboard');
    // The connect flow's "room plan" tile does not make a dashboard a floor plan.
    expect(journeyStepOf(board('room', ['lamp', 'music', 'plan', 'connect']), ctx)).toBe('music');
  });
  it('a pinned (saved) room is the saved step', () => {
    expect(journeyStepOf(board('room', ['lamp', 'music'], true), ctx)).toBe('saved');
  });
  it('a plan board is the floor-plan step until checked, then checked, then language', () => {
    expect(journeyStepOf(board('plan', ['plan']), ctx)).toBe('floorplan');
    expect(journeyStepOf(board('note', ['plan']), ctx)).toBe('floorplan');
    expect(journeyStepOf(board('plan', ['plan']), { ...ctx, checked: true })).toBe('checked');
    expect(journeyStepOf(board('plan', ['plan']), { ...ctx, checked: true, lang: 'kn' })).toBe('language');
  });
  it('offline and shared override the board shape once the board has content', () => {
    expect(journeyStepOf(board('plan', ['plan']), { ...ctx, online: false })).toBe('offline');
    expect(journeyStepOf(board('room', ['lamp']), { ...ctx, shared: true, online: false })).toBe('shared');
  });
  it('while phones pair (pair-first connect) the board is at the devices step', () => {
    expect(journeyStepOf(board('note', []), { ...ctx, pairing: true, phones: 1 })).toBe('devices');
  });
  it('paired phones alone do not mean the board was shared', () => {
    expect(journeyStepOf(board('room', ['lamp']), { ...ctx, phones: 2 })).toBe('dashboard');
  });
});

describe('boardForJourney', () => {
  it('flattens nested container tiles into leaf kinds', () => {
    const plan: SurfacePlan = {
      kind: 'room', title: 'Living room',
      tiles: [{ type: 'card', title: 'Lights', children: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk' }] },
        { type: 'tabs', tabs: [{ label: 'Audio', children: [{ type: 'music', deviceId: 'speaker-1', label: 'Speaker' }] }] }],
    };
    const b = boardForJourney({ kind: 'note', pinned: false }, plan);
    expect(b.kind).toBe('room');
    expect(b.tiles.map((t) => t.kind).sort()).toEqual(['lamp', 'music']);
    expect(journeyStepOf(b, ctx)).toBe('music');
  });
  it('no surface is an empty board of the frame kind', () => {
    expect(boardForJourney({ kind: 'note', pinned: true }, undefined)).toEqual({ kind: 'note', tiles: [], pinned: true });
  });
});
