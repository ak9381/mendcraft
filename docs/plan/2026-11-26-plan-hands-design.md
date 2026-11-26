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
| Held fist | Select | Moves the selected element (or the one under the palm), snapped to the 10 cm grid; doors slide along their wall; a room moves with all its walls. Nothing selected and nothing under the palm = pan the plan inside its board. |
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

## Not in this pass
In the 3D view a held fist turns the model and two fists move the camera; there is no walk-through by hand. Typing a label's text needs voice or a keyboard. Plan drawing edits are not stored with the board. See `2026-11-26-hands-coverage.md`.
