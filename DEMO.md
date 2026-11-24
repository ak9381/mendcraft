# Mendcraft — unified demo take

For the #BuildHybridAI Devpost video. Submissions close **1 Dec 2026, 3:30 AM IST**. Aim for **3:00 or under**, in one continuous take, with English voice-over (or subtitles). Upload to YouTube early; processing is slow.

This is the film plan for the flow Akash described on 24 Nov 2026, checked against `sim-main` in this repo (SHA at the time of writing is on the branch tip). It only claims what the code actually does. Where the code does not yet match the beat, the script says so and gives a way to film today, and the last section lists exact work for Claude Code on the Mac.

Gestures in the current build: **hover-select for 1.5 seconds** (the ring fills), and **two fists on a board to move it**. Do not say “pinch.” Other buttons stay quiet while a two-fist grab is on.

Preview: https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1

---

## Before you film

- [ ] Laptop in Chrome (Gemini Nano available if you want a real on-device badge). Wi-Fi on.
- [ ] Nothing Phone 3a on the **left**, iPhone on the **right**, both with Mendcraft Relay open and unlocked.
- [ ] Pairing chime: laptop speakers up; phone mics unobstructed. One test pair before the take.
- [ ] Insta360 Flow 2 Pro ready. Dock the iPhone only when the script says to.
- [ ] WiZ lamp on the same LAN. On the laptop, `npm run wiz-bridge` is running and the token is already in `.env.local` / the bridge. Do one brightness test off-camera.
- [ ] Marshall speaker on, already connected in the **Spotify** app (Premium). Mendcraft’s Spotify Client ID lives in `.env.local` as `VITE_SPOTIFY_CLIENT_ID` — never put the value in this file or a commit. Sign in to Spotify on the **web** app first if you need the Connect session; the iPhone shell cannot finish the `/spotify` redirect.
- [ ] Hands on, camera clear. If anyone else may walk into frame, that is useful for the register beat.
- [ ] Optional: a second person in the background for “crowded room.”
- [ ] Do not claim ADA/IRC compliance, user testing, or a live bulb/speaker/Spotify session you have not just proven.

Badge text to look for, from `src/ai/router.ts` `badgeLabel` / `sourceText`:

| Where it ran | Badge |
|---|---|
| Chrome on-device | **Gemini Nano · on device** |
| iPhone on-device model | **Apple · on device** |
| Cloud | **Gemini · cloud** |
| Nano then cloud | **Nano → Gemini** |
| Apple then cloud | **Apple → Gemini** |
| Exact local command | **Rules · exact command** |
| Simulation | label includes **SIM** — do not pretend it was live |

The footer and the **What left this device** panel (`src/ui/ledgerPanel.ts`, `src/core/ledger.ts`) are the honest byte count. Open the ledger when the script says to. A SIM take that sends 0 B is fine if you say so.

---

## The take (~3:00)

One continuous shot if you can. Times are a guide; cut rather than overrun. Voice-over is short so the screen can do the work.

### 0:00–0:08 — Hook

**You say:** “This is Mendcraft. A canvas you drive with your voice and your hands — so someone with limited hand use can still run a room, or draw a floor plan.”

**You do:** Sit at the empty canvas. Hands visible, no mouse.

**On screen:** Empty canvas. Lead: “Let’s build something fun.” Side chips: Register, Edit, Tools, Talk.

**Model / ledger:** Nothing has left the device yet.

Why this beat is here: the pitch is hands-free work, not a gadget tour. The landing page and the judges page both frame it that way. Do not name a medical diagnosis unless you want to; “limited hand use” is enough. (The builder’s mother, arthritis, and Kannada are in the product and in `/judges`, but they are optional in this 3-minute take — see “What else was missed.”)

---

### 0:08–0:22 — Register (crowded room)

**You say:** “I register first. Even in a crowded room, after this, only my face and hands are tracked.”

