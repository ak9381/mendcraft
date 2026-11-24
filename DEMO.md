<!-- DRAFT only. Not submitted. Structure follows the v2 demo script; content updated 24 Nov 2026 for the live unified take. -->

# Mendcraft — Demo Video Script

Target runtime: uncut is about **5:40** (5s title + body + 5s end card). It will run **over 3:00** — that is fine. In the edit, **fast-forward** the sections marked **FF**. Do not drop a beat to hit 3:00. Leave the first fist-tap click, the first Approve, and the spoken lines at full speed.

Recorded on the sim-main preview (https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1), plus live camera, phones, WiZ, and Spotify when those are proven.

Every change on the canvas goes through the same review (**Approve** / **Reject** / **Something else**). Nothing is built until Approve. Reject leaves the canvas unchanged.

Gestures in the current build: **point with your palm**, **tap a fist to click** (close and open quickly), **hold a fist and move** to drag a board or pan the canvas, and **two fists** to zoom. **Hover to click** (rest the palm ~0.8 s) is an opt-in fallback in Tools for anyone who can't close their hand. Do not say “pinch.” Other buttons stay quiet while a grab is on. Hands **pause when you look clearly away** (the pill reads **Not facing**). There is **no on-screen keyboard**.

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

**Akash does / says:** Sits at the empty canvas, hands visible, no mouse. Says “show tools,” or taps a fist on the **Tools** chip if the bar is closed. Points at the side chips so they’re readable.
**On screen:** Empty infinite canvas. Centered lead: “Let's build something fun.” Right-side chips, top to bottom: **Re-register**, **Edit**, **Tools**, **Talk** (mic). A zoom HUD sits bottom-left, and the **Nano | Gemini** engine bar sits bottom-centre. After “show tools,” a *top toolbar* (not a radial arc around the hand): **Show everything**, **New board**, **Save**, **Undo**, **Hands**, **Hover to click**, **Re-register**, **Teach a gesture**, **Custom gestures**, **AI activity**, **AI monitor**, **Simulate offline**, plus a say box and **Go**.
**VO:** “This is Mendcraft. A canvas you drive with your voice and your hands — I built it for my mom, who has arthritis and speaks Kannada, and for anyone with limited hand use who still wants to run a room or draw a floor plan. ‘Show tools’ opens a toolbar along the top. Talk, Re-register, and Edit stay at the side.”
**Caption:** Tools chip and top toolbar — not a radial arc. Talk, Re-register, and Edit sit at the side.
**Model / ledger:** Nothing has left the device yet.
**Status: WORKS.** Do not claim a formal user study. The mom / Kannada frame is already in `/judges` and the landing page (`src/judges/judgesPage.ts`, `src/landing/shell.html`).

---

## Shot 2 — Connect devices, two reviews, dashboard (0:18–0:58) — FF the swarm / model stream

**Akash does / says:** Taps a fist on **Talk** and says: “Connect devices and make a dashboard to control them.” Pairing opens first (see below). When it asks “What do you want to connect next?”, taps the **build the dashboard** chip or says “build the dashboard.” When the first review opens, taps **Approve**. When the second opens, taps **Approve** again. Then opens **What left this device**.
**On screen:** **Pairing opens first**: a chime plays and each phone that joins shows as a paired row with a ✓ (SIM phones under `?sim=1` — label them). The iPhone’s entry gains a sub-state from what the iPhone really reports: **“Gimbal tracking ready”** (docked), **“Tracking you”** only once the plugin confirms DockKit tracking is on, **“Following your hands”** while “follow my hands” runs, **“Camera tracking you”** when only the iPhone camera senses (the stand is not claimed), **“Hands: on”** if its Hands pill is on, and when undocked **“No gimbal — the iPhone camera can still point”** (or **“No gimbal — pointing uses the laptop camera”** if its camera is unavailable). Under `?sim=1`: “SIM · Gimbal tracking ready”. Then it asks **“What do you want to connect next?”** with three chips: **Point at a device**, **Name a device**, **Build the dashboard** (Shot 2c uses the first). “Build the dashboard” (chip or voice) starts the two reviews. The **AI panel auto-opens while the models work and hides afterwards**. A swarm of small colour-coded agent cursors (Gemini blue, Nano green) moves across the canvas, with two live terminals — “nano · on this device” and “gemini · cloud”. The old swarm pill is replaced by the **engine bar** (Nano | Gemini, bottom-centre); read the live counts from it. The **floating review window** (now resizable) opens: **“Draft: 2 lamps found in this room”**, with **Approve**, **Reject**, and **Something else**. It shows **THE PLAN** (+ add / ~ change / − remove), an **engine chip**, a **“Why …”** line and **“What left this device · N KB”** per turn. After the first Approve, **“Better: grouped lights + a room plan.”** After the second Approve, the Living room dashboard lands: lamp tiles, a speaker tile, a small room plan, a connect tile. Sage self-check marks may already sit on healthy tiles. The ledger lists each cloud call and its bytes.
**VO:** “I say ‘Connect devices and make a dashboard to control them.’ The phones pair first, with a chime and a check each. Then a swarm of cursors — Gemini blue, Nano green — walks the real steps, logged in two terminals. The engine bar is honest about the mix. Every change waits for me. I approve the on-device draft, then Gemini’s tighter grouping. Only then does the dashboard land. And this ledger is the privacy note — what ran on this device, and what went to the cloud.”
**Caption:** Pair first, then two reviews (Draft, then Better). Nothing is built until Approve. Ledger open.

