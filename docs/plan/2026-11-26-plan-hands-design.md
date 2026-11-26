# Plan hands — editing the floor plan with a hand (design)

Date: 26 Nov 2026 · Branch `plan-hands` (from `sim-main`) · Asked by Akash: "for the plan we need to be able to make changes to drawings with our hands — that's the whole point."

## Why
The floor-plan board has twelve tools but only a mouse could use them in the live pipeline: the fist pipeline moved the board or panned the canvas, and the older pinch surface API is not wired from camera frames. This adds hand editing with the shapes people already know (open palm, fist, thumbs, peace). No new shapes.

## When it is on ("hand edit")
A plan board is in hand edit when **Hands is on, the board shows the 2D plan, the board is not in tile-layout Edit, and its "Hand edit" switch is on** (the switch is a button in the plan toolbar, on by default, shown only while Hands is on). Then:
- a fist on the **drawing surface** edits the plan — it never moves the board and never pans the canvas;
- a fist on the board title still moves the board; a fist outside the board still pans; two fists still zoom the canvas;
- a banner on the plan says what the hand will do, e.g. "Drawing walls with your hand — close your fist to start, open your hand to finish", and shows the live size in large type.
Switch it off and the plan behaves as before (fist moves the board).

## Gestures
| Hand | Tool | What happens |
|---|---|---|
| Open palm + R thumbs-up 2 s (or fist tap) | any | Presses the highlighted button. Every palette tool, the Furniture flyout, Check / 3D / DXF and the hand action bar are real buttons, ≥ 56 px while Hands is on. |
| Held fist = pen down | Wall, Room, Dimension, Opening, Stairs, Measure | Fist start = first point, moving = live preview with the length in metres, opening the hand = end point. Room = diagonal → rectangle. Opening = the span along the nearest wall. Dimension = a free dimension between the two points. |
| Fist tap | Door, Window, Opening, Column, Furniture, Stairs, Text, Dimension | Places at the palm point. Doors / windows / openings snap onto the nearest wall (wide reach for a hand); Dimension tap pins a dimension to the nearest wall; Text drops a "Note" label (no keyboard needed). A held fist with these tools carries the ghost and places on release. |
| Open palm | Select | The palm highlight also snaps to plan elements (walls, rooms, doors, windows, furniture, labels, dimensions): each gets an invisible proxy button on the plan, so the same sticky highlight, crowd magnifier and name label apply. Thumbs-up / fist tap selects it. |
| Held fist | Select | Closed on or near the selected element: moves it, snapped to the 10 cm grid (at least 20 cm); doors slide along their wall; a room moves with all its walls. Anywhere else, or with nothing selected: pans the plan inside its board. |
| R thumbs-down 2 s | element selected | Remove (presses the "Remove" button; yellow badge). With nothing selected it stays Close / Reject. |
| L peace 2 s | furniture or door selected | Rotate 90° / flip the door swing (presses "Rotate" / "Flip swing"; yellow badge). Otherwise it stays Tools. |
| Peace and move | wall, room or dimension selected, hand over the plan | Resize in 10 cm steps, one step per 30 px of travel. Wall / dimension: along its direction (right / up = longer). Room: sideways = width, up / down = depth. Large readout "Bedroom: 4.10 m × 3.00 m". A still peace still fires its 2 s button. |
| L thumbs-down 2 s | any | Undo (the canvas Undo), including plan edits. |

Snapping while drawing: existing wall endpoints and midpoints first (28 px reach for a hand), then a point on an existing wall, then the 10 cm grid; the second point is held to 45° steps from the first.

