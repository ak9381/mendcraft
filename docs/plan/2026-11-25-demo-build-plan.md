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

## Wave 2 (after plan 1 Stream B merges; sequential to avoid canvasApp conflicts)

### Task 4: Remove the on-screen keyboard (DEMO build 7) — exact file/test list in `DEMO.md` §Build list 7.
### Task 5: Connect devices → pair phones first (DEMO build 2) — `pendingAfterPair`; connected-device row with checks from host session peers; Continue → "What do you want to connect next?" → `connectRoom` only on "build the dashboard".
### Task 6: Point-to-connect (DEMO build 1) — phrase route before `parseGimbalSpeech`; hold-steady → `captureFullFrame()` → crop along landmarks 5→8 (un-mirror) → `identifyDevice(crop,{pointer})` → `mapKindToTile`; null/low confidence → say so; ledger source honest.
### Task 7: Spotify speaker tile (DEMO build 3) — `createSpotifyAwareConnector` wrapping the simulated connector; prefer Connect device named like "Marshall"; transfer `play:false` then play; fallback built-in + spoken notice.
### Task 8: Board → phone on one-fist grab (DEMO build 4) — feed grab midpoint into `edgeIntent`/`evaluateDwell`; commit → `publishBoardTransfer` for the whole board; cancel → snap back.
### Task 9: Judge replay `?replay=demo` — scripted utterance timeline through `run()` with review auto-approve after 2 s, labelled "Replay"; vitest asserts no dead-end replies and the ledger text is the scripted one.

Each Wave 2 task gets its own brief (Files / Interfaces / tests) written when Wave 1 lands, from the then-current code.
