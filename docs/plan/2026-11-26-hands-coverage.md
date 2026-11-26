# Hands coverage — can a hand do it?

Date: 26 Nov 2026 · Branch `plan-hands` · Companion to `2026-11-26-plan-hands-design.md`

## How this was checked
- Read of the live hand pipeline (`handPointer.ts`, `palmHighlight.ts`, `gestureControl.ts`, `gestureBindings.ts`) for what each kind of control receives.
- A headless survey (Chrome, 1440 × 900 and a 412 × 915 phone) that lists every usable interactive control in these states: blank canvas, Tools open, Tools › More, review open, after the demo journey (three boards in overview), board in Edit, AI drawer open, and the phone screens `pair`, `canvas`, `dashboard`, `approval`, `gimbal`.
- `npm run e2e:gestures` (fixed gestures, highlight, real camera path) and `npm run e2e:plan-hands` (the plan editor) drive the paths marked **tested**.
- Not checked on a real camera in this pass. Everything below is from code, unit tests and synthetic frames.

## The rule that covers most of it
Any `button`, link, `role=button/tab/switch/checkbox/menuitem/option` or `summary` that is visible, enabled and on top is reachable three ways with no extra work: **open palm highlight → right thumbs-up 2 s**, **fist tap** on it (backup click), and — where it has one — its **fixed shape**. A fist held on a `[data-mc-drag-handle]` / `[data-mc-resize-handle]` drags it. Text fields, sliders and `select` are the exceptions.

## Canvas (laptop / tablet)
| Surface | Can hands do it? | How | Gap |
|---|---|---|---|
| Toolbar (New, Show all, Save, Undo, History, …) | Yes | Highlight + thumbs-up, fist tap. Save = L thumbs-up, Undo = L thumbs-down, New = L 1 finger | — |
| Tools chip and palette | Yes | L peace (when no plan element with Rotate is selected), highlight, fist tap. R thumbs-down closes it | — |
| Tools › More (Hands, Hover to click, Register again, monitor, offline, …) | Yes | Highlight + thumbs-up; monitor = both thumbs up, offline = both thumbs down, Register = both peace | — |
| Say box (text field) | Partly | Fist tap focuses it | No way to enter text by hand. Use Talk (L 3 fingers). By design |
| Hand cluster (Register, Edit / Done, Tools, Talk, Undo, Reset layout) | Yes, tested | Fixed shapes with badges; highlight | — |
| Review dialog: Approve / Reject | Yes, tested | R thumbs-up / R thumbs-down (modal: only these and Undo act) | — |
| Review dialog: move and resize | Yes | Held fist on the title bar / the corner grip | **Fixed (round 2):** the corner grip is 56 px while Hands is on |
| Review dialog: "Show the work" (`summary`), Ask for something else | Yes | Highlight + thumbs-up, fist tap (direct hit needed for confirm actions). The long list scrolls with peace-and-move (merged from sim-main) | — |
| Next-step chips | Yes, tested | R 1 finger / peace / 3 fingers; highlight | A 4th chip has no fixed shape (highlight only) |
| Board: focus | Yes | Fist tap on the title | Title was 39 px tall. **Fixed:** ≥ 48 px while Hands is on |
| Board: move | Yes, tested | Held fist on the board or its title | — |
| Board: resize | Yes | **Added (round 2):** "Smaller" / "Bigger" on the focused board's header (56 px), Hands on only | Steps of 20 %, no free resize. A focused board never shows larger than the free screen |
| Board: close / pin | Yes | "Close board" on the focused board's header; Undo brings the board back, with its drawing (round 3). The dock's Unpin and the phone's "Pin on this device" are buttons | — |
| Board Edit mode: move / resize tiles | Yes | Held fist on a tile's move or resize handle | **Fixed (round 2):** handles are 56 px while Hands is on |
| Board to a paired phone (edge transfer) | Yes | Held fist drags the board to the screen edge | — |
| Dock (pinned tile, Unpin, agent chips) | Yes | Highlight + thumbs-up, fist tap | — |
| Pairing card (code, Close, Swap sides) | Yes | Highlight; R thumbs-down closes | — |
| AI drawer: open | Yes | Engine cards, both thumbs up for the monitor | — |
| AI drawer: close, history Undo, dock chips | Yes | Highlight; R thumbs-down closes; L thumbs-down = Undo | — |
| AI drawer: move / resize a terminal | Yes | Held fist on the title bar / corner | **Fixed (round 2):** grip ≥ 44 px tall, corner 56 px while Hands is on |
| AI drawer: read the log (scroll) | Yes | Peace-and-move scroll (merged from sim-main) | Not re-tested in this branch beyond the shared suites |
| Zoom HUD (−, +, Fit) | Yes | Highlight, fist tap; two fists zoom, one fist on bare canvas pans | — |
| Monitor link | Yes | Both thumbs up; highlight | Opens a second window that has no hand control of its own |
| Lamp tile (On / Off, Dimmer, Brighter) | Yes | Highlight (shadow DOM is walked), fist tap; levels by peace-and-move where the tile exposes `data-level` | — |
| Music tile (Play / Pause, Softer, Louder, Next) | Yes | Same | — |
| Form tiles with a slider (`input[type=range]`) or `select` | Partly | Sliders step with peace-and-move (shared `adjustLevel`) | `select` has no hand path |
| Scan / register panel, teach-a-gesture panel, connect sheet | Yes | Their buttons; R thumbs-down = Cancel / Close | Teach capture itself is hand-driven already |
| Canvas: pan / zoom | Yes, tested | One fist on bare canvas; two fists | — |
| Overview (several boards zoomed out) | Yes, by design | Overview is view-only for every input (board bodies are inert): the only targets are the board titles. Fist tap a title to focus the board, then its tiles are full size | **Fixed (round 2):** titles keep ≥ 48 px on screen at any zoom while Hands is on. The brief asked for ≥ 44 px tile buttons in overview; they are not pressable there by any input, so the title is what was enlarged |

