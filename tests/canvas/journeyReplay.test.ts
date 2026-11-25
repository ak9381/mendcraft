import { describe, expect, it } from 'vitest';
import { createReplayPlayer, DEMO_JOURNEY, type ReplayHost, type ReplayStep } from '../../src/canvas/journeyReplay';
import { ruleSuggestions } from '../../src/canvas/nextSteps';
import { routeLine } from '../../src/canvas/routeLine';
import type { JourneyStep } from '../../src/canvas/journey';

/** A fake canvas: each line's effect is scripted; time is a virtual clock. */
interface Effect { route?: string; reviews?: string[]; lines?: string[]; busyMs?: number }
function fakeApp(effects: Record<string, Effect>, o: { pointRoute?: boolean; sendOk?: boolean } = {}) {
  let clock = 0;
  const log: string[] = [];
  const queue: string[] = []; // review titles still to open
  let review: string | null = null;
  let busyUntil = 0;
  let online = true;
  const ran: string[] = [];
  const approved: string[] = [];
  const say = (t: string) => log.push(t);
  const openNext = () => { review = queue.shift() ?? null; if (!review) busyUntil = Math.max(busyUntil, clock + 50); };
  const app: ReplayHost = {
    run(text) {
      ran.push(text);
      const e = effects[text] ?? {};
      (e.lines ?? []).forEach(say);
      queue.push(...(e.reviews ?? []));
      busyUntil = clock + (e.busyMs ?? 0);
      if (queue.length) setTimeoutLike(() => openNext(), e.busyMs ?? 0);
      return true;
    },
    routeOf(text) {
      if (/pointing at/.test(text)) return o.pointRoute ? 'pointConnect' : 'gimbal';
      return effects[text]?.route ?? 'canvas';
    },
    isReviewOpen: () => review !== null,
    reviewTitle: () => review ?? '',
    reviewApprove() { approved.push(review!); review = null; say('Kept.'); if (queue.length) setTimeoutLike(openNext, 100); },
    isIdle: () => review === null && !queue.length && clock >= busyUntil && !pendingTimers.length,
    statusMark: () => log.length,
    statusSince: (m) => log.slice(m),
    isOnline: () => online,
    toggleOffline() { online = !online; say(online ? 'Back online.' : 'Offline.'); },
    async sendBoard() { if (o.sendOk === false) return false; say('Sent to iPhone (SIM).'); return true; },
  };
  const pendingTimers: { at: number; fn: () => void }[] = [];
  function setTimeoutLike(fn: () => void, ms: number) { pendingTimers.push({ at: clock + ms, fn }); }
  const sleep = async (ms: number) => {
    clock += ms;
    for (const t of [...pendingTimers]) if (t.at <= clock) { pendingTimers.splice(pendingTimers.indexOf(t), 1); t.fn(); }
  };
  return { app, sleep, now: () => clock, ran, approved, log };
}

const quick = { approveDelayMs: 2000, pollMs: 100, settleMs: 200, stepTimeoutMs: 10_000 };