**Note:** pair-first is in the code. The checks are on the paired-device rows, not the swarm cursors (the swarm is AI agents). The dashboard still starts from the scripted two lamps, not from the devices collected.

**Model / ledger:** First turn **Gemini Nano · on device**. Handoff **Nano → Gemini**. Second turn **Gemini · cloud**. Footer from `setFooterBytes`.
**Rollback / red flash:** If a build fails after Approve, the last good board is restored and the responsible terminal blinks red (`EnginePanelUi.fail` in `src/canvas/modelPanels.ts`, `.mc-terminal.is-failing` in `src/canvas/canvas.css`; also `rollbackFix` in `src/canvas/selfCheck.ts`). Only show this if you have a rehearsed, safe failure (see the build list). Do not invent a crash.
**Status: WORKS** for the two reviews, AI activity, the floating approve window, the ledger, self-check marks, and fail/rollback when a failure happens. **PARTIAL** for “a red flash in every take” and for the dashboard, which still starts from the scripted two lamps.

---

## Shot 2b — Dim the lamp / WiZ cutaway (0:58–1:08)

**Akash does / says:** Says “increase the brightness,” or taps a fist on a brightness control on a lamp tile. Looks at the real lamp when the command lands.
**On screen (canvas):** The lamp tile updates (`parseDeviceCommands` in `src/canvas/deviceCommands.ts`).
**On screen (real-world cutaway):** A reachable WiZ lamp on the LAN should change (`createWizAwareConnector`, `src/devices/wizClient.ts`). If the bridge is down, the tile is labelled **SIM** — hold on the board only and drop the VO sentence about the physical bulb.
**VO (when the real lamp is filmed):** “Increase the brightness — and the physical WiZ lamp changes.”
**VO (canvas-only fallback):** “The lamp tile responds on the board.”
**Caption:** On-canvas lamp control. Physical WiZ bulb only if the bridge is up.
**Model / ledger:** Lamp control is local (LAN bridge), not a Gemini job.
**Status: WORKS** when the bridge is up; otherwise SIM only.

---

## Shot 2c — Gimbal and point-to-connect (1:08–1:32) — FF extra review waits

**Akash does / says:** After “What do you want to connect next?”, taps **Point at a device** (or says “connect to what I’m pointing at”). He **looks into the iPhone camera** and points at the WiZ lamp placed **next to his face** (inside the iPhone frame, within ~40 cm of the face), holding still ~0.6 s. Then the same with the **Marshall** next to his face. In the sim, the app may ask **“Which one — Reading lamp or Main light?”**; he answers, and the review opens.

**What the code does today:** with a paired iPhone that reports hand sensing, the laptop asks the **iPhone** to take the photo (`sensePoint` over the relay). On the iPhone the gimbal **holds**, the sensing layer (hand frames on the iPhone’s one shared camera — not gated by facing, because he looks at the device) waits for a steady point, a crop is cut along the knuckle→fingertip ray from the **same camera stream** (about 0.42–0.45 m across at 0.75 m: 42–45 % of a landscape frame, 60–65 % of a portrait one; the iPhone stream is 1280×720), and identify runs on the iPhone (on device first, cloud second). Only the identity comes back to the laptop, which proposes the tile through the normal review; the iPhone’s monitor tab shows what stayed on device and what crossed. If the ray points out of the frame: “I can’t see what you’re pointing at — move the device into the camera’s view.” (no guess). A **speaker** is a software tile: pointing at the Marshall proposes a music tile labelled **Marshall speaker** and says “Speaker added — it will play through Spotify Connect if your Marshall is awake in Spotify.” (never “connected”). A **lamp** still needs a connected WiZ device. Lamp and speaker both at the fingertip → “Which one — the lamp or the speaker?”. With no sensing iPhone paired, the laptop camera path (Hands on) is the fallback and says so. In the sim the identity is scripted and labelled SIM. The gimbal does not pan toward the finger (follow-up).

**Film today:** iPhone docked, **its Hands pill OFF** (control is optional; film with it off unless showing it). Tap **Point at a device**, look into the iPhone camera, point at the lamp beside the face, hold. Taps **Approve**. Repeat for the Marshall, then “play <song>”. FF the identify wait. **Verify on the day** (checklist G11–G16) before filming; if the iPhone photo misses, use the laptop-camera fallback (Hands on the laptop). Say “the gimbal follows my face (DockKit tracking)” only if G1/G2 passed.
**On screen:** Each connect is a Proposal with its engine chip. By-name connects (“connect the lamp”) remain available as a fallback and are Nano, no photo.
**VO:** “The iPhone on the gimbal sees my hand. I point at the lamp, hold, and it identifies it — then the speaker. Each connection waits for Approve.”
**Caption:** Point-to-connect: hold a point, confirm, Approve.
**Model / ledger:** Plugin check is local. Point-to-connect sends a photo to identify only if the ledger says so — read the live ledger before claiming bytes. By-name is Nano, no photo.
**Status:** Point-to-connect **WORKS** on the laptop camera (rehearse live; the sim uses a scripted choice). Pointing from the iPhone camera **BUILT, UNVERIFIED on the device** (test G11–G16). Speaker point → software music tile **WORKS** in tests. Laptop-camera gimbal recognition **MISSING**. DockKit face follow **UNVERIFIED** (test G1–G2).

