# Akash's test checklist — 27 Nov

Two apps to test:

| | Address | What it is |
|---|---|---|
| **Preview (sim-main)** | https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html | The full hand-built demo |
| **Main (actual demo)** | https://mendcraft.web.app/canvas.html | Only scaffolding — Gemini and Nano build every board |

Before you start:
- Mac **plugged in**, display on (sleep pauses the app and the phones' links).
- WiZ bridge running (`npm run wiz-bridge` in mendcraft-sim), bulb powered.
- Both phones unlocked, Mendcraft open. **The phones hold one build at a time** — tell me which app you're testing and I'll install the right build (≈5 min).
- iPhone docked on the charged gimbal. Marshall paired to the iPhone over Bluetooth.
- **Before pairing after a deploy: reload the laptop page first.** Phones paired before this build need one re-pair by chime.

Write the number of anything that looks wrong.

---

## A. Preview (sim-main)

### A1. Pairing and devices
- [ ] A1.1 Say or type **"connect devices"**. Both phones join (remembered phones rejoin with no chime). The Connected devices board ticks ✓ Laptop, ✓ iPhone, ✓ Nothing phone, ✓ Lamp, Speaker.
- [ ] A1.2 Close the pairing card with ✕ — the phones stay ✓.

### A2. Dashboard and devices
- [ ] A2.1 **"build the dashboard"** → swarm cursors, one review (Nano draft + Gemini), Approve → Lamp, Speaker, Gimbal tiles.
- [ ] A2.2 Lamp tile: on, colour (blue), a scene (sunset), brightness — the real bulb follows.
- [ ] A2.3 Open **Spotify on the iPhone**, then Play on the Speaker tile → music on the Marshall; the tile shows the real song and volume (never a made-up one).
- [ ] A2.4 Gimbal tile: **Nod** (up/down), **Shake** (left/right, ends centred), **Follow me** (face), **Follow my hands** — the stand follows your hand, not your face, and holds still when your hand leaves the camera. The laptop's devices line reads "DockKit tracking: off · aiming at hands: yes/no".

### A3. Floor plan
- [ ] A3.1 **"draw the floor plan"** → its own Floor plan board (Nano), Approve.
- [ ] A3.2 **"add a study next to bedroom 2"** → review "Add Study …" (no song skips!), Approve.
- [ ] A3.3 Hold a fist on the plan to edit; 3D → hold a fist and move to turn the view; two fists zoom.

### A4. Board to phone (hands)
- [ ] A4.1 Palm on a board's **title**, fist, move to the **right edge** → the **board lights up green** with "Hold to send to Nothing phone"; hold ≈1 s → it flashes and says "Sent …". The Nothing phone shows the board glowing with **"Moved from laptop"**, including your latest edits.
- [ ] A4.2 Same at the **left edge** → iPhone.

### A5. Hands, look-away, voice
- [ ] A5.1 With Hands on, **look away** from the laptop → nothing moves or clicks; look back → resumes after ≈½ s. Each phone has its own "Facing / Not facing" pill and only the device you face acts on your hands.
- [ ] A5.2 Peace sign + move down on the tall dashboard → scrolls; the chip row stays put.
- [ ] A5.3 Hover label is small glass; Read aloud button (and R-thumbs-up + L-thumbs-down) toggles speech.

### A6. Honesty and safety
- [ ] A6.1 **"can you call my daughter"** → "I can't do that — I can only change things here on your boards and devices." (never "Yes, I will call…").
- [ ] A6.2 **"set the speaker volume to 150%"** → refused within ≈10 s: "Volume goes from 0 to 100 %. Nothing changed."
- [ ] A6.3 More → Simulate offline → any plan edit says "You're offline — this is Nano's draft"; the Gemini card says Offline.
- [ ] A6.4 **"add kannada"** → review → Approve → buttons in Kannada → Undo → English.
- [ ] A6.5 Reload the page → every board is still there.

---

## B. Main (actual demo on mendcraft.web.app)

One-time on this address (it's a different origin from the preview):
- [ ] B0.1 Chrome site settings for mendcraft.web.app → **Apps on device: Allow**, **Local network: Allow**. Then tell me — I link the lamp bridge to this address.
- [ ] B0.2 Spotify sign-in on this address if a play asks for it.
- [ ] B0.3 Phones: I install the main build on both (and put sim-main back afterwards).

### B1. Everything is generated
- [ ] B1.1 Fresh page is empty: "Let's build something fun."
- [ ] B1.2 **"show my devices"** → Gemini review (a devices table), Approve → live rows with honest ✓ (only what really answers; "Not paired" otherwise). Board label: "Gemini · cloud · <date>".
- [ ] B1.3 **"build the dashboard"** → swarm cursors → one review (Nano draft improved by Gemini) → tiles for the devices that really answer; the speaker volume shows "—" until Spotify reports it.
- [ ] B1.4 **"draw the floor plan"** → its own board, Gemini rooms; **"add a study next to bedroom 2"** → Nano edit.
- [ ] B1.5 **"add kannada"** → review lists 13 labels + "Stays English: …" → Approve → Kannada → Undo.
- [ ] B1.6 **"set the speaker volume to 150%"** → refused, nothing changed.
- [ ] B1.7 Offline → Nano-only draft with the offline label; Gemini card Offline.
- [ ] B1.8 Say **"show artifacts"** → every stored board/plan/pack with its maker; Export, then Import the file → one confirm ("Adds N, replaces M") → items labelled "Imported · …".
- [ ] B1.9 Reload → all boards return (and the plan is centred — this was off this morning, fix in progress).

### B2. Devices and phones on main (after B0)
- [ ] B2.1 Lamp tile → the real bulb; a wrong control (e.g. volume on a lamp) is refused, never turns the bulb on.
- [ ] B2.2 Speaker → Marshall via the iPhone.
- [ ] B2.3 Pair both phones by chime; send a board to each phone (board glow + "Moved from laptop" once ported).
- [ ] B2.4 Gimbal tile appears only while the stand is docked; Nod / Shake / Follow my hands as in A2.4.
- [ ] B2.5 Look-away and facing pills as in A5.1.

---

Results so far (Claude's own runs) are in `docs/DEMO-REVIEW.md` (sim-main) and `.superpowers/sdd/plan/live-main-findings.md` (main, local).