**You do:** Hover-select **Register** (1.5 s). Look at the camera, then show your open left palm, then your right, each until the ring fills.

**On screen:** Scan, “Register you.” Prompts in order: “Look at the camera and hold still.” → “Show your open LEFT palm.” → “Now your open RIGHT palm.” → “Registered — tracking locked to you.” The chip switches to **Re-register**. Status: “Registered. Tracking is locked to you.”

**Model / ledger:** All on this device. Face and hand signatures stay in `sessionStorage` (`mc.owner.v2`). No cloud call.

**Status: WORKS.** `createScanFlow` in `src/canvas/scanRegistration.ts`; `applyOwnerLock` in `src/canvas/canvasApp.ts` calls `registerSignature` and `setOwnerHands`. Other faces are dimmed and not the operator (`src/input/faceLogic.ts`); other hands are rejected if they do not match the owner (`src/input/handBinding.ts`, `rejectedHands` on the presence frame).

---

### 0:22–0:42 — Pair the phones

**Intended line:** “Connect devices and build me a dashboard.” Then the app would first find which devices already have Mendcraft, chime to connect, and show them as a swarm with a checkmark each.

**What the code does today:** the phrase “connect devices…” goes straight to `connectRoom()` and opens the **Draft: 2 lamps found in this room** review. It does **not** scan for installed companions or play the chime. The chime is a separate path: say “connect a device” (or use the Connect tile) → **Join a phone**. The coloured swarm is AI agent cursors (Nano / Gemini), not device checkmarks. There is no “devices with Mendcraft installed” discovery.

**Film today:**

**You say:** “Connect a device.” Hover **Join a phone**. Hold the Nothing, then the iPhone, near the laptop so each can hear the chime. (If one is already remembered, looking at it or opening the app is enough.)

**On screen:** Pairing card: “Playing a chime — hold your phone near this laptop. No typing, no scanning.” Phones show “Listening for laptop chime…” then join. Status: “Phone connected.” Arrangement: Nothing on the left, iPhone on the right.

**Model / ledger:** The chime is encoded and heard on-device (`src/relay/soundPairing.ts`, `src/ux/pairingChime.ts`). The mic is never uploaded. A Relay room is used to stay in sync; that is not a Gemini call.

**Status: PARTIAL.** Pairing and the left/right layout work (`showPairing`, `createChimeListener` in `src/canvas/mobileMain.ts`, `src/canvas/screenLayout.ts`). Automatic discovery, a device swarm with checkmarks, and “what do you want to connect next?” are **MISSING**.

---

### 0:42–0:52 — The gimbal

**Intended:** the app asks “what do you want to connect next?” You hold the Insta360 Flow 2 Pro up to the laptop camera. It recognises it, says it is iPhone-compatible (DockKit), and builds.

**What the code does today:** there is no visual identifier for a gimbal. Device kinds are lamp, speaker, TV, fan, plug, AC — no gimbal (`src/devices/identify.ts`). DockKit is detected **on the iPhone, when the phone is docked**, by `MendcraftGimbalPlugin` (`ios-src/MendcraftGimbalPlugin.swift`), not by the laptop webcam.

**Film today:** Dock the iPhone in the Flow 2 Pro. You can say, honestly: “The iPhone is in a DockKit gimbal, so it can follow my hands and look where I point.” Do not say the laptop camera recognised the stand unless that work lands (see the Claude list).

**Model / ledger:** Plugin check is local. No cloud.

**Status: MISSING** as a laptop-camera beat. DockKit itself is **PARTIAL** (code exists, untested on the filming setup).

---

### 0:52–1:12 — Point to connect: lamp, then speaker

**Intended line:** “Use the gimbal to connect to what I point at.” Point at the WiZ lamp, then the Marshall, then connect Spotify.

**What the code does today:**