describe('journey replay player', () => {
  it('runs each line, approves each review after the pause, and finishes', async () => {
    const steps: ReplayStep[] = [
      { id: 'a', label: 'A', action: { kind: 'say', text: 'build the dashboard' }, reviews: 2 },
      { id: 'b', label: 'B', action: { kind: 'say', text: 'save' }, expect: /^Saved/ },
    ];
    const f = fakeApp({ 'build the dashboard': { reviews: ['Draft', 'Better'], busyMs: 500 }, save: { lines: ['Saved Living room.'] } });
    const notes: string[] = [];
    const seen: string[] = [];
    const r = await createReplayPlayer(f.app, steps, { ...quick, sleep: f.sleep, now: f.now, onNote: (t) => notes.push(t), onStep: (i, n, s) => seen.push(`${i}/${n} ${s.label}`) }).start();
    expect(r.ok).toBe(true);
    expect(f.ran).toEqual(['build the dashboard', 'save']);
    expect(f.approved).toEqual(['Draft', 'Better']);
    expect(notes).toContain('Replay · approving “Draft”');
    expect(seen).toEqual(['1/2 A', '2/2 B']);
    expect(r.steps[0].ms).toBeGreaterThanOrEqual(4000); // two visible 2 s pauses
  });

  it('fails a step that says a failure line, and stops there', async () => {
    const steps: ReplayStep[] = [
      { id: 'a', label: 'A', action: { kind: 'say', text: 'check accessibility' } },
      { id: 'b', label: 'B', action: { kind: 'say', text: 'save' } },
    ];
    const f = fakeApp({ 'check accessibility': { lines: ['Nothing to check — no plan board.'] } });
    const r = await createReplayPlayer(f.app, steps, { ...quick, sleep: f.sleep, now: f.now }).start();
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => s.outcome)).toEqual(['failed']);
    expect(r.steps[0].note).toMatch(/Nothing to check/);
    expect(f.ran).toEqual(['check accessibility']);
  });

  it('fails an open-ended line and a missing expected line', async () => {
    const f = fakeApp({ 'do a dance': { route: 'openEnded' } });
    const r1 = await createReplayPlayer(f.app, [{ id: 'x', label: 'X', action: { kind: 'say', text: 'do a dance' } }], { ...quick, sleep: f.sleep, now: f.now }).start();
    expect(r1.steps[0].outcome).toBe('failed');
    expect(f.ran).toEqual([]); // never sent
    const r2 = await createReplayPlayer(f.app, [{ id: 'y', label: 'Y', action: { kind: 'say', text: 'undo' }, expect: /^Undid/ }], { ...quick, sleep: f.sleep, now: f.now }).start();
    expect(r2.steps[0].outcome).toBe('failed');
  });

  it('skips (not fails) a step whose route is not in this build, with a note', async () => {
    const step: ReplayStep = { id: 'point', label: 'Point', action: { kind: 'say', text: "connect to what I'm pointing at" }, needsRoute: 'pointConnect', reviews: 1 };
    const f = fakeApp({});
    const notes: string[] = [];
    const r = await createReplayPlayer(f.app, [step], { ...quick, sleep: f.sleep, now: f.now, onNote: (t) => notes.push(t) }).start();
    expect(r.ok).toBe(true);
    expect(r.steps[0].outcome).toBe('skipped');
    expect(notes.join(' ')).toMatch(/skipped/);
    expect(f.ran).toEqual([]);
    // Once the route exists, the same step runs and approves its review.
    const g = fakeApp({ "connect to what I'm pointing at": { reviews: ['Connect: Lamp'] } }, { pointRoute: true });
    const r2 = await createReplayPlayer(g.app, [step], { ...quick, sleep: g.sleep, now: g.now }).start();
    expect(r2.steps[0].outcome).toBe('done');
    expect(g.approved).toEqual(['Connect: Lamp']);
  });

  it('answers a clarifying question once, then approves the review it leads to', async () => {
    const step: ReplayStep = { id: 'point', label: 'Point', action: { kind: 'say', text: "connect to what I'm pointing at" }, needsRoute: 'pointConnect', reviews: 1, answer: { when: /^Which one/, say: 'the reading lamp' } };
    const f = fakeApp({ "connect to what I'm pointing at": { lines: ['Which one — Reading lamp or Main light?'] }, 'the reading lamp': { reviews: ['Connect: Reading lamp'] } }, { pointRoute: true });
    const r = await createReplayPlayer(f.app, [step], { ...quick, sleep: f.sleep, now: f.now }).start();
    expect(r.steps[0].outcome).toBe('done');
    expect(f.ran).toEqual(["connect to what I'm pointing at", 'the reading lamp']);
    expect(f.approved).toEqual(['Connect: Reading lamp']);
    // No question asked: nothing extra is said.
    const g = fakeApp({ "connect to what I'm pointing at": { reviews: ['Connect: Lamp'] } }, { pointRoute: true });
    await createReplayPlayer(g.app, [step], { ...quick, sleep: g.sleep, now: g.now }).start();
    expect(g.ran).toEqual(["connect to what I'm pointing at"]);
  });

  it('fails on an unexpected review and on a review that never opens', async () => {
    const f = fakeApp({ save: { reviews: ['Surprise'] } });
    const r = await createReplayPlayer(f.app, [{ id: 's', label: 'S', action: { kind: 'say', text: 'save' } }], { ...quick, sleep: f.sleep, now: f.now }).start();
    expect(r.steps[0].note).toMatch(/unexpected review/);
    const g = fakeApp({});
    const r2 = await createReplayPlayer(g.app, [{ id: 'k', label: 'K', action: { kind: 'say', text: 'add kannada' }, reviews: 1 }], { ...quick, sleep: g.sleep, now: g.now }).start();
    expect(r2.steps[0].note).toMatch(/timed out/);
  });

  it('toggles offline/online only when needed, and sends a board', async () => {
    const f = fakeApp({});
    const steps: ReplayStep[] = [
      { id: 'off', label: 'Off', action: { kind: 'online', on: false } },
      { id: 'off2', label: 'Off again', action: { kind: 'online', on: false } },
      { id: 'on', label: 'On', action: { kind: 'online', on: true }, expect: /^Back online/ },
      { id: 'send', label: 'Send', action: { kind: 'sendBoard', to: 'ios' }, expect: /^Sent/ },
    ];
    const r = await createReplayPlayer(f.app, steps, { ...quick, sleep: f.sleep, now: f.now }).start();
    expect(r.ok).toBe(true);
    expect(f.log.filter((l) => /^(Offline|Back online)/.test(l))).toEqual(['Offline.', 'Back online.']);
    const g = fakeApp({}, { sendOk: false });
    const r2 = await createReplayPlayer(g.app, [steps[3]], { ...quick, sleep: g.sleep, now: g.now }).start();
    expect(r2.steps[0].outcome).toBe('failed');
  });

  it('Stop ends the replay mid-step and leaves the review for her', async () => {
    const f = fakeApp({ 'draw the floor plan': { reviews: ['Floor plan'] } });
    const steps: ReplayStep[] = [
      { id: 'p', label: 'Plan', action: { kind: 'say', text: 'draw the floor plan' }, reviews: 1 },
      { id: 's', label: 'Save', action: { kind: 'say', text: 'save' } },
    ];
    const player = createReplayPlayer(f.app, steps, {
      ...quick, sleep: f.sleep, now: f.now,
      onNote: (t) => { if (t.startsWith('Replay · approving')) player.stop(); },
    });
    const r = await player.start();
    expect(r.stopped).toBe(true);
    expect(r.ok).toBe(false);
    expect(f.approved).toEqual([]);
    expect(f.app.isReviewOpen()).toBe(true);
    expect(f.ran).toEqual(['draw the floor plan']);
  });
});

