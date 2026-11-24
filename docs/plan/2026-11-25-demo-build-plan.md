# Demo build — implementation plan (plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make every `DEMO.md` beat real, add an AI monitor for the Mac's external display, and unblock the iPhone.
**Architecture:** New isolated modules wired with small hooks; reuse existing hybrid/relay/music/CAD code. Wave 1 = tasks that don't touch the hand pipeline (can run in parallel with plan 1 Stream B). Wave 2 = tasks that touch hands/canvas routing (after Stream B merges).
**Tech Stack:** TypeScript, Lit, Vite, Vitest, Capacitor, Firebase AI Logic.
**Spec:** `docs/plan/2026-11-25-demo-build-design.md`

## Global Constraints

- Branch `sim-main`; plain commit messages; no `Co-Authored-By` trailers or AI-tool mentions; never push `main`; no billing/console changes.
- All inference through Firebase AI Logic (`src/ai/hybrid.ts`); ledger/badges honest; SIM labelled.
- No new runtime dependencies.
- Baseline failures only `goldenTrace8319f68.test.ts`, `poseStabilityReplay.test.ts`.
- `?sim=1&hands=0` never opens the camera.

## Review Focus

1. Monitor window opened before/after the canvas, or reloaded mid-turn → it shows current state (canvas re-sends a snapshot on `hello`).
2. Two canvas tabs open → monitor shows the most recent sender only, no interleaving garbage (tag messages with a session id; monitor follows the latest).
3. iPhone with camera permission denied → touch still works.
4. Accessibility check on an empty plan → says there's nothing to check, no crash.
5. Kannada caption when no translation is available → shows the heard line only, no "undefined".

---

## Wave 1 (parallel, isolated worktrees)

### Task 1: AI monitor window (`monitor.html`)

**Files:** Create `monitor.html`, `src/monitor/monitorMain.ts`, `src/monitor/monitor.css`, `src/canvas/aiFeed.ts`; Modify `vite.config.ts` (add `monitor.html` as a build input next to `canvas.html`), `src/canvas/modelPanels.ts` (publish), `src/canvas/canvasApp.ts` (Tools button `data-cmd="monitor"` + voice "open ai monitor" → `window.open('/monitor.html','mendcraft-monitor')`; ledger total publish next to `setFooterBytes`); Test `tests/canvas/aiFeed.test.ts`, `tests/monitor/monitorMain.test.ts`.

**Interfaces — Produces (`aiFeed.ts`):**
- `export type AiFeedMsg = { v: 1; sid: string; t: number } & ({ kind: 'log'; engine: EngineId; verb: string; text: string } | { kind: 'state'; engine: EngineId; state: EngineState; line?: string } | { kind: 'handoff'; from: EngineId; to: EngineId; text: string } | { kind: 'bytes'; total: number } | { kind: 'snapshot'; engines: Record<EngineId, { state: EngineState; line?: string; lines: string[] }>; total: number } | { kind: 'hello' })`
- `export function createAiFeed(opts?: { channel?: { postMessage(m: unknown): void; addEventListener(t: 'message', f: (e: { data: unknown }) => void): void } }): { publish(m: DistributiveOmit<AiFeedMsg,'v'|'sid'|'t'>): void; onHello(f: () => void): void }` — default channel `new BroadcastChannel('mendcraft-ai')` when available, else no-op. Keeps the last 40 lines per engine for snapshots.
- Monitor: `mountMonitor(root: HTMLElement, channel)` renders two columns (`.mon-col[data-engine=nano|gemini]`), centre lane (`.mon-lane` for handoffs/redactions, `.mon-bytes` using `formatFooterBytes`), posts `{kind:'hello'}` on load, follows the latest `sid`, caps 200 lines per column, auto-scrolls.

