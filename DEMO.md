<!-- DRAFT only. Not submitted. Structure follows the v2 demo script; content updated 24 Nov 2026 for the live unified take. -->

# Mendcraft — Demo Video Script

Target runtime: uncut is about **5:40** (5s title + body + 5s end card). It will run **over 3:00** — that is fine. In the edit, **fast-forward** the sections marked **FF**. Do not drop a beat to hit 3:00. Leave the first hover-select, the first Approve, and the spoken lines at full speed.

Recorded on the sim-main preview (https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1), plus live camera, phones, WiZ, and Spotify when those are proven.

Every change on the canvas goes through the same review (**Approve** / **Reject** / **Ask for something else**). Nothing is built until Approve. Reject leaves the canvas unchanged.

Gestures in the current build: **hover-select for 1.5 seconds** (the ring fills), and **two fists on a board to move it**. Do not say “pinch.” Other buttons stay quiet while a two-fist grab is on. There is **no on-screen keyboard** in this demo (see the build-list task to remove it from the app).

Badge text, from `src/ai/router.ts` `badgeLabel` / `sourceText`: **Gemini Nano · on device**, **Apple · on device**, **Gemini · cloud**, **Nano → Gemini**, **Apple → Gemini**, **Rules · exact command**. A simulation includes **SIM** — do not pretend it was live. The footer and **What left this device** (`src/ui/ledgerPanel.ts`, `src/core/ledger.ts`) are the honest byte count.

---

## Before you film

- [ ] Laptop in Chrome (Gemini Nano if you want a real on-device badge). Wi-Fi on.
- [ ] Nothing Phone 3a on the **left**, iPhone on the **right**, both with Mendcraft Relay open and unlocked.
- [ ] Pairing chime: laptop speakers up; phone mics unobstructed. One test pair before the take.
- [ ] Insta360 Flow 2 Pro ready. Dock the iPhone only when the script says to.
- [ ] WiZ lamp on the same LAN. On the laptop, `npm run wiz-bridge` is running. Do one brightness test off-camera.
- [ ] Marshall speaker on, already connected in the **Spotify** app (Premium). Client ID lives in `.env.local` as `VITE_SPOTIFY_CLIENT_ID` — never put the value in this file or a commit. Sign in on the **web** app first; the iPhone shell cannot finish the `/spotify` redirect.
- [ ] Hands on, camera clear. A second person in the background helps the register beat.
- [ ] Do not claim ADA/IRC compliance, user testing, or a live bulb/speaker/Spotify session you have not just proven.

---

## Title Card (5s pre-roll)

**Akash does / says:** (none — hold on the card)
**On screen:** Deep slate background, minimal “Mendcraft” wordmark, subtitle: “Voice, Hands, and Hybrid Intelligence.”
**VO:** (none)
**Caption:** Mendcraft

---

## Shot 1 — Empty canvas & Tools (0:00–0:18)

**Akash does / says:** Sits at the empty canvas, hands visible, no mouse. Says “show tools,” or hover-selects the **Tools** chip if the bar is closed. Points at the side chips so they’re readable.
**On screen:** Empty infinite canvas. Centered lead: “Let's build something fun.” Right-side chips, top to bottom: **Register** (orange), **Edit**, **Tools**, **Talk** (mic). After “show tools,” a *top toolbar* (not a radial arc around the hand): **Show everything**, **New board**, **Save**, **Undo**, **Hands**, **Register**, **Teach a gesture**, **Custom gestures**, **AI activity**, **Simulate offline**, plus a say box and **Go**.
**VO:** “This is Mendcraft. A canvas you drive with your voice and your hands — I built it for my mom, who has arthritis and speaks Kannada, and for anyone with limited hand use who still wants to run a room or draw a floor plan. ‘Show tools’ opens a toolbar along the top. Talk, Register, and Edit stay at the side.”
**Caption:** Tools chip and top toolbar — not a radial arc. Talk, Register, and Edit sit at the side.
**Model / ledger:** Nothing has left the device yet.
**Status: WORKS.** Do not claim a formal user study. The mom / Kannada frame is already in `/judges` and the landing page (`src/judges/judgesPage.ts`, `src/landing/shell.html`).

---

## Shot 2 — Connect devices, two reviews, dashboard (0:18–0:58) — FF the swarm / model stream

**Akash does / says:** Hover-selects **Talk** and says: “Connect devices and make a dashboard to control them.” When the first review opens, hover-selects **Approve**. When the second review opens, hover-selects **Approve** again. Then opens **What left this device**.
**On screen:** The **AI activity** panel stays open. A swarm of small colour-coded agent cursors (Gemini blue, Nano green) moves across the canvas. Two live terminals — “nano · on this device” and “gemini · cloud” — log their own steps. Mid-build pill, in the sim walk: **“15 agents · Gemini 7 · Nano 8 · 0 B to cloud.”** Use the live pill and footer if the counts differ. The **floating review window** opens: **“Draft: 2 lamps found in this room”**, with **Approve**, **Reject**, and **Ask for something else**. After the first Approve, **“Better: grouped lights + a room plan.”** After the second Approve, the Living room dashboard lands: lamp tiles, a speaker tile, a small room plan, a connect tile. Sage self-check marks may already sit on healthy tiles. The ledger lists each cloud call and its bytes.
**VO:** “I say ‘Connect devices and make a dashboard to control them.’ A swarm of cursors — Gemini blue, Nano green — walks the real steps, logged in two terminals. The pill is honest about the mix. Every change waits for me. I approve the on-device draft, then Gemini’s tighter grouping. Only then does the dashboard land. And this ledger is the privacy note — what ran on this device, and what went to the cloud.”
**Caption:** Swarm + two reviews (Draft, then Better). Nothing is built until Approve. Ledger open.