describe('the demo journey', () => {
  it('covers the integrated journey in order', () => {
    expect(DEMO_JOURNEY.map((s) => s.id)).toEqual([
      'connect', 'build', 'music', 'save', 'floorplan', 'check', '3d', 'kannada', 'undo', 'break',
      'offline', 'kannada-queued', 'online', 'goto-room', 'send', 'new-board', 'point', 'everything',
    ]);
    // "build the dashboard" is one review: Gemini improves Nano's draft before she sees it.
    expect(DEMO_JOURNEY.reduce((n, s) => n + (s.reviews ?? 0), 0)).toBe(5);
  });

  it('says exactly what the next-step chips say', () => {
    const says = new Map<string, string>();
    const steps: JourneyStep[] = ['empty', 'devices', 'dashboard', 'music', 'saved', 'floorplan', 'checked', 'language', 'offline', 'shared'];
    for (const at of steps) {
      for (const extra of [{}, { pairing: true }, { savedRoom: true }]) {
        for (const s of ruleSuggestions(at, { lang: 'en', online: true, phones: 0, ...extra })) says.set(s.id, s.say);
      }
    }
    for (const step of DEMO_JOURNEY.filter((s) => s.chip)) {
      expect(says.get(step.chip!), step.id).toBe(step.action.kind === 'say' ? step.action.text : undefined);
    }
  });

  it('every spoken line routes to a real command (the same table run() uses)', () => {
    const world = { hasPlanBoard: true, devices: [{ id: 'wiz-desk', label: 'Reading lamp', kind: 'lamp' as const }, { id: 'speaker-1', label: 'Speaker', kind: 'music' as const }], sim: true };
    for (const step of DEMO_JOURNEY) {
      if (step.action.kind !== 'say' || step.id === 'build') continue; // "build the dashboard" belongs to the pair-first flow
      const r = routeLine(step.action.text, world).name;
      expect(r, step.action.text).not.toBe('openEnded');
      if (step.needsRoute) expect(r, step.action.text).toBe(step.needsRoute);
    }
  });
});