- The closest voice line is “connect what I’m pointing at” / “connect to what I am pointing at” (`parseGimbalSpeech` in `src/canvas/gimbalCanvas.ts`). The longer “use the gimbal to…” line does **not** match.
- On a matching line, the gimbal goes to point mode (iPhone app only; on the web it says “The gimbal works in the iPhone app”). When a point target fires, `pointTurn` runs — but it **always proposes a speaker tile**. It does not call `identifyDevice` on a live photo. `pointConnect('speaker')` is hard-coded in `src/canvas/canvasApp.ts`.
- The full identify / connector flow (`runAddDevice` in `src/devices/addDeviceFlow.ts`, `identifyDevice` in `src/ai/hybrid.ts`) lives on the studio add-device path, not on this canvas turn.
- “Connect the lamp” / “connect the speaker” **does** work as a by-name Nano turn (`byName` in `src/canvas/connectTurns.ts`). A lamp is assumed to be WiZ.

**Film today (until the live point path is wired):**

**You say:** “Connect the lamp.” Hover **Approve** on the review. Then “Connect the speaker.” Approve again. If Spotify is already signed in on the web app, say so in the VO — “we’ve connected to Spotify” — but see the Spotify gap below before you press Play and claim the Marshall.

**On screen:** Each connect is a Proposal (Approve / Reject / Ask for something else). Badge for by-name: **Nano · on device — nothing left this device**. After keep, tiles appear on the board.

**Model / ledger:** By-name is Nano, no photo. A live photo identify, when it is wired, should show **Gemini · cloud** and a ledger line like “1 photo of what you pointed at, your words.”

**Status: PARTIAL** (voice-by-name and the connect sheet work; live point-to-identify on the canvas is not wired; the exact gimbal sentence is unrecognised).

---

### 1:12–1:38 — Build the dashboard, human in the loop, privacy

**You say:** “Connect devices and build me a dashboard.” (This is the line that actually runs `connectRoom` today.)

**You do:** Watch the swarm and the two terminals. When **Draft: 2 lamps found in this room** opens, hover **Approve**. When **Better: grouped lights + a room plan** opens, Approve again. Then open **What left this device**.

**On screen:** Nano and Gemini cursors and terminals. Mid-build pill in the form “N agents · Gemini x · Nano y · N B to cloud.” First review is the on-device draft; second is the cloud improvement (grouped lights, a speaker tile, a small room plan, a Connect tile). Nothing lands until Approve. After the second keep, the Living room board is live. The ledger lists each cloud call and its bytes, next to what stayed on this device.

**You say (over the ledger):** “Every change waited for me. And this ledger is the privacy note — what ran on this device, and what went to the cloud.”

**Model / ledger:** First turn **Gemini Nano · on device**. Handoff **Nano → Gemini** (“group the lights and add a room plan”). Second turn **Gemini · cloud**. Footer updates from the real ledger total (`setFooterBytes`).

**Rollback / red flash:** If a build fails after Approve, the last good board is restored and the responsible terminal blinks red (`EnginePanelUi.fail` in `src/canvas/modelPanels.ts`, `.mc-terminal.is-failing` in `src/canvas/canvas.css`; also `rollbackFix` in `src/canvas/selfCheck.ts`). That is real, but it only appears when something actually fails. Do not invent a crash. If you want this in the take, it needs a rehearsed, safe demo seed (Claude list). Otherwise skip it and rely on Approve / Reject.

**Status: WORKS** for the two reviews, the swarm-as-agents, the ledger, and fail/rollback when a failure happens. **PARTIAL** for “show a red flash in every take,” and the dashboard still starts from the scripted two lamps, not only the devices you just added.

---

### 1:38–1:56 — Floor plan (15–20 s)

This is the hands-free CAD beat. It belongs here, not as a separate film: the dashboard is pinned or still in view, and the next line shows privacy and hybrid on a real plan.

**You say:** “Floor plan for Mrs Sharma’s flat.” Hover **Approve**.

