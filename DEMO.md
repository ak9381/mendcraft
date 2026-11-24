# Mendcraft — unified demo take

For the #BuildHybridAI Devpost video. Submissions close **1 Dec 2026, 3:30 AM IST**. Upload to YouTube early; processing is slow.

This is one continuous filmed take of the flow Akash described, plus the shipped beats that belong in the same story (floor-plan CAD, Kannada, offline queue, teach a gesture). Checked against `sim-main`. It only claims what the code does. Where the code does not yet match, the shot says how to film today, and the last section lists exact build work for the Mac.

**Runtime:** The uncut take will run **over 3:00** — that is fine. In the edit, **fast-forward** the sections marked **FF**. Do not drop a beat to hit 3:00. A first hover-select, a first Approve, and the spoken lines should stay at full speed so judges can see the interaction.

Gestures in the current build: **hover-select for 1.5 seconds** (the ring fills), and **two fists on a board to move it**. Do not say “pinch.” Other buttons stay quiet while a two-fist grab is on. There is **no on-screen keyboard** in this demo (see the build-list task to remove it from the app).

Preview: https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1

Badge text, from `src/ai/router.ts` `badgeLabel` / `sourceText`:

| Where it ran | Badge |
|---|---|
| Chrome on-device | **Gemini Nano · on device** |
| iPhone on-device model | **Apple · on device** |
| Cloud | **Gemini · cloud** |
| Nano then cloud | **Nano → Gemini** |
| Apple then cloud | **Apple → Gemini** |
| Exact local command | **Rules · exact command** |
| Simulation | label includes **SIM** — do not pretend it was live |

The footer and the **What left this device** panel (`src/ui/ledgerPanel.ts`, `src/core/ledger.ts`) are the honest byte count. Open the ledger when the script says to.

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

## The take

Times are the uncut shot. **FF** means: keep the shot, speed it up in the edit.

### Shot 0 — Hook (0:00–0:08)

**You say:** “This is Mendcraft. A canvas you drive with your voice and your hands — I built it for my mom, who has arthritis and speaks Kannada, and for anyone with limited hand use who still wants to run a room or draw a floor plan.”

**You do:** Sit at the empty canvas. Hands visible, no mouse.

**On screen:** Empty canvas. Lead: “Let’s build something fun.” Side chips: Register, Edit, Tools, Talk.

**Model / ledger:** Nothing has left the device yet.

Do not claim a formal user study. Naming his mom is already how `/judges` and the landing page frame the product (`src/judges/judgesPage.ts`, `src/landing/shell.html`).

---

### Shot 1 — Register (0:08–0:28) — FF the hold rings after the face is clearly started

**You say:** “I register first. Even in a crowded room, after this, only my face and hands are tracked.”

**You do:** Hover-select **Register** (leave this first 1.5 s ring at full speed). Look at the camera, then show your open left palm, then your right, each until the ring fills.

**On screen:** Scan, “Register you.” Prompts: “Look at the camera and hold still.” → “Show your open LEFT palm.” → “Now your open RIGHT palm.” → “Registered — tracking locked to you.” The chip switches to **Re-register**.

**Model / ledger:** All on this device. Signatures stay in `sessionStorage` (`mc.owner.v2`). No cloud call.

**Status: WORKS.** `createScanFlow` in `src/canvas/scanRegistration.ts`; `applyOwnerLock` in `src/canvas/canvasApp.ts` calls `registerSignature` and `setOwnerHands`. Other faces are dimmed (`src/input/faceLogic.ts`); other hands are rejected (`src/input/handBinding.ts`, `rejectedHands`).

---

### Shot 2 — Pair the phones (0:28–0:55) — FF the chime wait

**Intended line:** “Connect devices and build me a dashboard.” Then the app would first find which devices already have Mendcraft, chime to connect, and show them with a checkmark each.