**Intended, not in the code today:** that sentence would first find which devices already have Mendcraft, chime to connect, and show them with a checkmark each. Today it goes straight to `connectRoom()` and the two-lamp draft. Pairing is Shot 12. The swarm is AI agents, not device checks.

**Model / ledger:** First turn **Gemini Nano · on device**. Handoff **Nano → Gemini**. Second turn **Gemini · cloud**. Footer from `setFooterBytes`.
**Rollback / red flash:** If a build fails after Approve, the last good board is restored and the responsible terminal blinks red (`EnginePanelUi.fail` in `src/canvas/modelPanels.ts`, `.mc-terminal.is-failing` in `src/canvas/canvas.css`; also `rollbackFix` in `src/canvas/selfCheck.ts`). Only show this if you have a rehearsed, safe failure (see the build list). Do not invent a crash.
**Status: WORKS** for the two reviews, AI activity, the floating approve window, the ledger, self-check marks, and fail/rollback when a failure happens. **PARTIAL** for “a red flash in every take,” for pairing-first, and the dashboard still starts from the scripted two lamps.

---

## Shot 2b — Dim the lamp / WiZ cutaway (0:58–1:08)

**Akash does / says:** Says “increase the brightness,” or hover-selects a brightness control on a lamp tile. Looks at the real lamp when the command lands.
**On screen (canvas):** The lamp tile updates (`parseDeviceCommands` in `src/canvas/deviceCommands.ts`).
**On screen (real-world cutaway):** A reachable WiZ lamp on the LAN should change (`createWizAwareConnector`, `src/devices/wizClient.ts`). If the bridge is down, the tile is labelled **SIM** — hold on the board only and drop the VO sentence about the physical bulb.
**VO (when the real lamp is filmed):** “Increase the brightness — and the physical WiZ lamp changes.”
**VO (canvas-only fallback):** “The lamp tile responds on the board.”
**Caption:** On-canvas lamp control. Physical WiZ bulb only if the bridge is up.
**Model / ledger:** Lamp control is local (LAN bridge), not a Gemini job.
**Status: WORKS** when the bridge is up; otherwise SIM only.

---

## Shot 2c — Gimbal and point-to-connect (1:08–1:32) — FF extra review waits

**Akash does / says (intended):** After a prompt of “what do you want to connect next?”, brings the Insta360 Flow 2 Pro up to the laptop camera, then says “Use the gimbal to connect to what I point at,” and points at the WiZ lamp, then the Marshall.

**What the code does today:** no visual identifier for a gimbal (`DEVICE_KINDS` in `src/devices/identify.ts`). DockKit is detected **on the iPhone, when the phone is docked**, by `MendcraftGimbalPlugin.isAvailable()`. The closest voice line is “connect what I’m pointing at” (`parseGimbalSpeech` in `src/canvas/gimbalCanvas.ts`); the longer “use the gimbal to…” line does not match. `pointTurn` always proposes a **speaker** tile — it does not call `identifyDevice` on a live photo. “Connect the lamp” / “connect the speaker” works as a by-name Nano turn (`byName` in `src/canvas/connectTurns.ts`).

**Film today:** Docks the iPhone in the Flow 2 Pro and says, honestly: “The iPhone is in a DockKit gimbal, so it can follow my hands and look where I point.” Then: “Connect the lamp.” Hover-selects **Approve**. Then “Connect the speaker.” Approves again.
**On screen:** Each connect is a Proposal. Badge for by-name: **Nano · on device — nothing left this device**.
**VO:** “The iPhone is in a DockKit gimbal. I add the lamp and the speaker by name, and each one waits for Approve.”
**Caption:** Docked DockKit gimbal. By-name connect; live point-to-identify not wired yet.
**Model / ledger:** Plugin check is local. By-name is Nano, no photo.
**Status: MISSING** as a laptop-camera gimbal beat. DockKit **PARTIAL** (untested on the filming rig). Point-to-connect **PARTIAL** (by-name works; live identify is not wired).

---

## Shot 2d — Spotify on the speaker (1:32–1:45)