**On screen:** A new board, not drawn on top of the dashboard (the current board is pinned). Terminals: Nano keeps the name on this device and redacts it (Sharma → a placeholder such as `[Client A]`) before Gemini sees the prompt. Review title: **Floor plan: two bedrooms**. After Approve, walls, rooms, and doors render. If you have two seconds, hover a door or wall so it reads as CAD, not a picture.

**You say (one line):** “A name never has to leave this device. The plan is still a real drawing — rooms, doors, walls.”

**Model / ledger:** Redaction on-device, then **Gemini · cloud** for the plan. Footer should show a non-zero cloud byte count. Do not say the plan is ADA-compliant. An accessibility check exists (`checkPlanAccessibility` in `src/plan/accessibility.ts`) if you later say “check accessibility”; it is not required in these 20 seconds.

**Status: WORKS.** Routed from `/\bfloor\s*plans?\b/` in `src/canvas/canvasApp.ts`. CAD stack: `src/plan/` (templates, doors, walls, `toDxf` in `src/plan/export.ts`, `extrude3d.ts` for 3D). You will not have time to export DXF or extrude to 3D in this take; they are there if a judge explores.

---

### 1:56–2:16 — The dashboard at work

**You say:** “Increase the brightness.” Then, if Spotify is truly hooked up and the Marshall is a Spotify Connect device: “Play [track] on the speaker.” If that path is not proven, say only what the board actually does.

**You do:** Look at the real lamp when the brightness command lands. For music, look at the Marshall only if you have just confirmed it is receiving Spotify, not the laptop speakers.

**On screen:** Lamp tile updates. A reachable WiZ lamp on the LAN should change (`createWizAwareConnector`, `src/devices/wizClient.ts`, `src/devices/lampControl.ts`, `parseDeviceCommands` in `src/canvas/deviceCommands.ts`).

**Model / ledger:** Lamp control is local (LAN bridge), not a Gemini job. Spotify, if used, is ledgered as job `spotify` — commands and search text only, no camera, no tokens in the ledger (`src/core/outbound.ts`, `src/music/spotifyApi.ts`).

**Status:**

- WiZ brightness: **WORKS** when the bridge is up. Otherwise the tile is labelled SIM and only the board changes.
- Canvas speaker tile: **PARTIAL / not Spotify.** Play, pause, next, and volume on the dashboard go through a **simulated** connector and a canned track list (e.g. “Morning light”) in `src/canvas/canvasApp.ts`. There are **no** `spotify` references under `src/canvas/`. The real Spotify integration is the studio music panel (`src/ui/musicPanel.ts`, `src/music/musicSession.ts`, `searchAndPlay` / `transferPlayback`). There is no Marshall-specific or Web Bluetooth code. A Marshall can only play along if it already appears as a Spotify Connect device **and** the canvas tile is wired to that session.

Until that wire exists, do not say “that’s playing on the Marshall through Spotify” over the canvas Play button.

---

### 2:16–2:48 — Pin, move to the iPhone, pin it there

**Intended:** pin the dashboard, two-fist grab it, drag it to the iPhone, look-to-unlock, pin it on the iPhone in the gimbal. Optional: the gimbal tracks your hands.

**What the code does today:**

- “Save” or “pin” pins the board on the laptop dock (`parseCanvasCommand` / `reg.setPinned`).
- Two fists move a **board on this canvas**. They do not hand it to a phone.
- Moving work to a phone is a **one-hand (or mouse) tile drag in Edit**, past the glowing edge, via `createEdgeTransferController` in `src/canvas/edgeTransfer.ts`. It is tile-by-tile, not a whole-board two-fist fling.
- Looking at the phone **syncs** the board (`shouldSync` in `src/input/gazeSync.ts`, used in `src/canvas/mobileMain.ts`). That is look-to-sync, not a separate “unlock touch” lock.
- **Pin on this device** (`togglePin` in `src/canvas/phonePin.ts`) keeps the board on the phone, including offline.
- “Follow my hands” / “track my hands” puts the DockKit stand in hands mode (`parseGimbalSpeech`, `createGimbalFollow` in `src/devices/gimbalFollow.ts`, `followWhileBuilding` while a board is generating). Web fallback: “The gimbal works in the iPhone app.” This is optional and untested on the filming rig.

