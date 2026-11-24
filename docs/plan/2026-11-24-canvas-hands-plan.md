# Canvas navigation, hands, and calmer screen — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figma-style pan/zoom + mouse board move, hands that point/select/grab/zoom reliably, and a calmer screen where Nano and Gemini are both always visible.

**Architecture:** Keep the pure camera module (`src/canvas/camera.ts`) as the single source of truth and add pure input-mapping helpers next to it; new small DOM modules (`zoomHud.ts`, `boardDrag.ts`, `engineBar.ts`) are wired into `canvasApp.ts` with a few lines each. Hand changes stay inside the existing pointer pipeline (`handFeel.ts`, `handPointer.ts`, `canvasHands.ts`) plus their wiring in `canvasApp.ts`.

**Tech Stack:** TypeScript, Lit/DOM, Vite, Vitest (jsdom), MediaPipe Hand Landmarker (unchanged).

**Spec:** `docs/plan/2026-11-24-canvas-hands-design.md`

## Global Constraints

- Branch `sim-main` only; commit messages plain, **no `Co-Authored-By` trailers, no AI-tool mention**; never push `main`.
- No new runtime dependencies.
- `?sim=1&hands=0` must never open the camera.
- Phone shell (`isPhoneCanvasShell`, viewport < 600px or Capacitor) keeps its own layout: new desktop chrome (HUD, engine bar) is hidden there.
- Baseline: `npx tsc --noEmit` clean; `npx vitest run` → only `goldenTrace8319f68.test.ts` and `poseStabilityReplay.test.ts` fail (missing absolute-path fixtures). No new failures.
- Byte counts shown anywhere come from the existing ledger (`ledger.totals()`), never invented.
- Hand gestures are handedness-agnostic; never branch on MediaPipe Left/Right.

## Review Focus

1. Typing in the say box / teach input while pressing `-`, `=`, `0`, Space → must type, not zoom/pan. (Task 2 test.)
2. A mouse click on a board title with < 5px movement → still focuses the board, does not move it. (Task 3 test.)
3. A hand fist closing over a button (not a board, not empty canvas) → nothing moves and nothing clicks. (Task 5 test.)
4. Cursor jitter of ±8px inside a 60px button during dwell → the click still fires at 800 ms. (Task 4 test.)
5. An engine turn that errors or goes offline → engine bar card shows the failure/queued state and the AI panel stays open with the reason. (Task 6 test.)

---

## Stream A — Camera (Tasks 1–3) · files: `camera.ts`, new `canvasNav.ts`, new `zoomHud.ts`, new `boardDrag.ts`, camera wiring in `canvasApp.ts` (~2060–2200)

### Task 1: Camera range, zoom steps, wheel mapping (pure)

**Files:**
- Modify: `src/canvas/camera.ts` (`MAX_Z`)
- Create: `src/canvas/canvasNav.ts`
- Test: `tests/canvas/canvasNav.test.ts`, update `tests/canvas/camera.test.ts`

**Interfaces — Produces:**
- `export const MAX_Z = 2` (camera.ts); `MIN_Z` becomes `0.1`.
- `export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2] as const`
- `export function stepZoom(z: number, dir: 1 | -1): number` — next step strictly above/below `z`, clamped.
- `export type WheelIntent = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number }`
- `export function wheelIntent(e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; deltaMode: number }): WheelIntent` — ctrl/meta → zoom `factor = exp(-deltaY * 0.01)`; else pan `(deltaX, deltaY)`, Shift swaps to horizontal (`dx = deltaY` when `deltaX === 0`); `deltaMode === 1` (lines) multiplies by 16.
- `export function zoomCameraTo(c: Camera, vp: Viewport, z: number): Camera` — zoom about the viewport centre.

