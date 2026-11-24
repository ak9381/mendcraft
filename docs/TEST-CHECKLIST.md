# Akash's test checklist (morning, 25 Nov)

Preview (after the Firebase re-login below): https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1&sim=1
AI monitor: https://mendcraft--sim-main-o8jrlskh.web.app/monitor.html (keys 1/2/3 = Laptop/iPhone/Android, F = Follow)
Judge replay: https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?replay=demo
Local (always latest): http://localhost:5173/canvas.html?fresh=1&sim=1

Note anything off with its number.

## 0. Before anything (2 min)
- [ ] 0.1 Firebase login expired overnight — run in Terminal: `cd ~/Developer/mendcraft-sim && npx firebase-tools login --reauth`, then tell me and I'll redeploy the preview.
- [ ] 0.2 Plug in the iPhone (unlocked) → I install the latest build.
- [ ] 0.3 Plug in the Nothing phone (the cable that worked) → I install the latest build.

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
- [ ] J1 Chips under each board lead the whole way: Connect devices → Build the dashboard → Play music → Save → Floor plan → Check accessibility → Try to break it → Add Kannada.
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