**Film today:**

**You say:** “Save.” Hover **Edit**. Drag a dashboard tile (or the plan tile) past the **right** edge to the iPhone. Look at the iPhone. Hover **Pin on this device**. Optional: “Follow my hands.”

**On screen:** “Saved Living room…” and the dock. The laptop’s right edge glows only if the iPhone is paired. The tile lands on the phone. The phone updates when you look at it or open the app. Pinned, it stays if the wide-area network drops; the WiZ lamp can still be reached on the LAN.

**Model / ledger:** Gaze frames stay on the phone (on-device ledger start, no frames uploaded). A small edit on the iPhone can show **Apple · on device** if that build is the one on the phone; the same edit on the Nothing, which has no on-device model, should show **Gemini · cloud**. Confirm the badge on the actual build before you say it. The iPhone shell and Apple mic path were still being ported from `wip/iphone-canvas` — use the install you have already tested.

**Status: PARTIAL.** Pin, look-to-sync, edge tile transfer, and phone pin exist. Two-fist whole-board transfer and “look to unlock touch” as a distinct lock do not.

---

### 2:48–3:00 — Close

**You say:** “Show everything.”

**On screen:** Pull back: pinned Living room, floor-plan board, phones as extra screens, terminals, ledger if still open.

**You say:** “On-device when it can, cloud when it must, and nothing is built until I approve it. That’s Mendcraft.”

**End card (optional, 5 s):** Mendcraft. “Hybrid on-device intelligence. Human in control.”

---

## Gap check

Checked with `rg` on `src/` (and iOS plugin sources) in this worktree. WORKS means the function is in the tree; it may still need a live rehearsal.

| Beat | Status | Where |
|---|---|---|
| Crowded-room register lock | **WORKS** | `createScanFlow`, `applyOwnerLock` (`canvasApp.ts`); `registerSignature` / operator pick (`faceLogic.ts`, `presence.ts`); `setOwnerHands` / `matchesOwner` (`handBinding.ts`, `handSignature.ts`) |
| “Connect devices and build me a dashboard” | **PARTIAL** | Regex in `canvasApp.ts` `run()` → `connectRoom()` (Nano draft, then Gemini “Better…”). Does not discover companions first |
| Chime pairing, Nothing left / iPhone right | **WORKS** | `showPairing`, `createChimeLoop` / `createChimeListener`, `screenLayout.ts` |
| Swarm checkmarks for connected devices | **MISSING** | Swarm is AI cursors (`swarmAgents.ts`, `createSwarmLayer`). Phone join is a status line, not a checked device chip |
| “What do you want to connect next?” | **MISSING** | Closest: connect sheet (`mountConnectSheet`) — Point at it / Say its name / Join a phone |
| Laptop camera recognises the Flow 2 Pro + DockKit line | **MISSING** | No gimbal kind in `DEVICE_KINDS`. DockKit availability is `MendcraftGimbalPlugin.isAvailable()` on a docked iPhone |
| Gimbal point-to-connect (untested) | **PARTIAL** | Aiming math: `createGimbalFollow`, `parseGimbalSpeech`, `pointTarget` → `pointTurn`. Live ID is **not** used; `pointTurn` hard-codes `pointConnect('speaker')`. Studio path `runAddDevice` / `identifyDevice` is separate and untested on this rig |
| WiZ brightness | **WORKS** | `parseDeviceCommands`, `createWizAwareConnector`, `wizClient.ts`, `wiz.ts`, `scripts/wiz-bridge.mjs`. Needs the bridge up |
| Marshall / Bluetooth speaker | **MISSING** as a device | No Marshall or Web Bluetooth connector. Speaker is a music tile |
| Spotify | **PARTIAL** | Full stack in `src/music/*` and `src/ui/musicPanel.ts` (Premium, PKCE, `searchAndPlay`, `transferPlayback`, ledger job `spotify`). **Not wired** to the canvas dashboard tile |
| Approve window (human in the loop) | **WORKS** | `createSurfaceProposal`, `mountReviewDialog` / `showReview`, Approve / Reject / Ask for something else |
| Red-flash rollback | **WORKS** (on real failure only) | `panels.forEngine(…).fail`, `.is-failing`, restore in `proposePlan` catch, `selfCheck.rollbackFix` |
| “What left this device” ledger | **WORKS** | `createLedger`, `createLedgerPanel`, footer `setFooterBytes` |
| Pin on the laptop | **WORKS** | Voice “save” / “pin”; side dock |
| Two-fist grab | **WORKS** on this canvas | `handPointer.ts` / `canvasApp.ts` board move; hover on other buttons is off during the grab |
| Move to the phone | **PARTIAL** | `createEdgeTransferController` — one-hand **tile** drag past a paired edge, not a two-fist board handoff |
| Look at the phone | **WORKS** as look-to-sync | `shouldSync`, `evaluateSync` in `mobileMain.ts`. Not a separate touch-unlock |
| Pin on the phone | **WORKS** | `pinBoard` / `togglePin` in `phonePin.ts` |
| Gimbal tracks hands | **PARTIAL** (optional, untested) | `followWhileBuilding`, `createGimbalFollow` mode `'hands'`; web no-op |
| Floor plan / CAD | **WORKS** | `src/plan/*`: rooms, walls, doors, `toDxf`, `createExtrudeView`, `checkPlanAccessibility` |