---

## Shot 2d — Spotify on the speaker (1:32–1:45)

**Akash does / says:** Only if Spotify is signed in on the web app and the Marshall is already a Spotify Connect device: “Play [track] on the speaker.” Looks at the Marshall only if it is actually receiving audio. If that path is not proven, skip the spoken claim and leave the canvas Play control alone, or say only that Spotify is connected.
**On screen:** If it works, the music tile shows the real track. If Spotify is not connected, the tile falls back to the **simulated** player and a canned track (e.g. “Morning light”) — label that SIM. The stack is `src/ui/musicPanel.ts` and `src/music/musicSession.ts` (`searchAndPlay`, `transferPlayback`). No Marshall-specific or Web Bluetooth code.
**VO (only if proven):** “We’ve connected to Spotify, and that’s playing on the Marshall.”
**Caption:** Spotify over the speaker only if the canvas tile is wired and the Marshall is a Connect device.
**Model / ledger:** Job `spotify` — commands and search text only, no tokens in the ledger.
**Status: PARTIAL.** The canvas speaker tile is built to use Spotify but is **not yet verified** — it needs Premium and the Marshall as a Connect device. Studio music panel **WORKS**. If unverified on the day, keep the spoken claim out.

---

## Shot 3 — Save pins the dashboard (1:45–1:53)

**Akash does / says:** Taps a fist on **Talk** (or the say box) and says “save.” The saved room board also shows a chip once Try-to-break-it has run (see below).
**On screen:** Status: “Saved Living room at [time].” The Living room dashboard pins to a side dock titled **“Living room”**, with an **Unpin** control. The dock stays interactive.
**VO:** “I say ‘save.’ The dashboard pins to the side as Living room — still live, just out of the way.”
**Caption:** Voice “save” pins the dashboard to the Living room dock.
**Status: WORKS.** `parseCanvasCommand` / `reg.setPinned`.

---

## Shot 4 — Floor plan and CAD (1:53–2:38) — FF the model stream; keep the drawing at full speed

**Akash does / says:** Taps a fist on **Talk** and says: “floor plan for Mrs Sharma's flat.” Taps **Approve**. Then, on the live plan board: points at a door and a dimension; opens the plan **component palette**; uses the **measure tool** (or two-hand measure) and keeps a dimension; taps **Check** (or says “check accessibility”); toggles **3D**; taps **DXF**.
**On screen:** A new CAD board appears beside the pinned dashboard (review first). Terminals: Nano logs the raw request and a redact line (Sharma → `[Client A]`) before a byte reaches “gemini · cloud”, whose log never shows the raw name. Footer shows the real cloud bytes (the sim walk was **2.2 KB**). Review title: **“Floor plan: two bedrooms.”** After Approve, the board is a live drawing: **rooms, walls, doors, windows, and dimensions** (`PlanBoardElement` in `src/canvas/widgets.ts` wraps `createPlanController` and `createPlanRenderer`). Palette and furniture flyout: `createPalette`, `createPlanTools`, `FURNITURE_FLYOUT` in `src/plan/tools.ts`. **Trash zone** on the same board (`createTrash` in `src/core/palette.ts`). Measure: `createMeasureTool` / `beginTwoHandMeasure`. Accessibility findings (door clear width 815 mm min / 850 mm recommended, ramp slope 1:12, corridors, stairs): `checkPlanAccessibility` in `src/plan/accessibility.ts`, `PLAN_A11Y` in `src/core/a11y.ts`. 3D walls: `toggle3D` / `createExtrudeView` in `src/plan/extrude3d.ts`. DXF: `controller.export()` → `toDxf` in `src/plan/export.ts` (`mendcraft-plan.dxf`).
**VO:** “Next: ‘floor plan for Mrs Sharma’s flat.’ Nano redacts Sharma to Client A before Gemini ever sees the prompt, and the footer shows exactly what left this device. I approve, and the CAD board renders — rooms, doors, walls, dimensions. It can check a door width or a ramp, open in 3D, and export a DXF.”
**Caption:** Nano redacts the name; CAD board with dimensions; Check / 3D / DXF buttons on the board.
**Model / ledger:** Redaction on-device, then **Gemini · cloud** for the plan. The checker itself is deterministic code. An explanation of the issues, if shown, may go to the cloud — if it does, the ledger should show it. Do not say the plan is ADA-compliant.