- [ ] **Step 1: Write failing tests** — `stepZoom(1, 1) === 1.5`, `stepZoom(0.8, -1) === 0.75`, `stepZoom(2, 1) === 2`, `stepZoom(0.1, -1) === 0.1`; `wheelIntent({deltaY: 100, ctrlKey: true,…})` → `{kind:'zoom', factor: Math.exp(-1)}`; plain `{deltaX: 5, deltaY: 40}` → `{kind:'pan', dx:5, dy:40}`; shift `{deltaX:0, deltaY:40, shiftKey:true}` → `{kind:'pan', dx:40, dy:0}`; `zoomCameraTo` keeps the world point at the viewport centre fixed (use `screenToWorld`).
- [ ] **Step 2: Run** `npx vitest run tests/canvas/canvasNav.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `canvasNav.ts`; set `MIN_Z = 0.1`, `MAX_Z = 2`; fix any `camera.test.ts` assertion that pinned 0.08/1.
- [ ] **Step 4: Run** `npx vitest run tests/canvas/canvasNav.test.ts tests/canvas/camera.test.ts` → PASS.
- [ ] **Step 5: Commit** `Canvas nav: zoom steps, wheel intent, zoom range 0.1–2.`

### Task 2: Wire wheel, keys, Space-drag, Safari gestures, voice + zoom HUD

**Files:**
- Create: `src/canvas/zoomHud.ts`
- Modify: `src/canvas/canvasApp.ts` wheel handler (~2184), keydown handler (~2125), pointer pan (~2092), command parser for "zoom in/out", "100%", "fit"; `src/canvas/canvas.css` (HUD styles)
- Test: `tests/canvas/zoomHud.test.ts`, `tests/canvas/canvasKeys.test.ts`

**Interfaces:**
- Consumes: Task 1 (`wheelIntent`, `stepZoom`, `zoomCameraTo`), existing `zoomAbout`, `panBy`, `flyTo`, `overview`, `applyCamera`.
- Produces: `export function mountZoomHud(root: HTMLElement, api: { zoomIn(): void; zoomOut(): void; reset(): void; fit(): void }): { setZoom(z: number): void; el: HTMLElement }` — buttons `.mc-zoom-out` (−), `.mc-zoom-pct` (shows `Math.round(z*100)+'%'`, click → reset), `.mc-zoom-in` (+), `.mc-zoom-fit` (Fit); each has `aria-label`; container `.mc-zoom-hud`, fixed bottom-left (left 16, bottom 16), ≥52px targets, hidden in phone shell.
- `export function isTypingTarget(t: EventTarget | null): boolean` (in `zoomHud.ts` or `canvasNav.ts`) — true for input/textarea/select/contenteditable.

- [ ] **Step 1: Failing tests** — HUD: clicking `.mc-zoom-in` calls `zoomIn` once; `setZoom(0.874)` shows `87%`; clicking `.mc-zoom-pct` calls `reset`. Keys: `isTypingTarget(inputEl) === true`, `isTypingTarget(divEl) === false`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement HUD + wiring.** Wheel: use `wheelIntent`; zoom → `zoomAbout` at the pointer; pan → `panBy(camera, -dx, -dy)`; keep the existing "skip over focused frame" rule only for zoom, and let pan scroll the focused board's own content when it is scrollable (if the event target is inside a scrollable element that can scroll in that direction, don't preventDefault). Add `gesturestart/gesturechange` (Safari) → zoom. Keys (skip when `isTypingTarget`): Cmd/Ctrl `=`/`+` → `zoomCameraTo(stepZoom(z,1))`, `-` → step down, `0` → 1, Shift+`!`/Digit1 → `overview()`; Space held → next pointer drag pans even over boards (cursor `grab`). Voice/typed command phrases "zoom in", "zoom out", "reset zoom"/"100%", "fit" route to the same functions (add to the existing command parser in `canvasCommands.ts` following its pattern). Call `hud.setZoom(camera.z)` inside `applyCamera`. Animate HUD/keys/voice zoom with `flyTo`.
- [ ] **Step 4: Run** the two new test files + `tests/canvas/canvasCommands*.test.ts` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Browser check** (dev server `http://localhost:5173/canvas.html?fresh=1&sim=1&hands=0`): build a dashboard, then wheel pans, Cmd+wheel zooms at cursor, HUD +/−/Fit/% work, typing "-" in the say box types.
- [ ] **Step 6: Commit** `Canvas nav: trackpad pan, pinch/Cmd-wheel zoom, keys, zoom HUD.`