---

## What else was missed

These are in the product, but the new unified flow did not name them. With a 3:00 cap, most should stay out of the main take.

- **Opening hook** — added above. Without it the film starts mid-setup.
- **Accessibility angle** — this is the reason for the floor-plan beat. Landing copy and `/judges` say it is made for limited hand use (arthritis, tremor, weak grip). Do not claim a formal study.
- **Mother, arthritis, Kannada** — present in `src/judges/judgesPage.ts`, the landing page, setup copy, `add Kannada` (`languagePack.ts`), and a few Kannada music/device phrases. “Add Kannada” is a strong hybrid beat (Nano hands off to Gemini because the pack is too big on-device). It will not fit unless you cut something else.
- **Airplane / simulate offline** — **Tools → Simulate offline**. Cloud work queues (“N request(s) queued offline — will run on reconnect”) and is reviewed when you come back (`setOnline` in `canvasApp.ts`). A pinned phone board keeps working offline. Worth 8 seconds if you are under time; otherwise leave it for judges on `/judges` or `?sim=1`.
- **Closing line** — added above. Keep it plain.
- **Teach a gesture**, morph-a-tile, and sage self-check marks — all real; v3 had them as separate shots. In this take, self-check marks may simply be visible on the finished board. Do not spend a shot on them unless you are under.
- **Gestures changed** — older scripts still say pinch. This take must not.

---

## For Claude: what to build

Docs only — do not start this work from the agent that wrote this file. Do it in Claude Code on the Mac, in `~/Developer/mendcraft-sim`, on `sim-main`. No force-push, no production deploy, no secrets in the repo. Keep Nano / Gemini badges and the ledger honest; never invent a cloud call or a device that was not identified.

Do these in order. Stop after each one and check the acceptance line before starting the next.

### 1. Live point-to-connect on the canvas (needed for the take)

The studio identify path already exists. The canvas path does not use it.