**On the canvas:** walls, rooms, doors, dimensions, measure, the furniture palette, the trash zone, and the **Check**, **3D** and **DXF** buttons on the plan board all **WORK** on the canvas. Film them there; no `/studio` cutaway is needed.

**Status:** drawing tools, Check, 3D and DXF **WORK** on the canvas. Do not say the plan is ADA-compliant.

---

## Shot 5 — Add Kannada (2:38–2:58) — FF the pack stream; keep Approve and the language switch at full speed

**Akash does / says:** Taps a fist on **Talk** and says “add Kannada.” Taps **Approve**. Optional, if the pack is on: a short rehearsed Kannada command so the Talk caption shows the Kannada words.
**On screen:** Both terminals log the same handoff: Nano asks Gemini to plan the Kannada pack because it is too complex on-device (`addKannada` / `languageTurn` in `src/canvas/canvasApp.ts`). Review title: **“Add Kannada.”** After Approve, labels, tiles, and controls switch into Kannada script. Spoken replies use **kn-IN** (`resolveLanguage` in `src/ai/language.ts`, `opts.voice.setLang`; `src/ai/speechVoices.ts` prefers a Kannada voice when one is installed).
**VO:** “Now, ‘add Kannada.’ Both terminals log the real reason: Nano asks Gemini to plan the pack because it’s too complex on-device, and Gemini hands the labels back for Nano to apply locally. I approve, and the interface switches into Kannada.”
**Caption:** Handoff with the real reason; review; Approve; UI in Kannada; kn-IN voice.

The canvas Talk caption now pairs the heard Kannada line with an English translation (`buildCaption` in `src/ai/language.ts`, `micFab.ts`). Film a short rehearsed Kannada utterance to show it.

**Model / ledger:** **Nano → Gemini**, then **Gemini · cloud**. Receipt: the key list and the request — no board data, no device addresses.
**Status: WORKS** for “add Kannada,” the review, the UI pack, and kn-IN on the canvas. The paired Kannada caption on the canvas **WORKS**; rehearse it live. A spoken Kannada CAD reply is still studio-only.

---

## Shot 6 — Undo, offline queue, reconnect (2:58–3:20) — FF the wait; keep the queue badge and the reconnect review at full speed

**Akash does / says:** Says “undo” (back to English). Taps a fist on **Simulate offline** (the button reads **“Offline (simulated)”** while down). Taps **Talk** and says “add Kannada” again. Taps **Simulate offline** again to reconnect. Taps **Approve** on the review that follows.
**On screen:** After undo, English chrome is back. Offline: Nano’s panel shows **“N request(s) queued offline — will run on reconnect.”** On-device work still runs; a job that needs the cloud waits (`setOnline` in `canvasApp.ts`, `net.queueLater`, `deepLater` for a dashboard’s Gemini pass, and `src/offline/queue.ts` in the studio). On reconnect: “Back online. Running N saved request(s).” The same **“Add Kannada”** review opens. After Approve, Kannada is back. A pinned phone board also keeps working offline; the WiZ lamp can still be reached on the LAN.
**VO:** “Undo takes us back to English. If the network drops, edits that can stay on this device still work. A job that needs the cloud — like adding Kannada — waits in the queue, honestly labelled. The moment we’re back, it runs and still waits for me to approve.”
**Caption:** Undo to English. Offline requests queue in Nano’s panel and are reviewed on reconnect.
**Status: WORKS** on the canvas for Simulate offline, the Kannada queue, the Deep-dashboard queue, and window `offline`/`online` events.

---

## Shot 7 — Teach a gesture (3:20–3:42) — FF the sample holds after the first repetition is clear

**Akash does / says:** Taps a fist on **Teach a gesture**. Records a thumbs-up (or another pose) two or three times (live camera when filming; sim uses synthetic samples). Says or types “save the canvas” in “What should it do?”, then **Go**. Taps **Approve**. Optional, if filming live: gives the thumbs-up; the canvas saves.
**On screen:** Teach panel: “Stays on this device” (`mountTeachPanel` in `src/canvas/teachPanel.ts`, `src/input/customGestures.ts`, IndexedDB — never Firestore). After the samples, “What should it do?” Review: **“Teach: Save the canvas.”** After Approve: “Learned it — Save the canvas, stays on this device.” Custom / remappable gestures are in **Custom gestures**.
**VO:** “You can teach Mendcraft a gesture. I record a thumbs-up, say ‘save the canvas,’ and approve. From now on, a thumbs-up saves — on this device, with a human in the loop.”
**Caption:** Teach a gesture on-device; review before the bind; Approve.
**Model / ledger:** Recording is on-device. If parsing the action uses a model, the badge and ledger must say so.
**Status: WORKS.**

---

## Shot 8 — Register (3:42–4:02) — FF the hold rings after the face is clearly started

