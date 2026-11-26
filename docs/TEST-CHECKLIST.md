# Akash's test checklist (morning, 25 Nov)

Preview (after the Firebase re-login below): https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1&sim=1
AI monitor: https://mendcraft--sim-main-o8jrlskh.web.app/monitor.html (keys 1/2/3 = Laptop/iPhone/Android, F = Follow)
Judge replay: https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?replay=demo
Local (always latest): http://localhost:5173/canvas.html?fresh=1&sim=1

Note anything off with its number.

## 0. Before anything (2 min)
- [ ] 0.1 Firebase login expired overnight — run in Terminal: `cd ~/Developer/mendcraft-sim && npx firebase-tools login --reauth`. Then redeploy the preview: `npm run build && npx firebase-tools hosting:channel:deploy sim-main --project mendcraft`.
- [ ] 0.2 Plug in the iPhone (unlocked) and install the latest build — IN THIS ORDER (the app builds from the untracked ios/App, so the new Swift must be copied in first):
  ```
  cd ~/Developer/mendcraft-sim && git pull --ff-only origin sim-main && npm run build && npx cap sync ios && cp ios-src/*.swift ios/App/App/
  grep -c requestSystemTrackingOff ios/App/App/*.swift          # every line must be :0
  for f in ios-src/*.swift; do cmp -s "$f" "ios/App/App/${f##*/}" || echo "STALE ${f##*/}"; done   # must print nothing
  xcrun devicectl list devices                                   # copy the iPhone's Identifier (UDID)
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination generic/platform=iOS -derivedDataPath ~/mendcraft-live/dd -allowProvisioningUpdates build
  xcrun devicectl device install app --device <UDID> ~/mendcraft-live/dd/Build/Products/Debug-iphoneos/App.app
  xcrun devicectl device process launch --terminate-existing --device <UDID> app.mendcraft.relay
  ```
  (If install says "Connection interrupted", just rerun the install line.)
- [ ] 0.3 Plug in the Nothing phone (the cable that worked, USB debugging allowed) → install the latest build (`npx cap sync android && cd android && ./gradlew assembleDebug`, then `adb install -r app/build/outputs/apk/debug/app-debug.apk`).

