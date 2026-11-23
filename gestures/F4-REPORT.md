# F4 — System / cross-cutting hand parity + robustness

Worktree: `builder-relay/sim-main-f4` (branch `f4-system`, based on `origin/sim-main`).
Every fix below: regression test named with the row ID, `npx tsc --noEmit` clean,
committed on `f4-system`, then rebased onto `origin/sim-main` and pushed to `sim-main`.

Final state: `npx vitest run` → **176 files, 2267 tests, all passing**. `tsc --noEmit` clean.

Scope note: stayed out of `src/canvas/*` (F2) and `src/plan/*` + CAD `src/main.ts` (F3).
The one `src/canvas/` file touched (`scanRegistration.ts`) was explicitly assigned by the
C068 brief and is a pure, camera-free state machine.

## Fixed — priority bugs (flipped `it.fails`/`it.skip` to passing)

| Row | Fix | Files | Commit |
|---|---|---|---|
| A1-023 | Both hands dropping out together and reappearing in a different array order swapped colour slots. Disappearing slots now **keep their handedness label**, so re-entry re-binds by handedness rather than array position. | `src/input/handLogic.ts`, `tests/gestures/a1-presence-identity.test.ts` | `c237c58` |
| C068 | A stranger's hand (right pose + handedness) drifting into frame mid palm-hold donated its signature to the registrant's capture. The **first matching frame locks the hold to that hand's signature**; later frames keep the hold ticking (a brief intrusion must not restart a 1.5s hold) but only fold in samples that match — never a stranger's. | `src/canvas/scanRegistration.ts`, `tests/gestures/registration-hand-path.test.ts` | `f1e4473` |
| C006 | The keyboard hover-dwell was a bare `setTimeout` with no cancel hook, so losing the hand mid-dwell still fired the key. Added `cancelDwell()`, called from the hand pointer's `'lost'` handler in `main.ts`. | `src/ui/onscreenKeyboard.ts`, `src/main.ts`, `tests/gestures/keyboard-hand-path.test.ts` | `7603561` |
| C009 | Dwell time was a hardcoded 600ms for every hand profile. Added `setDwellMs()` driven by the active interaction profile (assist 900 / standard 700 / precise 600), honouring a calibrated dwell when present. | `src/ui/onscreenKeyboard.ts`, `src/main.ts`, `tests/gestures/keyboard-hand-path.test.ts` | `7603561` |

Note on C068 test: the original `it.fails` body asserted `step === 'done'` right after
the *left* step (which actually advances to `'right'`, with `result()` still null), so it
was "failing" on the wrong assertion and never exercising the contamination check. The body
was rewritten to drive through to `'done'` and assert the captured left signature matches the
registrant's hand alone (distance ≈ 0) while the stranger is genuinely far outside tolerance.

## Fixed — top C-system gaps (highest user value first)

| Row | Gap | Fix | Files | Commit |
|---|---|---|---|---|
| C022 | Pinch keyboard had no caret-move keys — a mistype mid-word meant backspacing everything (`SpecialKey` had no Arrow/Home/End). | Added `ArrowLeft`/`ArrowRight`/`Home`/`End` special keys + a caret-navigation row. Pure caret moves leave the text untouched and skip the input event so text handlers don't see a phantom edit. | `src/input/keyboardLogic.ts`, `src/ui/onscreenKeyboard.ts`, `tests/gestures/keyboard-hand-path.test.ts` | `1328732` |
| C046 (+ C-ROBUST #14) | Native `title` tooltips never fired for a hand user (no mouseover), so hints a mouse user gets "for free" were invisible. | `HandHover` now reads `title → aria-label → data-tooltip` (pure, guarded `tooltipTextFor`) and emits it via an `onTooltip` callback; `main.ts` renders a small bubble anchored above the hovered control (`.hand-tooltip` CSS). | `src/ui/handHover.ts`, `src/main.ts`, `src/style.css`, `tests/handHover.test.ts` | `04b6915` |
| C018 | Keyboard dwell fired one delete per hover-enter, so clearing a field meant re-dwelling per character. | After the initial dwell, **Backspace auto-repeats every 150ms** while the hand stays over it, stopping on move-off / hand loss. Only Backspace repeats — auto-repeating letters would misfire for a shaky hand. | `src/ui/onscreenKeyboard.ts`, `tests/gestures/keyboard-hand-path.test.ts` | `6fc4444` |

## Deferred (with reason)

- **C067 (registration tremor/assist hold time)** — the fix (scaling `holdMs` by the active
  interaction profile) is correct, but `createScanFlow()` is only instantiated in
  `src/canvas/canvasApp.ts`, which is F2's area. Wiring it would collide; the scan state
  machine itself (mine) is ready to accept a profile-scaled `ScanConfig` when F2 plumbs it.
- **Gap #2 text-selection-by-drag (C023)** — needs a drag-over-text gesture writing
  `field.start/end` live; the caret plumbing is now in place (`pressKey` collapses selections,
  the component applies `start..end`), but the hand-drag gesture itself is larger than a
  small safe step. Left for a focused follow-up.
- **Gaps #3–#6 browser panel (scroll / links / back-forward / zoom), #11 fullscreen gesture,
  #13 undo/redo shortcut, #15 two independent hands** — each requires either `src/main.ts`
  CAD wiring (F3), `src/canvas/*` (F2), cross-origin iframe access (a technical wall per the
  inventory), or a new global gesture-arbitration model. All out of a small-safe-step budget
  and/or another agent's area.
- **C007 / C142 / C149 (second independent dwell/pinch cursor)** — blocked by the single
  global pinch owner in `handLogic.ts`, which `handLogic.test.ts` enforces by design;
  changing it is an architecture decision, not a small fix.

## Verification

- `npx tsc --noEmit` — clean after every commit.
- `npx vitest run` — 2267/2267 passing (final full run).
- Did not edit `GESTURE-CHECKLIST.md` (parent merges statuses).
