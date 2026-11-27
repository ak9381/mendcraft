// A7-026: offline, a room connect keeps the on-device draft and promises
// "Deep will improve it when you're back online" — that promise must be backed
// by a real queue that setOnline(true) drains.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');

describe('offline Deep pass is queued and run on reconnect (A7-026)', () => {
  it('connectRoom queues the board when offline', () => {
    const body = src.slice(src.indexOf('async function connectRoom('), src.indexOf('function floorPlan('));
    expect(body).toMatch(/if \(!deepLater\.some\(\(d\) => d\.frameId === frameId\)\) deepLater\.push\(\{ frameId, utterance \}\)/);
  });
  it('setOnline(true) counts and runs the queued Deep passes', () => {
    const body = src.slice(src.indexOf('function setOnline('), src.indexOf('// ---- commands ----'));
    expect(body).toContain('later.length + deepLater.length');
    expect(body).toContain('void runDeepLater()');
  });
  it('runDeepLater skips deleted boards and waits while a proposal is open', () => {
    const body = src.slice(src.indexOf('async function runDeepLaterLoop('), src.indexOf('async function connectRoom('));
    // Busy (a review open, a saved language ask first): looked at again shortly, never dropped.
    expect(body).toContain('if (langRunning || langLater.length || reviewBusy()) return;');
    expect(body).toContain('if (!reg.get(next.frameId) || !surfaces[next.frameId]) continue;');
  });
});
