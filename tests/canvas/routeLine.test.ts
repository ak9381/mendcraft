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
    ["connect to what I'm pointing at", 'pointConnect'],
    ['connect what I am pointing at', 'pointConnect'],
    ['connect to whatever I point at', 'pointConnect'],
    ['Connect to what I’m pointing at.', 'pointConnect'],
    ['use the gimbal to connect to what I point at', 'pointConnect'],
    ['connect to what I point at', 'pointConnect'],
    ["add what I'm pointing at", 'pointConnect'],
    ['connect this', 'pointConnect'],
    ['Connect this.', 'pointConnect'],
    ['scan the room', 'gimbalScan'],
    ['follow my hands', 'gimbal'],
    ['follow me', 'gimbal'],
    ['follow my face', 'gimbal'],
    ['track me', 'gimbal'],
    ['hold still', 'gimbal'],
    ['stop following', 'gimbal'],
    ['keep alive on', 'gimbal'],
    ['gimbal keep alive off', 'gimbal'],
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

describe('routeLine: Tools > More by voice', () => {
  const table: [string, string][] = [
    ['hands on', 'handsOn'], ['turn off hands', 'handsOff'], ['hover to click', 'dwell'],
    ['register again', 'register'], ['simulate offline', 'offline'], ['back online', 'online'],
    ['swap phone sides', 'swap'],
  ];
  for (const [text, tool] of table) {
    it(`"${text}" → ${tool}`, () => {
      expect(routeLine(text, base)).toEqual({ name: 'tool', tool });
    });
  }
  it('device and gimbal phrases still fall through', () => {
    expect(routeLine('follow my hands', base).name).not.toBe('tool');
    expect(routeLine('turn on the desk lamp', base).name).toBe('device');
  });
});

describe('routeLine: voice / typed edits to the floor plan', () => {
  const onPlan: RouteWorld = { ...base, hasPlanBoard: true, planFocused: true, planBoardExists: true, planRooms: ['Bedroom 1', 'Bedroom 2', 'Living room', 'Kitchen', 'Bathroom'] };
  it('on the plan board, small talk with a bare verb stays chat', () => {
    for (const t of ['call my daughter', 'make me laugh', 'make a joke', 'change the subject', 'put on the news', 'turn the tv on', 'move this board', 'move to board 2', 'make it snappy', 'call it a day'])
      expect(routeLine(t, onPlan).name, t).not.toBe('planEdit');
  });
  it('a bare edit on the plan board must name a room of this plan, or "it" with a size or side', () => {
    expect(routeLine('make bedroom two wider', onPlan).name).toBe('planEdit');
    expect(routeLine('move it 1 m north', onPlan).name).toBe('planEdit');
    expect(routeLine('make it nice', onPlan).name).toBe('openEnded');
  });
  it('a new floor plan, devices, questions and wishes are not plan edits', () => {
    for (const w of [onPlan, { ...base, planBoardExists: true }]) {
      expect(routeLine('make a floor plan with two bedrooms and a kitchen', w).name).toBe('floorPlan');
      expect(routeLine('build a floor plan with a kitchen', w).name).toBe('floorPlan');
      expect(routeLine('create a new floor plan with a bathroom', w).name).toBe('floorPlan');
      for (const t of ['turn on the kitchen fan', 'add the kitchen thermostat', 'tell me how to make my bathroom safer', 'what if I move the bedroom', 'I want to build a nursery someday', 'how do I add a window to the kitchen?', 'should I remove the bathroom'])
        expect(routeLine(t, w).name, t).not.toBe('planEdit');
      // back where it went before plan edits existed (the strict add-device
      // phrase doesn't take "kitchen thermostat", so it was never connectByName)
      expect(routeLine('add the kitchen thermostat', w).name).toBe(routeLine('add the kitchen thermostat', base).name);
      expect(routeLine('connect the speaker', w).name).toBe('connectByName');
      // a polite ask IS an edit request
      expect(routeLine('can you make the kitchen bigger?', w).name).toBe('planEdit');
      expect(routeLine('could you please add a study next to bedroom 2', w).name).toBe('planEdit');
    }
  });
  const planElsewhere: RouteWorld = { ...base, planBoardExists: true };
  it('on the floor-plan board, an edit is a plan edit, not chat', () => {
    for (const t of ['add a study next to bedroom 2', 'Add a study next to bedroom 2.', 'remove the bathroom', 'make the kitchen bigger', 'widen bedroom 1', 'add a window to the kitchen', 'add stairs in the living room', 'make it bigger', 'move it a bit to the right'])
      expect(routeLine(t, onPlan).name, t).toBe('planEdit');
  });
  it('from another board, a clear plan edit goes to the plan that exists', () => {
    expect(routeLine('add a study next to bedroom 2', planElsewhere).name).toBe('planEdit');
    expect(routeLine('add a bedroom to the floor plan', planElsewhere).name).toBe('planEdit');
    // …but a vague one stays chat there
    expect(routeLine('make it bigger', planElsewhere).name).toBe('openEnded');
  });
  it('with no plan board anywhere, nothing becomes a plan edit', () => {
    expect(routeLine('add a study next to bedroom 2', base).name).toBe('openEnded');
    expect(routeLine('make it bigger', base).name).toBe('openEnded');
  });
  it('commands that won before still win on the plan board', () => {
    const table: [string, RouteName][] = [
      ['draw the floor plan', 'floorPlan'],
      ['make a floor plan', 'floorPlan'],
      ['start a floor plan', 'floorPlan'],
      ['turn on the desk lamp', 'device'],
      ['play music', 'device'],
      ['undo', 'canvas'],
      ['keep it', 'canvas'],
      ['new board', 'canvas'],
      ['show 3d', 'planExtra'],
      ['check accessibility', 'planExtra'],
      ['connect this room', 'connectRoom'],
      ['make a dashboard for my desk lamp', 'connectRoom'],
      ['connect devices', 'connectDevices'],
      ['connect a device', 'connectSheet'],
      ['connect the speaker', 'connectByName'],
      ['hi', 'openEnded'],
      ['how are you', 'openEnded'],
      ['what is a study', 'openEnded'],
    ];
    for (const [t, name] of table) expect(routeLine(t, onPlan).name, t).toBe(name);
  });
});
