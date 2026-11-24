# Akash's test checklist (morning, 25 Nov)

Preview (after the Firebase re-login below): https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1&sim=1
AI monitor: https://mendcraft--sim-main-o8jrlskh.web.app/monitor.html (keys 1/2/3 = Laptop/iPhone/Android, F = Follow)
Judge replay: https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?replay=demo
Local (always latest): http://localhost:5173/canvas.html?fresh=1&sim=1

Note anything off with its number.

## 0. Before anything (2 min)
- [ ] 0.1 Firebase login expired overnight — run in Terminal: `cd ~/Developer/mendcraft-sim && npx firebase-tools login --reauth`. Then redeploy the preview: `npm run build && npx firebase-tools hosting:channel:deploy sim-main --project mendcraft`.
- [ ] 0.2 Plug in the iPhone (unlocked) → install the latest build (`xcodebuild … && xcrun devicectl device install app …`, see ios/README.md).
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
- [ ] G0 Launch: the status line reads "DockKit tracking on — needs a camera app/camera running" (PASS) — or a plain error such as "DockKit tracking didn't turn on: …" / "No DockKit stand docked" (write it down; FAIL). Nothing should claim following if the line is an error.
- [ ] G1 Face follow, no camera running: sit in front of the phone and move slowly left/right ~1 m. Does the stand turn to follow your face? (Expected risk: it does NOT, because no camera session is running in the app.) Note YES / NO.
- [ ] G2 Face follow, keep-alive: say "keep alive on" (or relaunch with `?gimbalKeepAlive=1` if you can). Status: "DockKit tracking on — camera keep-alive running (test option)" — the green camera dot should appear. Repeat the G1 move. Does it follow now? YES / NO. If G1 was NO and G2 is YES, the keep-alive is needed for the film; if both NO, DockKit tracking does not work from this app — cut the "follows my face" line.
- [ ] G3 Keep-alive side effects: with keep-alive on, does anything else that uses the camera on the iPhone (look-to-edit, if on) stop or go black? YES / NO. Say "keep alive off": camera dot goes away within ~2 s.
- [ ] G4 "hold still": status "Gimbal holding still (DockKit tracking off)"; move around — the stand must NOT move. "follow me" again → G0 status, and it follows again (if it did in G1/G2).
- [ ] G5 "follow my hands" on the iPhone: must say "Hand following needs a hand tracker — following your face instead. DockKit tracking on — …" and keep following the face. FAIL if it claims to follow hands.
- [ ] G6 "connect to what I'm pointing at" on the iPhone: must say "Pointing needs the laptop camera — turn on Hands on the laptop and say it there." and must NOT open the selfie camera or ask for a click.
- [ ] G7 "scan the room" on the iPhone (and on the laptop without `?sim=1`): must say "Room scan isn't available yet — point at a device or name it." and propose nothing. With `?sim=1` on the laptop it proposes a lamp + speaker labelled SIM.
- [ ] G8 Background/foreground: press Home → the stand returns to normal DockKit behaviour (Insta360/Camera app tracking works). Reopen Mendcraft → the G0 status / mode you had is re-applied (e.g. after "hold still" it stays still).
- [ ] G9 Undock and redock while in face mode: tracking comes back on its own after redock (YES / NO).
- [ ] G10 (only if you test aiming from the laptop path) Which way does a custom aim go? A hand on the camera's RIGHT should pan the stand RIGHT and raise for a hand HIGH in the frame. Note if yaw or pitch is reversed (axis convention is unverified: Vector3D x = pitch, y = yaw).
Film decision: the iPhone-on-gimbal beat = following (only if G1 or G2 passed) + the Apple · on device badge (P2). Pointing is filmed on the laptop camera.