- [ ] Tests: publish→monitor renders a nano log line in the left column; handoff shows in the lane; bytes 2253 → "2.2 KB sent to cloud"; a `hello` triggers a snapshot from the feed; messages from an older `sid` are ignored after a newer one arrives (Review Focus 1–2); unknown/malformed messages ignored.
- [ ] Implement; dark, large-type styling (≥22px log text, column headers with the same engine colours as the engine bar, "on this device" / "cloud" subtitles, a pulsing dot while working).
- [ ] `npx tsc --noEmit`, focused tests, full suite; `npm run build` includes `dist/monitor.html`.
- [ ] Commit `AI monitor window for a second display.`

### Task 2: iPhone touch never locks

**Files:** Modify `src/canvas/phoneEditLock.ts`, `src/canvas/phoneCanvasRuntime.ts`; Test `tests/canvas/phoneEditLock.test.ts`, `tests/canvas/phoneCanvasRuntime.test.ts`.
**Behaviour:** default unlocked; lock only when the user turns on "Look to edit" (persisted, off by default) AND the face signal is known-present-then-absent for `LOOK_AWAY_LOCK_MS`; unknown/denied camera → unlocked; hint "Look at me to edit" only shown while actually locked.
- [ ] Tests: fresh runtime → editable; camera denied → editable (Review Focus 3); opt-in on + face seen then gone 3 s → locked; face back → unlocked.
- [ ] Implement; full suite; commit `iPhone: touch works by default; look-to-edit is opt-in.`

### Task 3: CAD extras + Kannada caption on the canvas

**Files:** Modify the canvas plan board element (find `PlanBoardElement` / plan board in `src/canvas/`), `src/canvas/canvasApp.ts` (`run()` routes "check accessibility", "show 3d"/"3d", "export dxf"/"export plan" to the focused plan board), `src/canvas/micFab.ts` (caption via `buildCaption` from `src/ai/language.ts`); Test `tests/canvas/planBoardExtras.test.ts`, `tests/canvas/micCaption.test.ts`.
**Reuse:** `isAccessibilityRequest`, `checkPlanAccessibility`, `toggle3D`/`createExtrudeView`, `toDxf`/`controller.export()` (currently wired in `src/main.ts` studio shell — follow that wiring).
- [ ] Tests: router sends "check accessibility" to the plan board and the result lists door-width/ramp findings; empty plan → "nothing to check yet" (Review Focus 4); "export dxf" produces a `mendcraft-plan.dxf` download call; Kannada utterance → caption shows heard line + English; no translation → heard line only (Review Focus 5).
- [ ] Implement (three small buttons on the plan board header: Check, 3D, DXF — ≥52 px so hands can dwell them); full suite; commit `Canvas plan board: accessibility check, 3D, DXF; Kannada caption.`

## Wave 2 — the integrated journey (re-scoped 25 Nov, see design "Decision")

Order: 2a (parallel, now) Tasks 4, 5, 6 · 2b (after hands Stream B merges) Tasks 7, 8, 9, 10.

### Task 4: Journey + next-step suggestions

