# Handoff notes (Mac, from 24 Nov 2026)

Running log on top of `HANDOVER.md`. Newest first. Branch: `sim-main` only — never `main`, never production.

## Setup state

- Mac: `~/Developer/mendcraft-sim` on `sim-main`. `.env.local` present (values never read here).
- Firebase CLI logged in on this Mac (`~/.config` ownership fixed). Preview deploy: `npm run build && npx firebase-tools hosting:channel:deploy sim-main --project mendcraft` → https://mendcraft--sim-main-o8jrlskh.web.app (expires 4 Dec 2026).
- Deploy warns "Unable to add channel domain to Firebase Auth" — preview domain is not an authorized domain yet (console step, not done).
- Tests: 2722 pass; 2 fail only because `goldenTrace8319f68` / `poseStabilityReplay` read trace JSON from the old Linux box path `/workspace/hackathon/firebase-hybrid/e2e-review-2x/live/`.
- iPhone: iPhone 16 Pro Max paired (UDID `<iPhone UDID: xcrun devicectl list devices>`). `ios/App` generated locally (untracked; `ios/debug.xcconfig` must stay uncommitted).
- Android: SDK at `~/Library/Android/sdk` (platform 36, build-tools 36.0.0). Build with JDK 21: `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew assembleDebug` in `android/` after `npm run build && npx cap sync android`. Debug APK id is `app.mendcraft.relay.sim`. `minSdkVersion` raised 24 → 26 (ML Kit genai-prompt requires it). Not yet installed on the Nothing 3a (no device connected).

## Mouse click-through (24 Nov, `?fresh=1&sim=1&hands=0`, 1470×745 MacBook Air)

Works: connect → Draft → Approve → Better → Approve; tile buttons (on/off, dimmer, brighter); Save pins to dock; Floor plan → Approve → CAD board; Add Kannada → Approve; Undo; Simulate offline → queued → back online → replays; Reject; Teach a gesture → Approve; Custom gestures panel; Edit → Done; Register (scripted); Swap sides.

Fixed in the first click-pass commit: 1, 2 (button removed), 3, 5, 6, review footer text after Kannada keep/drop.

Broken / wrong (as found):

1. Stale pinch copy: empty state "or pinch Tools"; AI activity intro "Pinch clicks, two-finger scrolls…"; review status "Pinch or say keep; brush or say drop"; CAD edit hint "pinch-hold adds"; Tools → **Calibrate pinch** (dead feature).
2. Calibrate pinch turns the camera on even with `?hands=0`, Esc doesn't cancel it, "Pinch twice…" pill sticks.
3. Right-side chip column (Register / Edit / Tools / Talk) sits on top of the review window, the board's right edge and edit handles, and above modal backdrops.
4. Kannada pack only swaps hidden empty-state + Tools palette labels; visible tiles and right chips stay English, `<html lang>` stays `en`; activity footer stays "English until you keep it" after approval.
5. New board is placed behind the AI activity panel (not visible).
6. Pinned dock overlaps board titles (e.g. "…rd 2").
7. Edit → Done leaves the CAD board narrower and the "Wall w3" popover open.
8. Offline "1 request queued" badge overlaps the Nano terminal header.
9. Many icon buttons have no accessible name (activity chips, terminal controls).
10. `?fresh=1` keeps the Registered state.

Still open from the click pass: 4 (Kannada only swaps palette/empty-state labels), 7 (CAD inspector clipped on the narrower board), 8, 9, 10; "AI activity" button does nothing (panel is always open by design).

## Direction from Akash (24 Nov, evening)

- Demo has to feel "wow"; UI feels crowded; show **both** Nano and Gemini clearly.
- Hand control (cursor movement + selection) is currently worse than mouse/keyboard — it should help, not hinder.
- Vision: a smart canvas you can work on and make anything.

## iPhone first run (24 Nov, Akash)

App launches, canvas shows, badge reads "Apple · on device". Blocker: touch is locked behind "Look at me to edit" and never unlocks (front camera on, face check never passes), so nothing can be tapped or swiped. Next: make touch work by default; look-to-edit only as an opt-in, and never lock on a failed/unknown face signal.

## Live hand check (stream B: palm cursor, fist tap, fist grab)

Sim tests use synthetic landmarks; none of this is proven until tried on the Mac camera. Hands on, `?sim=1` (no `hands=0`):