## How it is built
- `src/plan/handEdit.ts` — the logic, no DOM. Works against the plan's own `ToolContext` + `ToolController` (the renderer exposes them through `handHost()`), so every change is the same validated op a mouse edit sends (`add_wall`, `add_room`, `add_dim`, `add_opening`, `move`, `move_many`, `move_opening`, `set_length`, `rotate`, `delete`, …) through `controller.applyOp`. No second state.
- One gesture = one undo step: live frames are applied so the plan follows the hand, then rolled back and re-applied as one op / batch on release (the pattern `twoHandSession.ts` already uses). A lost hand, looking away or a second fist cancels the stroke and applies nothing.
- `src/canvas/planHandSurface.ts` — the DOM side on each plan board: banner, hand action bar (Remove, Rotate, size steppers, Done), element proxies, and the `handEdit` half of the board's `HandSurface`.
- `handPointer.ts` — a new grab kind `surface`: a held fist that closes over an armed hand surface (and not on a control) goes to `handEdit.fistStart / fistMove / fistEnd`; a fist tap there goes to `handEdit.tap`. Decided before board move / pan, so those cannot also start.
- `palmHighlight.ts` — while the palm is over an armed drawing surface with a drawing or placing tool, only buttons right next to the palm can take the highlight, so a fist tap places the door instead of pressing a far button.
- `gestureBindings.ts` — a binding may name contextual buttons (`when`) that take the gesture while they are visible: Remove for R thumbs-down, Rotate for L peace. The badge moves to them.
- `planPeace.ts` — peace-and-move stepper for resize. It follows the scroll builder's contract (arm on a peace, start after ≥ 40 px inside 500 ms, 30 px per step, that hand's peace hold is suppressed until the shape changes). The size steppers are also exposed as `data-level` controls with `[data-level-inc]` / `[data-level-dec]`, so the shared level adjust works on them once it lands. **For the merge:** a peace hand that `planPeace` has claimed must not also scroll.

## Undo and history
Plan edits (hand or mouse) now land in the canvas history as `kind: 'plan'` entries ("Drew a wall 3.00 m · You"), so the one Undo (button, voice, L thumbs-down) takes back the last plan edit by sending the plan engine its own `undo` op the right number of times. Mouse edits create no proposals or self-checks today, so hand edits create none either.

## Round 2 (26 Nov, after the first review)
- **Size for a hand.** With Hands on, focusing a floor-plan board grows it to the free screen, and hand edit holds the plan between 60 and 80 px per metre (a 120–240 px stroke is 2–3 m). A "1 m" bar shows the scale. The view no longer re-frames after each edit while hand edit is on.
- **Two fists on the plan** zoom and pan the plan itself. Both fists must close on the plan surface; otherwise two fists zoom the canvas as before.
- **Banner** moved into the plan's toolbar row so it never covers the drawing. The mouse hint pill is hidden while it shows; a problem message for the hand ("Draw a wall first…") takes the banner line for about 3 s.
- **Scroll / level merge.** `planPeace.taken(side)` (armed or resizing) keeps the scroll gesture off that hand; `claimed(side)` keeps the 2 s hold off it. Peace-and-move over the size steppers goes through the shared `levelControl.adjustLevel`.
- **Board buttons** for hands on the focused board's header: Smaller, Bigger, Close board (Close is one Undo away).

## Round 3 (26 Nov)
- **The drawing is stored with the board.** After each plan edit (and each plan Undo) the plan document, without its selection, is written onto the board's plan tile as `doc`, so it rides the existing canvas document: reload, a board re-render, and Close + Undo keep the drawing. It never travels in the A2UI message; `planDocs.ts` hands it to the plan board when it mounts.
- **Re-frame after an edit.** If what a hand edit drew, moved or resized ends up outside the visible drawing area, the view pans to it (and zooms out first if it cannot fit).
- **Hands growth is display-only.** A focused plan board is shown at the free screen size while Hands is on (the same display-only fit the canvas already uses to narrow a focused board); its stored size is untouched, so it goes back when Hands goes off.

## Round 4 (26 Nov, review fixes)
- **Privacy.** The drawing is no longer on the plan tile. It lives in the canvas document under `drawings` (frame id → plan board id → plan doc), beside `surfaces`. A surface plan — the thing model prompts, morph edits, board transfers and the relay serialize — has no field for a drawing, so nothing drawn can reach the cloud through them, and a model or a relayed board cannot supply one. A drawing follows its plan board id across AI and morph edits of the board. This supersedes "stored on the tile" in round 3.
- **Restore is checked element by element** (`sanitizePlanDoc`): malformed elements, dangling wall references and duplicate ids are dropped. The plan engine moves its id counter past every restored id, so a wall drawn after a reload never reuses one.
- **Close before remove.** R thumbs-down closes whatever is open (Tools, a menu, a dialog, the AI drawer) before it can mean Remove. L peace stays Tools while Tools is open.
- **Aimed moves.** Only the selected element moves, and only when the fist closes on or within 56 px of it; anywhere else the fist pans the plan. A move under 20 cm is dropped.
- **Real strokes only.** A drawing stroke needs 40 px of travel; a wall needs 30 cm. A fist held still draws nothing and the banner says why. Fist taps still place.
- **Looking away** when the hand opens cancels the stroke.
- Smaller / Bigger are in Undo. An Undo first closes any plan edit still inside its 350 ms grouping window, so it takes back one edit. The boards' hand UI refreshes at about 10 Hz. The user's own plan zoom survives hand edit going off and on.