**Akash does / says:** Taps a fist on the **Register** chip (it reads **Re-register** once you are registered; leave this first tap at full speed). Looks at the camera, then shows an open left palm, then the right, each until the ring fills. (Sim uses a scripted replay.)
**On screen:** Scan title: **“Register you.”** Prompts: “Look at the camera and hold still.” → “Show your open LEFT palm.” → “Now your open RIGHT palm.” → “Registered — tracking locked to you.” The side chip and toolbar switch to **Re-register**.
**VO:** “I register last so you can see it clearly — but in a crowded room, after this, only my face and hands are tracked. The canvas follows the person who owns it.”
**Caption:** Register you; tracking locked to the owner. Re-register is on the toolbar afterwards.
**Model / ledger:** All on this device. Signatures stay in `sessionStorage` (`mc.owner.v2`). No cloud call.
**Status: WORKS.** `createScanFlow` in `src/canvas/scanRegistration.ts`; `applyOwnerLock` in `src/canvas/canvasApp.ts` (`registerSignature`, `setOwnerHands`). Other faces are dimmed (`src/input/faceLogic.ts`); other hands are rejected (`src/input/handBinding.ts`, `rejectedHands`).

---

## Shot 9 — Edit mode & the self-check mark (4:02–4:16)

**Akash does / says:** Taps a fist on **Edit**. Grabs a drag handle with a **held fist** and moves a tile. Taps **Done**.
**On screen:** The Edit chip reads **Done** while edit is on. Move/resize handles appear on tiles. A sage self-check mark (`.mc-self-check`) sits on the tile corner and *follows* the tile to its new place after the drag. After Done, the handles clear; the mark stays on the moved tile.
**VO:** “Edit mode lets me drag a tile into place. The self-check mark follows the tile — it doesn’t get left behind.”
**Caption:** Edit, drag, Done. The sage self-check mark tracks the moved tile.
**Status: WORKS.** `src/canvas/selfCheck.ts`, edit board handles.

---

## Shot 10 — Morph a tile, review, undo (4:16–4:40)

**Akash does / says:** Long-presses a lamp tile **with the mouse or touch** (about a second) — or opens the morph card by voice. Says or types: “change the color to warm amber.” Taps **Approve**. Then taps **Undo** on the morph card (or says “undo”).
**On screen:** Morph card on the tile: “Desk lamp — what do you want to do?” then “Changing Desk lamp…”. Review title: **“morph: Desk lamp — change the color to warm amber.”** Approve / Reject / Something else. After Approve, the card reads **“Changed.”** with **Undo** and **Close**. After Undo, the tile is back.
**VO:** “I open the morph card on a tile and say ‘change the color to warm amber.’ The same review opens before anything is spliced. I approve, the tile changes, and Undo is right on the card.”
**Caption:** Morph card; review before the splice; Approve; Undo on the card.
**Film today:** morph-by-hand is **not reachable any more** (the pinch gesture it relied on was removed). Film the open step by mouse/touch long-press or voice, and do not say or imply a hand gesture opens it.
**Status: PARTIAL.** The morph card, review, and undo **WORK**; opening it by hand is **MISSING**.

---

## Shot 11 — Self-check (4:40–4:50)

**Akash does / says:** Holds on the finished board (or triggers a fresh check if one is in flight). Points at a sage mark.
**On screen:** Sage self-check marks on the lamp, speaker, plan, and connect tiles (`is-passed`). No warning marks on a healthy sim dashboard.
**VO:** “Every tile on this board has already checked itself — dump, tap-replay, overlap — and is marked sage.”
**Caption:** Self-check sage marks on a healthy board.
**Status: WORKS.**

---

## Shot 12 — Phones, chime, board to phone, look-to-sync (4:50–5:22) — FF the chime wait

**Akash does / says:** Nothing Phone 3a (Android) on the left, iPhone on the right. In the phone app he taps **Join laptop**; the laptop chimes and each phone shows as connected. Then he drags it by the title with a **held fist** (or the mouse) to the laptop edge nearest the paired phone and **holds it there ~0.2 s**. The board lands on the phone and the laptop board snaps back. Looks at the iPhone; taps **Pin on this device**. Optional: “Follow me” (the gimbal follows his face via DockKit tracking — **verify on the day**, checklist G). On the Android phone, the **Hands** pill gives hand control through the phone’s front camera. The iPhone is docked on the gimbal and is **not** hand-controlled.
**On screen:** Pairing: the **Join laptop** pill in the phone app and the chime; phones show “Phone connected” (`showPairing`, `createChimeListener`, `src/canvas/screenLayout.ts`). The laptop’s edge glows only if that phone is paired. Board-to-phone is a **hold at the paired phone’s edge** (`createEdgeTransferController` in `src/canvas/edgeTransfer.ts`) — not a tile drag, and not the old “MISSING” two-fist fling. The phone **syncs** when he looks at it (`shouldSync` in `src/input/gazeSync.ts`). **Pin on this device** (`togglePin` in `src/canvas/phonePin.ts`) keeps the board, including offline. Near the screen edge, **edge freeze** holds the last stable pose (`createEdgeGuard` in `src/canvas/handEdge.ts`). “Follow me” turns on DockKit’s own tracking (`gimbalCanvas.ts` face mode) and the status line says what is really on (“DockKit tracking on — needs a camera app/camera running”) or the plugin’s error; “follow my hands” on the iPhone says “Hand following needs a hand tracker — following your face instead”; on the web: “The gimbal works in the iPhone app.” A small edit on the iPhone can show **Apple · on device** if that build is the one on the phone; the same edit on the Nothing should show **Gemini · cloud**. Confirm the badge on the actual build before saying it.
**VO:** “The phones join with a chime. The Nothing is hand-controlled; the iPhone rides the gimbal, which follows me. I drag the board to the edge, hold, and it moves to that phone. When I look at the phone, it syncs. Pin it here and it keeps working with the internet off. Changes from either phone still arrive as proposals I approve or reject.”
**Caption:** Join laptop + chime. Hold the board at the phone’s edge. Look-to-sync, pin on this device.
**Model / ledger:** Chime mic and gaze frames stay on-device. The mic is never uploaded. Relay traffic between devices goes through Firestore (cloud); say that the **names never reach the AI model**, not that they never leave the phone.
**Status: PARTIAL.** Pairing, layout, look-to-sync, board-to-phone, edge freeze, and phone pin **WORK**; the Android phone hand control **WORKS** (rehearse). Gimbal face follow (DockKit tracking) is **UNVERIFIED** — film the iPhone-on-gimbal beat as following + the **Apple · on device** badge only if G passes. Gimbal hand-follow on the iPhone is **BUILT, UNVERIFIED** (“follow my hands” turns on the iPhone’s hand sensing; test G12). iPhone hand **control** (Hands pill) is optional, off by default and only acts while he faces the phone. Automatic “devices with Mendcraft installed” discovery beyond pairing is **MISSING**.