**Akash does / says:** Only if Spotify is signed in on the web app and the Marshall is already a Spotify Connect device: “Play [track] on the speaker.” Looks at the Marshall only if it is actually receiving audio. If that path is not proven, skip the spoken claim and leave the canvas Play control alone, or say only that Spotify is connected.
**On screen:** If wired, the music tile shows the real track. Today the canvas speaker tile uses a **simulated** connector and a canned track (e.g. “Morning light”) in `src/canvas/canvasApp.ts`. There are no `spotify` references under `src/canvas/`. The real stack is `src/ui/musicPanel.ts` and `src/music/musicSession.ts` (`searchAndPlay`, `transferPlayback`). No Marshall-specific or Web Bluetooth code.
**VO (only if proven):** “We’ve connected to Spotify, and that’s playing on the Marshall.”
**Caption:** Spotify over the speaker only if the canvas tile is wired and the Marshall is a Connect device.
**Model / ledger:** Job `spotify` — commands and search text only, no tokens in the ledger.
**Status: PARTIAL.** Studio music panel **WORKS**. Canvas tile is not Spotify.

---

## Shot 3 — Save pins the dashboard (1:45–1:53)

**Akash does / says:** Hover-selects **Talk** (or the say box) and says “save.”
**On screen:** Status: “Saved Living room at [time].” The Living room dashboard pins to a side dock titled **“Living room”**, with an **Unpin** control. The dock stays interactive.
**VO:** “I say ‘save.’ The dashboard pins to the side as Living room — still live, just out of the way.”
**Caption:** Voice “save” pins the dashboard to the Living room dock.
**Status: WORKS.** `parseCanvasCommand` / `reg.setPinned`.

---

## Shot 4 — Floor plan and CAD (1:53–2:38) — FF the model stream; keep the drawing at full speed

**Akash does / says:** Hover-selects **Talk** and says: “floor plan for Mrs Sharma's flat.” Hover-selects **Approve**. Then, on the live plan board: hovers a door and a dimension; opens the plan **component palette**; uses the **measure tool** (or two-hand measure) and keeps a dimension; says “check accessibility” if that line is wired; toggles **3D**; **Export DXF**.
**On screen:** A new CAD board appears beside the pinned dashboard (review first). Terminals: Nano logs the raw request and a redact line (Sharma → `[Client A]`) before a byte reaches “gemini · cloud”, whose log never shows the raw name. Footer shows the real cloud bytes (the sim walk was **2.2 KB**). Review title: **“Floor plan: two bedrooms.”** After Approve, the board is a live drawing: **rooms, walls, doors, windows, and dimensions** (`PlanBoardElement` in `src/canvas/widgets.ts` wraps `createPlanController` and `createPlanRenderer`). Palette and furniture flyout: `createPalette`, `createPlanTools`, `FURNITURE_FLYOUT` in `src/plan/tools.ts`. **Trash zone** on the same board (`createTrash` in `src/core/palette.ts`). Measure: `createMeasureTool` / `beginTwoHandMeasure`. Accessibility findings (door clear width 815 mm min / 850 mm recommended, ramp slope 1:12, corridors, stairs): `checkPlanAccessibility` in `src/plan/accessibility.ts`, `PLAN_A11Y` in `src/core/a11y.ts`. 3D walls: `toggle3D` / `createExtrudeView` in `src/plan/extrude3d.ts`. DXF: `controller.export()` → `toDxf` in `src/plan/export.ts` (`mendcraft-plan.dxf`).
**VO:** “Next: ‘floor plan for Mrs Sharma’s flat.’ Nano redacts Sharma to Client A before Gemini ever sees the prompt, and the footer shows exactly what left this device. I approve, and the CAD board renders — rooms, doors, walls, dimensions. It can check a door width or a ramp, open in 3D, and export a DXF.”
**Caption:** Nano redacts the name; CAD board with dimensions; a11y / 3D / DXF if those controls are on this board.
**Model / ledger:** Redaction on-device, then **Gemini · cloud** for the plan. The checker itself is deterministic code. An explanation of the issues, if shown, may go to the cloud — if it does, the ledger should show it. Do not say the plan is ADA-compliant.

**Canvas vs studio:** walls, rooms, doors, dimensions, measure, the furniture palette and the trash zone **WORK** on the canvas plan board. “Check accessibility,” the **3D** button, and **Export DXF** are implemented but the **buttons and the voice line are wired in the studio shell** (`src/main.ts`, `/studio`) — **PARTIAL** on today’s canvas. Film the drawing tools on the canvas board; for a11y, 3D and DXF either cut away briefly to `/studio` (**FF** the navigation, not the result) or wait for the build-list task that exposes them on the canvas board.

**Status:** drawing tools **WORKS** on canvas. Accessibility / 3D / DXF **WORKS** in code, **PARTIAL** on the canvas route.

---

## Shot 5 — Add Kannada (2:38–2:58) — FF the pack stream; keep Approve and the language switch at full speed