**What the code does today:** that phrase goes straight to `connectRoom()` and opens **Draft: 2 lamps found in this room**. It does not scan for companions. The chime is a separate path: say “connect a device” → **Join a phone**. The coloured swarm is AI agent cursors, not device checkmarks.

**Film today:**

**You say:** “Connect a device.” Hover **Join a phone**. Hold the Nothing, then the iPhone, near the laptop so each can hear the chime. (If one is already remembered, looking at it or opening the app is enough.)

**On screen:** “Playing a chime — hold your phone near this laptop. No typing, no scanning.” Phones show “Listening for laptop chime…” then join. Status: “Phone connected.” Arrangement: Nothing left, iPhone right.

**Model / ledger:** Chime is on-device (`src/relay/soundPairing.ts`, `src/ux/pairingChime.ts`). The mic is never uploaded.

**Status: PARTIAL.** Pairing and left/right layout work (`showPairing`, `createChimeListener`, `src/canvas/screenLayout.ts`). Automatic discovery, a device swarm with checkmarks, and “what do you want to connect next?” are **MISSING**.

---

### Shot 3 — The gimbal (0:55–1:05)

**Intended:** the app asks “what do you want to connect next?” You hold the Insta360 Flow 2 Pro up to the laptop camera. It recognises it and says it is iPhone-compatible (DockKit).

**What the code does today:** no visual identifier for a gimbal (`DEVICE_KINDS` in `src/devices/identify.ts` has no gimbal). DockKit is detected **on the iPhone, when the phone is docked**, by `MendcraftGimbalPlugin.isAvailable()`.

**Film today:** Dock the iPhone in the Flow 2 Pro. You can say, honestly: “The iPhone is in a DockKit gimbal, so it can follow my hands and look where I point.” Do not say the laptop camera recognised the stand unless that work lands (see the build list).

**Model / ledger:** Plugin check is local. No cloud.

**Status: MISSING** as a laptop-camera beat. DockKit itself is **PARTIAL** (code exists, untested on the filming setup).

---

### Shot 4 — Point to connect: lamp, speaker, Spotify (1:05–1:30) — FF extra review waits

**Intended line:** “Use the gimbal to connect to what I point at.” Point at the WiZ lamp, then the Marshall, then connect Spotify.

**What the code does today:** the closest voice line is “connect what I’m pointing at” (`parseGimbalSpeech` in `src/canvas/gimbalCanvas.ts`). The longer “use the gimbal to…” line does not match. `pointTurn` always proposes a **speaker** tile — it does not call `identifyDevice` on a live photo. “Connect the lamp” / “connect the speaker” works as a by-name Nano turn (`byName` in `src/canvas/connectTurns.ts`). A lamp is assumed to be WiZ. Spotify exists in the studio music panel, not on the canvas tile (see Shot 7).

**Film today:**

**You say:** “Connect the lamp.” Hover **Approve**. Then “Connect the speaker.” Approve again. If Spotify is already signed in on the web app, you may say “we’ve connected to Spotify” — but do not press Play and claim the Marshall until Shot 7 is proven.

**On screen:** Each connect is a Proposal (Approve / Reject / Ask for something else). Badge for by-name: **Nano · on device — nothing left this device**.

**Status: PARTIAL.** By-name and the connect sheet work; live point-to-identify on the canvas is not wired.

---

### Shot 5 — Build the dashboard, human in the loop, privacy (1:30–2:00) — FF the swarm / model stream

**You say:** “Connect devices and build me a dashboard.”

**You do:** Watch the swarm and the two terminals (this is the **AI activity** panel — it stays open). When **Draft: 2 lamps found in this room** opens, hover **Approve** on the **floating review window**. When **Better: grouped lights + a room plan** opens, Approve again. Then open **What left this device**.

**On screen:** Nano and Gemini cursors and terminals. Mid-build pill: “N agents · Gemini x · Nano y · N B to cloud.” First review is the on-device draft; second is the cloud improvement. Nothing lands until Approve. The living-room board appears. Sage **self-check** marks may already sit on healthy tiles. The ledger lists each cloud call and its bytes.

