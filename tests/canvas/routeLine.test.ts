import { describe, expect, it } from 'vitest';
import { SCRIPTED_KN_PACK } from '../../src/canvas/languagePack';
import { routeLine, type RouteName, type RouteWorld } from '../../src/canvas/routeLine';

const lamp = { id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' as const };
const speaker = { id: 'speaker-1', label: 'Speaker', kind: 'music' as const };
const base: RouteWorld = { hasPlanBoard: false, devices: [lamp, speaker] };

describe('routeLine: the table run() switches on', () => {
  const table: [string, RouteName, Partial<RouteWorld>?][] = [
    ['show tools', 'paletteOpen'],
    ['hide tools', 'paletteClose'],
    ['teach a gesture', 'teach'],
    ['my gestures', 'teachList'],
    ['show ai', 'showAi'],
    ['open the ai monitor', 'monitor'],
    ['hide ai', 'hideAi'],
    ['scan the room', 'gimbalScan'],
    ['follow my hands', 'gimbal'],
    ['add kannada', 'kannada'],
    ['show history', 'history'],
    ['check accessibility', 'planExtra', { hasPlanBoard: true }],
    ['show 3d', 'planExtra', { hasPlanBoard: true }],
    ['export dxf', 'planExtra', { hasPlanBoard: true }],
    ['save', 'canvas'],
    ['new board', 'canvas'],
    ['undo', 'canvas'],
    ['show everything', 'canvas'],
    ['keep it', 'canvas'],
    ['go to living room', 'canvas'],
    ['play music', 'device'],
    ['turn on the desk lamp', 'device'],
    ['play songs by A R Rahman', 'musicSearch', { spotifyConnected: true }],
    ['connect devices', 'connectDevices'],
    ['connect devices and make a dashboard to control them', 'connectDevices'],
    ['connect this room', 'connectRoom'],
    ['connect everything in this room', 'connectRoom'],
    ['draw the floor plan', 'floorPlan'],
    ['floor plan for Mrs Sharma\'s flat', 'floorPlan'],
    ['connect a device', 'connectSheet'],
    ['connect the speaker', 'connectByName'],
    ['what is the weather like', 'openEnded'],
    ['send it to my phone', 'openEnded'],
  ];
  it.each(table)('%s → %s', (text, name, w) => {
    expect(routeLine(text, { ...base, ...w }).name).toBe(name);
  });

  it('plan extras fall through without a plan board', () => {
    expect(routeLine('check accessibility', base).name).not.toBe('planExtra');
    expect(routeLine('show 3d', base).name).toBe('openEnded');
  });
  it('a music search needs Spotify, a speaker and not sim', () => {
    expect(routeLine('play songs by A R Rahman', { ...base, spotifyConnected: true, sim: true }).name).not.toBe('musicSearch');
    expect(routeLine('play songs by A R Rahman', { ...base, spotifyConnected: true, devices: [lamp] }).name).not.toBe('musicSearch');
  });
  it('device commands need a device on the canvas', () => {
    expect(routeLine('play music', { ...base, devices: [] }).name).toBe('openEnded');
  });
  it('a Kannada pack routes its own phrases first', () => {
    const phrase = Object.values(SCRIPTED_KN_PACK.phrases).flat()[0]!;
    expect(phrase).toBeTruthy();
    expect(routeLine(phrase, { ...base, pack: SCRIPTED_KN_PACK }).name).toBe('packIntent');
  });
  it('carries the parsed payload', () => {
    const r = routeLine('show 3d', { ...base, hasPlanBoard: true });
    expect(r).toEqual({ name: 'planExtra', extra: '3d' });
    const c = routeLine('save', base);
    expect(c.name === 'canvas' && c.cmd.type).toBe('save');
    const cd = routeLine('connect devices and make a dashboard to control them', base);
    expect(cd).toEqual({ name: 'connectDevices', dashboard: true });
  });
});
