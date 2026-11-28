import { describe, expect, it } from 'vitest';
import { INTENT_ACTIONS, decideIntent, parseIntent, intentPrompt, INTENT_CONSTRAINT, RUN_AT } from '../../src/canvas/intentRouter';
import { routeLine } from '../../src/canvas/routeLine';

const w = { devices: [], planBoardExists: false, planFocused: false } as never;
const expectRoute: Record<string, string> = {
  showDevices: 'showDevices', buildDashboard: 'connectRoom', connectGimbal: 'connectRoom', pointConnect: 'pointConnect',
  connectPhones: 'connectDevices', connectLamp: 'connectByName', connectSpeaker: 'connectByName', floorPlan: 'floorPlan', newBoard: 'canvas',
};

describe('intent router', () => {
  it("every action's fixed phrase takes the route it stands for (never chat)", () => {
    for (const a of INTENT_ACTIONS) {
      const r = routeLine(a.phrase('of a two bedroom flat'), w);
      expect(r.name, `${a.id} -> "${a.phrase('of a two bedroom flat')}"`).toBe(expectRoute[a.id]);
    }
  });
  it('parses only an id from the list with a confidence', () => {
    expect(parseIntent('{"intent":"showDevices","confidence":0.9}')).toEqual({ intent: 'showDevices', confidence: 0.9 });
    expect(parseIntent('{"intent":"deleteEverything","confidence":1}')).toBeNull();
    expect(parseIntent('{"intent":"showDevices"}')).toBeNull();
    expect(parseIntent('nope')).toBeNull();
    expect(parseIntent('{"intent":"chat","confidence":2}')).toEqual({ intent: 'chat', confidence: 1 });
  });
  it('runs when sure, asks when unsure, chats otherwise', () => {
    expect(decideIntent({ intent: 'showDevices', confidence: RUN_AT }).kind).toBe('run');
    expect(decideIntent({ intent: 'showDevices', confidence: 0.5 }).kind).toBe('ask');
    expect(decideIntent({ intent: 'showDevices', confidence: 0.2 }).kind).toBe('chat');
    expect(decideIntent({ intent: 'chat', confidence: 0.99 }).kind).toBe('chat');
    expect(decideIntent(null).kind).toBe('chat');
  });
  it('the prompt lists every action and her words; the schema lists the same ids', () => {
    const p = intentPrompt('build me about to keep track of my devices');
    for (const a of INTENT_ACTIONS) expect(p).toContain(`- ${a.id}:`);
    expect(p).toContain('build me about to keep track of my devices');
    const ids = ((INTENT_CONSTRAINT.properties as Record<string, { enum?: string[] }>).intent.enum) ?? [];
    expect(ids).toEqual([...INTENT_ACTIONS.map((a) => a.id), 'chat']);
  });
});

import { askFirst } from '../../src/canvas/intentRouter';
describe('ask first', () => {
  const run = (id: string) => decideIntent({ intent: id, confidence: 0.95 });
  it('a floor plan (cloud) always asks first', () => { expect(askFirst(run('floorPlan'), 'draw my flat').kind).toBe('ask'); });
  it('a question is never an order on its own', () => {
    expect(askFirst(run('connectGimbal'), 'what is a gimbal?').kind).toBe('ask');
    expect(askFirst(run('connectGimbal'), 'how does the gimbal work').kind).toBe('ask');
  });
  it('a polite request still runs', () => {
    expect(askFirst(run('showDevices'), "can you put everything I've connected on one screen?").kind).toBe('run');
    expect(askFirst(run('showDevices'), 'build me about to keep track of my devices').kind).toBe('run');
  });
});

import { statusNotDashboard } from '../../src/canvas/intentRouter';
describe('status board, not dashboard', () => {
  const dash = decideIntent({ intent: 'buildDashboard', confidence: 0.95 });
  it('status words and no control words → the status board', () => {
    const d = statusNotDashboard(dash, 'something to keep track of all my devices and their status');
    expect(d.kind === 'run' && d.action.id).toBe('showDevices');
  });
  it('control words keep the dashboard', () => {
    const d = statusNotDashboard(dash, 'a board to control my lamp and see its status');
    expect(d.kind === 'run' && d.action.id).toBe('buildDashboard');
  });
});

import { isCommand, choicesFor, pickChoice } from '../../src/canvas/intentRouter';
describe("ask, don't guess", () => {
  it('commands vs questions', () => {
    for (const t of ['build me about to keep track of my devices', 'belt me a bored', 'can you put everything on one screen', 'I want a board for my stuff', 'please hook it up', "let's make a board", 'so now show me everything'])
      expect(isCommand(t), t).toBe(true);
    for (const t of ['what is a gimbal?', 'how are you', 'tell me a joke', 'can you tell me what a gimbal is', 'thanks'])
      expect(isCommand(t), t).toBe(false);
  });
  it("choices: Nano's guess first, then the three boards, three at most", () => {
    expect(choicesFor({ intent: 'connectGimbal', confidence: 0.5 }).map((a) => a.id)).toEqual(['connectGimbal', 'showDevices', 'buildDashboard']);
    expect(choicesFor(null).map((a) => a.id)).toEqual(['showDevices', 'buildDashboard', 'floorPlan']);
    expect(choicesFor({ intent: 'chat', confidence: 0.9 }).map((a) => a.id)).toEqual(['showDevices', 'buildDashboard', 'floorPlan']);
  });
  it('her spoken pick', () => {
    const cs = choicesFor(null);
    expect(pickChoice('the first one', cs)).toBe(0);
    expect(pickChoice('the status board', cs)).toBe(0);
    expect(pickChoice('dashboard', cs)).toBe(1);
    expect(pickChoice('floor plan please', cs)).toBe(2);
    expect(pickChoice('something else', cs)).toBe(-1);
    expect(pickChoice('banana', cs)).toBeNull();
  });
});
