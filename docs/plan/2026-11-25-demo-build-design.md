# Demo build — design (plan 2)

Date: 25 Nov 2026 · Branch `sim-main` · Deadline 1 Dec 2026, 3:30 AM IST
Inputs: `DEMO.md` (full-length take, build list 1–8), Akash's requests (AI monitor on the Mac's external display, iPhone touch lock), recon in the plan workspace.

## Why

The film is a single long take that will be cut down later. Every beat in `DEMO.md` must really happen on screen, and the hybrid story (Nano on device vs Gemini in the cloud) must be readable at a glance. Akash wants the model activity on the **external monitor connected to the Mac** (iPad later via the same page), so the laptop canvas stays calm.

## Goals (in priority order)

1. **AI monitor** — `monitor.html`, opened from the canvas ("Open AI monitor" in Tools, voice "open AI monitor"), meant to be dragged to the external display and full-screened. Two columns: **Nano · on this device** (left) and **Gemini · cloud** (right), each streaming the same log lines the in-app terminals show, plus a centre lane with handoff arrows, redaction notices ("name redacted before cloud") and the live "N sent to cloud" ledger total. Same-browser sync via `BroadcastChannel('mendcraft-ai')` — no network, works offline. Large type, dark background for filming. The canvas still works without it. Later: iPad joins the same feed over Relay (not in this plan).
2. **iPhone touch never locks** — touch works by default; look-to-edit is opt-in and never locks on a missing/unknown face signal.
3. **Connect devices pairs phones first** (build list 2), then asks what's next; the lamp dashboard waits for "build the dashboard".
4. **Point-to-connect** (build list 1) with a real camera frame → `identifyDevice`; never defaults to a speaker.
5. **Speaker tile → Spotify** (build list 3) when connected; honest fallback otherwise.
6. **Board to phone** (build list 4) on a one-fist board grab dragged to a paired edge (gesture spec is now one fist = move, two fists = zoom).
7. **CAD extras on the canvas** (build list 5): "check accessibility", 3D toggle, Export DXF on the canvas plan board.
8. **Kannada caption** (build list 6) on the canvas Talk caption.
9. **Remove the on-screen keyboard** (build list 7).
10. **Judge replay** (`HANDOVER.md` §14): `?sim=1&hands=0&replay=demo` plays a scripted run of commands through `run()` so judges without a camera see the product.

## Non-goals

Optional build-list item 8 (gimbal photo ID, dashboard-from-collected-devices, rollback demo), Cloud Run replay server, any billing/console change, production deploy.

## Constraints

- All model inference stays on Firebase AI Logic (contest rule). Ledger/badges honest; SIM stays labelled.
- No new runtime deps unless a task justifies it (Spotify/WiZ/MediaPipe code already in repo).
- Branch `sim-main`, plain commit messages, no AI-tool attribution, never push `main`.
- Baseline test failures only `goldenTrace8319f68`, `poseStabilityReplay`.

## Approaches considered (monitor)

| Approach | Trade-off | Pick |
|---|---|---|
| BroadcastChannel between two windows of the same origin | Zero infra, offline, instant; same machine only | **Yes** (external display) |
| Relay/Firestore guest page | Works on iPad; needs pairing + network | Later, same page |
| Move the AI panel itself to a popup window | Couples layout; breaks when popup blocked | No |

## Decision (25 Nov): one integrated journey, not demo beats

Akash: features should be truly integrated end to end, not separate things to demo. Ruling:

- **One journey** is the product spine: empty canvas → connect (phones pair, point at the lamp) → room dashboard → music on the speaker → save → floor plan → accessibility check / 3D / DXF → Kannada → offline + reconnect → board to phone. Every step is reachable from the previous one in the UI, not only by a demo phrase.
- **Next-step suggestions** on each board: 2–3 context chips generated on device by Nano (rules fallback when Nano is absent; labelled honestly) — e.g. lamp dashboard → "Play music", "Save", "Draw the floor plan"; floor plan → "Check accessibility", "Show 3D". Chips are dwell/voice/mouse targets.
- **Judge replay = the same journey played by the product** (`?replay=demo`), using real reviews and engines (SIM-labelled under `?sim=1`). The same timeline drives an end-to-end test that fails if any step breaks.
- **No faked rollback.** Undo is real and part of the journey.
- **Cut:** on-screen keyboard (removed), gimbal photo ID (optional, not planned).