---

## Shot 12b — Try to break it (short; FF the Nano wait)

**Akash does / says:** Says “set the main light to 500% brightness.”
**On screen:** The request is **refused**. The Nano card turns **red** and reads **“Decided on this device · 0 B sent.”** The board is unchanged. A chip appears on the saved room board noting the refusal.
**VO:** “Ask it to do something it shouldn’t, and the on-device model says no — nothing left this device, and the board didn’t change.”
**Caption:** Refusal decided on this device. 0 B sent. Board unchanged.
**Model / ledger:** Decided by Nano; read the live byte count before saying “0 B.” Do not stage a refusal that did not happen.
**Status: WORKS** (rehearse the exact phrasing).

---

## Shot 12c — AI monitor on the ultrawide (short; FF the walk-through)

**Akash does / says:** Taps a fist on **Tools → AI monitor** on the ultrawide. Switches tabs **Laptop / iPhone / Android** with **1 / 2 / 3** and toggles **Follow** with **F**. Lets one request play through.
**On screen:** The wow moments: a **packet crossing** with its real size, **redaction** of a name, and a **refusal in red**.
**VO:** “This is the whole system in one view: what each device asked, what crossed to the cloud, and what was refused.”
**Caption:** AI monitor: real packet sizes, redaction, refusal.
**Film today:** the sim shows a **SIM banner**. Do **not** film the sim for the final video unless it is labelled SIM. Film the live rig.
**Status: WORKS** (live rig needed for the final).

---

## Judge replay (a Devpost “try it” link, not a shot)

`?replay=demo` plays an automatic walk of about **80 s**, with a banner and a **Stop** button. Put it in the Devpost description as the no-camera try-it link. It is a replay, not live inference — say so.

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
- The swarm pill is gone; read the mix from the **engine bar** (Nano | Gemini). The AI panel auto-opens while models work and hides after.
- Tools are a **chip + top toolbar**, not a radial arc around the hand.
- Click is a **fist tap** (close and open, ~0.1–0.3 s); a **held fist** drags a board or pans; **two fists** zoom. **Hover to click** (~0.8 s) is an opt-in fallback in Tools. Hands pause on **Not facing**. Do not say “pinch.”
- “save” **pins** the board as **Living room**; it does not only write a file.
- Reject / Something else is always available; Reject leaves the canvas unchanged (useful B-roll if you want a beat of “nothing was built”).
- If a post-Approve build fails, the last good board is restored and the responsible terminal blinks red with a one-line reason. Optional B-roll; not in the main VO unless rehearsed.
- **WiZ (Shot 2b):** only claim the physical bulb when the bridge is up. **Spotify / Marshall (Shot 2d):** only claim them when the canvas tile actually plays and the speaker is a Connect device.
- Privacy wording: say **names never reach the AI model**. Never say they never leave the phone — relay traffic goes through Firestore (cloud).
- Live camera register, live thumbs-up after teach, chime pairing, edge hold, look-to-sync, and the iPhone’s **Apple · on device** badge are filming-day bits; a `?sim=1` walk uses scripted stand-ins.
- The **in-canvas browser** (`createReferencePanel` in `src/ui/referencePanel.ts`) **WORKS in studio** only. Leave it out of this take unless you add a short `/studio` cutaway.
- No user-testing claims. No third-party logos.
- Screenshots from the earlier sim walk: `/workspace/hackathon/firebase-hybrid/e2e-demo-run/script-v2/`.

---

## Gap check

Checked with `rg` on `src/` (and iOS plugin sources). WORKS means the function is in the tree; it may still need a live rehearsal.