## Floor-plan editor (this branch)
| Surface | Can hands do it? | How | Gap |
|---|---|---|---|
| Palette: Select, Wall, Room, Door, Window, Opening, Dimension, Measure, Stairs, Text, Column | Yes, tested | Highlight + thumbs-up, fist tap; ≥ 64 × 56 px while Hands is on | No fixed shape per tool: all 15 shape slots are taken |
| Furniture flyout (13 components) | Yes, tested | Same; 3 columns of ≥ 56 px, not clipped | — |
| Check, 3D, DXF, Hand edit | Yes | Same; ≥ 56 px | DXF triggers a browser download |
| Draw wall / room / dimension / opening / stairs | Yes, tested | Held fist = pen down, open hand = end; live length in metres | — |
| Measure | Yes | Held fist reads a length | The reading is not kept (fist-drag with Dimension to keep one) |
| Place door / window / opening / column / furniture / stairs | Yes, tested | Fist tap; doors and windows snap to the nearest wall | — |
| Text label | Partly | Fist tap drops a "Note" label | Its text needs voice or a keyboard |
| Select an element | Yes, tested | Palm highlight snaps to element handles; thumbs-up or fist tap | On a dense plan handles shrink to 32 px; the crowd magnifier helps. Wall-pinned dimensions have no handle (select the wall) |
| Move an element | Yes, tested | Held fist that closes on or near the selected element (Select), 10 cm grid, at least 20 cm | Select it first: a fist never grabs an unselected element. A dimension cannot be moved (it follows its wall) |
| Resize wall / room / dimension / door / furniture | Yes, tested | Peace-and-move over the plan (10 cm per 30 px), or the − 10 cm / + 10 cm steppers. The steppers are `data-level` controls, so peace-and-move over them steps through the shared `adjustLevel` | — |
| Rotate furniture, flip door swing | Yes, tested | L peace 2 s, or the Rotate / Flip swing button | 90° steps only |
| Remove | Yes, tested | R thumbs-down 2 s, or Remove | If Tools, a menu, a dialog or the AI drawer is open, thumbs-down closes that first |
| Undo a plan edit | Yes, tested | L thumbs-down (canvas Undo) | No Redo on the canvas |
| Multi-select, marquee, copy / paste, duplicate | No | — | Mouse and keyboard only. The properties panel's Duplicate button is reachable |
| Properties panel (thickness, sill, height, name) | Partly | Its step buttons are ≥ 56 px while Hands is on | Number and text fields need a keyboard |
| Pan the plan inside its board | Yes | Held fist on empty floor with Select and nothing selected | — |
| Zoom / pan the plan inside its board | Yes, tested | **Added (round 2):** two fists that both close on the plan zoom and pan the plan itself (the canvas does not move). With Hands on, a focused plan board takes the free screen and the plan is held at 60–80 px per metre, with a "1 m" scale bar | A plan larger than about 14 × 6 m overflows at 60 px per metre and has to be panned or zoomed out |
| 3D view | Yes | Held fist turns the model; two fists move the camera in and out | No walk-through by hand |
| Fullscreen, Move to screen | Yes | Buttons, ≥ 56 px while Hands is on | — |
| Trash zone (drag to delete) | Not needed | Remove replaces it | — |