**Akash does / says:** Hover-selects **Talk** and says “add Kannada.” Hover-selects **Approve**. Optional, if the pack is on: a short rehearsed Kannada command so the Talk caption shows the Kannada words.
**On screen:** Both terminals log the same handoff: Nano asks Gemini to plan the Kannada pack because it is too complex on-device (`addKannada` / `languageTurn` in `src/canvas/canvasApp.ts`). Review title: **“Add Kannada.”** After Approve, labels, tiles, and controls switch into Kannada script. Spoken replies use **kn-IN** (`resolveLanguage` in `src/ai/language.ts`, `opts.voice.setLang`; `src/ai/speechVoices.ts` prefers a Kannada voice when one is installed).
**VO:** “Now, ‘add Kannada.’ Both terminals log the real reason: Nano asks Gemini to plan the pack because it’s too complex on-device, and Gemini hands the labels back for Nano to apply locally. I approve, and the interface switches into Kannada.”
**Caption:** Handoff with the real reason; review; Approve; UI in Kannada; kn-IN voice.

The bilingual caption bar (her words beside the English translation — `buildCaption` in `src/ai/language.ts`, `#caption-bar` in `src/main.ts`) **WORKS in the studio**. The canvas Talk caption (`micFab.ts`) shows the live words but does not yet pair a translation line. A short `/studio` cutaway is honest if you want that bar; do not claim the canvas already shows both lines.

**Model / ledger:** **Nano → Gemini**, then **Gemini · cloud**. Receipt: the key list and the request — no board data, no device addresses.
**Status: WORKS** for “add Kannada,” the review, the UI pack, and kn-IN on the canvas. **PARTIAL** for a paired caption bar and a spoken Kannada CAD reply on the canvas (those are studio).

---

## Shot 6 — Undo, offline queue, reconnect (2:58–3:20) — FF the wait; keep the queue badge and the reconnect review at full speed

**Akash does / says:** Says “undo” (back to English). Hover-selects **Simulate offline** (the button reads **“Offline (simulated)”** while down). Hover-selects **Talk** and says “add Kannada” again. Hover-selects **Simulate offline** again to reconnect. Hover-selects **Approve** on the review that follows.
**On screen:** After undo, English chrome is back. Offline: Nano’s panel shows **“N request(s) queued offline — will run on reconnect.”** On-device work still runs; a job that needs the cloud waits (`setOnline` in `canvasApp.ts`, `net.queueLater`, `deepLater` for a dashboard’s Gemini pass, and `src/offline/queue.ts` in the studio). On reconnect: “Back online. Running N saved request(s).” The same **“Add Kannada”** review opens. After Approve, Kannada is back. A pinned phone board also keeps working offline; the WiZ lamp can still be reached on the LAN.
**VO:** “Undo takes us back to English. If the network drops, edits that can stay on this device still work. A job that needs the cloud — like adding Kannada — waits in the queue, honestly labelled. The moment we’re back, it runs and still waits for me to approve.”
**Caption:** Undo to English. Offline requests queue in Nano’s panel and are reviewed on reconnect.
**Status: WORKS** on the canvas for Simulate offline, the Kannada queue, the Deep-dashboard queue, and window `offline`/`online` events.

---

## Shot 7 — Teach a gesture (3:20–3:42) — FF the sample holds after the first repetition is clear

**Akash does / says:** Hover-selects **Teach a gesture**. Records a thumbs-up (or another pose) two or three times (live camera when filming; sim uses synthetic samples). Says or types “save the canvas” in “What should it do?”, then **Go**. Hover-selects **Approve**. Optional, if filming live: gives the thumbs-up; the canvas saves.
**On screen:** Teach panel: “Stays on this device” (`mountTeachPanel` in `src/canvas/teachPanel.ts`, `src/input/customGestures.ts`, IndexedDB — never Firestore). After the samples, “What should it do?” Review: **“Teach: Save the canvas.”** After Approve: “Learned it — Save the canvas, stays on this device.” Custom / remappable gestures are in **Custom gestures**.
**VO:** “You can teach Mendcraft a gesture. I record a thumbs-up, say ‘save the canvas,’ and approve. From now on, a thumbs-up saves — on this device, with a human in the loop.”
**Caption:** Teach a gesture on-device; review before the bind; Approve.
**Model / ledger:** Recording is on-device. If parsing the action uses a model, the badge and ledger must say so.
**Status: WORKS.**

---

## Shot 8 — Register (3:42–4:02) — FF the hold rings after the face is clearly started

**Akash does / says:** Hover-selects the **Register** chip (leave this first 1.5 s ring at full speed). Looks at the camera, then shows an open left palm, then the right, each until the ring fills. (Sim uses a scripted replay.)
**On screen:** Scan title: **“Register you.”** Prompts: “Look at the camera and hold still.” → “Show your open LEFT palm.” → “Now your open RIGHT palm.” → “Registered — tracking locked to you.” The side chip and toolbar switch to **Re-register**.
**VO:** “I register last so you can see it clearly — but in a crowded room, after this, only my face and hands are tracked. The canvas follows the person who owns it.”
**Caption:** Register you; tracking locked to the owner. Re-register is on the toolbar afterwards.
**Model / ledger:** All on this device. Signatures stay in `sessionStorage` (`mc.owner.v2`). No cloud call.
**Status: WORKS.** `createScanFlow` in `src/canvas/scanRegistration.ts`; `applyOwnerLock` in `src/canvas/canvasApp.ts` (`registerSignature`, `setOwnerHands`). Other faces are dimmed (`src/input/faceLogic.ts`); other hands are rejected (`src/input/handBinding.ts`, `rejectedHands`).