### Task 3: Drag a board by its title with a mouse

**Files:**
- Create: `src/canvas/boardDrag.ts`
- Modify: `src/canvas/canvasApp.ts` (frame title rendering ~743 and the `[data-focus]` click handler)
- Test: `tests/canvas/boardDrag.test.ts`

**Interfaces — Produces:** `export function attachBoardDrag(title: HTMLElement, opts: { frameId: string; getZoom(): number; onMove(id: string, dxWorld: number, dyWorld: number): void; onEnd(id: string): void; threshold?: number }): () => void` — pointerdown on the title (button 0) → after > `threshold` (default 5) px movement, calls `onMove` with screen delta ÷ zoom and sets `title.dataset.dragged = '1'` so the following click is swallowed; pointerup → `onEnd`. Uses pointer capture.

- [ ] **Step 1: Failing tests** — synthetic pointerdown/move(+20,+10)/up at zoom 0.5 → `onMove` totals `(40, 20)` and `onEnd` once; pointerdown/move(+3,0)/up → `onMove` never called and a click event still reaches the title (Review Focus 2).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; wire in canvasApp: `onMove` → `reg.setRect(id, {...rect, x: x+dx, y: y+dy})` + `sync()`; `onEnd` → `persist()`. Title gets `cursor: grab`.
- [ ] **Step 4: Run** tests → PASS; browser: drag "Living room" title in overview and when focused; click still focuses.
- [ ] **Step 5: Commit** `Boards: drag by title with mouse or touch.`

## Stream B — Hands (Tasks 4–5) · files: `handFeel.ts`, `handPointer.ts`, `canvasHands.ts`, hand wiring in `canvasApp.ts` (~1580–1600, ~1750–1890)

### Task 4: Palm-anchored cursor, active box, target-locked 800 ms dwell, magnet

**Files:**
- Modify: `src/canvas/handFeel.ts` (`HAND_FEEL`), `src/canvas/handPointer.ts` (landmark choice ~912, `mapToScreen` ~117, `aim` ~853, `tickDwell` ~769, `CONFIRM_DWELL_MS` ~298)
- Test: update `tests/canvas/handFeel.test.ts`, `handPointer.test.ts`, `handPointerPipeline.test.ts`, `gestureTrace.test.ts`; add `tests/canvas/handDwellLock.test.ts`

**Interfaces — Produces:**
- `HAND_FEEL.dwellMs = 800`, `HAND_FEEL.reach = { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.75 }`, `HAND_FEEL.cursorFilter = { minCutoff: 1.0, beta: 0.01, dCutoff: 1.0 }` (screen px; tune against recorded traces if available), `HAND_FEEL.magnetCapturePx = 40`, `HAND_FEEL.magnetReleasePx = 60`, `HAND_FEEL.clickCooldownMs = 600`. `CONFIRM_DWELL_MS` imports `HAND_FEEL.dwellMs` (no duplicate constant).
- `export function palmPoint(points: readonly {x:number;y:number}[]): {x:number;y:number}` — mean of landmarks 0, 5, 9, 17 (handFeel.ts); the live cursor uses it instead of landmark 8.

- [ ] **Step 1: Failing tests** — `palmPoint` returns the mean of those four; closing the fist (moving tips 8/12/16/20 by 0.1) doesn't change `palmPoint`. Dwell lock (`handDwellLock.test.ts`, through the existing pipeline harness used by `handPointerPipeline.test.ts`): cursor enters a 60×52 button, jitters ±8px for 800 ms → exactly one click (Review Focus 4); leaves the button at 500 ms → no click; after a click, staying on the button 2 s → no second click; leave and re-enter → arms again; a point 35px outside the button snaps to it, 65px does not. Update pinned numbers in the four existing test files to the new constants.
- [ ] **Step 2: Run** those files → FAIL.
- [ ] **Step 3: Implement** — cursor source = `palmPoint`; `mapToScreen` uses `HAND_FEEL.reach`; dwell: once `aim` returns an interactive target, keep it locked while the raw point stays inside the target rect inflated by `magnetReleasePx - magnetCapturePx` (20px); ring progress is time since lock, not since last stillness; `dwellSlopPx` no longer resets a locked target; snap capture radius = `magnetCapturePx`, release = `magnetReleasePx`; after `activate()`, set cooldown and require leaving the target before re-arming. Boards (`.mc-frame`) remain dwell targets (focus), empty canvas never is.
- [ ] **Step 4: Run** the hand test files → PASS; full `npx vitest run` → baseline only.
- [ ] **Step 5: Commit** `Hands: palm cursor, active box, 800 ms target-locked dwell with magnet.`