**You say (over the ledger):** “Every change waited for me. And this ledger is the privacy note — what ran on this device, and what went to the cloud.”

**Model / ledger:** First turn **Gemini Nano · on device**. Handoff **Nano → Gemini**. Second turn **Gemini · cloud**. Footer from the real ledger total (`setFooterBytes`).

**Rollback / red flash:** If a build fails after Approve, the last good board is restored and the responsible terminal blinks red (`EnginePanelUi.fail` in `src/canvas/modelPanels.ts`, `.mc-terminal.is-failing` in `src/canvas/canvas.css`; also `rollbackFix` in `src/canvas/selfCheck.ts`). Only show this if you have a rehearsed, safe failure (see the build list). Do not invent a crash.

**Status: WORKS** for the two reviews, AI activity, the floating approve window, the ledger, self-check marks, and fail/rollback when a failure happens. **PARTIAL** for “a red flash in every take,” and the dashboard still starts from the scripted two lamps.

---

### Shot 6 — Floor plan and CAD (2:00–2:40) — FF the model stream; keep the drawing at full speed

This is the hands-free CAD beat, in the same take as the dashboard.

**You say:** “Floor plan for Mrs Sharma’s flat.” Hover **Approve**.

**On screen:** A new board (the dashboard is pinned, not drawn over). Terminals: Nano keeps the name on this device and redacts it (Sharma → a placeholder such as `[Client A]`) before Gemini sees the prompt. Review: **Floor plan: two bedrooms**. After Approve, the board is a live CAD view: **rooms, walls, doors, windows, and dimensions** (`PlanBoardElement` in `src/canvas/widgets.ts` wraps `createPlanController` and `createPlanRenderer`).

**Then, still on this board:**

1. Hover a door and a dimension so they read as a drawing, not a picture.
2. Open the plan **component palette** (wall, room, door, window, furniture flyout — `createPalette`, `createPlanTools`, `FURNITURE_FLYOUT` in `src/plan/tools.ts`). The **trash zone** is on the same board (`createTrash` in `src/core/palette.ts`): drag a fixture onto it to delete.
3. Use the **measure tool** (`createMeasureTool`, or two-hand measure via `beginTwoHandMeasure`). A tap can keep the tape as a dimension (`add_dim`).
4. **Check accessibility** — say “check accessibility” or “make it wheelchair friendly” (`isAccessibilityRequest` in `src/core/a11y.ts`, `checkPlanAccessibility` in `src/plan/accessibility.ts`). It flags door clear width (815 mm minimum, 850 mm recommended) and ramp slope (1:12), plus corridors and stairs. **Do not say the plan is ADA-compliant** — say “it checks door widths and ramps against published figures.”
5. Toggle **3D** so walls extrude (`toggle3D` / `createExtrudeView` in `src/plan/extrude3d.ts`). Orbit once.
6. **Export DXF** (`controller.export()` → `toDxf` in `src/plan/export.ts`) so a `mendcraft-plan.dxf` download is visible.

**You say:** “A name never has to leave this device. The plan is a real drawing — rooms, doors, walls, dimensions — and it can check a door width or a ramp, open in 3D, and export a DXF.”

**Model / ledger:** Redaction on-device, then **Gemini · cloud** for the plan. The checker itself is deterministic code, not a model. An explanation of the issues, if shown, may go to the cloud — if it does, the ledger should show it.

**Canvas vs studio, honestly:** walls, rooms, doors, dimensions, measure, the furniture palette and the trash zone **WORK** on the canvas plan board. “Check accessibility,” the **3D** button, and **Export DXF** are implemented (`checkPlanAccessibility`, `toggle3D`, `toDxf`) but the **buttons and the voice line are wired in the studio shell** (`src/main.ts`, `/studio`). On today’s canvas take they are **PARTIAL**. Film the drawing tools on the canvas board; for a11y, 3D and DXF either cut away briefly to `/studio` (FF the navigation, not the result) or wait for the build-list task that exposes them on the canvas board.