---

## Shot 9 — Edit mode & the self-check mark (4:02–4:16)

**Akash does / says:** Hover-selects **Edit**. Hover-selects a drag handle and moves a tile. Hover-selects **Done**.
**On screen:** The Edit chip reads **Done** while edit is on. Move/resize handles appear on tiles. A sage self-check mark (`.mc-self-check`) sits on the tile corner and *follows* the tile to its new place after the drag. After Done, the handles clear; the mark stays on the moved tile.
**VO:** “Edit mode lets me drag a tile into place. The self-check mark follows the tile — it doesn’t get left behind.”
**Caption:** Edit, drag, Done. The sage self-check mark tracks the moved tile.
**Status: WORKS.** `src/canvas/selfCheck.ts`, edit board handles.

---

## Shot 10 — Morph a tile, review, undo (4:16–4:40)

**Akash does / says:** Hover-holds a lamp tile for about a second (a quick hover-select is just a tap). Says or types: “change the color to warm amber.” Hover-selects **Approve**. Then hover-selects **Undo** on the morph card (or says “undo”).
**On screen:** Morph card on the tile: “Desk lamp — what do you want to do?” then “Changing Desk lamp…”. Review title: **“morph: Desk lamp — change the color to warm amber.”** Approve / Reject / Ask for something else. After Approve, the card reads **“Changed.”** with **Undo** and **Close**. After Undo, the tile is back.
**VO:** “Hold a tile to morph it. I say ‘change the color to warm amber.’ The same review opens before anything is spliced. I approve, the tile changes, and Undo is right on the card.”
**Caption:** Hover-hold to morph; review before the splice; Approve; Undo on the card.
**Status: WORKS.**

---

## Shot 11 — Self-check (4:40–4:50)

**Akash does / says:** Holds on the finished board (or triggers a fresh check if one is in flight). Points at a sage mark.
**On screen:** Sage self-check marks on the lamp, speaker, plan, and connect tiles (`is-passed`). No warning marks on a healthy sim dashboard.
**VO:** “Every tile on this board has already checked itself — dump, tap-replay, overlap — and is marked sage.”
**Caption:** Self-check sage marks on a healthy board.
**Status: WORKS.**

---

## Shot 12 — Phones, chime, edge transfer, look-to-sync (4:50–5:22) — FF the chime wait

**Akash does / says:** Nothing Phone 3a on the left, iPhone on the right. Says “connect a device,” hover-selects **Join a phone**, and holds each phone near the laptop so it can hear the chime (if one is already remembered, looking at it or opening the app is enough). Hover-selects **Edit**, drags a dashboard tile past the **right** edge to the iPhone. Looks at the iPhone. Hover-selects **Pin on this device**. Optional: “Follow my hands.” On a phone, **Menu** still holds the same tools (Canvas, Hands and gestures, Testing).
**On screen:** Pairing card: “Playing a chime — hold your phone near this laptop. No typing, no scanning.” Phones show “Listening for laptop chime…” then “Phone connected.” Arrangement: Nothing left, iPhone right (`showPairing`, `createChimeListener`, `src/canvas/screenLayout.ts`). The laptop’s right edge glows only if the iPhone is paired. The tile lands on the phone (`createEdgeTransferController` in `src/canvas/edgeTransfer.ts` — one-hand **tile** drag, not a two-fist board fling). The phone **syncs** when he looks at it (`shouldSync` in `src/input/gazeSync.ts`) — look-to-sync, not a separate touch-unlock. **Pin on this device** (`togglePin` in `src/canvas/phonePin.ts`) keeps the board, including offline. Near the screen edge, **edge freeze** holds the last stable pose (`createEdgeGuard` in `src/canvas/handEdge.ts`) so the drag stays clean. “Follow my hands” aims the DockKit stand (`createGimbalFollow`); on the web: “The gimbal works in the iPhone app.” A small edit on the iPhone can show **Apple · on device** if that build is the one on the phone; the same edit on the Nothing should show **Gemini · cloud**. Confirm the badge on the actual build before saying it.
**VO:** “The phones join with a chime — no typing, no scanning. The Nothing sits on the left, the iPhone on the right. I drag a tile past the edge and it moves to that phone. When I look at the phone, it syncs. Pin it here and it keeps working even with the internet off. Changes from either phone still arrive as proposals I approve or reject.”
**Caption:** Chime pairing. Nothing left, iPhone right. Edge transfer, look-to-sync, pin on this device.
**Model / ledger:** Chime mic and gaze frames stay on-device. The mic is never uploaded.
**Status: PARTIAL.** Pairing, layout, look-to-sync, edge tile transfer, edge freeze, and phone pin **WORK**. Two-fist whole-board transfer and “look to unlock touch” as a distinct lock are **MISSING**. Gimbal hand-follow is **PARTIAL** (optional, untested). Automatic “devices with Mendcraft installed” discovery and swarm checkmarks are **MISSING**.

---

