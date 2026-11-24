// Judge replay (?replay=demo): the ONE integrated journey, played by the
// product itself. Every step is what a person does — a line through run()
// (the same table the next-step chips use), Approve on the real review,
// the Simulate offline button, a board held at a paired phone's edge — so the
// same timeline is the end-to-end test: a step that doesn't land fails it.
// Pure: the canvas supplies a ReplayHost; time is injectable for tests.

/** What the canvas exposes to the replay (canvasApp's `replay` handle). */
export interface ReplayHost {
  run(text: string): boolean;
  /** Where run() would send this line right now (routeLine's route name). */
  routeOf(text: string): string;
  isReviewOpen(): boolean;
  reviewTitle(): string;
  /** Approve the waiting review (the same keep the Approve button does). */
  reviewApprove(): void;
  /** No turn streaming, no review waiting, no pairing in progress. */
  isIdle(): boolean;
  /** Status lines: a mark now, then every line said since that mark. */
  statusMark(): number;
  statusSince(mark: number): readonly string[];
  isOnline(): boolean;
  /** Press the bar's Simulate offline toggle. */
  toggleOffline(): void;
  /** Hold the focused board at the paired phone's edge until it is sent. */
  sendBoard(to: 'ios' | 'android'): Promise<boolean>;
}

export type ReplayAction =
  | { kind: 'say'; text: string }
  | { kind: 'online'; on: boolean }
  | { kind: 'sendBoard'; to: 'ios' | 'android' };

export interface ReplayStep {
  id: string;
  label: string;
  action: ReplayAction;
  /** Reviews this step opens; each is approved (after a visible pause). */
  reviews?: number;
  /** The next-step chip this line comes from (its `say` must match). */
  chip?: string;
  /** The route this line must take. When run() has no such route yet, the
   *  step is skipped with a logged note (not failed). */
  needsRoute?: string;
  /** A status line said during the step must match. */
  expect?: RegExp;
  /** The app asks a clarifying question (a line matching `when`): answer it
   *  once, through run(), as she would. No question → nothing is said. */
  answer?: { when: RegExp; say: string };
}

export const DEMO_JOURNEY: readonly ReplayStep[] = [
  { id: 'connect', label: 'Connect devices and make a dashboard', action: { kind: 'say', text: 'connect devices and make a dashboard' }, needsRoute: 'connectDevices', expect: /joined/ },
  { id: 'build', label: 'Build the dashboard', chip: 'build-dashboard', action: { kind: 'say', text: 'build the dashboard' }, reviews: 2 },
  { id: 'music', label: 'Play music', chip: 'play-music', action: { kind: 'say', text: 'play music' } },
  { id: 'save', label: 'Save', chip: 'save', action: { kind: 'say', text: 'save' }, expect: /^Saved/ },
  { id: 'floorplan', label: 'Draw the floor plan', chip: 'floorplan', action: { kind: 'say', text: 'draw the floor plan' }, reviews: 1 },
  { id: 'check', label: 'Check accessibility', chip: 'check', action: { kind: 'say', text: 'check accessibility' }, needsRoute: 'planExtra' },
  { id: '3d', label: 'Show 3D', chip: '3d', action: { kind: 'say', text: 'show 3d' }, needsRoute: 'planExtra' },
  { id: 'kannada', label: 'Add Kannada', chip: 'kannada', action: { kind: 'say', text: 'add kannada' }, reviews: 1, expect: /Kannada is on/ },
  { id: 'undo', label: 'Undo', chip: 'undo', action: { kind: 'say', text: 'undo' }, expect: /^Undid/ },
  { id: 'break', label: 'Try to break it', action: { kind: 'say', text: 'set the desk lamp to 500% brightness' }, expect: /Nothing changed/ },
  { id: 'offline', label: 'Simulate offline', action: { kind: 'online', on: false } },
  { id: 'kannada-queued', label: 'Add Kannada (queued offline)', chip: 'kannada', action: { kind: 'say', text: 'add kannada' }, expect: /back online/i },
  { id: 'online', label: 'Back online', action: { kind: 'online', on: true }, reviews: 1, expect: /^Back online/ },
  { id: 'goto-room', label: 'Go to the Living room', action: { kind: 'say', text: 'go to living room' }, needsRoute: 'canvas' },
  { id: 'send', label: 'Send the board to the iPhone', action: { kind: 'sendBoard', to: 'ios' }, expect: /^Sent/ },
  { id: 'new-board', label: 'New board', chip: 'new-board', action: { kind: 'say', text: 'new board' } },
  { id: 'point', label: 'Connect to what I’m pointing at', action: { kind: 'say', text: "connect to what I'm pointing at" }, needsRoute: 'pointConnect', reviews: 1,
    // Two lamps are connected, so the app asks which one; she names the desk lamp.
    answer: { when: /^Which one\b/, say: 'the reading lamp' } },
  { id: 'everything', label: 'Show everything', chip: 'everything', action: { kind: 'say', text: 'show everything' } },
];