**Status:** drawing tools **WORKS** on canvas. Accessibility / 3D / DXF **WORKS** in code, **PARTIAL** on the canvas route.

---

### Shot 7 — The dashboard at work (2:40–2:55)

**You say:** “Increase the brightness.” Then, only if Spotify is truly hooked up and the Marshall is a Spotify Connect device: “Play [track] on the speaker.”

**You do:** Look at the real lamp when the command lands. Look at the Marshall only if you have just confirmed it is receiving Spotify.

**On screen:** Lamp tile updates. A reachable WiZ lamp on the LAN should change (`createWizAwareConnector`, `src/devices/wizClient.ts`, `parseDeviceCommands` in `src/canvas/deviceCommands.ts`).

**Model / ledger:** Lamp control is local (LAN bridge). Spotify, if used, is ledgered as job `spotify` — no tokens in the ledger.

**Status:**

- WiZ brightness: **WORKS** when the bridge is up. Otherwise the tile is labelled SIM.
- Canvas speaker tile: **PARTIAL / not Spotify.** Play on the dashboard goes through a simulated connector and a canned track (e.g. “Morning light”) in `src/canvas/canvasApp.ts`. There are no `spotify` references under `src/canvas/`. The real integration is `src/ui/musicPanel.ts` and `src/music/musicSession.ts` (`searchAndPlay`, `transferPlayback`). No Marshall-specific or Web Bluetooth code. A Marshall can only play along if it already appears as a Spotify Connect device **and** the canvas tile is wired to that session.

Until that wire exists, do not say “that’s playing on the Marshall through Spotify” over the canvas Play button.

---

### Shot 8 — Kannada (2:55–3:15) — FF the pack stream; keep Approve and the language switch at full speed

**You say:** “Add Kannada.” Hover **Approve**.

**On screen:** Both terminals log the handoff: Nano asks Gemini to plan the Kannada pack because it is too complex on-device (`languageTurn` / `addKannada` in `src/canvas/canvasApp.ts`, reason line in `showHandoff`). Review title: **Add Kannada**. After Approve, labels, tiles and controls switch into Kannada script. Spoken replies use **kn-IN** (`resolveLanguage` in `src/ai/language.ts`, `opts.voice.setLang` in `canvasApp.ts`; voice pick in `src/ai/speechVoices.ts` prefers a Kannada voice when one is installed).

**You say (optional, in Kannada, if the pack is on):** a short command you have rehearsed, so the Talk caption shows the Kannada words.

**The bilingual caption bar** (her words beside the English translation — `buildCaption` in `src/ai/language.ts`, `#caption-bar` in `src/main.ts`) is **WORKS in the studio** (`/studio`). The canvas Talk caption (`micFab.ts`) shows the live words but does not yet pair a translation line. If you want that bar in this take, a short **studio cutaway** is honest; do not claim the canvas already shows both lines.

**Model / ledger:** **Nano → Gemini**, then **Gemini · cloud**. Receipt: the key list and the request — no board data, no device addresses. Badge should read in the spirit of “Gemini · cloud · Kannada.”

**Status: WORKS** for “add Kannada,” the review, the UI pack, and kn-IN speech language on the canvas. **PARTIAL** for a paired caption bar and a spoken Kannada CAD reply on the canvas (those are studio).

---

### Shot 9 — Offline / airplane mode (3:15–3:35) — FF the wait; keep the queue badge and the reconnect review at full speed

**You say:** “Undo.” (Back to English if you just added Kannada.) Hover **Simulate offline**. Then say “Add Kannada” again. Hover **Simulate offline** once more to come back. Approve the review that follows.