## Shot 13 — Close / pull back (5:22–5:36)

**Akash does / says:** Pulls back / says “show everything” so the full workspace is visible.
**On screen:** The whole canvas: pinned Living room dock, CAD board, Kannada or English labels as filmed, sage marks, side chips, phones as extra screens, and the Nano / Gemini terminals (ledger if still open).
**VO:** “On-device when it can, cloud when it must, and nothing is built until I approve it. That’s Mendcraft.”
**Caption:** Hybrid on-device intelligence. Human in control.

---

## End Card (5:36–5:41)

**Akash does / says:** (none)
**On screen:** “Mendcraft” wordmark, tagline: “Hybrid on-device intelligence. Human in control.”
**VO:** (none)
**Caption:** Mendcraft

Uncut, this is about **5:40**. FF the marked waits and the edit can sit nearer 3:00 without dropping a shot.

---

## Notes for the cut

- Two dashboard reviews, not one: **Draft: 2 lamps found in this room**, then **Better: grouped lights + a room plan.**
- Pill during the first dashboard build, in the sim walk, is **15 agents · Gemini 7 · Nano 8 · 0 B to cloud**, not “Nano 15 then Gemini 15.” Use the live pill if the counts differ.
- Tools are a **chip + top toolbar**, not a radial arc around the hand.
- Hover-select is **1.5 s**; two fists move a board. Do not say “pinch.”
- “save” **pins** the board as **Living room**; it does not only write a file.
- Reject / Ask for something else is always available; Reject leaves the canvas unchanged (useful B-roll if you want a beat of “nothing was built”).
- If a post-Approve build fails, the last good board is restored and the responsible terminal blinks red with a one-line reason. Optional B-roll; not in the main VO unless rehearsed.
- **WiZ (Shot 2b):** only claim the physical bulb when the bridge is up. **Spotify / Marshall (Shot 2d):** only claim them when the canvas tile is wired and the speaker is a Connect device.
- Live camera register, live thumbs-up after teach, chime pairing, edge drag, look-to-sync, and the iPhone’s **Apple · on device** badge are filming-day bits; a `?sim=1` walk uses scripted stand-ins.
- The **in-canvas browser** (`createReferencePanel` in `src/ui/referencePanel.ts`) **WORKS in studio** only. Leave it out of this take unless you add a short `/studio` cutaway.
- No on-screen keyboard. No user-testing claims. No third-party logos.
- Screenshots from the earlier sim walk: `/workspace/hackathon/firebase-hybrid/e2e-demo-run/script-v2/`.

---

## Gap check

Checked with `rg` on `src/` (and iOS plugin sources). WORKS means the function is in the tree; it may still need a live rehearsal.

| Beat | Status | Where |
|---|---|---|
| Crowded-room register lock | **WORKS** | `createScanFlow`, `applyOwnerLock`; `registerSignature` / `setOwnerHands` |
| “Connect devices and make a dashboard” | **PARTIAL** | `run()` → `connectRoom()` (Nano draft, then Gemini). Does not discover companions first |
| Chime pairing, Nothing left / iPhone right | **WORKS** | `showPairing`, `createChimeLoop` / `createChimeListener`, `screenLayout.ts` |
| Swarm checkmarks for connected devices | **MISSING** | Swarm is AI cursors (`swarmAgents.ts`) |
| “What do you want to connect next?” | **MISSING** | Closest: `mountConnectSheet` |
| Laptop camera recognises the Flow 2 Pro | **MISSING** | DockKit is `MendcraftGimbalPlugin.isAvailable()` on a docked iPhone |
| Gimbal point-to-connect | **PARTIAL** | `createGimbalFollow`, `parseGimbalSpeech`, `pointTurn` hard-codes `pointConnect('speaker')` |
| WiZ brightness | **WORKS** | `parseDeviceCommands`, `createWizAwareConnector`, `wizClient.ts` |
| Marshall / Bluetooth speaker | **MISSING** as a device | No Marshall or Web Bluetooth connector |
| Spotify on the canvas tile | **PARTIAL** | Full stack in `src/music/*` and `musicPanel.ts`. **Not wired** to the canvas tile |
| Approve window / AI activity / ledger | **WORKS** | `mountReviewDialog`, `showAi`, `createLedgerPanel` |
| Red-flash rollback | **WORKS** (on real failure only) | `fail()`, `.is-failing`, `rollbackFix` |
| Floor plan drawing (walls, rooms, doors, dimensions, measure, palette, trash) | **WORKS** on canvas | `PlanBoardElement`, `createPlanRenderer`, `createPlanTools`, `createMeasureTool`, `createTrash` |
| Accessibility checker (door width, ramps) | **WORKS** in code, **PARTIAL** on canvas | `checkPlanAccessibility`, `PLAN_A11Y`. Voice line is in `src/main.ts` (studio) |
| 3D extrude and DXF export | **WORKS** in code, **PARTIAL** on canvas | `createExtrudeView` / `toggle3D`; `toDxf` / `controller.export()`. Buttons are in the studio shell |
| Add Kannada, kn-IN voice | **WORKS** on canvas | `addKannada`, `languageTurn`, `speechLang: 'kn-IN'` |
| Bilingual caption bar and spoken Kannada CAD reply | **WORKS** in studio, **PARTIAL** on canvas | `buildCaption`, `#caption-bar` in `src/main.ts` |
| Offline / airplane queue | **WORKS** | `setOnline`, `queueLater`, `deepLater`, `src/offline/queue.ts` |
| Teach a gesture | **WORKS** | `mountTeachPanel`, `customGestures.ts` |
| Edit, morph, self-check marks | **WORKS** | edit board, morph flow, `selfCheck.ts` |
| Pin / look-to-sync / phone pin / edge transfer | **PARTIAL** | Tile edge-drag, not two-fist board handoff. Look-to-sync, not touch-unlock |
| Edge pose freeze | **WORKS** | `createEdgeGuard` in `src/canvas/handEdge.ts` |
| Gimbal tracks hands | **PARTIAL** (optional, untested) | `followWhileBuilding`, mode `'hands'` |
| In-canvas browser | **WORKS** in studio only | `createReferencePanel` |