- Touch: `pointTurn` in `src/canvas/canvasApp.ts` (stop hard-coding `pointConnect('speaker')`); `pointConnect` in `src/canvas/connectTurns.ts`; `identifyDevice` in `src/ai/hybrid.ts`; `parseGimbalSpeech` in `src/canvas/gimbalCanvas.ts`; the `run()` command router in `canvasApp.ts`.
- Accept spoken lines including “use the gimbal to connect to what I point at” and “connect to what I point at” (not only “pointing”).
- When a point is held, take a frame from the gimbal if it is available, otherwise the laptop camera, run `identifyDevice`, and propose that tile (WiZ lamp vs speaker). If identify fails, say so; do not silently propose a speaker.
- Ledger: a cloud identify should record the photo receipt; a Nano-only guess should say nothing left the device.
- **Accept:** Point at the WiZ lamp → review titled for a lamp (WiZ). Point at a speaker → speaker tile. The new phrases route here. Web without a gimbal still works from the laptop camera.

### 2. “Connect devices” should pair phones first, then ask what’s next

- Touch: the `connect (everything|…|devices?)` branch and `connectRoom()` in `src/canvas/canvasApp.ts`; `mountConnectSheet` / `showPairing` in `src/canvas/connectSheet.ts`; device status UI (do not overload AI swarm cursors — a small connected-device row with a check is enough).
- Saying “connect devices and build me a dashboard” should: start or resume pairing for companions that can hear the chime (Nothing 3a, iPhone); show each as connected with a check; then prompt “What do you want to connect next?” (point / name / another phone). Do not open “Draft: 2 lamps…” until he says to build, or until the later “build a dashboard” command.
- **Accept:** After that sentence, both phones can join and appear with checks, and the lamp dashboard review does not jump the queue.

### 3. Wire the canvas speaker tile to Spotify

- Touch: `defaultConnector` / `simulatedConnector` in `src/canvas/canvasApp.ts`; `createDeviceStore` in `src/canvas/deviceActions.ts`; reuse `src/music/musicSession.ts`, `parseMusicIntent`, `searchAndPlay`, `transferPlayback`. Outbound already allows job `spotify`.
- “Play …” from Talk or the tile should use the existing Spotify session when the user is connected (Premium, `VITE_SPOTIFY_CLIENT_ID` already in `.env.local`). If `/me/player/devices` lists a speaker (the Marshall, if it is already a Spotify Connect device), prefer it; otherwise this browser. If Spotify is not connected, keep the built-in player and say so — never fake a session.
- No Web Bluetooth. No tokens in the ledger.
- **Accept:** A connected Premium account, “play [track],” the canvas tile shows the real title, audio comes from the Marshall when it is available as a Connect device, and the ledger shows a `spotify` row.

### 4. Two-fist a board to a paired phone

- Touch: two-fist move in `src/canvas/handPointer.ts` and `canvasApp.ts`; `createEdgeTransferController` in `src/canvas/edgeTransfer.ts` (today: one-hand tile drag only).
- While a two-fist grab is moving a board, approaching a paired edge should transfer that dashboard (or its tiles) to the phone on that side, with the same tremor/cancel rules as today’s tile transfer.
- **Accept:** Two-fist the Living room board, drag to the right edge, it appears on the iPhone; look at the phone and it syncs; **Pin on this device** still works.

### 5. Optional, if the take still needs them

- **Laptop recognises the Flow 2 Pro.** Extend identify (not `DEVICE_KINDS` only as a controllable lamp) so a photo of the gimbal can propose “Insta360 Flow 2 Pro — compatible with iPhone (DockKit).” If this is shaky, keep the film workaround: dock the phone and use the plugin.
- **“Build a dashboard”** after devices are collected should run the two-review flow from *those* devices, not only the scripted two lamps (`SCRIPTS.nanoRoom` / `geminiRoom` in `canvasApp.ts`).
- **A safe rollback demo.** One rehearsed way (for example a self-check failure after Approve) to show the responsible terminal blink red and the last good tile return. Do not fake failures on the happy path.

When a beat is filmed on a workaround, update this file’s “Film today” notes so the next take stays honest.
