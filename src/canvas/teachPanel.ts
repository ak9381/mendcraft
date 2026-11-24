// TEACH A GESTURE — record mode for the canvas: perform a gesture 2–3 times,
// say or type what it should do, approve the parsed action on a Proposal
// card, then it's saved (local-only — never Firestore/cloud) and listed with
// rename/test/delete. See src/input/customGestures.ts for the matching core.
import {
  autoFireGesture,
  builtinConflict,
  createGestureAutoFireState,
  createGestureRecorder,
  createIndexedDbGestureStore,
  createMemoryGestureStore,
  matchCustomGestures,
  SAMPLES_MIN,
  SAMPLES_NEEDED,
  type CustomGesture,
  type CustomGestureStore,
} from '../input/customGestures';
import { resolveGestureAction, type GestureActionEngines } from './gestureActionParser';
import { createSurfaceProposal } from './proposalBuffer';
import { buildHandPose } from '../dev/trackingSim';
import { createPresenceTracker } from '../input/presence';
import { CAMERA_LOST_TEACH } from './failLines';
import type { DeviceRef } from './deviceCommands';
import type { Pt } from '../input/handLogic';

/** Model output (Gemini/Nano summary) and user text land in innerHTML here —
 *  escape them so a summary can never inject markup or handlers. */
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export interface TeachPanelOptions {
  devices(): DeviceRef[];
  engines?: GestureActionEngines;
  store?: CustomGestureStore;
  /** ?sim=1: record a deterministic synthetic sample instead of the camera. */
  sim?: boolean;
  /** Called once a gesture is saved — the caller adds the history line. */
  onSaved(gesture: CustomGesture): void;
  /** Called when a taught gesture fires (live tracking, or the list's Test
   *  button) — the caller runs the action and adds the history line
   *  ("Custom gesture <name> triggered -> <action>"). */
  onTriggered(gesture: CustomGesture): void;
  say(s: string): void;
  /** A model (not the rules) turned her words into the action: the caller
   *  books what that call sent (Gemini's bytes in the ledger). */
  onModelSent?(engine: 'nano' | 'gemini', prompt: string): void;
  /** Open the taught-gesture Proposal in the shared full-screen review
   *  (Approve/Reject/Ask for something else) instead of this panel's own
   *  card, so there is one decision surface for every AI proposal. When
   *  omitted (e.g. a test harness), the card renders inline as before. */
  openReview?(title: string, card: HTMLElement): void;
}

export interface TeachPanel {
  open(): void;
  gestures(): CustomGesture[];
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  openList(): void;
  /** Open (teach or list view)? The canvas routes Escape here first. */
  isOpen(): boolean;
  /** Same as the × button. */
  close(): void;
  /** Always-on tracking loop: feed one live frame. Matches it against every
   *  saved gesture (threshold/cooldown/conflict rules in customGestures.ts)
   *  and fires onTriggered — a no-op while this panel is open (recording or
   *  listing) so she isn't fighting her own taught gestures mid-teach. */
  matchFrame(hands: readonly (readonly Pt[])[], now?: number): void;
}

