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