| Beat | Status | Where |
|---|---|---|
| Crowded-room register lock | **WORKS** | `createScanFlow`, `applyOwnerLock`; `registerSignature` / `setOwnerHands` |
| “Connect devices and make a dashboard” | **WORKS** | Pairing first, then “What do you want to connect next?”, then `connectRoom()` (Nano draft, then Gemini). Dashboard still uses the scripted lamps |
| Chime pairing, Nothing left / iPhone right | **WORKS** | `showPairing`, `createChimeLoop` / `createChimeListener`, `screenLayout.ts` |
| Checkmarks for connected devices | **WORKS** | ✓ on paired-device rows (not the swarm; `swarmAgents.ts` is AI cursors) |
| “What do you want to connect next?” | **WORKS** | Asked after pairing |
| Laptop camera recognises the Flow 2 Pro | **MISSING** | DockKit is `MendcraftGimbalPlugin.isAvailable()` on a docked iPhone |
| Point-to-connect | **WORKS** | `pointTurn`, `parseGimbalSpeech`; asks “Which one — …?” when unsure |
| Try to break it (refusal, 0 B) | **WORKS** | Nano refusal card, chip on saved room board |
| AI monitor | **WORKS** (sim shows SIM banner) | Tools → AI monitor |
| Judge replay | **WORKS** | `?replay=demo` |
| WiZ brightness | **WORKS** | `parseDeviceCommands`, `createWizAwareConnector`, `wizClient.ts` |
| Marshall / Bluetooth speaker | **MISSING** as a device | No Marshall or Web Bluetooth connector |
| Spotify on the canvas tile | **BUILT, unverified** | Needs Premium and the Marshall to verify |
| Approve window / AI activity / ledger | **WORKS** | `mountReviewDialog`, `showAi`, `createLedgerPanel` |
| Red-flash rollback | **WORKS** (on real failure only) | `fail()`, `.is-failing`, `rollbackFix` |
| Floor plan drawing (walls, rooms, doors, dimensions, measure, palette, trash) | **WORKS** on canvas | `PlanBoardElement`, `createPlanRenderer`, `createPlanTools`, `createMeasureTool`, `createTrash` |
| Accessibility checker (door width, ramps) | **WORKS** on canvas | `checkPlanAccessibility`, `PLAN_A11Y`; Check button |
| 3D extrude and DXF export | **WORKS** on canvas | `createExtrudeView` / `toggle3D`; `toDxf`; 3D and DXF buttons |
| Add Kannada, kn-IN voice | **WORKS** on canvas | `addKannada`, `languageTurn`, `speechLang: 'kn-IN'` |
| Bilingual caption (Kannada + English) | **WORKS** on canvas | `buildCaption`, `micFab.ts`. Spoken Kannada CAD reply still studio |
| Offline / airplane queue | **WORKS** | `setOnline`, `queueLater`, `deepLater`, `src/offline/queue.ts` |
| Teach a gesture | **WORKS** | `mountTeachPanel`, `customGestures.ts` |
| Edit, self-check marks | **WORKS** | edit board (held-fist handle), `selfCheck.ts` |
| Morph by hand | **MISSING** | Pinch removed; morph opens by mouse/touch long-press or voice |
| Board to phone / look-to-sync / phone pin | **WORKS** | Hold the board at the paired phone’s edge (~0.2 s); look-to-sync, not touch-unlock |
| Android phone hand control | **WORKS** | Hands pill, shared front camera. iPhone is not hand-controlled |
| Edge pose freeze | **WORKS** | `createEdgeGuard` in `src/canvas/handEdge.ts` |
| Gimbal follows face | **UNVERIFIED** (DockKit system tracking; test G) | `gimbalCanvas.ts` mode `'face'`, `MendcraftGimbalPlugin.setSystemTrackingEnabled` |
| Gimbal tracks hands | **BUILT, UNVERIFIED** (iPhone sensing layer feeds mode `'hands'`) | `phoneSensor.ts`, `gimbalCanvas.ts` |
| Point from the iPhone camera | **BUILT, UNVERIFIED** (laptop camera is the fallback) | `phoneSensorPoint` / `onIphonePointResult` in `canvasApp.ts` |
| Room scan by gimbal | **MISSING** live (says so); SIM-labelled in `?sim=1` | `scanRoom` in `canvasApp.ts` |
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

Work items — do these on the Mac in `~/Developer/mendcraft-sim` on `sim-main`. No force-push, no production deploy, no secrets in the repo, **no billing changes**. Keep Nano / Gemini badges and the ledger honest; never invent a cloud call or a device that was not identified.

Items 1, 2, 4, 5, 6 and 7 are **DONE**; 3 is built and needs verifying. Acceptance lines are kept for the record.

### 1. Live point-to-connect on the canvas — DONE

