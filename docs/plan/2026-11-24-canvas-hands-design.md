# Canvas navigation, hands, and a calmer screen — design

Date: 24 Nov 2026 · Branch: `sim-main` · Deadline: 1 Dec 2026, 3:30 AM IST

## Why

Akash, after a live session: the UI is liked, but the screen feels crowded, Nano and Gemini aren't both clearly visible, and hand control (moving the cursor, selecting) is worse than mouse + keyboard — it gets in the way. The vision is a smart canvas you can work on and make anything with, and the demo has to feel "wow". He also wants proper zoom in/out and board moving, built on proven open-source behaviour so it can be reused in other apps.

## Goals

1. Canvas navigation that feels like Figma/tldraw: trackpad two-finger pan, pinch-zoom, mouse-wheel pan, Cmd/Ctrl+wheel zoom, Space+drag, keyboard zoom steps, zoom-to-fit, a visible zoom HUD, and dragging a board by its title with a mouse.
2. Hands that help: a steady cursor, forgiving selection, and the same verbs as the mouse (point, select, move a board, pan, zoom).
3. A calmer screen where Nano (on device) and Gemini (cloud) are both always visible, and the AI detail appears only while a model is working.
4. Kannada switch visibly changes what's on screen.

## Non-goals

- No new pan/zoom dependency (see Approaches). No React.
- No relative/joystick cursor or Gesture Recognizer model swap (good ideas, not in 6 days).
- Pinch stays out. No minimap.
- No changes to the AI routing (Nano → Gemini → rules), App Check, or Relay protocol.

## Anti-goals (failure even if it "works")

- Hands that need more precision or effort than before.
- A gesture firing by accident (Midas touch) — e.g. clicking while just moving, or a fist moving a board by accident.
- Hiding Gemini or Nano, or showing fabricated byte counts.
- Breaking the `?sim=1` judge path, the phone shell, or mouse-only use.

## Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| Adopt a pan/zoom library (anvaka/panzoom MIT, @panzoom/panzoom MIT, d3-zoom ISC) | Small and proven, but each owns its own transform state; hands, voice, `flyTo` and the HUD would fight it. anvaka/panzoom zooms on every wheel (no trackpad pan). | Rejected |
| Keep our ~60-line camera (`src/canvas/camera.ts`) and copy tldraw/Excalidraw behaviour (Excalidraw MIT helpers as reference; tldraw behaviour only, its licence needs a key) | One source of truth for mouse, touch, hands, voice; reusable as a tiny standalone module. | **Picked** |
| Rebuild hands on MediaPipe Gesture Recognizer + relative cursor (Gameface-style) | Best long-term, but a model swap + clutch UX is too much risk before 1 Dec. | Later |