### Task 5: One fist = grab (move board / pan), two fists = zoom; unwire pinch

**Files:**
- Modify: `src/canvas/handPointer.ts` (plural `createHandPointer` grab logic ~980–1072), `src/canvas/canvasHands.ts` (pinch → keep ~192, thumbs-up ~196, palm swipe ~170), `src/canvas/canvasApp.ts` (`handleTwoHand` ~1758–1830, `handleHandPan` ~1836–1847, `onBoardMove` ~1583)
- Test: update `handPointerPipeline.test.ts` two-fist cases (~518–586), `canvasHands.test.ts` pinch cases; add `tests/canvas/handGrab.test.ts`

**Interfaces — Produces (handPointer options):**
- `onBoardMove(id: string, dx: number, dy: number)` — unchanged signature, now fired by ONE fist held ≥150 ms whose palm point is over a `.mc-frame` (hit-test by frame rects, not `elementFromPoint`, so chrome over the board doesn't drop the grab).
- `onWorldPan(dx: number, dy: number)` — new; one fist over empty canvas (no frame, no interactive element).
- `onWorldZoom(phase: 'start' | 'move' | 'end', a: {x:number;y:number}, b: {x:number;y:number})` — new; two fists. canvasApp uses `twoHandCamera(cam0, a0, b0, a, b)`.
- `isGrabActive()` true during any of the three; dwell suppressed.

- [ ] **Step 1: Failing tests** (`handGrab.test.ts`, synthetic frames): one fist over a board for 200 ms then moving +50px → `onBoardMove` deltas sum to +50 and no click fires; one fist over empty canvas → `onWorldPan`; one fist over a button → no `onBoardMove`, no `onWorldPan`, no click (Review Focus 3); two fists spreading → `onWorldZoom('start')` then `'move'`; a fist held < 150 ms → nothing. Pinch frames no longer trigger keep, pan, or zoom.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; delete the live calls to `handleTwoHand`'s pinch path and `handleHandPan` (keep edit-mode resize only if it is still reachable by two fists; otherwise remove), remove pinch/thumbs-up → keep and palm-swipe → drop wiring in `canvasHands.ts`. canvasApp: `onWorldPan` → `panBy(camera, dx, dy)` + `applyCamera()`; `onWorldZoom` → `twoHandCamera`.
- [ ] **Step 4: Run** hand tests + full suite → baseline only.
- [ ] **Step 5: Commit** `Hands: one-fist grab moves boards or pans, two fists zoom; pinch unwired.`
- [ ] **Step 6: Live check request** — note in `docs/HANDOFF-NOTES.md` that Akash must try: point, dwell a button, fist-move a board across the right cluster, fist-pan, two-fist zoom, both hands.

## Stream C — Calmer screen + engines + Kannada (Tasks 6–7) · files: new `engineBar.ts`, `activityLog.ts`, `modelPanels.ts`, `canvas.css`, `languagePack.ts`, `toolPalette.ts`, `reviewDialog.ts`, small wiring in `canvasApp.ts`

### Task 6: Engine bar (Nano + Gemini always visible) and auto-collapsing AI panel

**Files:**
- Create: `src/canvas/engineBar.ts`
- Modify: `src/canvas/activityLog.ts:68` (`AI_PANEL_ALWAYS_OPEN = false`), `src/canvas/modelPanels.ts` (mirror state to the bar), `src/canvas/canvasApp.ts` (`showAi`, `autoHideAi`, turn start/end, ledger footer ~991), `src/canvas/canvas.css` (bar, cluster 120×52 gaps 24, face preview to top-right corner chip)
- Test: `tests/canvas/engineBar.test.ts`; update `activityLog.test.ts`, `talkReachable.test.ts`, `viewportLayout.test.ts`, `modelPanels.test.ts`

**Interfaces — Produces:**
- `export type EngineId = 'nano' | 'gemini'`
- `export type EngineState = 'idle' | 'working' | 'done' | 'queued' | 'failed' | 'unavailable'`
- `export function mountEngineBar(root: HTMLElement, opts: { onOpen(engine: EngineId): void }): { set(engine: EngineId, state: EngineState, line?: string): void; handoff(from: EngineId, to: EngineId): void; setCloudBytes(bytes: number): void; el: HTMLElement }` — `.mc-engine-bar` fixed bottom-centre with two `.mc-engine-card[data-engine]` (`Nano · on this device`, `Gemini · cloud`), each with a status dot, state text, last line (≤60 chars, ellipsis); `.mc-engine-bytes` shows `formatBytes(bytes) + ' sent to cloud'` using the existing formatter; `handoff()` adds `.is-handoff` for 1.2 s; clicking a card → `onOpen`. Hidden in phone shell. The phones strip (`.mc-arrange`) sits directly above it.

- [ ] **Step 1: Failing tests** — mount; `set('nano','working','redacted a name')` → nano card `data-state="working"` and line text; `setCloudBytes(2253)` → `2.2 KB sent to cloud`; card click → `onOpen('gemini')`; `set('gemini','failed','App Check blocked')` → failed state shown (Review Focus 5). `activityLog.test.ts`: flag false, panel hidden initially, close button visible.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; every `panels.forEngine(e).log/fail/setQueued` and `panels.showHandoff` also updates the bar (do it inside `modelPanels.ts` via an optional `bar` dependency so call sites don't change); `ledger` updates call `setCloudBytes`. AI panel: opens when a turn starts or a review opens, stays open while a review is pending or a turn failed, hides 3 s after the turn ends; `focusCam` re-flies when it toggles (existing). Update pinned layout tests to the new cluster size and flag.
- [ ] **Step 4: Run** tests → PASS; browser at 1470×745: empty canvas shows only blank prompt, cluster, engine bar; connect flow shows panel during work and collapses after keep.
- [ ] **Step 5: Commit** `Screen: Nano + Gemini engine bar, AI panel opens only while working.`

### Task 7: Kannada changes what's on screen

**Files:**
- Modify: `src/canvas/languagePack.ts`, `src/canvas/toolPalette.ts:44`, `src/canvas/reviewDialog.ts:114-116`, `src/canvas/canvasApp.ts` (`applyStrings` sets `document.documentElement.lang`)
- Test: `tests/canvas/languagePackExtras.test.ts`

**Interfaces — Produces:** `export const LANG_OPTIONAL_KEYS = ['tools', 'approve', 'reject', 'askElse'] as const`; `LangStringKey` covers required + optional; `coerceLanguagePack` accepts optional keys but only requires `LANG_STRING_KEYS`; `EN_PACK` adds `tools: 'Tools', approve: 'Approve', reject: 'Reject', askElse: 'Ask for something else'`, and `keep: 'Keep', drop: 'Drop'` (replace the stale `'PINCH  keep'`/`'BRUSH  drop'`); `SCRIPTED_KN_PACK` adds Kannada for the four. The Gemini prompt's key list (`Object.keys(EN_PACK.strings)`) then includes them automatically.

- [ ] **Step 1: Failing tests** — a pack missing only optional keys is accepted; scripted pack has all four optional keys in Kannada script; `EN_PACK.strings.keep === 'Keep'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; add `data-i18n` to the Tools chip and the three review buttons; `applyStrings` sets `<html lang>` to `pack?.lang ?? 'en'`. **Step 4: Run** → PASS; browser: add Kannada → Tools chip and review buttons show Kannada.
- [ ] **Step 5: Commit** `Kannada: Tools and review buttons switch language, html lang follows.`

## Finish

- [ ] Full `npx tsc --noEmit` + `npx vitest run` (baseline only), `npm run build`, push `sim-main`, deploy preview channel `sim-main`, update `docs/HANDOFF-NOTES.md` with what changed and the live-check list.