---

## Open source we built on

The Google canvas / UI tool in this repo is **A2UI** (Agent-to-UI), not “AI2U.” Packages in `package.json`: `@a2ui/lit` and `@a2ui/web_core`, both `^0.15.0`. Upstream: https://github.com/google/A2UI. Boards are A2UI v0.9 surfaces: the model proposes a validated surface plan (`src/canvas/surfacePlan.ts`), then Lit custom elements in `src/canvas/widgets.ts` render it (`A2uiLitElement`, `MessageProcessor` from `@a2ui/web_core/v0_9`). The README already links this.

**Exact wording for Devpost (Built With / “What did you use?”):**

> Mendcraft’s boards are built with Google’s open-source **A2UI (Agent-to-UI)** library (`@a2ui/lit` and `@a2ui/web_core`). Models never emit raw HTML; they propose a validated surface plan that A2UI renders with Lit. Hands and faces are tracked on-device with **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`). Hybrid inference goes through **Firebase AI Logic** (`firebase/ai`): Gemini Nano on device, Gemini in the cloud. The iPhone and Android apps use **Capacitor**. 3D plan views use **Three.js** (and `three-bvh-csg`). We also use Lit, Zod, and Vite.

Other dependencies actually used: `@capacitor/core` / `ios` / `android`, `firebase` `^13.3.0`, `lit`, `three`, `zod`, `qrcode`. Dev tools (axe-core, Vitest, Puppeteer, TypeScript, Vite) can be listed if Devpost asks for them; they are not runtime features of the demo.

---

## Credits: Gemini API and Google Cloud

**Ideas to plan — not done. Do not change billing, attach a card, enable APIs, or spend credits unless Akash asks.** He has about **$29k** of Google Cloud credits plus Gemini API credits. Almost any honest plan for this demo will use a tiny fraction of that.

**Contest constraint:** judging expects the app’s AI inference to go through **Firebase AI Logic**, not a raw Gemini API or a direct Vertex call. Prefer Firebase AI Logic on the existing `mendcraft` project. If a credit only applies to the raw Gemini API or to Vertex, say so in the plan and keep that work off the scored hybrid path unless Akash confirms it is allowed.

Ideas, with **rough cost per demo run** (verify current prices before anything is switched on; figures are order-of-magnitude only):

1. **Gemini via Firebase AI Logic for the heavy beats we already have** — floor-plan generation, the Kannada pack, live photo identify (room, lamp, gimbal), and a short plain-language explanation of accessibility findings. A 3–5 minute take is a handful of Flash / Flash-Lite calls, often **well under $0.10**. A hundred judge replays would still be **a few dollars**, not hundreds.
2. **Firebase Hosting** for a stable try-it link. The current preview channel expires 4 Dec. A Hosting deploy of the static app is **pennies**. Do not deploy production without Akash.
3. **Cloud Run (or Cloud Functions) for a judge replay server** — serve `?sim=1&play=1` (and a recorded hand/voice walk) so judges can try the canvas without a camera. Scale-to-zero is usually **cents per day** of light traffic; an always-on min instance is the one line that can reach tens of dollars a month, so default to scale-to-zero.
4. **Vertex AI / Imagen for still renders** of a floor plan or a room hero frame, only if it can be called in a way that does not break the Firebase AI Logic rule — or as pre-rendered B-roll, not live inference. Imagen-class stills are often **a few cents per image**. Do not add a live image path to the scored demo until the rule is checked.
5. **Headroom** — leave the rest of the $29k unused. The film and the judge link do not need a big spend. A short written plan (what, which API, estimated cost per run, and what is out of scope) is enough.

---

## Build list

Docs only — do not start this work from the agent that wrote this file. Do it on the Mac, in `~/Developer/mendcraft-sim`, on `sim-main`. No force-push, no production deploy, no secrets in the repo, **no billing changes**. Keep Nano / Gemini badges and the ledger honest; never invent a cloud call or a device that was not identified.

Do these in order. Stop after each one and check the acceptance line.

### 1. Live point-to-connect on the canvas

- Touch: `pointTurn` in `src/canvas/canvasApp.ts` (stop hard-coding `pointConnect('speaker')`); `pointConnect` in `src/canvas/connectTurns.ts`; `identifyDevice` in `src/ai/hybrid.ts`; `parseGimbalSpeech` in `src/canvas/gimbalCanvas.ts`; the `run()` router in `canvasApp.ts`.
- Accept “use the gimbal to connect to what I point at” and “connect to what I point at.”
- Hold a point, take a frame from the gimbal if present, otherwise the laptop camera, run `identifyDevice`, and propose that tile. If identify fails, say so; do not silently propose a speaker.
- **Accept:** Point at the WiZ lamp → lamp (WiZ) review. Point at a speaker → speaker tile. The new phrases route here.

### 2. “Connect devices” should pair phones first, then ask what’s next

- Touch: the `connect (everything|…|devices?)` branch and `connectRoom()` in `canvasApp.ts`; `mountConnectSheet` / `showPairing`. Use a small connected-device row with a check, not the AI swarm cursors.
- **Accept:** After “connect devices and make a dashboard,” both phones can join and appear with checks, and the lamp dashboard review does not jump the queue.

### 3. Wire the canvas speaker tile to Spotify

- Touch: `defaultConnector` / `simulatedConnector` in `canvasApp.ts`; reuse `src/music/musicSession.ts`, `parseMusicIntent`, `searchAndPlay`, `transferPlayback`.
- Prefer a Spotify Connect speaker (the Marshall, if it is already in `/me/player/devices`); otherwise this browser. If Spotify is not connected, keep the built-in player and say so.
- **Accept:** “Play [track]” shows the real title, audio comes from the Marshall when it is a Connect device, ledger shows job `spotify`.

### 4. Two-fist a board to a paired phone

- Touch: two-fist move in `handPointer.ts` / `canvasApp.ts`; `createEdgeTransferController` in `edgeTransfer.ts`.
- **Accept:** Two-fist the Living room board, drag to the right edge, it appears on the iPhone; look-to-sync and **Pin on this device** still work.

### 5. Expose CAD extras on the canvas plan board

- “Check accessibility,” **3D** extrude, and **Export DXF** already exist (`isAccessibilityRequest`, `checkPlanAccessibility`, `toggle3D` / `createExtrudeView`, `toDxf` / `controller.export()`) but the voice line and buttons are in the studio shell (`src/main.ts`).
- Put the same controls on the canvas `PlanBoardElement` (or route the voice lines in `canvasApp.ts` `run()`).
- **Accept:** On `canvas.html`, after “floor plan for Mrs Sharma’s flat,” you can say “check accessibility” and see door-width / ramp findings, toggle 3D, and download `mendcraft-plan.dxf`, without opening `/studio`.

### 6. Canvas caption bar for Kannada

- Reuse `buildCaption` in `src/ai/language.ts` on the canvas Talk caption (`micFab.ts`), not only `#caption-bar` in studio.
- **Accept:** A Kannada utterance shows the heard line and an English translation on `canvas.html`, and a kn-IN voice still speaks the reply when a Kannada voice is installed.