Hands: research (Bowman "Heisenberg effect", Ultraleap TouchFree guidelines, Majaranta & Räihä dwell, Grossman bubble cursor, Jacob's Midas touch) points at four fixes we can make in the existing pipeline: palm-anchored cursor, an active box, target-locked dwell, and magnetic targets.

## Design

### 1. Camera (`camera.ts`, `canvasApp.ts`, new `zoomHud.ts`, new `canvasKeys`)

- Wheel: `ctrlKey || metaKey` → zoom about the pointer, `z *= exp(-deltaY * 0.01)` (macOS trackpad pinch arrives as ctrl+wheel). Otherwise pan by `(deltaX, deltaY)`; Shift+wheel pans horizontally. Safari `gesturestart/gesturechange` → zoom.
- Zoom range 0.1–2 (`MAX_Z` 1 → 2). If the CAD floor plan misbehaves above 1:1 while focused, focused CAD boards cap at 1 (builder verifies in the browser).
- Keys (ignored while typing in an input): Cmd/Ctrl `=`/`+` zoom in, `-` zoom out (step list 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2 about the viewport centre), Cmd/Ctrl `0` → 100%, Shift+1 → fit all (existing `overview`), Space+drag → pan.
- Zoom HUD bottom-left: `−  [ 87% ]  +  Fit`, ≥52px targets so they're dwell- and voice-reachable; clicking the % resets to 100%. Voice/typed: "zoom in", "zoom out", "fit"/"show everything", "100%".
- Mouse board move: drag a board's title bar (`.mc-frame-title`) past 5px → move the board (`reg.setRect`, persist on release); a click without movement still focuses it.
- Camera helpers stay pure functions (no DOM) so `camera.ts` can be copied into other apps.

### 2. Hands (`handFeel.ts`, `handPointer.ts`, `canvasHands.ts`, hand wiring in `canvasApp.ts`)

Gesture set (four, all handedness-agnostic, tracked by slot not MediaPipe label):

1. **Point** — open hand. Cursor anchored to the palm centroid (mean of landmarks 0, 5, 9, 17), not the index tip, so curling a finger or closing a fist doesn't move it. Active box: centred ~60% × 55% of the frame mapped to the full screen (mirrored, clamped). One-Euro retuned (≈ minCutoff 1.0, beta 0.01 in screen px; builder tunes against recorded traces) + 3px dead zone when slow.
2. **Select** — target-locked dwell, **800 ms** (was 1.5 s). Once a target captures the cursor, the ring keeps filling while the cursor stays within the target's rect plus a margin; leaving resets. Magnetic snap: capture within 40px, release beyond 60px. After a click, 600 ms cooldown and the cursor must leave the target to re-arm. Dwell only on interactive targets and boards, never empty canvas. Off while a grab is active.
3. **Grab** — one fist (held ≥150 ms). Over a board's title or body: move that board. Over empty canvas: pan the world 1:1 ("grab the world"). Opening the hand releases. Palm anchoring means closing the fist doesn't jump.
4. **Zoom** — two fists: distance ratio sets zoom (`z0 · d/d0`, clamped), midpoint is the zoom focus and pans. Replaces two-fist board move (one fist now moves boards).

Removed from the live path: pinch-driven `handleTwoHand` zoom, `handleHandPan`, pinch → `keep`, thumbs-up keep, palm-swipe drop. (Dead pinch code may stay in files; only the wiring goes.)

### 3. Calmer screen + both engines visible (`modelPanels.ts`, `activityLog.ts`, `canvas.css`, new `engineBar.ts`)

- New **engine bar**, bottom-centre, always visible on desktop: two cards side by side —
  `● Nano · on this device · <state>` and `● Gemini · cloud · <state>`, plus the running "N B sent to cloud" total from the existing ledger (real numbers only). Each card pulses while its engine works and shows the last line (e.g. "redacted name", "handed off → Gemini"). The handoff animates an arrow between the cards. The phones strip moves into this bar (or above it) so there is one bottom element.
- The AI panel (`.mc-ai`) is no longer always open: it opens automatically while a model is working or a review is pending, and collapses ~3 s after the turn ends (`AI_PANEL_ALWAYS_OPEN = false`). Clicking either engine card opens it. When collapsed, boards get the full width.
- Right hand cluster: smaller (120×52, 24px gaps), still vertically centred, still hand-reachable.
- Face preview + "Facing this device" pill: shrink to a small corner chip (top-right) instead of top-centre.

### 4. Kannada visibly switches

`LANG_STRING_KEYS` gains optional keys `tools`, `approve`, `reject`, `askElse` (optional = not required by the completeness check, so a live Gemini pack without them still validates); the scripted pack includes them; the Tools chip and review buttons get `data-i18n`; `<html lang>` follows the pack.

## Constraints

- Existing tests pin old numbers (dwell 1500, reach box .15/.85, cluster 140×60, AI panel always open — see `tests/canvas/handPointerPipeline`, `handFeel`, `handPointer`, `viewportLayout`, `talkReachable`, `activityLog`, `modelPanels`, `camera`). Update them to the new spec; don't delete coverage.
- Synthetic tests can't catch live camera problems; every hand change gets a live check on Akash's Mac before it's called done.
- `?sim=1&hands=0` must stay camera-free.
- Commit to `sim-main` only, plain commit messages, no AI attribution.

## Left to the builder

Exact One-Euro numbers, active-box size, CSS sizes/colours of the engine bar within the existing palette, and whether the phones strip sits inside or above the engine bar.
