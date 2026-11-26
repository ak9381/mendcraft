# Button gestures — design (plan 3)

Date: 26 Nov 2026 · Branch `sim-main` · Asked by Akash (26 Nov)

## Why
Mendcraft is for people with arthritis. Pointing + fist tap is one way to press a button; a held hand shape is a second, lower-effort way that needs no aiming. Clicking stays the backup, not the only path. Two hands means either hand can do it.

## What Akash asked for
- Every on-screen button has a gesture.
- A gesture must be held for **2 seconds** to fire; while it is held, that button lights up (fills toward done).
- Each button shows a **small animated hand** of its gesture so people can learn it at a glance.
- Either hand works. Example: **Approve = thumbs up**.

## Rulings (mine, to check)
1. **Gestures are per screen context, not global.** There are dozens of buttons but only ~8 hand shapes a camera can tell apart reliably. Only the buttons visible and enabled right now are bound; no two visible buttons share a gesture. Hidden buttons have none.
2. **Fixed meanings first** (same everywhere): thumbs up = Approve / Keep / Yes; thumbs down = Decline / Drop / No; open palm facing camera held still = Stop / Cancel / Close; ILoveYou (thumb+index+pinky) = Undo. Then **numbered choices** (chips, next steps, menu items) use **finger counts 1–4** (index; index+middle; three; four), numbered left to right and shown in the hand badge.
3. **Open palm moving and fist stay the cursor/click/drag.** A "held" gesture only counts when the hand is nearly still (reuses the speed guard) for the full 2 s, so normal cursor use never fires one. Fist is never a button gesture.
4. **Pointing at a device** (point-to-connect) only runs inside its own capture step, where button gestures are paused, so "1 finger" cannot collide with it.
5. **Recognition on device** with MediaPipe hand landmarks already running (finger-curl geometry we already have, plus thumb direction) — no new model download, no cloud. Facing gate applies: not facing → no gestures.
6. **Light-up**: a ring/fill that grows over 2 s on the target button plus the hand badge pulsing; releasing early cancels with no action; on fire, the same pressed feedback as a click (and the review/undo safety net is unchanged).
7. **Badge**: small (≈20 px) animated hand icon in the button corner, shown only while hands are on; respects `prefers-reduced-motion` (static icon). Voice and mouse users don't see clutter when hands are off.
8. **Phones**: same bindings on Android (and iPhone control layer) when the Hands pill is on.

## Done means
Unit tests for the classifier (each shape from recorded landmark fixtures, both hands, mirrored), the binder (no duplicate gestures in a context), the 2 s hold (cancel on release/motion/not facing), and an e2e that fires Approve via a scripted thumbs-up. Then a full UI/UX review pass using the installed design skills (impeccable critique/audit, web-design-guidelines, emil-design-eng, design-taste-frontend, ui-ux-pro-max) and fixes.

## Decision (26 Nov, Akash) — supersedes rulings 1–2 above
Hybrid:
- **Fixed gestures with yellow animated hand badges** on the always-on buttons (Tools, Register, Edit, Talk, Undo) and on Approve / Decline in the review. Approve = right thumbs up, Decline = right thumbs down. Held 2 s, button fills, then presses. Easy shapes only (thumbs up/down, 1 finger, peace, 3 fingers, flat palm held still; left/right distinct). No fist, no ILoveYou, no 4 fingers.
- **Everything else: open palm.** No free cursor for pressing: the palm moves a highlight that snaps to the nearest button (sticky with hysteresis; slower in crowded areas; a crowded group magnifies into a spaced row after ~0.5 s hover). The highlighted button shows its name large. Hold thumbs up 2 s to press it; thumbs down 2 s = back/cancel.
- While a review is open, thumbs up = Approve (the review is modal).
- Held fist drag for boards, pan and two-fist zoom stay as they are. Facing gate applies to all of it.

## Fixed gesture table (26 Nov, Akash: "as many fixed as possible", demo-first)
Shapes: thumbs up (TU), thumbs down (TD), 1 finger (index up), peace (index+middle), 3 fingers (index+middle+ring). L/R from MediaPipe handedness (cross-checked by hand x vs face x). An open palm is NEVER a fixed gesture (it drives the highlight). Hold 2 s, still, facing.

| Gesture | Action | Demo beat |
|---|---|---|
| R thumbs up | Approve / Yes — or press the palm-highlighted button when nothing is under review | every review |
| R thumbs down | Decline / No / Close the open dialog or menu | refusal, closing |
| R 1 finger | Next-step chip 1 | journey runs on chips |
| R peace | Next-step chip 2 | |
| R 3 fingers | Next-step chip 3 | |
| L thumbs up | Save | save the room |
| L thumbs down | Undo | rollback |
| L 1 finger | New board | |
| L peace | Tools | |
| L 3 fingers | Talk (mic) | |
| Both thumbs up | More menu (AI monitor lives there; also voice "open AI monitor" and the palm highlight) | the hybrid story |
| L thumbs up + R thumbs down (together, 2 s) | Hover to click on/off | accessibility |
| R thumbs up + L thumbs down (together, 2 s) | Read aloud on/off (button below Talk; phones too) | spoken replies |
| Both thumbs down | Simulate offline on/off | offline beat |
| Both 1 finger | Point at a device | point-to-connect |
| Both peace | Register / Re-register | opening |
| Both 3 fingers | Edit / Done on the active board | |
Badges: yellow, animated hand of the shape with an L/R/2-hand mark, on each of these buttons (and on chips 1–3), centred on the button's top-left corner so they never cover its label (26 Nov, from live screenshots). The mixed L-up + R-down badge shows both hands. L thumbs up alone (Save) and R thumbs down alone (Decline) wait while the other hand is still changing shape (400 ms grace), so forming the mixed gesture never fires them. Everything else = open-palm highlight + R thumbs up.

## AI activity vs AI monitor
Two names for two views (in-app drawer vs second-display page) confuse. Ruling: remove the "AI activity" button from the bar; the drawer still opens by itself while a model works and from the Nano/Gemini engine bar; "AI monitor" is the one named entry.

## Phones
Android (and the iPhone control layer) get the same shapes behind the Hands pill: R/L TU/TD map to Approve/Decline/Undo/Save in the phone shell; the open-palm highlight works on the phone's buttons.

## Scroll gesture (26 Nov, Akash: "we definitely need scroll")
Ruling: a peace sign that MOVES scrolls what's under the hand (board body, review list, drawer log, menus), else pans the canvas vertically — like two-finger trackpad scroll. Starts only after ≥40 px travel within 500 ms; then the peace hold (chip 2 / Tools) is cancelled for that shape. A still peace still fires its button after 2 s. Voice: "scroll up/down", "page up/down". Same on phones behind the Hands pill.

## Read aloud (26 Nov, Akash)
Replies are read aloud by default (on-device voices only). A "Read aloud: On/Off" button sits below Talk in the hand cluster (and on the phone). Fixed gesture to toggle: right thumbs up + left thumbs down held 2 s (mirror of Hover to click), with the pair grace so Approve/Undo never fire while it forms.