**On screen:** After undo, English chrome is back. Offline: Nano’s panel shows **“N request(s) queued offline — will run on reconnect.”** On-device work still runs; a job that needs the cloud waits (`setOnline` in `canvasApp.ts`, `net.queueLater`, `deepLater` for a dashboard’s Gemini pass, and `src/offline/queue.ts` in the studio). On reconnect: “Back online. Running N saved request(s).” The same **Add Kannada** review opens. After Approve, Kannada is back.

**You say:** “If the network drops, edits that can stay on this device still work. The big cloud jobs wait in the queue, and they still come back for me to approve.”

**Model / ledger:** Queue is local. The drained job is **Gemini · cloud**, still behind Approve. A pinned phone board also keeps working offline (`phonePin.ts`); the WiZ lamp can still be reached on the LAN.

**Status: WORKS** on the canvas for Simulate offline, the Kannada queue, the Deep-dashboard queue, and window `offline`/`online` events.

---

### Shot 10 — Teach a gesture (3:35–3:55) — FF the sample holds after the first repetition is clear

**You say:** “Teach a gesture.” Record a thumbs-up (or another pose) two or three times. Say or type what it should do, for example “save the canvas,” then Go. Hover **Approve**. If filming live, give the thumbs-up once to show it fires.

**On screen:** Teach panel: samples stay on this device (`mountTeachPanel` in `src/canvas/teachPanel.ts`, `src/input/customGestures.ts`, IndexedDB — never Firestore). After the samples, “What should it do?” Review: **Teach: Save the canvas.** After Approve: “Learned it — … stays on this device.” Custom / remappable gestures are in **Custom gestures**.

**Model / ledger:** Recording is on-device. Parsing the action may use a model; if it does, the badge and ledger must say so. The bind is local and still goes through the same Approve window.

**Status: WORKS.**

---

### Shot 11 — Pin, move to the iPhone, pin it there (3:55–4:20)

**Intended:** pin the dashboard, two-fist grab it, drag it to the iPhone, look-to-unlock, pin it on the iPhone in the gimbal. Optional: the gimbal tracks your hands.

**What the code does today:** “Save” or “pin” pins the board on the laptop dock. Two fists move a board **on this canvas**, not onto a phone. Moving work to a phone is a **one-hand tile drag in Edit**, past the glowing edge (`createEdgeTransferController` in `src/canvas/edgeTransfer.ts`). Looking at the phone **syncs** it (`shouldSync` in `src/input/gazeSync.ts`) — look-to-sync, not a separate touch-unlock. **Pin on this device** (`togglePin` in `src/canvas/phonePin.ts`) keeps the board on the phone, including offline. “Follow my hands” aims the DockKit stand (`createGimbalFollow`, `parseGimbalSpeech`); on the web: “The gimbal works in the iPhone app.”

**Near the screen edge:** the pointer **edge freeze** holds the last stable pose so a clipped hand does not flap into a false click (`createEdgeGuard` in `src/canvas/handEdge.ts`, `SCREEN_MARGIN_PX`, `EDGE_CLICK_COOLDOWN_MS`). You do not need a line of VO for this; it is there so the drag stays clean.

**Film today:**

**You say:** “Save.” Hover **Edit**. Drag a dashboard tile past the **right** edge to the iPhone. Look at the iPhone. Hover **Pin on this device**. Optional: “Follow my hands.”

**On screen:** “Saved Living room…” and the dock. The right edge glows only if the iPhone is paired. The tile lands on the phone. The phone updates when you look at it. Pinned, it stays if the wide-area network drops.

**Model / ledger:** Gaze frames stay on the phone. A small edit on the iPhone can show **Apple · on device** if that build is the one on the phone; the same edit on the Nothing should show **Gemini · cloud**. Confirm the badge on the actual build before you say it.

**Status: PARTIAL.** Pin, look-to-sync, edge tile transfer, edge freeze, and phone pin exist. Two-fist whole-board transfer and “look to unlock touch” as a distinct lock do not.

---

### Shot 12 — Close (4:20–4:35)

**You say:** “Show everything.”