/** Status lines that mean a step did not land. */
export const FAIL_LINES: readonly RegExp[] = [
  /isn[’']t a canvas command/i,
  /^Nothing to\b/,
  /^Nothing is waiting/,
  /^Finish the (review|waiting)/,
  /didn[’']t answer/,
  /^Blocked a plan/,
  /^Refused the (plan|pack)/,
  /^No board called/,
  /I[’']m listening — tell me what to build/,
];

export type StepOutcome = 'done' | 'skipped' | 'failed' | 'stopped';
export interface StepResult { id: string; label: string; outcome: StepOutcome; ms: number; note?: string; lines: readonly string[] }
export interface ReplayResult { ok: boolean; stopped: boolean; ms: number; steps: StepResult[] }

export interface ReplayEvents {
  /** A step starts (1-based index). */
  onStep?(index: number, total: number, step: ReplayStep): void;
  /** A visible note ("Replay · approving …", "skipped …"). */
  onNote?(text: string): void;
  onStepDone?(r: StepResult): void;
  onDone?(r: ReplayResult): void;
}

export interface ReplayOptions extends ReplayEvents {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Pause before approving a review, so a viewer sees it (default 2 s). */
  approveDelayMs?: number;
  pollMs?: number;
  /** A step that hasn't settled by then fails (default 45 s). */
  stepTimeoutMs?: number;
  /** Idle must hold this long before the step counts as settled. */
  settleMs?: number;
  /** A pause after each landed step, so a viewer can see what it did. */
  beatMs?: number;
}

export interface ReplayPlayer {
  start(): Promise<ReplayResult>;
  /** Stop after the current poll; the canvas is left as it is, usable. */
  stop(): void;
  running(): boolean;
}

export function createReplayPlayer(app: ReplayHost, steps: readonly ReplayStep[], o: ReplayOptions = {}): ReplayPlayer {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? (() => Date.now());
  const approveDelay = o.approveDelayMs ?? 2000;
  const poll = o.pollMs ?? 150;
  const timeout = o.stepTimeoutMs ?? 45_000;
  const settle = o.settleMs ?? 400;
  const beat = o.beatMs ?? 0;
  let stopped = false;
  let active = false;

  async function act(a: ReplayAction): Promise<string | null> {
    if (a.kind === 'say') { app.run(a.text); return null; }
    if (a.kind === 'online') {
      if (app.isOnline() !== a.on) app.toggleOffline();
      return app.isOnline() === a.on ? null : `still ${a.on ? 'offline' : 'online'} after the toggle`;
    }
    return (await app.sendBoard(a.to)) ? null : `the board was not sent to the ${a.to === 'ios' ? 'iPhone' : 'Nothing phone'}`;
  }

  async function playStep(step: ReplayStep): Promise<Omit<StepResult, 'id' | 'label' | 'ms' | 'lines'> & { mark: number }> {
    const mark = app.statusMark();
    if (step.action.kind === 'say') {
      const route = app.routeOf(step.action.text);
      if (step.needsRoute && route !== step.needsRoute) {
        const note = `skipped: “${step.action.text}” has no ${step.needsRoute} route in this build (went to ${route})`;
        o.onNote?.(`Replay · ${note}`);
        return { outcome: 'skipped', note, mark };
      }
      if (route === 'openEnded') return { outcome: 'failed', note: `“${step.action.text}” is not a command here (open-ended)`, mark };
    }
    const why = await act(step.action);
    if (why) return { outcome: 'failed', note: why, mark };
    const want = step.reviews ?? 0;
    let approved = 0;
    const start = now();
    let idleSince: number | null = null;
    let answered = false;
    while (!stopped) {
      if (now() - start > timeout) {
        return { outcome: 'failed', note: `timed out (${approved}/${want} reviews approved${app.isReviewOpen() ? ', a review is waiting' : ''})`, mark };
      }
      if (app.isReviewOpen()) {
        idleSince = null;
        if (approved >= want) return { outcome: 'failed', note: `an unexpected review opened: “${app.reviewTitle()}”`, mark };
        o.onNote?.(`Replay · approving “${app.reviewTitle()}”`);
        await sleep(approveDelay);
        if (stopped) break;
        if (!app.isReviewOpen()) continue; // decided by hand meanwhile
        app.reviewApprove();
        approved++;
        o.onNote?.('');
      } else if (step.answer && !answered && app.statusSince(mark).some((l) => step.answer!.when.test(l))) {
        answered = true;
        idleSince = null;
        o.onNote?.(`Replay · answering “${step.answer.say}”`);
        await sleep(approveDelay);
        if (stopped) break;
        app.run(step.answer.say);
      } else if (app.isIdle() && approved >= want) {
        if (idleSince === null) idleSince = now();
        else if (now() - idleSince >= settle) return { outcome: 'done', mark };
      } else {
        idleSince = null;
      }
      await sleep(poll);
    }
    return { outcome: 'stopped', mark };
  }

  return {
    running: () => active,
    stop() { stopped = true; },
    async start() {
      active = true;
      stopped = false;
      const t0 = now();
      const results: StepResult[] = [];
      let ok = true;
      for (let i = 0; i < steps.length && !stopped; i++) {
        const step = steps[i];
        o.onStep?.(i + 1, steps.length, step);
        const s0 = now();
        const r = await playStep(step);
        const lines = app.statusSince(r.mark);
        let { outcome, note } = r;
        if (outcome === 'done') {
          const bad = lines.find((l) => FAIL_LINES.some((re) => re.test(l)));
          if (bad) { outcome = 'failed'; note = `said “${bad}”`; }
          else if (step.expect && !lines.some((l) => step.expect!.test(l))) { outcome = 'failed'; note = `no line matched ${step.expect}`; }
        }
        const res: StepResult = { id: step.id, label: step.label, outcome, ms: now() - s0, note, lines };
        results.push(res);
        o.onStepDone?.(res);
        if (outcome === 'failed') { ok = false; break; }
        if (outcome === 'done' && beat && i < steps.length - 1) await sleep(beat);
      }
      active = false;
      const out: ReplayResult = { ok: ok && !stopped, stopped, ms: now() - t0, steps: results };
      o.onDone?.(out);
      return out;
    },
  };
}