## Phone shells (Android, iPhone control layer; Hands pill on)
| Surface | Can hands do it? | How | Gap |
|---|---|---|---|
| Phone menu and pills (Join laptop, Hands, menu items) | Yes | Highlight + thumbs-up, fist tap (wider magnet on phones) | — |
| Approve / Reject | Yes | R thumbs-up / R thumbs-down | — |
| Undo, Save | Yes | L thumbs-down / L thumbs-up | — |
| Board chips | Yes | Highlight, fist tap | **Fixed (round 2):** chips are ≥ 44 px tall |
| Tiles (`mc-m-tile`), dock card handle | Yes | Highlight, fist tap; held fist on the handle | — |
| Say field | Partly | Fist tap focuses | Text needs Talk |
| Next-step chips, Tools, New, Talk by fixed shape | No | Highlight only | The phone table binds 4 shapes (Approve, Reject, Undo, Save) |
| Floor plan on a phone | Yes in code | Same surface, same strokes; peace-and-move resize is wired through `phoneHands` (**added**); R thumbs-down = Remove | Not run on a phone. No L peace = Rotate on phones (use the Rotate button) |
| Pair, gimbal screens | Yes | One or two large buttons each | — |

## Fixed in this pass
1. The whole plan editor (was mouse-only in the live pipeline).
2. Plan edits now reach the canvas history, so Undo covers them.
3. 3D view turns with a held fist; two fists move the camera.
4. Plan palette, flyout, toolbar, fullscreen and panel buttons ≥ 56 px while Hands is on.
5. Board titles ≥ 48 px on screen at any zoom while Hands is on.
6. Peace-and-move resize on the phone shell.
7. Round 2: a focused plan board fills the free screen and shows at 60–80 px per metre with a scale bar; two fists on the plan zoom the plan.
8. Round 2: "Smaller", "Bigger" and "Close board" (undoable) on the focused board's header.
9. Round 2: review corner grip, tile handles and terminal corner 56 px while Hands is on; phone board chips ≥ 44 px.
10. Round 2: merged the peace-and-move scroll and level gesture; a peace the plan resize has taken never scrolls.

## Left open
1. **Text entry** (say box, labels, number fields) — voice only.
2. **`select` controls** in generated form tiles.
3. **Multi-select / marquee / copy-paste** on the plan.
4. **Plan Undo across a re-render**: the drawing is now stored with the board (round 3), but a plan Undo entry made before the board was re-rendered or reloaded cannot be taken back.
5. **Drawings stay on this device**: a board sent to a paired phone or relayed arrives with its plan template, not what was drawn (by design: drawings are kept out of everything that is sent).
6. **Phone**: fixed shapes for chips / Tools / Talk / Rotate; nothing here was run on a device.
7. **Monitor window** — no hand control of its own.
8. **Real camera**: every result here is from synthetic frames.
