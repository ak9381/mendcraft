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
