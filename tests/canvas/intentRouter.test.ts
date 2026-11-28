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
