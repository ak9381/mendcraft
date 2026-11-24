# Demo build — implementation plan (plan 2)


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

### Task 7 (2b): Remove the on-screen keyboard

**Files:** exact delete/edit/test list in `DEMO.md` Build list 7 (onscreenKeyboard.ts, keyboardLogic.ts, handKeyboard.ts; mounts in canvasApp.ts, handPointer.ts, main.ts, referencePanel.ts; tests keyboardLogic, capsLock, handKeyboard, keyboard-hand-path, keyboard parts of say-box-hand-path, t2-B-props-panel, browser-panel-hand-path). Also remove engine-bar/CSS rules that only existed to hide chrome while the hand keyboard was open.
- [ ] Acceptance: no on-screen keyboard anywhere (canvas, studio, phone); no dead "Keyboard" button; Talk, say box (typed), hover/fist still work; `vitest run` baseline only.
- [ ] Commit `Remove the on-screen keyboard.`
### Task 8 (2b): Point-to-connect

**Files:** Modify `src/canvas/routeLine.ts` (new route `pointConnect` placed before the gimbal routes: /connect (to )?(what|whatever) i('m| am)? point(ing)? at/ and "use the gimbal to connect to what I point at"), `src/canvas/canvasApp.ts` (`pointTurn` ~1446: stop hard-coding `pointConnect('speaker')`), `src/canvas/connectTurns.ts`; Create `src/canvas/pointCrop.ts`; Test `tests/canvas/pointCrop.test.ts`, `tests/canvas/pointConnect.test.ts`, extend `tests/canvas/routeLine.test.ts`.
**Behaviour:** on the route, ask "Point at it and hold still"; when the hand cursor (palm) is steady ≥ 600 ms — or after a mouse click on the canvas if hands are off — capture a frame (gimbal if available, else the laptop camera via the existing `captureFullFrame` pattern in src/main.ts / devices/addDeviceFlow.ts), crop around the pointing ray (landmarks 5→8, un-mirrored; `cropAlongRay(landmarks, frameW, frameH): {x,y,w,h}` pure, ~35–40 % square ahead of the fingertip, clamped; full frame if no hand), downscale to ≤512 px JPEG, call `identifyDevice(crop, { pointer })` (src/ai/hybrid.ts — Nano first, cloud second, both through Firebase AI Logic). Map the identity with `mapKindToTile`: WiZ/bulb/lamp → lamp tile, speaker → music tile; propose it through the normal review. null / confidence < 0.5 → say "I couldn't tell what you're pointing at — try naming it." Never default to a speaker. Ledger + AI feed record the real source (on-device vs cloud, bytes of the photo crop). Under `?sim=1`: scripted identify of a lamp, labelled SIM, no camera.
- [ ] Tests: cropAlongRay geometry (mirror, clamp, no-hand → full); route phrases; identity → tile mapping; null/low-confidence → message, no proposal; sim path labelled.
- [ ] Commit `Point at a device to connect it.`

### Task 11 (2b): Try to break it + small fixes

**Files:** validation for device intents/plans (find where lamp brightness and tile plans are validated: wizBridge sanitizeParams ranges 10–100, surfacePlan coerce, deviceActions); `src/canvas/canvasApp.ts` (languageTurn settle); Test `tests/canvas/tryToBreak.test.ts`.
**Behaviour:** (1) "Set the desk lamp to 500% brightness" → the proposal is refused by validation with a plain reason ("Lamps go from 10 to 100 %. Nothing changed.") — NOT silently clamped; the responsible engine's card/terminal blinks red (existing `.is-failing` / EngineBar failed state / AI feed 'failed'); board unchanged. (2) "Add a control for the oven" with no oven device → refused: "There's no oven connected. Nothing changed." Same red + unchanged. Under `?sim=1` the scripted model reply is the real-shaped attempt (e.g. dimming 500) so the refusal is genuine validation, labelled SIM. (3) Fix: Nano card stays "Working" after the Kannada handoff — languageTurn settles the engine bar like aiTurn. (4) Add a journey chip "Try to break it" on the dashboard step (rules) that says "set the desk lamp to 500% brightness".
- [ ] Tests: 500 % → refusal text, failed state, board snapshot equal before/after; oven → refusal; valid 70 % still works; Nano card settles after Kannada.
- [ ] Commit `Show the safety net: impossible requests are refused, nothing changes.`
### Task 9 (2b): Board → phone on a held-fist drag

**Files:** Modify `src/canvas/canvasApp.ts` (the `onBoardMove` handler for hands AND the mouse title-drag `onMove/onEnd` from boardDrag), `src/canvas/edgeTransfer.ts` (add a whole-board path next to the tile path), reuse `screenLayout` edge intent/dwell + `publishBoardTransfer`; Test `tests/canvas/boardEdgeTransfer.test.ts`.
**Behaviour:** while a board is being dragged (one-fist grab or mouse title drag), the drag point approaching the paired side's screen edge lights the existing edge glow; holding at the edge for the existing dwell commits → `publishBoardTransfer(frameId, surface)` sends the whole board to that phone and the board snaps back to where the drag started on the laptop (it isn't deleted); leaving the edge or releasing early cancels with no transfer. Only when a phone is paired on that side (pair-first flow / host session); under `?sim=1` with SIM phones, show the same glow and a SIM-labelled "Sent to iPhone (SIM)" without network. Status line + AI-feed-free (this is not AI). Mark journey step 'shared' (expose a hook the journey can read: e.g. `sharedBoards` set).
- [ ] Tests: drag reaching right edge with iPhone paired right + dwell → one publish, board rect restored; leave early → none; no phone on that side → no glow, no publish; mouse title drag path behaves the same.
- [ ] Commit `Drag a board to a paired phone's edge to send it.`
### Task 10 (2b): Journey replay + end-to-end test

**Files:** Create `src/canvas/journeyReplay.ts` (timeline + player), `src/canvas/replayBanner.ts` (small "Replay · <step> · Stop" banner); Modify `src/canvas/canvasMain.ts` (`?replay=demo` boot flag; implies `sim=1&hands=0`), `src/canvas/canvasApp.ts` (expose a minimal replay hook: `run(text)`, `reviewApprove()`, `isReviewOpen()`, `isIdle()` — reuse existing handle methods where they exist); Test `tests/canvas/journeyReplay.test.ts` (pure timeline/player with a fake app) and an end-to-end Playwright script `scripts/e2e-journey.mjs` (repo already has Puppeteer/Playwright-style scripts — follow their pattern) that runs `?replay=demo` on the dev server and asserts.
**Timeline (the integrated journey, all real commands through `run()`):** connect devices and make a dashboard → (SIM phones join) → build the dashboard → approve ×2 → play music → save → draw the floor plan → approve → check accessibility → show 3D → add Kannada → approve → undo → set the desk lamp to 500% brightness (refused, red) → simulate offline → add Kannada (queued) → back online → approve → send the Living room board to the iPhone (programmatic board-edge send in sim) → connect to what I'm pointing at (SIM lamp) → approve → show everything. Each step waits for the app to be idle (no pending turn) and auto-approves a review after 2 s with a visible "Replay · approving" note. Banner shows the current step; Stop ends the replay and leaves the canvas usable. Everything stays SIM-labelled.
**E2E assertions:** every step lands (no "isn't a canvas command", no "Nothing to …" for steps that should work), expected boards exist at the end (Living room dashboard, floor plan, Board with a WiZ lamp), the try-to-break step shows the refusal and the lamp value unchanged, the ledger total is a real number with SIM labels, and the run completes in < 3 min.
- [ ] Commit `Judge replay walks the whole journey; end-to-end test.`

Also in 2b: Nano card settles after the Kannada handoff (languageTurn → settle); wire face click to FaceLandmarker blendshapes if cheap.