- Touch: `pointTurn` in `src/canvas/canvasApp.ts` (stop hard-coding `pointConnect('speaker')`); `pointConnect` in `src/canvas/connectTurns.ts`; `identifyDevice` in `src/ai/hybrid.ts`; `parseGimbalSpeech` in `src/canvas/gimbalCanvas.ts`; the `run()` router in `canvasApp.ts`.
- Accept “use the gimbal to connect to what I point at” and “connect to what I point at.”
- Hold a point, take a frame from the paired iPhone’s camera when it senses hands (else the laptop camera), run `identifyDevice`, and propose that tile. If identify fails, say so; do not silently propose a speaker (a speaker is proposed only when identify sees one).
- **Accept:** Point at the WiZ lamp → lamp (WiZ) review. Point at a speaker → speaker tile. The new phrases route here.

### 2. “Connect devices” should pair phones first, then ask what’s next — DONE

- Touch: the `connect (everything|…|devices?)` branch and `connectRoom()` in `canvasApp.ts`; `mountConnectSheet` / `showPairing`. Use a small connected-device row with a check, not the AI swarm cursors.
- **Accept:** After “connect devices and make a dashboard,” both phones can join and appear with checks, and the lamp dashboard review does not jump the queue.

### 3. Wire the canvas speaker tile to Spotify — built; needs Premium + Marshall to verify

- Touch: `defaultConnector` / `simulatedConnector` in `canvasApp.ts`; reuse `src/music/musicSession.ts`, `parseMusicIntent`, `searchAndPlay`, `transferPlayback`.
- Prefer a Spotify Connect speaker (the Marshall, if it is already in `/me/player/devices`); otherwise this browser. If Spotify is not connected, keep the built-in player and say so.
- **Accept:** “Play [track]” shows the real title, audio comes from the Marshall when it is a Connect device, ledger shows job `spotify`.

### 4. Board to a paired phone — DONE (hold the board at the phone’s edge, not two-fist)

- Touch: held-fist board drag in `handPointer.ts` / `canvasApp.ts`; `createEdgeTransferController` in `edgeTransfer.ts`.
- **Accept (as built):** Drag the Living room board by its title with a held fist or the mouse to the paired phone’s edge and hold ~0.2 s; it appears on the phone and the laptop board snaps back; look-to-sync and **Pin on this device** still work.

### 5. Expose CAD extras on the canvas plan board — DONE (Check / 3D / DXF buttons)

- “Check accessibility,” **3D** extrude, and **Export DXF** already exist (`isAccessibilityRequest`, `checkPlanAccessibility`, `toggle3D` / `createExtrudeView`, `toDxf` / `controller.export()`) but the voice line and buttons are in the studio shell (`src/main.ts`).
- Put the same controls on the canvas `PlanBoardElement` (or route the voice lines in `canvasApp.ts` `run()`).
- **Accept:** On `canvas.html`, after “floor plan for Mrs Sharma’s flat,” you can say “check accessibility” and see door-width / ramp findings, toggle 3D, and download `mendcraft-plan.dxf`, without opening `/studio`.

### 6. Canvas caption bar for Kannada — DONE

- Reuse `buildCaption` in `src/ai/language.ts` on the canvas Talk caption (`micFab.ts`), not only `#caption-bar` in studio.
- **Accept:** A Kannada utterance shows the heard line and an English translation on `canvas.html`, and a kn-IN voice still speaks the reply when a Kannada voice is installed.

### 7. Delete the on-screen keyboard — DONE

The demo will not show pinch-to-type. Remove the feature from the app.

- Delete (or empty and unhook) `src/ui/onscreenKeyboard.ts`, `src/input/keyboardLogic.ts`, `src/canvas/handKeyboard.ts`.
- Remove mounts and branches in `src/canvas/canvasApp.ts`, `src/canvas/handPointer.ts`, `src/main.ts`, and `src/ui/referencePanel.ts`.
- Update or remove tests: `tests/keyboardLogic.test.ts`, `tests/capsLock.test.ts`, `tests/canvas/handKeyboard.test.ts`, `tests/gestures/keyboard-hand-path.test.ts`, and keyboard-only parts of `tests/gestures/say-box-hand-path.test.ts`, `tests/gestures/t2-B-props-panel.test.ts`, `tests/gestures/browser-panel-hand-path.test.ts`.
- **Accept:** No on-screen keyboard appears in canvas or studio. `vitest run` is green. Hands can still use Talk, the say box, and the fist tap. Do not leave a dead “Keyboard” button.

### 8. Optional, if the take still needs them (dashboard-from-collected-devices still pending)

- Laptop recognises the Flow 2 Pro from a webcam photo (“Insta360 Flow 2 Pro — compatible with iPhone (DockKit)”). If this is shaky, keep the docked-phone workaround.
- “Build a dashboard” after devices are collected should use those devices, not only `SCRIPTS.nanoRoom` / `geminiRoom`. **Still pending.**
- A safe, rehearsed rollback demo (responsible terminal blinks red, last good tile returns). Do not fake failures on the happy path.
- A **credits plan only** (no billing changes): how to use Firebase AI Logic, Hosting, and a scale-to-zero Cloud Run replay so judges can try the canvas without a camera, with an estimated cost per demo run and per 100 judge visits. Stay on Firebase AI Logic for inference.

When a beat is filmed on a workaround, update this file’s “Film today” notes so the next take stays honest.