**On screen:** Pull back: pinned Living room, floor-plan board, phones as extra screens, AI activity, ledger if still open, sage self-check marks.

**You say:** “On-device when it can, cloud when it must, and nothing is built until I approve it. That’s Mendcraft.”

**End card (optional, 5 s):** Mendcraft. “Hybrid on-device intelligence. Human in control.”

Uncut, this is about **4:30**. FF the marked waits and the edit can sit near 3:00 without dropping a shot.

---

## Optional beats

These are shipped, but they are easy to show as a glance during the shots above rather than as their own scene. If a shot already covers them, you do not need a second take.

| Enhancement | Where it already appears | Status |
|---|---|---|
| Self-check marks and rollback | Shot 5 (and any failed Approve) | **WORKS** — `src/canvas/selfCheck.ts` |
| AI activity panel | Open throughout Shots 5–10 | **WORKS** — `showAi` in `canvasApp.ts` |
| Floating approve window | Every Approve | **WORKS** — `mountReviewDialog` in `src/canvas/reviewDialog.ts` |
| Edge pose freeze | Shot 11, at the screen edge | **WORKS** — `createEdgeGuard` in `src/canvas/handEdge.ts` |
| Measure tool, trash zone, component palette | Shot 6, on the plan board | **WORKS** — `createMeasureTool`, `createTrash`, `createPalette` |
| In-canvas browser (reference panel) | Not on the canvas route | **WORKS in studio** — `createReferencePanel` in `src/ui/referencePanel.ts`, used from `src/main.ts`. **MISSING** on `canvas.html`. Leave it out of this take unless you add a short `/studio` cutaway. |
| Morph a tile | Not required for this story | **WORKS** on canvas (hover-hold a tile, say the change, Approve). Optional B-roll only. |

Do **not** film the on-screen keyboard.

---

## Gap check

Checked with `rg` on `src/` (and iOS plugin sources). WORKS means the function is in the tree; it may still need a live rehearsal.

| Beat | Status | Where |
|---|---|---|
| Crowded-room register lock | **WORKS** | `createScanFlow`, `applyOwnerLock`; `registerSignature` / `setOwnerHands` |
| “Connect devices and build me a dashboard” | **PARTIAL** | `run()` → `connectRoom()` (Nano draft, then Gemini). Does not discover companions first |
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
| Accessibility checker (door width, ramps) | **WORKS** in code, **PARTIAL** on canvas | `checkPlanAccessibility`, `PLAN_A11Y` in `src/core/a11y.ts`. Voice line is in `src/main.ts` (studio) |
| 3D extrude and DXF export | **WORKS** in code, **PARTIAL** on canvas | `createExtrudeView` / `toggle3D`; `toDxf` / `controller.export()`. Buttons are in the studio shell |
| Add Kannada, kn-IN voice | **WORKS** on canvas | `addKannada`, `languageTurn`, `speechLang: 'kn-IN'` |
| Bilingual caption bar and spoken Kannada CAD reply | **WORKS** in studio, **PARTIAL** on canvas | `buildCaption`, `#caption-bar` in `src/main.ts` |
| Offline / airplane queue | **WORKS** | `setOnline`, `queueLater`, `deepLater`, `src/offline/queue.ts` |
| Teach a gesture | **WORKS** | `mountTeachPanel`, `customGestures.ts` |
| Pin / look-to-sync / phone pin / edge transfer | **PARTIAL** | Tile edge-drag, not two-fist board handoff. Look-to-sync, not touch-unlock |
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
3. **Cloud Run (or Cloud Functions) for a judge replay server** — serve `?sim=1&play=1` (and a recorded hand/voice walk) so judges can try the canvas without a camera. Scale-to-zero is usually **cents per day** of light traffic; a always-on min instance is the one line that can reach tens of dollars a month, so default to scale-to-zero.
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
- **Accept:** After “connect devices and build me a dashboard,” both phones can join and appear with checks, and the lamp dashboard review does not jump the queue.

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