## E. Hands on the laptop (most important — 5 min)
- [ ] E1 Open palm: the glass hand sits ON the cursor; curling fingers doesn't jump it.
- [ ] E2 Quick fist tap (close + open, thumb anywhere) on Tools clicks on the FIRST try. A relaxed or half-curled hand never clicks.
- [ ] E3 Hold a fist on a board (title or body) and move: it follows; drag across the right buttons — no clicks, no drop. Open hand → drops.
- [ ] E4 Fist on empty canvas pans; two fists zoom.
- [ ] E5 Look clearly away (turn your head): "Not facing" shows and hands stop (cursor dims, hint). Look back: works immediately.
- [ ] E6 Look DOWN at the keyboard and at your hands: hands must NOT lock.
- [ ] E7 Raise a hand in front of your face mid-drag, lower it: the board must not drop.
- [ ] E8 Repeat E2–E4 with the LEFT hand only, then RIGHT only.
- [ ] E9 Hold a fist still for 3 s and wiggle it: no click.
- [ ] E10 Point your index straight at the camera: must not count as a fist.
- [ ] E11 Scroll (scroll-wheel style): with a long list on screen (review plan, AI drawer log, a full board), make a PEACE sign (index + middle up) over it and move your hand clearly DOWN (about a hand's length): the list scrolls DOWN (shows what is below); hand up = scroll up. A small "Scrolling down/up" hint sits by the hand and the list gets a dashed yellow outline. Areas that overflow show a yellow "move down to scroll" hint while Hands is on.
- [ ] E12 Scroll vs hold: a peace that MOVES deliberately never fires its button (right peace = next step 2, left peace = Tools), even if you then hold it still. A peace held still — or trembling / drifting a little — for 2 s still fires it and never scrolls. Drop the hand mid-scroll: it stops at once (no glide). Look away: no scroll. Make a fist mid-glide: the glide stops.
- [ ] E13 Peace over empty canvas and move down: the canvas scrolls down (content moves up). Either hand works. Right hand scrolls, then add a left peace and hold both still: Register (never Tools).
- [ ] E14 Levels: peace over a volume / brightness / colour-temperature control (or a slider): a deliberate move up starts it, then every ~30 px up is one step up (at most ~6 steps a second) with a big "Volume 80 %" readout by the hand; small wobbles at a step never flip it back and forth (watch the real WiZ lamp: no flicker of commands). It never scrolls the page or fires Tools/chip 2.
- [ ] E16 Badges sit at each button's top-left corner (hand + L/R/L+R tag) and never cover a label — check Save, New board, AI monitor, Re-register, More.
- [ ] E17 Both thumbs up 2 s: the More menu opens (with Tools). Inside it, AI monitor is reachable by the palm highlight + right thumbs up, or say "open AI monitor".
- [ ] E18 Left thumbs up + right thumbs down together for 2 s: Hover to click toggles. Raise the left thumb first and then the right: Save never fires on the way; L thumbs up alone (other hand down or resting) still Saves, R thumbs down alone still Declines.
- [ ] E20 Read aloud: on a fresh profile replies are read aloud and the button below Talk says "Read aloud: On" (≥56 px, with a two-hand badge). Tap it: "Read aloud: Off", and any reply being spoken stops at once; More → Voice → "Read replies aloud" shows the same state (and vice versa). Reload: her choice is kept. On the phone the button sits above the Join pill, clear of the mic.
- [ ] E21 Right thumbs up + left thumbs down together for 2 s toggles Read aloud. Raise the right thumb first, then the left: Approve (or the highlighted button) never fires on the way; left thumb down first: Undo never fires on the way.
- [ ] E19 Open More (and on a phone, the menu sheet) with the camera preview showing: the menu is on top; the preview and "Facing this device" pill step aside while it is open and come back when it closes. Check at 1440×900 and 1280×800.
- [ ] E15 Voice: "scroll down", "scroll up", "page down", "page up" move the open review / drawer / focused board (else the canvas).

## R. Review window (the "plan")
- [ ] R1 "connect everything in this room" → the review shows THE PLAN (+ add / ~ change / − remove), engine chip, "What left this device · N KB".
- [ ] R2 Resize from the bottom-right corner (mouse, or held fist); size is remembered.
- [ ] R3 "add kannada" → its footer shows ~385 B (its own turn), not the dashboard's 2.3 KB.

## M. AI monitor (ultrawide)
- [ ] M1 Tools → AI monitor; drag to the ultrawide, full-screen.
- [ ] M2 "connect everything in this room": packet crosses with the real size; stream lines coloured (Heard white, Handed off amber, Sent blue, Kept on device green).
- [ ] M3 "set the main light to 500% brightness": red Blocked, "Decided on this device · 0 B sent".
- [ ] M4 Switch tabs 1/2/3; Follow (F) jumps to the active device.

## J. Journey + replay
- [ ] J1 Chips under each board lead the whole way: Connect devices → Build the dashboard → Play music → Save (opens a new board) → Draw the floor plan → Check accessibility → … ; "Try to break it" shows on the saved room board (before Add Kannada).
- [ ] J2 "connect to what I'm pointing at" (sim) → asks which lamp, then proposes it.
- [ ] J3 Drag the Living room board to the right edge and hold → "Sent to iPhone (SIM)"; board snaps back.
- [ ] J4 `?replay=demo` plays all 18 steps (~80 s) with a banner + Stop.

## P. Phones (needs both phones + laptop on the same Wi-Fi)
- [ ] P1 Phone app → "Join laptop" → laptop Tools → connect devices: the chime pairs; the phone shows "Laptop ✓"; the laptop row shows a check.
- [ ] P2 iPhone badge reads "Apple · on device" (or says why not — then check Settings → Apple Intelligence & Siri).
- [ ] P3 iPhone mic: a small request → the monitor's iPhone tab shows it "kept on device · 0 B".
- [ ] P4 Nothing phone request → monitor's Android tab shows it crossing to Gemini with its bytes.
- [ ] P5 Drag a laptop board to the iPhone's edge and hold → it appears on the iPhone only.
- [ ] P6 NOTHING PHONE ONLY (the iPhone is on the gimbal, no hand control there): "Hands" pill → camera prompt → palm cursor + fist tap; touch still works; app in background turns the camera off; a normal grip doesn't lock the hands.

## S. Spotify / WiZ (only if set up)
- [ ] S1 "play <song>" → real title on the tile, sound on the Marshall.
- [ ] S2 WiZ lamp responds to the tile buttons (with `npm run wiz-bridge` running).

## G. Gimbal (iPhone docked, ~15 min)
Setup: latest iPhone build installed (0.2), iOS 18+, iPhone docked in the Flow 2 Pro, stand powered on, Mendcraft open on the canvas. Have the Insta360 app CLOSED. Note the exact status-line text at every step — it should only say "following" when DockKit really reports tracking on.
- [ ] G0a Before building: `cp ios-src/*.swift ios/App/App/ && grep -c requestSystemTrackingOff ios/App/App/*.swift` prints only zeros (else an old plugin copy is in the build).
- [ ] G0 Launch (this also proves the new plugin is in the build — the old one never prints it): the status line reads "DockKit tracking on — needs a camera app/camera running" (PASS) — or a plain error such as "DockKit tracking didn't turn on: …" / "No DockKit stand docked" (write it down; FAIL). Nothing should claim following if the line is an error.
- [ ] G1 Face follow, no camera running (the iPhone camera is off until you turn Track on or ask it to follow your hands / take a point photo; docking alone does not start it): sit in front of the phone and move slowly left/right ~1 m. Does the stand turn to follow your face? (Expected risk: it does NOT, because no camera session is running in the app.) Note YES / NO.
- [ ] G2 Face follow, keep-alive: say "keep alive on" (or relaunch with `?gimbalKeepAlive=1` if you can). Status: "DockKit tracking on — camera keep-alive running (test option)" — the green camera dot should appear. Repeat the G1 move. Does it follow now? YES / NO. If G1 was NO and G2 is YES, the keep-alive is needed for the film; if both NO, DockKit tracking does not work from this app — cut the "follows my face" line.
- [ ] G3 Keep-alive side effects: with keep-alive on, does anything else that uses the camera on the iPhone (look-to-edit, if on) stop or go black? YES / NO. Say "keep alive off": camera dot goes away within ~2 s.
- [ ] G4 "hold still": status "Gimbal holding still (DockKit tracking off)"; move around — the stand must NOT move. "follow me" again → G0 status, and it follows again (if it did in G1/G2).
- [ ] G5 "follow my hands" on the iPhone (the camera is off until you turn Track on or ask to follow/point): the camera dot appears, status "Gimbal follows your hands (DockKit tracking off)". Move one open hand slowly left/right in frame — does the stand follow the HAND (not your face)? YES / NO. Hide the hand: the stand stays put. If the camera can't start it must say "Hand following needs a hand tracker — following your face instead…" (never claim hands).
- [ ] G6 With the iPhone camera denied (Settings → Mendcraft → Camera off), "connect to what I'm pointing at" on the iPhone must say the camera isn't available and "Pointing needs the laptop camera…" — no click prompt, no guess. Turn the camera back on after.
- [ ] G7 "scan the room" on the iPhone (and on the laptop without `?sim=1`): must say "Room scan isn't available yet — point at a device or name it." and propose nothing. With `?sim=1` on the laptop it proposes a lamp + speaker labelled SIM.
- [ ] G8 Background/foreground: press Home → the stand returns to normal DockKit behaviour (Insta360/Camera app tracking works). Reopen Mendcraft → the G0 status / mode you had is re-applied (e.g. after "hold still" it stays still).
- [ ] G9 Undock and redock while in face mode: tracking comes back on its own after redock, within ~10 s (YES / NO). Launch the app BEFORE docking, then dock: same (the status line should change from "No DockKit stand docked" to "DockKit tracking on — …"). After "hold still", a redock must NOT start following.
- [ ] G9b Track pill: turn it on (camera dot), then tap it again → the dot goes off at once even while docked. During a G12 point, a tap ends the point ("Hand tracking off — nothing was captured").
- [ ] G10 During G5: which way does the custom aim go? Hold a hand off to one side: the stand must turn TOWARD the hand (try both sides), and a hand HIGH in the frame must tilt up. Note if yaw or pitch is reversed (axis convention is unverified: Vector3D x = pitch, y = yaw) — that's a one-line sign fix.
- [ ] G11 Connect-devices row (laptop, both phones paired): the iPhone entry reads "Gimbal tracking ready" when docked; "Tracking you" ONLY after "follow me" got DockKit tracking confirmed (G0 line); "Following your hands" during G5; "Camera tracking you" when only Track is on; "Hands: on" only if you turned its Hands pill on; undocked → "No gimbal — the iPhone camera can still point" (camera denied → "…pointing uses the laptop camera", and pointing then really uses the laptop). Docking alone must NOT turn the camera dot on. After "What do you want to connect next?" three chips: Point at a device / Name a device / Build the dashboard.
- [ ] G12 Lamp next to face: iPhone Hands pill OFF. Tap "Point at a device" on the laptop → the iPhone says "Point at it and hold still — this camera takes one photo for the laptop". Look INTO the iPhone camera, point at the lamp placed ~30–40 cm beside your face (lamp fully in the iPhone frame), hold ~0.6 s. PASS: the gimbal does not move during the hold; the laptop opens a lamp (WiZ) review; the monitor's iPhone tab shows the identify (on device, or the crop bytes to Gemini). Note what it said if not.
- [ ] G13 Lamp ~1 m away, still in the iPhone frame: same as G12. PASS / FAIL. Then point clearly OFF the edge of the frame → must say "I can't see what you're pointing at — move the device into the camera's view." (no tile).
- [ ] G14 Marshall next to face: point at it → a speaker review labelled "Marshall speaker" (or "Speaker"), and after Approve "Speaker added — it will play through Spotify Connect if your Marshall is awake in Spotify." Then "play <song>" → sound from the Marshall (Spotify Premium, Marshall awake in Spotify).
- [ ] G15 Lamp AND Marshall both beside your face, point between them: either it picks the one you point at, or asks "Which one — the lamp or the speaker?" (answer "the speaker"). FAIL if it guesses a device that isn't there.
- [ ] G16 iPhone control layer (optional): turn its Hands pill on. Facing the phone, a fist tap clicks; look away (at the lamp) → pill reads "Hands · face the phone" and fist taps do nothing, but a G12 point still works. Turn it OFF before filming.
- [ ] G17 Nod on Approve: iPhone docked and paired. On the LAPTOP, open any review (e.g. "connect everything in this room") and tap **Approve**. PASS: within ~1 s the stand nods "yes" (DockKit `.yes` animation), then goes back to what it was doing (face follow resumes if it was on). On the iPhone, the status line reads "Gimbal nodded" ONLY if it really moved; approving on the iPhone itself does the same locally. Undocked → no nod and no "Gimbal nodded" line. Two Approves within 2 s → one nod (rate limit).
- [ ] G18 Shake on try-to-break: say "set the main light to 500% brightness" (on the laptop or the iPhone). PASS: refused as in Shot 12b AND the stand shakes "no" (`.no`); the iPhone status says "Gimbal shook its head" only if it moved. A plan that fails the check ("Blocked a plan that did not pass the check.") also shakes.
- [ ] G19 Wakeup on pair: iPhone docked, not paired. On the phone tap **Join laptop** and let the chime pair it. PASS: as the laptop shows "Phone connected", the stand does the DockKit wake-up move (`.wakeup`); the iPhone status says "Gimbal woke up" only if it moved. Note the delay (Firestore relay, usually < 1 s). If it doesn't move, note the iPhone status text — a timeout reads "The gimbal didn't answer in 3 s" (shown only in the plugin result, never as a claim).
- [ ] G20 Overlapping cue + aim: in "follow my hands" (G5) with a hand moving, tap Approve on the laptop so a nod lands mid-follow. PASS: the stand nods, then hand-follow carries on. Then "follow me" (face), and Approve twice quickly while you move: after the nod the stand follows your face again within ~2 s (tracking must never stay off after overlapping moves). FAIL if it stays still until relaunch.
- [ ] G21 Cue during face-follow: in face mode (G0/G1 line), trigger each cue (Approve → nod, try-to-break → shake, re-pair → wakeup). After each, move ~1 m left/right: the stand follows your face again (same as before the cue). Also with "hold still" first: after a cue the stand stays still (hold is respected).
Film decision: the iPhone-on-gimbal beat = following (only if G1/G2 or G5 passed) + pointing from the iPhone (only if G12/G14 passed; else point on the laptop camera) + the Apple · on device badge (P2).