1. **Point** — open hand: the cursor follows the palm, not the fingertip; curling fingers or closing a fist barely moves it. Every edge (top toolbar, right cluster, bottom) is reachable without the hand leaving the camera; overshooting the top bar (fingertips leaving the frame) does not freeze or jump the cursor.
2. **Fist tap = click** — rest the open hand on a small toolbar button (~0.2 s), then close and open the fist quickly (about 0.1–0.3 s): it clicks once. A relaxed hand drifting or half-closing must NOT click; neither should a fist made while still sweeping in. Try a button 30–40 px off (magnet). Two quick taps under 0.4 s apart click once. Approve / Reject only click on a direct hit. A tap on a board body, bare canvas or a dialog's dimmed backdrop does nothing; a tap on a board title focuses it.
3. **Fist-move a board across the right cluster** — hold a fist on a board (body or title) for ~0.3 s (or start moving it): it grabs. Drag it over the right-side buttons/chips and to the screen edge: no hover outline, no clicks, the grab never drops; a loose fist that flickers open for a frame keeps it. Opening the hand (~0.15 s) drops it; the position survives a reload.
4. **Fist on chrome** — a fist held over a button, the review dialog, the dock or the engine bar does nothing (no board under it moves, no pan).
5. **Fist-pan** — a held fist on bare canvas pans 1:1; in focus mode a fist on the focused board pans.
6. **Two-fist zoom** — two held fists spread/close to zoom about their midpoint; opening one stops it and the other fist does not start panning.
7. **Both hands** — repeat 2, 3 and 5 with the LEFT hand only, then the RIGHT only (must feel identical); then point with one while the other makes a fist.
8. **Hover to click (opt-in)** — Tools → "Hover to click": resting the palm on a button fills the ring and clicks at ~0.8 s; easing from Reject to Approve never fires Reject. Toggle it off: no ring, the hover outline stays.
9. **Pinch** does nothing anywhere (no keep, no pan, no zoom, no click).
10. **Camera edge** — at the frame edge the cursor holds and nothing clicks; coming back in eases with no jump; a board being dragged stays grabbed.
11. **First-try tap** (25 Nov fix) — a natural quick fist, thumb in or out, clicks on the FIRST try from a resting open hand. A relaxed, half-curled hand never clicks.
12. **Glass hand on the cursor** — the drawn hand's palm sits on the coral cursor (no below-left offset), for both hands.
13. **Facing gate** — turn your head away (pill says "Not facing"): within ~0.3 s the cursor dims, "Look at the screen to use hands" shows, and taps / grabs / pan / zoom do nothing; a board being dragged is dropped where it is. Look back: hands work at once. With no face in view (pill hidden), hands still work.
14. **Facing pill + face chip** — readable from the chair (large pill, ~200×150 chip, bottom-right), not covering the engine bar or the cluster.

## Overnight status (25 Nov, early morning)

Merged to sim-main (all reviewed): pan/zoom + HUD + title drag; calmer screen + Nano/Gemini engine bar; Kannada visible; hands rewrite (palm cursor, finger-geometry fist tap, fist grab/pan, two-fist zoom, facing gate with looser down-look, overlay on cursor, bigger Facing pill); review window as a plan (resizable, per-turn honest footer); AI monitor "two minds, one boundary" with device tabs + colour-coded activity stream; phones' AI activity relayed to the monitor; in-app "Join laptop" chime pairing; point-to-connect; try-to-break-it refusal; board → phone edge send; next-step chips + single routing table; on-screen keyboard removed; judge replay `?replay=demo` + `npm run e2e` (18 steps, ~80 s, passing).
In review: hands on the phones (Hands pill, one shared front camera).
Blocked on Akash: Firebase CLI re-login (`npx firebase-tools login --reauth`) before the next preview deploy; iPhone + Nothing phone plugged in for installs; live hand re-test; real-device run-through (checklist P/S).
Known flaky under heavy load (pass alone): selfCheckLatency, speculative, surfacePlanNested, phoneLookToEdit, gitignore.secrets. Known missing-fixture failures: goldenTrace8319f68, poseStabilityReplay.

## Note: iPhone sensor mode as a connect-devices demo moment
The iPhone (on the gimbal) runs sensor-only hand/face tracking — no UI control. It appears in the connect-devices flow: paired row → "Gimbal tracking ready / Tracking you" → "Point at a device" chip → photo from the iPhone camera → identify → lamp tile review. See docs/plan/2026-11-25-demo-build-design.md (Note, 25 Nov night) and TEST-CHECKLIST section G.

## Status at end of overnight run (25 Nov)

All planned work is merged to sim-main and pushed (reviews passed; final whole-branch review fixes merged; gimbal DockKit follow + iPhone sensing/control layers merged). 3368 tests pass (only goldenTrace8319f68 / poseStabilityReplay fail: fixtures missing). `npm run e2e` (18-step journey) passes in ~80 s.
Android: latest debug APK built and installed on the Nothing phone (app.mendcraft.relay.sim).
iPhone: not installed since the last unplug; ios/App/App Swift files already synced from ios-src and verified clean; install steps are in docs/TEST-CHECKLIST.md 0.2 (copy → grep → build → install).
Preview: NOT redeployed since the Firebase login expired — run `npx firebase-tools login --reauth`, then `npm run build && npx firebase-tools hosting:channel:deploy sim-main --project mendcraft`.
Known limitations (parked): Track pill needs two taps to retry after a camera error; no pointResult sent if sensing is stopped mid-point; set-orientation awaits have no timeout; teach-with-model not wired to engines; one old tracked file docs/superpowers/plans/2026-11-20-rich-a2ui-layouts.md still begins with an assistant-style header (blocked by the local pre-push guard; ask before scrubbing).
Unverified without devices: DockKit face follow with the WebView camera, hand-follow axis signs, iPhone-camera pointing at the lamp/Marshall, Spotify on the Marshall, WiZ lamp, chime pairing inside the apps, phone hand fps. See TEST-CHECKLIST sections 0, E, G, P, S.
