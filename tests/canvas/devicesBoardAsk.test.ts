import { describe, expect, it } from 'vitest';
import { isShowDevices, routeLine } from '../../src/canvas/routeLine';
import { withConnectAnother, onlyConnectedTiles, DEVICES_CONNECT_LABEL } from '../../src/canvas/devicesTurn';

const w = { devices: [], planBoardExists: false, planFocused: false } as never;

describe('devices board ask', () => {
  it('her line builds the devices board, never the dashboard or chat', () => {
    for (const t of [
      'build me a board to keep track of all devices with status and to point and connect another if needed',
      'Build me a board to keep track of all my devices with their status, and to point and connect another if needed.',
      'make a board that shows the status of my connected devices',
      'I want to see them on this board',
      'build me about to keep track of all my devices and their status and to point and connect another if needed',
      'Build me a bored to keep track of my devices',
      'show my devices',
    ]) expect(routeLine(t, w).name, t).toBe('showDevices');
  });
  it('the dashboard and other boards are untouched', () => {
    for (const t of ['build the dashboard', 'build me a dashboard for my devices', 'build me a board for my lamp', 'make a weather board']) expect(isShowDevices(t), t).toBe(false);
  });
  it('always offers to connect another device', () => {
    const plan = { kind: 'room', title: 'My devices', tiles: [{ type: 'table', title: 'Devices', columns: [], rows: [], source: 'devices' }] } as never;
    const out = withConnectAnother(plan) as { tiles: { type: string; label?: string }[] };
    expect(out.tiles.at(-1)).toEqual({ type: 'connect', label: DEVICES_CONNECT_LABEL });
    expect(withConnectAnother(out as never)).toBe(out);
  });
  it('a board of connected devices can become the devices board; a dashboard of stats cannot', () => {
    expect(onlyConnectedTiles([{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] as never)).toBe(true);
    expect(onlyConnectedTiles([{ type: 'card', title: 'Lights', children: [{ type: 'lamp', deviceId: 'x', label: 'Lamp' }] }] as never)).toBe(true);
    expect(onlyConnectedTiles([{ type: 'stat', label: 'Temp', value: '21' }] as never)).toBe(false);
  });
});

describe('more mishearings of "build me a board"', () => {
  it('belt / bird / bored still build the status board', () => {
    for (const t of [
      'belt me a bored to keep track of all my devices and their status and point and connect another if needed',
      'build me a bird to keep track of all my devices and their status and to point and connect another if needed',
    ]) expect(routeLine(t, w).name, t).toBe('showDevices');
  });
});

import { isBuildDashboard } from '../../src/canvas/pairedRow';
import { wantsStatusBoard } from '../../src/canvas/routeLine';
describe('what it is FOR decides the board, not the word', () => {
  it('"a dashboard to keep track of my devices and their status" is the status board', () => {
    const t = 'build me a dashboard to keep track of all my devices and their status and to point and connect another if needed';
    expect(wantsStatusBoard(t)).toBe(true);
    expect(routeLine(t, w).name).toBe('showDevices');
    expect(isBuildDashboard(t)).toBe(true); // the word is there; the pair flow checks wantsStatusBoard too
  });
  it('a dashboard to control things stays the dashboard', () => {
    for (const t of ['build the dashboard', 'build me a dashboard to control my lamp and speaker', 'make a dashboard with buttons to turn on my devices'])
      expect(wantsStatusBoard(t), t).toBe(false);
    expect(routeLine('build the dashboard', w).name).toBe('connectRoom');
  });
});