**Files:** Create `src/canvas/journey.ts`, `src/canvas/nextSteps.ts`; Modify `src/canvas/canvasApp.ts` (render chips on the focused board's footer after every keep/undo/focus; chip click → `run(chip.say)`); `src/canvas/canvas.css` (append `.mc-next` rules at end of file); Test `tests/canvas/journey.test.ts`, `tests/canvas/nextSteps.test.ts`.
**Interfaces — Produces:**
- `export type JourneyStep = 'empty' | 'devices' | 'dashboard' | 'music' | 'saved' | 'floorplan' | 'checked' | 'language' | 'offline' | 'shared'`
- `export function journeyStepOf(board: { kind: string; tiles: { kind: string }[]; pinned: boolean }, ctx: { lang: string; online: boolean; phones: number }): JourneyStep`
- `export interface NextStep { id: string; label: string; say: string }` and `export function ruleSuggestions(step: JourneyStep, ctx): NextStep[]` (2–3, deterministic; e.g. dashboard → Play music / Save / Draw the floor plan; floorplan → Check accessibility / Show 3D / Export DXF; checked → Add Kannada / Send to my phone; empty → Connect this room / Floor plan).
- `export async function suggestNextSteps(step, ctx, nano?: (prompt: string) => Promise<string>): Promise<{ steps: NextStep[]; source: 'nano' | 'rules' }>` — Nano (on-device only; never cloud) picks/reorders from the rule list by id (prompt lists allowed ids; reply parsed strictly; anything invalid → rules). Under `?sim=1` uses rules and says so.
- Chips: `.mc-next` row inside the focused board footer, ≥52px targets, label + tiny source tag ("Nano" / "Suggested"); also published to the AI feed as a nano log line.
- [ ] Tests: step classification for each board shape; rules give 2–3 valid steps whose `say` routes to a real command (assert via `parseCanvasCommand` or the run() routing tests); invalid Nano reply → rules; Nano reply with an unknown id → dropped.
- [ ] Implement; full suite; commit `Next-step suggestions on every board.`

### Task 5: Connect devices pairs phones first (DEMO build 2)

**Files:** Modify `src/canvas/canvasApp.ts` (the `connect (everything|…|devices?)` branch ~2167 and `connectRoom` ~1368; host pairing flow ~1485–1505), `src/canvas/connectSheet.ts`; Create `src/canvas/pairedRow.ts`; Test `tests/canvas/pairFirst.test.ts`.
**Behaviour:** "connect devices (and make a dashboard)" → open pairing (chime + typed-code fallback) first; a small connected-device row with a check per joined phone (from host-session peer events; reuse arrange-strip data); "Continue" (or ≥1 phone joined + "next") → status "What do you want to connect next? Point at it, name it, or say build the dashboard."; the lamp dashboard review (`connectRoom`) starts only on "build the dashboard" / "make a dashboard" said afterwards, or immediately when no pairing is possible (sim without relay → say so and continue). Under `?sim=1` the two phones join on a scripted delay, labelled SIM.
- [ ] Tests: utterance with "and make a dashboard" sets pending and does NOT start connectRoom before pairing completes; joined peers render checks; "build the dashboard" runs connectRoom once.
- [ ] Commit `Connect devices pairs phones first, then asks what's next.`

### Task 6: Speaker tile → Spotify (DEMO build 3)

**Files:** Create `src/canvas/spotifyConnector.ts`; Modify `src/canvas/canvasApp.ts` (wrap the device connector next to `createWizAwareConnector` usage; route "play …" through `parseMusicIntent`); Test `tests/canvas/spotifyConnector.test.ts`.
**Interfaces:** `createSpotifyAwareConnector(inner, deps: { session: MusicSession-like; listDevices; transferPlayback; searchAndPlay; isConnected(): boolean; say(t: string): void })` — for `speaker-*` when connected: prefer a Connect device whose name matches /marshall/i, else the browser device; transfer `play:false` then play; tile `trackTitle` = real hit title; ledger job `spotify` via the existing hook. Not connected → inner (built-in player) + say "Spotify isn't connected — playing the built-in track." Never fakes a session.
- [ ] Tests with fakes: connected + Marshall present → transfer to it then play; no Marshall → browser device; not connected → inner + notice; search miss → notice, no fake title.
- [ ] Commit `Speaker tile plays through Spotify when connected.`

### Task 7 (2b): Remove the on-screen keyboard — exact list in `DEMO.md` Build list 7.
### Task 8 (2b): Point-to-connect — recon in workspace `plan2-recon.md` item 1; never defaults to a speaker; honest ledger source.
### Task 9 (2b): Board → phone on a held-fist board drag reaching a paired edge (recon item 4); cancel snaps back.
### Task 10 (2b): Journey replay `?replay=demo` + end-to-end test: a timeline of the journey's `say` lines (from Task 4's suggestions) run through `run()`, reviews auto-approved after 2 s with a visible "Replay" label; the same timeline in a vitest asserts every step lands (no "isn't a canvas command", each review kept, final boards present, ledger text SIM-labelled).
Also in 2b: Nano card settles after the Kannada handoff (languageTurn → settle); wire face click to FaceLandmarker blendshapes if cheap.