Wave 2 of the plan is re-scoped to: journey state + next-step suggestions, then each build-list item as a journey step (pair-first connect, point-to-connect, Spotify, board-to-phone), then replay + end-to-end test.

## Decision (25 Nov): a real "try to break it" beat, no staged failure

Akash asked for a rollback with the red blink. Ruling: show the real safety net, not a faked crash. The journey gets a "Try to break it" step: ask for something that violates a real limit (lamp brightness outside WiZ's 10–100 %, or a control for a device that isn't connected). The model proposes; validation refuses it; the responsible engine blinks red (panel, engine bar, AI monitor); the board is unchanged. Builder must first verify these requests reach validation and are refused (not silently clamped) on both `?sim=1` (scripted reply must be the model's real-shaped attempt, labelled SIM) and live; if a path clamps instead, make the validator refuse with a plain reason. Undo stays as the user-driven rollback.

## Decision (25 Nov, night): hands on the phones too

Akash: once clicking and moving work on the laptop, the phones get the same hand control. After the laptop hand fix (finger-geometry tap, overlay aligned to cursor, facing gate) is merged and live-verified, the phone shell (iPhone + Android) gets hand control via the front camera: palm cursor, fist tap = click, held fist = move/pan, two fists = zoom, same facing gate (only when facing the phone). Phone menu gets a Hands on/off switch. Must coexist with the front-camera face signal already used for look-to-sync / facing (one camera stream, both trackers). Performance budget: keep ≥ 20 fps tracking on an iPhone 16 Pro Max and a Nothing Phone 3a; throttle when idle. Touch keeps working at all times.

## Note (25 Nov, night): iPhone sensor mode is a demo moment inside "connect devices"

Akash: the iPhone's sensor-only hand/face tracking (docked on the gimbal) should be a visible moment in the connect-devices plan, not a hidden backend. Intended flow on camera:
1. "Connect devices and make a dashboard" → phones pair (chime). The paired row shows each phone with a ✓.
2. The iPhone's row gains a sub-state: "Gimbal tracking ready" (iPhone docked + sensor mode available), then "Tracking you" once the gimbal follow/sensor is actually running — only shown when the plugin/tracker really reports it.
3. The prompt "What do you want to connect next? Point at it, name it, or say build the dashboard." now offers a "Point at a device" chip; pointing uses the iPhone camera on the gimbal (sensor-only hands: no UI control), the gimbal holds while the photo is taken, identify runs (Nano/Apple first, cloud second), the lamp tile is proposed through the normal review.
4. Monitor: the iPhone tab shows the identify turn (what stayed on device vs what crossed).
Honesty: every status line reflects what is really on; if the gimbal or DockKit tracking isn't available the row says so plainly and pointing falls back to the laptop camera.

## Correction (25 Nov, night): iPhone has two layers, not sensor-only
Akash: hands on the iPhone should work like Android when he is looking at it. Final rule: SENSING layer (feeds gimbal hands-follow and point-to-connect; not gated by facing, because pointing means looking at the device) + CONTROL layer (full hand control behind the Hands pill, off by default, acts only while facing the phone). One shared camera/tracker. Film with iPhone control OFF unless demonstrating it.

## Film staging note (25 Nov, night): pointing shot
Akash will look into the iPhone camera and point at the lamp with the lamp placed next to his face (inside the iPhone-on-gimbal camera frame). This satisfies both "device in view" and "facing the phone". Pointing stays un-gated by facing in code so it also works when looking at the lamp. Setup for the take: lamp within ~40 cm of the face, in frame; steady point ~0.6 s; keep iPhone hand CONTROL off.