### 7. Delete the on-screen keyboard

The demo will not show pinch-to-type. Remove the feature from the app.

- Delete (or empty and unhook) `src/ui/onscreenKeyboard.ts`, `src/input/keyboardLogic.ts`, `src/canvas/handKeyboard.ts`.
- Remove mounts and branches in `src/canvas/canvasApp.ts`, `src/canvas/handPointer.ts`, `src/main.ts`, and `src/ui/referencePanel.ts`.
- Update or remove tests: `tests/keyboardLogic.test.ts`, `tests/capsLock.test.ts`, `tests/canvas/handKeyboard.test.ts`, `tests/gestures/keyboard-hand-path.test.ts`, and keyboard-only parts of `tests/gestures/say-box-hand-path.test.ts`, `tests/gestures/t2-B-props-panel.test.ts`, `tests/gestures/browser-panel-hand-path.test.ts`.
- **Accept:** No on-screen keyboard appears in canvas or studio. `vitest run` is green. Hands can still use Talk, the say box, and hover-select. Do not leave a dead “Keyboard” button.

### 8. Optional, if the take still needs them

- Laptop recognises the Flow 2 Pro from a webcam photo (“Insta360 Flow 2 Pro — compatible with iPhone (DockKit)”). If this is shaky, keep the docked-phone workaround.
- “Build a dashboard” after devices are collected should use those devices, not only `SCRIPTS.nanoRoom` / `geminiRoom`.
- A safe, rehearsed rollback demo (responsible terminal blinks red, last good tile returns). Do not fake failures on the happy path.
- A **credits plan only** (no billing changes): how to use Firebase AI Logic, Hosting, and a scale-to-zero Cloud Run replay so judges can try the canvas without a camera, with an estimated cost per demo run and per 100 judge visits. Stay on Firebase AI Logic for inference.

When a beat is filmed on a workaround, update this file’s “Film today” notes so the next take stays honest.
