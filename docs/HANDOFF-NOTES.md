# Handoff notes (Mac, from 24 Nov 2026)

Running log on top of `HANDOVER.md`. Newest first. Branch: `sim-main` only — never `main`, never production.

## Setup state

- Mac: `~/Developer/mendcraft-sim` on `sim-main`. `.env.local` present (values never read here).
- Firebase CLI logged in on this Mac (`~/.config` ownership fixed). Preview deploy: `npm run build && npx firebase-tools hosting:channel:deploy sim-main --project mendcraft` → https://mendcraft--sim-main-o8jrlskh.web.app (expires 4 Dec 2026).
- Deploy warns "Unable to add channel domain to Firebase Auth" — preview domain is not an authorized domain yet (console step, not done).
- Tests: 2722 pass; 2 fail only because `goldenTrace8319f68` / `poseStabilityReplay` read trace JSON from the old Linux box path `/workspace/hackathon/firebase-hybrid/e2e-review-2x/live/`.
- iPhone: iPhone 16 Pro Max paired (UDID `00008140-00183466020B001C`). `ios/App` generated locally (untracked; `ios/debug.xcconfig` must stay uncommitted).
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