## Round 5 (26 Nov, re-review)
- **Rendering never deletes a drawing.** An AI rebuild or a morph can drop or rename the plan tile and then be undone, rolled back by the self-check, or fail to render after Approve; the drawing stays in memory and is handed back when the tile returns. Orphaned drawings are only left out when the canvas document is written.
- With more than one element selected a fist pans the plan and the banner says "Select one item to move it."
- Merged the pair-grace work: Remove (R thumbs-down) and Rotate (L peace) wait under the pair grace like any one-hand hold.

## 3D view by hand (26 Nov, "I am unable to rotate the 3D plan with my hand")
**Root cause.** The 3D orbit hung off hand edit's own gate: the board had to be the focused one (an unfocused board's body is `inert`) and the Hand edit switch had to be on, and the hand pointer found the surface only through `elementFromPoint`, which skips an inert body (the hit is the board frame). So after "show 3D" from the overview, any zoom (a zoom drops focus, two fists included), or with Hand edit off, a held fist on the 3D view was decided as a **board move** — while the banner still said "hold a fist and move to turn the model". Over the model the palm highlight also snapped to far buttons (the DXF chip), so a quick fist clicked them.

**Now**, whenever Hands is on and a plan board shows 3D (not in tile-layout Edit; focused or not; Hand edit on or off — nothing is edited in 3D):
| Hand | What happens |
|---|---|
| Held fist + move | Orbit. Sideways = yaw, up / down = pitch. Pitch is clamped to 0.08–1.45 rad above the floor (never under it, never over the top); the mouse (OrbitControls) uses the same limits. The view eases towards the hand (`easeTurn`, 35 % per frame), so a jittery camera hand turns smoothly. |
| Two fists | Spread = closer, together = farther (both fists must close on the 3D view; otherwise the canvas zooms, as in 2D). |
| Peace and move | **Zoom** (picked over tilt, which the fist already does): up = closer, down = farther, one doubling per 240 px. Same arm / start / claim contract as the 2D resize, so it never scrolls. |
| Open palm | Highlights the 3D buttons (Turn left / right, From above / From the side, Closer, Farther — real ≥ 56 px buttons in the view's top row). Over the model only a button right next to the palm can take the highlight, so a fist there never clicks a far chip. |
| Opening the hand | Stops (the last bit of easing finishes). A lost hand or looking away stops **at once** (the pending easing is dropped). |

A fist on the 3D view never moves the board or pans the canvas; a fist on the board title still moves the board. The banner reads "Hold a fist and move to turn the 3D view · two fists or peace up / down: closer, farther" ("Turning the 3D view — open your hand to stop" while turning); the 2D palette, properties panel and hint pill step aside while 3D shows with Hands on. A mouse drag on the focused board's 3D view orbits it (on an overview board a mouse drag still pans the canvas, like any board there).

Built: `src/plan/orbitHands.ts` (the gesture → camera logic, no DOM), `orbit3d.ts` (`easeTurn`, `ELEVATION`), `extrude3d.ts` (eased `turn`, `stopTurn`, `cameraAngles`), `handPointer.armedSurfaceAt` (the hit-test, then the surfaces' rects — an inert board's 3D view is found by its rect and its own `armed(x, y)`), `planHandSurface.ts` (`on3d`, the 3D bar, the hint). Tests: `tests/plan/plan3dHands.test.ts` (real pointer, synthetic frames, focused and unfocused boards), `scripts/e2e-plan-hands.mjs` (3D section; `host.__mcPlan3d()` reads the camera).

## Not in this pass
There is no walk-through by hand in 3D. Typing a label's text needs voice or a keyboard. A plan Undo entry from before a board was re-rendered cannot be undone (the canvas says so). See `2026-11-26-hands-coverage.md`.