const SAMPLE_MS = 2500;
const RETRY_CAP = 2;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function mountTeachPanel(root: HTMLElement, opts: TeachPanelOptions): TeachPanel {
  const store = opts.store ?? (opts.sim ? createMemoryGestureStore() : createIndexedDbGestureStore());
  let gestures: CustomGesture[] = [];
  const loaded = store.load().then((g) => { gestures = g; });
  const autoFireState = createGestureAutoFireState();

  const panel = document.createElement('div');
  panel.className = 'mc-teach';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="mc-teach-card" role="dialog" aria-modal="true" aria-label="Teach a gesture">
      <button class="mc-teach-close" type="button" aria-label="Close">×</button>
      <p class="mc-teach-note">Stays on this device — never saved to the cloud.</p>
      <div class="mc-teach-body"></div>
      <div class="mc-teach-actions"></div>
    </div>`;
  root.appendChild(panel);
  const body = panel.querySelector<HTMLElement>('.mc-teach-body')!;
  const actions = panel.querySelector<HTMLElement>('.mc-teach-actions')!;
  panel.querySelector('.mc-teach-close')!.addEventListener('click', () => close());

  // Each open() is one teach session. Closing (×, Escape, Close) ends it, so a
  // recording still running in the background can't later write into — or
  // propose over — a newer session the user opened.
  let session = 0;
  class Cancelled extends Error { constructor() { super('teach closed'); this.name = 'Cancelled'; } }
  function close(): void { session++; panel.hidden = true; body.innerHTML = ''; actions.innerHTML = ''; }
  function show(html: string): void { body.innerHTML = html; }
  function alive(my: number): void { if (my !== session) throw new Cancelled(); }

  class CameraLost extends Error {
    constructor() { super(CAMERA_LOST_TEACH); this.name = 'CameraLost'; }
  }

  async function captureSample(my: number): Promise<Pt[][]> {
    if (opts.sim) {
      // Sim probe hook: rehearse the camera-lost failure without a camera.
      if ((globalThis as { __mcTeachFail?: string }).__mcTeachFail === 'lost') throw new CameraLost();
      // Deterministic synthetic recording: a held thumbs-up with a tiny,
      // repeatable wobble so screenshots/tests never need a camera.
      return Array.from({ length: 15 }, (_, i) => {
        const jitter = Math.sin(i) * 0.004;
        return buildHandPose('thumbs-up', { x: 0.6 + jitter, y: 0.6 - jitter }, 0.22);
      });
    }
    const frames: Pt[][] = [];
    let lost = false;
    const tracker = createPresenceTracker(() => {}, (f) => {
      const h = f.hands[0];
      if (h) frames.push(h.points);
    }, { onCameraLost: () => { lost = true; } });
    try {
      await tracker.start();
      const t0 = Date.now();
      while (Date.now() - t0 < SAMPLE_MS) {
        if (lost) throw new CameraLost();
        if (my !== session) break; // closed mid-sample: stop the camera now
        await wait(50);
      }
      if (lost) throw new CameraLost();
    } catch (e) {
      if (e instanceof CameraLost) throw e;
      // no camera available — resolve with whatever (likely nothing) we got
    } finally {
      tracker.stop();
    }
    return frames;
  }

  async function recordSamples(my: number): Promise<{ frames: Pt[][]; result: ReturnType<ReturnType<typeof createGestureRecorder>['finishEarly']> }> {
    const recorder = createGestureRecorder();
    let lastFrames: Pt[][] = [];
    for (let n = 1; n <= SAMPLES_NEEDED; n++) {
      let retries = 0;
      for (;;) {
        alive(my);
        show(`<p>Sample ${n} of ${SAMPLES_NEEDED} — hold your gesture…</p><p class="mc-teach-count">${SAMPLE_MS / 1000}s</p>`);
        const frames = await captureSample(my);
        alive(my);
        lastFrames = frames;
        const result = recorder.addSample(frames);
        if (result.status === 'retry' && result.reason) {
          if (retries >= RETRY_CAP) break; // stop fighting it — move on with what we have
          retries++;
          show(`<p>${esc(result.reason)}</p>`);
          await wait(1200);
          alive(my);
          continue;
        }
        if (result.status === 'ready' && n < SAMPLES_MIN) break; // shouldn't happen, but stay safe
        if (result.status === 'done') return { frames: lastFrames, result };
        break; // 'ready' (n==2) or the no-reason "need more" retry — go to the next sample
      }
    }
    const done = recorder.finishEarly();
    return { frames: lastFrames, result: done };
  }

  async function describeAndPropose(my: number, frames: Pt[][], result: { kind: 'pose' | 'motion'; pose?: CustomGesture['pose']; motion?: CustomGesture['motion'] }): Promise<void> {
    show(`
      <p>What should it do?</p>
      <form class="mc-teach-describe">
        <input type="text" placeholder="e.g. save the canvas" aria-label="What this gesture should do" />
        <button class="mc-btn primary" type="submit">Go</button>
      </form>`);
    const text = await new Promise<string>((resolve) => {
      panel.querySelector<HTMLFormElement>('.mc-teach-describe')!.addEventListener('submit', (e) => {
        e.preventDefault();
        resolve(panel.querySelector<HTMLInputElement>('.mc-teach-describe input')!.value.trim());
      });
    });
    alive(my);
    show('<p>Thinking…</p>');
    const parsed = await resolveGestureAction(text, opts.devices(), opts.engines);
    alive(my);
    if (!parsed) {
      show(`<p>I couldn't turn “${esc(text)}” into a canvas action. Try something like “save the canvas”.</p>`);
      actions.innerHTML = '<button class="mc-btn" data-act="close">Close</button>';
      panel.querySelector('[data-act=close]')!.addEventListener('click', close);
      return;
    }
    if (parsed.engine !== 'rules' && parsed.prompt) opts.onModelSent?.(parsed.engine, parsed.prompt);
    const conflict = builtinConflict(frames, result.kind);
    const conflictLine = conflict
      ? `<p class="mc-teach-conflict">This looks like the built-in “${esc(conflict.label)}” (${esc(conflict.does)}). Saving will use yours instead when it matches confidently.</p>`
      : '';
    const engineLabel = parsed.engine === 'rules' ? 'Rules · on device' : parsed.engine === 'nano' ? 'Nano · on device' : 'Gemini · cloud';
    const proposal = createSurfaceProposal(`teach-${Date.now()}`, parsed.engine === 'rules' ? 'rules' : parsed.engine, parsed.summary, [], () => {});
    const card = document.createElement('article');
    card.className = 'mc-proposal is-waiting mc-teach-proposal';
    card.innerHTML = `
      <header><strong>Teach: ${esc(parsed.summary)}</strong><span class="mc-proposal-engine">${engineLabel}</span></header>
      <p>Your gesture → <strong>${esc(parsed.summary)}</strong></p>
      ${conflictLine}
      <div class="mc-proposal-actions">
        <button class="mc-btn mc-proposal-drop" type="button">Reject</button>
        <button class="mc-btn primary mc-proposal-keep" type="button">Keep</button>
      </div>`;
    card.querySelector('.mc-proposal-drop')!.addEventListener('click', () => { proposal.reject(); close(); });
    card.querySelector('.mc-proposal-keep')!.addEventListener('click', () => void (async () => {
      proposal.accept();
      await loaded;
      const gesture: CustomGesture = {
        id: `g-${Date.now()}`,
        name: parsed.summary,
        kind: result.kind,
        pose: result.pose,
        motion: result.motion,
        action: { text: parsed.text },
        actionSummary: parsed.summary,
        conflictsWith: conflict?.id,
        createdAt: Date.now(),
      };
      gestures = [...gestures, gesture];
      await store.put(gesture);
      opts.say(`Learned it — ${gesture.actionSummary}, stays on this device.`);
      opts.onSaved(gesture);
      close();
    })());
    // The recording modal's job is done — the decision happens on one
    // shared surface (the full-screen review), never two cards at once.
    close();
    if (opts.openReview) { opts.openReview(`Teach: ${parsed.summary}`, card); return; }
    panel.hidden = false;
    body.innerHTML = '';
    body.appendChild(card);
    actions.innerHTML = '';
  }

  /** A7-010: a failed recording offers Try again (a fresh session, pinch- or
   *  click-reachable) next to Close, instead of a dead end. */
  function failActions(): void {
    actions.innerHTML = '<button class="mc-btn primary" data-act="retry">Try again</button><button class="mc-btn" data-act="close">Close</button>';
    actions.querySelector('[data-act=retry]')!.addEventListener('click', () => { void open(); });
    actions.querySelector('[data-act=close]')!.addEventListener('click', close);
  }

  async function open(): Promise<void> {
    const my = ++session;
    panel.hidden = false;
    actions.innerHTML = '';
    let frames: Pt[][] = [];
    let result: Awaited<ReturnType<typeof recordSamples>>['result'] | undefined;
    try {
      const rec = await recordSamples(my);
      frames = rec.frames;
      result = rec.result;
    } catch (e) {
      if (e instanceof Cancelled) return;
      const lost = e instanceof CameraLost || (e instanceof Error && e.name === 'CameraLost');
      show(`<p>${lost ? CAMERA_LOST_TEACH : 'Couldn’t get a clean reading — try again with your whole hand in view.'}</p>`);
      failActions();
      if (lost) opts.say(CAMERA_LOST_TEACH);
      return;
    }
    if (result?.status !== 'done') {
      show('<p>Couldn’t get a clean reading — try again with your whole hand in view.</p>');
      failActions();
      return;
    }
    try { await describeAndPropose(my, frames, result); } catch (e) { if (!(e instanceof Cancelled)) throw e; }
  }

  function openList(): void {
    session++;
    panel.hidden = false;
    actions.innerHTML = '<button class="mc-btn" data-act="close">Close</button>';
    actions.querySelector('[data-act=close]')!.addEventListener('click', close);
    const render = (): void => {
      show(gestures.length
        ? `<ul class="mc-teach-list">${gestures.map((g) => `
            <li data-id="${esc(g.id)}"><strong class="mc-teach-name">${esc(g.name)}</strong> → ${esc(g.actionSummary)}
              <span class="mc-teach-meter" data-meter="${esc(g.id)}"></span>
              <button class="mc-btn" data-act="test" data-id="${esc(g.id)}">Test</button>
              <button class="mc-btn" data-act="rename" data-id="${esc(g.id)}">Rename</button>
              <button class="mc-btn" data-act="delete" data-id="${esc(g.id)}">Delete</button>
            </li>`).join('')}</ul>`
        : '<p>No custom gestures yet.</p>');
      // Delete asks once (a stray pinch must not wipe a taught gesture):
      // the first press arms "Confirm delete" for 3s, the second deletes.
      body.querySelectorAll<HTMLButtonElement>('[data-act=delete]').forEach((btn) => {
        let armedTimer: ReturnType<typeof setTimeout> | null = null;
        btn.addEventListener('click', () => {
          if (!armedTimer) {
            btn.textContent = 'Confirm delete';
            btn.classList.add('is-armed');
            armedTimer = setTimeout(() => { armedTimer = null; btn.textContent = 'Delete'; btn.classList.remove('is-armed'); }, 3000);
            return;
          }
          clearTimeout(armedTimer); armedTimer = null;
          void remove(btn.dataset.id!).then(render);
        });
      });
      // Inline rename (no native prompt(): a modal a hand can't reach or close).
      body.querySelectorAll<HTMLButtonElement>('[data-act=rename]').forEach((btn) => btn.addEventListener('click', () => {
        const id = btn.dataset.id!;
        const li = btn.closest('li');
        const nameEl = li?.querySelector('.mc-teach-name');
        if (!li || !nameEl || li.querySelector('.mc-teach-rename')) return;
        const form = document.createElement('form');
        form.className = 'mc-teach-rename';
        form.innerHTML = `<input type="text" aria-label="New gesture name" /><button class="mc-btn primary" type="submit">Save</button><button class="mc-btn" type="button" data-act="rename-cancel">Cancel</button>`;
        const input = form.querySelector('input')!;
        input.value = gestures.find((g) => g.id === id)?.name ?? '';
        nameEl.replaceWith(form);
        input.focus();
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const name = input.value.trim();
          if (name) void rename(id, name).then(render); else render();
        });
        form.querySelector('[data-act=rename-cancel]')!.addEventListener('click', () => render());
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); render(); } });
      }));
      body.querySelectorAll<HTMLButtonElement>('[data-act=test]').forEach((btn) => btn.addEventListener('click', () => void testGesture(btn.dataset.id!)));
    };
    render();
  }

  /** Live match meter + fire: captures one sample and checks it against
   *  this one gesture, same matcher the always-on path would use. */
  async function testGesture(id: string): Promise<void> {
    const gesture = gestures.find((g) => g.id === id);
    if (!gesture) return;
    const meter = panel.querySelector<HTMLElement>(`[data-meter="${id}"]`);
    if (meter) meter.textContent = 'reading…';
    const my = session;
    const frames = await captureSample(my);
    if (my !== session) return; // list closed mid-test: never fire the action afterwards
    const match = matchCustomGestures(frames, [gesture]);
    if (meter) meter.textContent = match ? `match · ${(1 - match.distance).toFixed(2)}` : 'no match';
    if (match) opts.onTriggered(gesture);
  }

  async function rename(id: string, name: string): Promise<void> {
    const g = gestures.find((x) => x.id === id);
    if (!g) return;
    g.name = name;
    await store.put(g);
  }

  async function remove(id: string): Promise<void> {
    gestures = gestures.filter((g) => g.id !== id);
    await store.remove(id);
  }

  function matchFrame(hands: readonly (readonly Pt[])[], now = Date.now()): void {
    if (!panel.hidden) return; // recording or viewing the list — don't auto-fire
    if (!gestures.length) return;
    const gesture = autoFireGesture(hands, gestures, autoFireState, now);
    if (gesture) opts.onTriggered(gesture);
  }

  return {
    open: () => void open(),
    gestures: () => gestures,
    rename,
    remove,
    openList,
    isOpen: () => !panel.hidden,
    close,
    matchFrame,
  };
}

/** Live match meter for the gestures list: how close the current frame is
 *  to each saved gesture, for a "test" view. Pure-ish — takes the list and
 *  frames directly so it's callable from a test without the DOM panel. */
export function liveMatchMeter(frames: readonly Pt[][], gestures: readonly CustomGesture[]): { id: string; distance: number } | null {
  const match = matchCustomGestures(frames, gestures);
  return match ? { id: match.gesture.id, distance: match.distance } : null;
}
