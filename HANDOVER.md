# Mendcraft handover

Written 24 Nov 2026 (Asia/Calcutta) so Akash can continue on the Mac at `~/Developer/mendcraft-sim`. Facts below were checked against the `ak9381/mendcraft` git repo (this worktree is `/workspace/hackathon/firebase-hybrid/builder-relay/sim-main-ship`), its git log, and files under `/workspace/hackathon/firebase-hybrid`. Nothing here was invented. No secrets, tokens, or `.env` values are included.

Repo: https://github.com/ak9381/mendcraft.git  
Git identity used on this box: Akash K Raju `<ak9381@users.noreply.github.com>`

---

## 1. What we're aiming for

Mendcraft is an infinite canvas where you describe what you want (voice or type) and, with your hands, review and move what gets built — a room dashboard, a CAD floor plan, or both at once — on a phone, tablet, or browser. Every model change sits in a proposal first; nothing is applied until you approve it. The public tagline in `README.md` is: “A smart canvas that Gemini Nano and Gemini turn into anything.” The Devpost draft (`/workspace/hackathon/firebase-hybrid/submission/devpost-draft.md`, first line: `<!-- DRAFT only. Not submitted to Devpost. -->`) uses: “A canvas that becomes any app you ask for, on your own device.”

The audience and judging frame were written down on 12 Nov 2026 in `/workspace/hackathon/firebase-hybrid/accessible-builder/research.md`: a person with limited hand or arm mobility (the note lists incomplete tetraplegia, ALS/MND, MS, RSI) doing real productive or creative work with minimal movement — a pinch, a small hand move, head direction, and voice. That research recommended a hands-free 3D / assistive-part builder over a room planner alone. The product that actually shipped on `sim-main` is the hybrid canvas (dashboard + floor plan + proposal review + Relay), not a standalone 3D-print tool. The current gesture spec has also dropped pinch; do not describe pinch as a live gesture.

**Why Firebase AI Logic has to carry the product (not sit on the side).** This is a Google **#BuildHybridAI** entry. `/workspace/hackathon/firebase-hybrid/assessment.md` copies the official Overview criteria (no numeric weights published):

1. Technological Implementation — how effectively the project uses Firebase AI Logic hybrid inference.
2. Design — a complete product, not just a proof of concept.
3. Potential Impact — a credible case for a real audience, based on what is demonstrated.
4. Quality of the Idea — a creative, non-obvious use of Firebase AI Logic.

The same notes record the official getting-started rule: build apps that use Firebase AI Logic hybrid inference (on-device when available, cloud otherwise), and a stricter line from the overview notes: all of the app’s AI inference must go through Firebase AI Logic (no direct model APIs). Assessment item 1 also says hybrid inference must be **load-bearing**, not bolted on: the demo should show a moment that clearly runs on-device (offline, private, or instant) and a moment that justifiably goes to the cloud, and the UI should make that visible.

That is how Mendcraft is wired on the web: `src/ai/hybrid.ts` talks to Firebase AI Logic (`firebase/ai` — `getAI`, `getGenerativeModel`, `InferenceMode.ONLY_ON_DEVICE` / `PREFER_ON_DEVICE` / `ONLY_IN_CLOUD`). Gemini Nano on-device when Chrome’s Prompt API is present; cloud Gemini when the job needs more or Nano is missing; a deterministic parser for simple device commands; a byte ledger for what left the device; App Check (reCAPTCHA Enterprise) before AI calls. The canvas shows the engine (Nano / Gemini / Apple / rules / labelled SIM) and the byte count.

A documented exception, not a secret: on iPhone, `ios-src/README.md` (branch `wip/iphone-canvas`) says Apple Foundation Models are called directly (`SystemLanguageModel.default` + `LanguageModelSession`) because Firebase’s iOS `HybridModel` API was removed in firebase-ios-sdk 13.2.0 (16 Nov 2026). Cloud Gemini still runs in the web layer through Firebase AI Logic. `/workspace/hackathon/firebase-hybrid/relay-research/relay-to-5.md` also flags MediaPipe Hand Landmarker as a Google AI Edge bundle called outside Firebase AI Logic (Akash has accepted disclosure). Do not paper over either point.

**Hero moments to show judges** (from the current demo script and the product, not a new list):

From `/workspace/hackathon/firebase-hybrid/submission/demo-video-script-v3.txt` (header: draft only, not submitted; based on the 23 Nov 2026 12:09 AM IST item-8 rerun). Target in that file is ~4:40 and may need cutting to the contest’s ≤3:00 video. Shots:

1. Empty canvas and Tools (voice / open palm).
2. “Connect devices and make a dashboard” — swarm of Nano/Gemini agent cursors, live terminals, pill with agent mix and **0 B to cloud**, full-screen reviews; nothing is built until Approve (Draft, then Better).
2b. Dim a lamp / physical WiZ cutaway — the script itself marks the real bulb as pending.
3. “Save” pins the live Living room dashboard to a dock.
4. Floor plan (“Mrs Sharma’s flat”) — Nano redacts the name before Gemini; footer ledger (the scripted take shows 2.2 KB to cloud); Approve; CAD board beside the pinned dashboard.
5. “Add Kannada” — Nano hands the pack to Gemini because it is too complex on-device; Approve; UI switches.
6. Undo (back to English), simulated offline queue, reconnect, Approve.
7. Teach a gesture.
8. Register.
9. Edit mode and the self-check mark.
10. Morph a tile, review, undo.
11. Self-check.
12. Phone menu and join.
12b. Drag a tile to a phone (edge transfer).
12c. Pin on this device + look-to-sync.
12d. **Apple · on device** on the iPhone vs **Gemini · cloud** on the Nothing (no on-device model), and what stayed vs what left each device.
13. Close / pull back.

An earlier 12 Nov object memo, `/workspace/hackathon/firebase-hybrid/builder-relay/demo-object.md`, picked an accessible entrance-massing (house + ramp) as the filmed CAD hero and a drop-in phone stand as backup, with a 3-beat story (problem → pinch/voice build → printed part). That memo also assumed pinch and an iPad Relay beat. Pinch is no longer a canvas gesture, and `44e82fb` dropped the iPad as a demo device. Treat that memo as background for the accessibility/CAD pitch, not as the current shot list.

Contest close (verified in `e2e-review-2x/SUBMISSION-CHECKLIST.md` and `assessment.md`): **1 Dec 2026, 3:30 AM IST**. Checklist also notes an optional quota form closing 25 Nov 2026, 11:30 PM IST, only if a billing-required model is used — decision for Akash. A software draft URL was named for this handover as https://devpost.com/software/mendcraft; that exact URL was not found as a checked-in string in the files searched. The checked-in draft is the markdown file above, marked not submitted.

---

## 2. Use sim-main as the reference

`sim-main` and its Firebase Hosting **preview** channel are the source of truth for this push.

- Branch: `sim-main`, tracking `origin/sim-main`.
- Preview (only this channel): https://mendcraft--sim-main-o8jrlskh.web.app  
  Canvas: https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1  
  Scripted demo: add `&sim=1`.
- `origin/main` is **5f8177f** (`Finish the rich-layout showcase: compact split, hand-reachable zones, visible charts`). It has been left untouched. Do not merge to `main`, do not push `main`, do not deploy production / `mendcraft.web.app` unless Akash explicitly asks later.
- Every new change starts from current `origin/sim-main`. Pull `--rebase` if needed. **No force-push.**
- Do not land work from `wip/iphone-canvas` (or any other branch) onto `sim-main` by overwriting the current gesture code. Cherry-pick or re-apply only the phone-shell files (see §12).

On the Mac: `cd ~/Developer/mendcraft-sim`, `git fetch origin`, `git checkout sim-main`, `git pull --ff-only origin sim-main`.

---

## 3. Product and pitch (short)

- Hackathon: Google **#BuildHybridAI**.
- Submissions close **1 Dec 2026, 3:30 AM IST**.
- Devpost draft text: `/workspace/hackathon/firebase-hybrid/submission/devpost-draft.md` — **not submitted**.
- License on the public repo: Apache-2.0 (`LICENSE` at repo root, on `main` and `sim-main`). Caveat from the checklist: judges browsing the default branch see `main` (5f8177f) unless `sim-main` is merged.
- Built with (from the draft): A2UI, Firebase AI Logic, Gemini, Gemini Nano (on-device when available), TypeScript, Lit, Vite, Capacitor, MediaPipe (on-device hand tracking), DockKit (iOS gimbal).

---

## 4. Architecture

Web app: Vite + TypeScript + Lit, in this repo. `package.json` scripts include `"dev": "vite"`, `"build": "tsc && vite build"`, `"test": "vitest run"`. Capacitor wraps the same `dist/` for iOS and Android (`capacitor.config.ts` `appId` is `app.mendcraft.relay`).

**Canvas (`src/canvas/`).** Notable files (not exhaustive): `canvasApp.ts` (commands, speech `run()`, board move via `setRect`, edge-transfer host wiring), `canvasMain.ts` (boot, `?sim=1` skips `prepareHybrid()`, `?sim=1&demo=morph` can auto-call `window.__mcMorph.replay()`), `canvasCommands.ts`, `canvasHands.ts` (`autoHandsFromSearch`: hands on by default, including under `?sim=1`, unless `?hands=0`), `handPointer.ts` / `handFeel.ts` (dwell + two-fist move), `frames.ts` (`setRect`), `openEndedAsk.ts` (unmatched speech → Nano then Gemini), `aiTurn.ts` (scripted engines), `engines.ts` (`planEngines`: `?sim=1` forces scripted Nano and Gemini), `edgeTransfer.ts` (one-hand/mouse **tile** transfer to a paired phone — the file comment says it never fires on a two-hand pinch), `gestureTrace.ts` (`window.__mcTrace`, enable with `?debug=gestures` or a pre-set flag), `teachPanel.ts`, `scanRegistration.ts`, `swarmAgents.ts` (deterministic PRNG when `?sim=1`).

**Hybrid router.** `src/ai/hybrid.ts` plus `src/ai/router.ts`, `privacyRouter.ts`, `redact.ts`, `appleAI.ts`. Route: Nano first when present; Gemini via Firebase AI Logic in the cloud; rules parser when no model is needed. Unmatched canvas speech now uses `openEndedAsk()` (same Nano-then-Gemini order) instead of a dead-end string.

**Apple Foundation Models** on the iPhone mic / Quick path (see §7), not through the web Nano Prompt API.

**Relay and phone sync.** `src/relay/` (`session.ts`, `protocol.ts`, `firestoreTransport.ts`, `pairingStore.ts`, `privacyHub.ts`, `controlSnapshot.ts`, …). Phones can join the desktop hub; the hub redacts before cloud Gemini when that path is used. Chime-first pairing landed in `f8a023e` (in-repo FSK motif, guest join, no typing or scanning).

**Look-to-sync.** `src/input/gazeSync.ts`: when a paired phone is looked at (front-camera FaceLandmarker already in the stack), the web canvas can push the current board to that phone; visibility/focus is the fallback. Camera frames and landmarks are not supposed to leave the device; a ledger START event records that the gaze camera opened. On `wip/iphone-canvas`, `phoneEditLock.ts` keeps touch editing locked until the facing signal is true (`LOOK_TO_EDIT_HINT = 'Look at me to edit'`; re-lock after `LOOK_AWAY_LOCK_MS` = 3000).

**Ledger.** Every cloud round trip is logged with its byte size (README + proposal / activity UI). The demo script’s floor-plan take shows a footer like “2.2 KB sent to cloud”; a connect-dashboard draft in that script shows 0 B.

**Hands.** MediaPipe 21 landmarks, on-device only. Selfie-mirrored in presence (`x' = 1-x`); pointer math converts back with `cameraHandsFromSelfie`. Classification is handedness-agnostic (8319f68-style: if it is fist-like it is a fist). MediaPipe Left/Right is a trace label only. Pointer slots use `assignHandSlots` by tip proximity, not those labels.

---

## 5. Current gesture spec (live on sim-main after this batch)

There are two gestures only:

1. **Hover-select (click).** Rest the cursor still on a control or a `.mc-frame` for **1.5 s** (`HAND_FEEL.dwellMs` and `CONFIRM_DWELL_MS` = 1500). A visible `.mc-hand-dwell` ring fills over that window, then the control is clicked or the board is selected/focused. Moving more than `dwellSlopPx` resets the ring. One fist alone is cursor only — it does not click and does not drag.
2. **Two-fist MOVE.** Both hands clenched fists, both fist points inside the same `.mc-frame`. That board is grabbed and follows the midpoint of the two fists (`onBoardMove` + `frames.setRect`) until either fist opens. Opening either fist ends the grab.

**While a two-fist grab is active, all other buttons and UI ignore hover:** no dwell rings, no clicks, no hover activation (`isGrabActive` / `isBoardGrabbed` short-circuit in `aim()`). The point is to drag a board across the right-side chips, to the edge, and onward. Re-enabled when the grab ends.

**Out:** pinch (completely), fist-squeeze click, one-fist drag, two-finger scroll, handedness-mirrored point/fist math.

**Implementation note, do not over-claim:** `edgeTransfer.ts` is the one-hand/mouse **tile** path onto a paired phone. Two-fist board move currently translates the frame with `setRect` in `canvasApp.ts`. It is not wired through `edgeTransfer`. Whether a whole board hops devices during a two-fist drag still needs a live check; do not say that path is proven.

---

## 6. Known issues and history

All times below are Asia/Calcutta, 24 Nov 2026 unless noted.

- **8319f68** — Live-test UX: pinch band in trace units, clearer poses, skeletons, smoother palm scroll. This is the last “pinch-era” baseline many traces were recorded against (`golden-trace-8319f68.json`, `rec-left-8319f68.json`).
- **4423a20** — Never freeze the cursor for palm scroll; engage only on motion. Landed on `sim-main`, then **reverted** by **c44e591** (normal revert, not a force-push) so `sim-main` could merge **wip/cluster-spacing**.
- **ad7f03c** (`wip/cluster-spacing`) — Floating review window and always-on AI activity, plus cluster spacing / edge pose freeze from that line. Keep this UI.
- **895de86** (19:27) — `Merge wip/cluster-spacing for the sim-main preview.` After that merge the tree matched `ad7f03c`. Tests were green in the sim / unit suite. **Live camera on Akash’s machine was worse:** left and right both glitched, and the left hand “can’t tell if it’s left or right.” The working diagnosis: handedness-mirrored point/fist math trusted MediaPipe’s Left/Right label, which flips frame to frame, so classification inverted (left worse than right).
- **bc24ba2** — Tighter pinch hold and left/right point-fist hysteresis (on this line; later dropped along with mirroring).
- Attempts that were tried and then **removed** from the live spec: pinch-click; fist-squeeze click (quick fist &lt;~500 ms); hover-select first at ~1 s, then 3 s (`828398a`), then **1.5 s** (this batch).
- **828398a** (20:24) — `Live-test UX: 3s hover-select, two-fist board move, no pinch.` This was the last pushed `sim-main` commit before this batch. The 3 s dwell is superseded by 1.5 s in the follow-up commit.
- **Tests passing in sim but failing live** is a real pattern on this project, not a one-off. Unit and pipeline tests use synthetic landmarks and a faked document. They cannot catch MediaPipe label flip, camera smoothing, or z-order of the real right-side chips under a moving board. After this batch, still do a live-camera pass: 1.5 s hover-select, two-fist move across the right-side buttons, unmatched speech (“hi how are you”) on a **non-sim** preview if App Check allows.

Other standing notes (not re-tested in this pass): left-hand quality was the reason mirroring was dropped; if a live left-hand issue remains, track by position/slot, never by MediaPipe Left/Right. `frameIdAt` / `boardAt` used `elementFromPoint` + `closest('.mc-frame')` — if a chrome button sits over the board, a fist whose tip is still geometrically on the board may fail the board hit-test and drop the grab. That is exactly the “drag across the right-side buttons” case; check (and if needed, hit-test `.mc-frame` rects) during the live pass.

---

## 7. iPhone app

Branch: **`wip/iphone-canvas`** at **177964a** (`177964a818412c09b452934a28079221e23be898`), message: “Fix iPhone black screen and wire Apple FM on the mic path,” 24 Nov 2026, 20:19:31 +0530, tracking `origin/wip/iphone-canvas`. **Do not push over this branch from `sim-main` gesture work, and do not merge it blindly onto `sim-main`.**

What that commit is for: canvas + mic + badge, and `SceneDelegate` setting the root to `MendcraftViewController`.

Verified in the branch:

- `ios-src/SceneDelegate.swift` sets `window?.rootViewController = MendcraftViewController()`. A bare `CAPBridgeViewController` never registers `MendcraftAppleAI` and can leave the WebView black.
- `ios-src/README.md` says: copy the Swift files into `ios/App/App/`, add them to the App target, set the Main storyboard’s view controller class to `MendcraftViewController` (module **App**), and replace any Capacitor-generated `SceneDelegate` that instantiates `CAPBridgeViewController()`.
- Apple path: `MendcraftAppleAIPlugin.swift` uses Foundation Models for Quick jobs; badge **Apple · on device** when that path answers. The README on that branch still said those Swift files had not been compiled or run on the Linux box.
- Also on this branch, not on `sim-main`: `src/canvas/iphoneShell.ts` (phone-simple canvas when Capacitor iOS/Android or viewport &lt; 600px), `phoneCanvasRuntime.ts` (look-to-edit + Relay guest join, no hand tracking), `phoneEditLock.ts`, plus mic / engine / canvas wiring. See §12.

**Mac build commands.** The in-repo README’s original Mac steps still say: `npm install` && `npm run build`, `npx cap add ios` if needed, `npx cap sync ios`, copy Swift files, pick a signing team, and Run from Xcode on a physical iPhone 15 Pro or newer (Xcode 26, iOS 26+, Apple Intelligence on). The Simulator often lacks the on-device model.

The following device workflow was specified for this handover as the current Mac procedure. It was **not** found as a checked-in script in the mendcraft repo or under `/workspace/hackathon/firebase-hybrid` (searched for the device id and `devicectl`). Use it as Akash’s stated workflow, and **do not use the Xcode Run button from an old worktree**:

```sh
# After npm run build && npx cap sync ios, from the iOS project
xcodebuild -destination id=<iPhone-UDID> -derivedDataPath ~/mendcraft-live/dd
# then:
xcrun devicectl device install app --device <iPhone-UDID> <path-to-built-app>
xcrun devicectl device process launch --device <iPhone-UDID> app.mendcraft.relay
```

`app.mendcraft.relay` is verified in `capacitor.config.ts`. The exact `xcodebuild` scheme/target flags were not in the repo; fill them from the generated Xcode project on the Mac.

---

## 8. Android status

An `android/` Capacitor project is already tracked on `sim-main` and `origin/main` (58 files, package `app.mendcraft.relay`). It has not been confirmed as built or installed in this pass.

`README.md` already documents phones without on-device Nano: “all iPhones, and Android phones outside the AICore list, e.g. Nothing Phone 3a” — those fall back to Gemini in the cloud (or the hub), with an honest route line.

SDK and JDK 21 being installed on the Mac, and “not built yet,” were given for this handover; they could not be verified from this Linux box. Do not treat an APK as existing until you build it on the Mac.

---

## 9. Firebase setup

- Firebase project id (`.firebaserc`): **`mendcraft`**.
- Hosting preview channel name: **`sim-main`** only. Deploy with `npm run build` then `npx firebase-tools hosting:channel:deploy sim-main --project mendcraft`. The tool may print the production Hosting URL `mendcraft.web.app`; that is not a production release. Confirm the preview URL `https://mendcraft--sim-main-o8jrlskh.web.app`.
- `.env`, `.env.local`, and `.env*` are gitignored. `.env.example` is tracked. Builds need a local `.env.local` (and `.env.production` if you use that file). Copy from an existing worktree if missing. **Never commit or paste their values.**
- App Check is required for Firebase AI Logic (`src/firebase/appCheck.ts`). Init uses reCAPTCHA Enterprise. A missing site key or failed init falls back to the rule parser and tells the UI. Debug tokens are allowed only in a Vite dev build, or on a local hostname with `?debug`. Production bundles never enable the debug token, including on the hosted site with `?debug`. A debug token must be pre-registered in the Firebase console when you use local debug; **do not put the token in the repo or in this file**.
- The preview channel domain is often not on the App Check / reCAPTCHA authorized-domains list, which is one reason `?sim=1` skips `prepareHybrid()` (`canvasMain.ts`). A **non-sim** Gemini check on the preview may 403 until the domain or a debug token is handled — that is still on the remaining checklist.

---

## 10. Secrets and config (locations only — never values)

Do not put any of these values in the repo, in a commit, or in chat. This section lists **where** they live and the **names** of the variables. If a file is missing, copy from another existing worktree or fill from `.env.example` — do not invent keys.

**Firebase web config and reCAPTCHA site key** live in **`.env.local`** (gitignored). Copies verified present on this box (contents not read for this handover):

- `/workspace/hackathon/firebase-hybrid/builder-relay/sim-main-ship/.env.local` (this ship worktree)
- `/workspace/hackathon/firebase-hybrid/builder-relay/sim-main/.env.local` (parked worktree)
- `/workspace/hackathon/firebase-hybrid/builder-relay/app/.env.local` (the `app/` worktree)

On the Mac, the copy to use is **`~/Developer/mendcraft-sim/.env.local`**. That path was given for this handover; it is not on this Linux box. After `git pull` on the Mac, if `.env.local` is missing, copy it from a machine that already has it, or `cp .env.example .env.local` and fill the values. `.env.production` matches the same `.env*` ignore rule. It had been **tracked** in git despite that rule; this batch runs `git rm --cached -- .env.production` so it stays on disk but is no longer in the tree. Values were not opened or copied into this file. History may still contain the old blob — if that file held real keys, rotate them. Do not override production keys with placeholders (see `src/firebase/envGuard.ts`).

**Names in tracked `.env.example`** (values are empty in that file):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_RECAPTCHA_SITE_KEY`
- `VITE_APPCHECK_DEBUG`
- `VITE_SPOTIFY_CLIENT_ID`

**Also referenced in code, but not listed in `.env.example`:**

- `VITE_APPLE_MUSIC_DEV_TOKEN` (`src/music/appleMusic.ts`)
- `APPCHECK_DEBUG_TOKEN` — a **non-Vite** process env used by `vite.config.ts` to inject a local App Check debug token into dev HTML only. Never written into `dist` during `vite build`.

**App Check debug token — where it may live (paths only):**

1. For local Vite dev, README says: set `VITE_APPCHECK_DEBUG=true`, copy the token printed in DevTools, and register it in Firebase console → App Check. Never commit it.
2. `vite.config.ts` `loadLocalDebugToken()` also looks for, in this order: env `APPCHECK_DEBUG_TOKEN`, then `~/.secrets/mendcraft-appcheck-debug`, then `<repo>/.secrets/mendcraft-appcheck-debug`. The file is injected only for the Vite dev server / localhost `vite preview` with `?debug`. Production hosted builds do not enable the debug token, including on the preview channel with `?debug`.
3. `.secrets/` is gitignored (added in this batch). Do not add token files to the repo.

`docs/CONSOLE-STEPS.md` has the **human** Firebase console steps (including App Check replay protection). Do those in the console; do not automate them from an agent unless Akash asks.

**Firebase CLI login** is not a repo file. On this Linux box the CLI config lives under `~/.config/configstore/` (`firebase-tools.json`, `firebase-appcheck.json`). The same kind of user config lives under the Mac home after `npx firebase-tools login`. Do not copy those files into the repo. This box was already logged in for preview deploys to project `mendcraft`.

**iOS signing team.** In-repo docs (`ios/README.md`, `ios-src/README.md`) say: after `npx cap add ios` / `npx cap sync ios`, open Xcode and pick a signing team. No `debug.xcconfig` is tracked in this repo (searched; none found). If you keep a `DEVELOPMENT_TEAM` in a `debug.xcconfig` inside the **generated** `ios/App` tree on the Mac, do not commit it. The generated Xcode project is meant to be recreated on a Mac; only some `ios/App` build outputs are gitignored today, so a new xcconfig could be committable if you `git add` it. Don't.

**Check:** `tests/gitignore.secrets.test.ts` asserts that `.gitignore` lists `.env.local`, `.env*`, `!.env.example`, and `.secrets/`, and that `git check-ignore` treats `.env.local` as ignored and `.env.example` as not. Keep that test green.

---

## 11. Branches and deploy rules


| Ref | SHA (as of this handover) | Notes |
|---|---|---|
| `origin/sim-main` before this batch | `828398a` | 3 s hover-select, two-fist move, no pinch |
| `origin/main` | `5f8177f` | Do not touch |
| `origin/wip/iphone-canvas` | `177964a` | iPhone shell + SceneDelegate + Apple FM mic path |
| `wip/cluster-spacing` (local worktree) | `ad7f03c` | Already merged via `895de86` |
| parked `sim-main` worktree | `wip/guided-recorder` @ `4423a20` | Reverted on the ship branch; leave it |

Rules: preview channel `sim-main` only; never `main` or production without Akash; no force-push; no Firebase console / App Check / billing / rules deploys from an agent unless Akash asks; no secrets in the repo.

---

## 12. Scaffolding still to push (or still only on another branch)

Verified with `git ls-files` and `git diff --name-status origin/sim-main origin/wip/iphone-canvas`.

**Already in the git repo on `sim-main` (and `main`):** Capacitor stubs `android/` (58 tracked files) and `ios/` (`ios/README.md` plus copies under `ios/plugins/` of `MendcraftAppleAIPlugin.swift`, `MendcraftGimbalPlugin.swift`, `MendcraftLanPlugin.swift`, `MendcraftViewController.swift`). `ios-src/` on `sim-main` has those four Swift files plus `README.md`, but **not** `SceneDelegate.swift`.

**Already on GitHub, but only on `origin/wip/iphone-canvas` (not on `sim-main`):**

- `ios-src/SceneDelegate.swift` (new) and a small `ios-src/README.md` update.
- New web shell: `src/canvas/iphoneShell.ts`, `phoneCanvasRuntime.ts`, `phoneEditLock.ts`, and tests `iphoneShell.test.ts`, `phoneCanvasRuntime.test.ts`, `phoneEditLock.test.ts`.
- Related edits: `canvas.html`, `src/canvas/{activityLog,canvas.css,canvasApp,canvasMain,editBoard,engines,frames,micFab,morphFlow}.ts`, plus tests.

**Do not merge the whole branch.** The same diff also touches `src/canvas/handFeel.ts`, `handPointer.ts`, `src/input/gestures.ts`, `tests/canvas/gestureTrace.test.ts`, `handPointerPipeline.test.ts`, `tests/gestures.test.ts`, `say-box-hand-path.test.ts`, and **adds** `tests/canvas/twoFingerScroll.test.ts` (two-finger scroll was deleted on `sim-main` when pinch/other gestures were removed). A naive merge would fight the current 1.5 s hover + two-fist spec. Port only the iPhone shell / SceneDelegate / mic / badge / look-to-edit files, then re-test on `sim-main`.

**Not in the git repo (generated or local only):**

- The real Xcode project `ios/App/` is created on a Mac with `npx cap add ios` / `npx cap sync ios`. Build products (`Pods`, `DerivedData`, `ios/App/build`, …) are gitignored. `ios/README.md` describes this. There is no full `ios/App` tree in the worktree on this box, only `ios/README.md` and `ios/plugins/`.
- Live helper scripts described as living in **`~/mendcraft-live` on the Mac** (`nav.mjs`, `clr.mjs`, `rec-left.mjs`) were **not** found in this repo or on this Linux box. What *is* on the box, **outside the git repo**, is `/workspace/hackathon/firebase-hybrid/e2e-review-2x/live/` (`mac-cdp-check.mjs` defaults `OUT_DIR` to `~/mendcraft-live`, plus `golden-trace-8319f68.json` and `rec-left-8319f68.json`). If those Mac scripts and traces matter for judges or the next live pass, copy them into the repo (without secrets) or into `~/Developer/mendcraft-sim` and push.
- Likewise, `submission/devpost-draft.md`, `submission/demo-video-script-v3.txt` (and v1/v2), `e2e-review-2x/SUBMISSION-CHECKLIST.md`, and `builder-relay/demo-object.md` live under `/workspace/hackathon/firebase-hybrid/` and are **not** tracked in `ak9381/mendcraft`. Copy anything you still need into the Mac checkout or a notes folder if it is not already there.

---

## 13. Live test scripts

On the Mac, the intended folder is `~/mendcraft-live`. `e2e-review-2x/live/mac-cdp-check.mjs` is written to run on Akash’s Mac against an already-open Chrome started with `--remote-debugging-port=9222`, with the Mendcraft canvas tab open. It reloads with `?fresh=1`. Env: `CDP_URL` (default `http://127.0.0.1:9222`), `PREVIEW_URL`, `OUT_DIR` (default `~/mendcraft-live`). Do not run that script against the box browser.

In the app: `window.__mcTrace` (`src/canvas/gestureTrace.ts`). Enable with `?debug=gestures` or by assigning `window.__mcTrace` (object with `enabled: true`, or `true`) before install. The trace is a ring buffer (`dump()`, `clear()`).

`nav.mjs`, `clr.mjs`, and `rec-left.mjs` were named as Mac helpers in that folder; they are not in the repo (see §12).

---

## 14. Replay plan for judges (no camera, no hands)

Judges, and a laptop without a camera, must be able to run the product.

**What already works**

- Open the preview in scripted mode:  
  https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1&sim=1  
  `?sim=1` forces scripted Nano and Gemini (`planEngines`), skips warming App Check / cloud models, uses deterministic swarm motion, scripted teach-a-gesture samples, and a camera-free Register feed (`scanRegistration.ts`). The say box / Talk still accept typed or spoken commands; unmatched speech goes through `openEndedAsk` (scripted engines under `?sim=1`).
- A narrower built-in replay: `?sim=1&demo=morph` waits 2.5 s and calls `window.__mcMorph.replay()` (`canvasMain.ts`).
- Hands stay **on** under `?sim=1` unless `?hands=0`. For a no-camera judge session, use `?hands=0` so the app does not wait on a webcam. Mouse / tap / typed commands still work.
- Unit-level trace replay exists in `tests/canvas/goldenTrace8319f68.test.ts`. It reads **`/workspace/hackathon/firebase-hybrid/e2e-review-2x/live/golden-trace-8319f68.json`** (absolute path, **outside the git repo**) and replays pinch-band behaviour through `classifyGesture` / `createPinchMachine`. There is a sibling recording, `rec-left-8319f68.json`, in the same folder. These traces are from **8319f68**, a pinch-era build. They are not a judge-facing canvas demo, and they do **not** match the current “no pinch, 1.5 s hover, two-fist move” spec.

**What does not exist yet**

- No query flag was found that loads a recorded hand trace into the live canvas (nothing like `?replay=golden`).
- The golden traces are not in the published repo, so a judge cloning `ak9381/mendcraft` cannot run that vitest file as-is.
- A full deterministic “play the demo video path with fake hands” mode is **not** built. `?sim=1` scripts the models, not the hands.

**Plan to build a deterministic demo replay** (recommended next, on `sim-main`):

1. Record a short, current-spec trace on the Mac (`?debug=gestures`, `window.__mcTrace.dump()`): hover-select at 1.5 s, a two-fist board move across the right-side chips, and a couple of voice/typed commands (connect-devices, save, a greeting). Keep a `?sim=1` take so model output is stable. Commit the JSON under something like `tests/fixtures/traces/` (and, if judges should load it, `public/replays/`). Do not reuse `golden-trace-8319f68.json` as the demo; keep it only as historical pinch evidence if you still want it.
2. Add a boot flag, e.g. `?sim=1&hands=0&replay=demo`, that feeds the recorded frames through the same `createHandPointer().update()` path the pipeline tests use, on a wall-clock or fixed timestep, and types/says the recorded utterances into `run()`. Make the sequence deterministic (seeded, no live camera, scripted engines already guaranteed by `?sim=1`).
3. Cover it with a vitest that boots the replay headless (or drives `update()` + `run()`) and asserts: no `"isn't a canvas command yet"`, a Keep/Approve review can be dwell-selected, a board moves on two-fist frames, and the ledger/badge text is the scripted one.
4. Put the URL on Devpost “Try it”:  
   `https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1&sim=1&hands=0&replay=demo`  
   (or the production host later, only with Akash’s OK). Also keep a no-replay URL for judges who will click and type only.
5. Re-read the official physical-access note in `relay-research/relay-to-5.md`: `/?sim=1` should be a complete product so the entry does not depend on a gimbal, a specific bulb, or other hardware. The video can still show those; the clickable demo must stand without them.

---

## 15. Demo plan and script

Use `/workspace/hackathon/firebase-hybrid/submission/demo-video-script-v3.txt` as the working shot list (see §1). Companion files in the same folder: `demo-video-script.md`, `demo-video-script-v2.md`. Object/hero memo: `builder-relay/demo-object.md` (dated 12 Nov; pinch/iPad parts are stale). Submission checklist: `e2e-review-2x/SUBMISSION-CHECKLIST.md` (checked 24 Nov 2026, 00:55 IST, read-only).

Hardware called for in the script: Insta360 Flow 2 Pro gimbal (iPhone / DockKit; no gimbal control on web — the app should say so), a real WiZ lamp (cutaway still marked pending in the script), chime pairing with the Nothing Phone 3a on the left and the iPhone on the right, and the Apple-vs-Gemini ledger beat (shot 12d).

---

## 16. Remaining checklist

From `e2e-review-2x/SUBMISSION-CHECKLIST.md` and this batch:

- [ ] **Gemini non-sim check** — one real desktop Chrome run with Nano that shows an on-device answer and a cloud answer. Headless Chrome on the Linux box has no Nano. The preview domain may need App Check / authorized domains (or a local `?debug` token in dev only).
- [ ] **Live-camera gesture pass** on the 1.5 s dwell + two-fist move + grab-disables-hover build (tests will not catch this alone).
- [ ] **Demo recording** — film against the script; cut toward ≤3:00; include on-device and cloud; English or subtitled.
- [ ] **YouTube** — public or unlisted upload. No video link was in the repo or notes as of the 24 Nov 00:55 IST checklist. Upload early (processing is slow).
- [ ] **Devpost review** — draft is not submitted. Confirm the Try-it URL, license/visibility, and whether to point at the preview (expires; the 23 Nov note said the channel expires 4 Dec 2026) or a production deploy (needs Akash). Optional quota form: closes 25 Nov 2026, 11:30 PM IST if a billing-required model is used.
- [ ] **Port iPhone shell / SceneDelegate** onto `sim-main` without regressing gestures (§12).
- [ ] **Judge replay mode** (§14).
- [ ] **Android build** on the Mac (Nothing 3a; no Nano, cloud fallback).
- [ ] Decide whether research/demo markdown under `/workspace/hackathon/firebase-hybrid/submission` and `e2e-review-2x` should be copied into the public repo.

---

## 17. This batch (24 Nov 2026, evening)

Code and docs on `sim-main` (SHA is this commit once pushed):

- Unmatched speech (“hi how are you”, “let’s build something”) goes to `openEndedAsk` (Nano first, then Gemini). The string `“…” isn’t a canvas command yet` is removed. Tests: `tests/canvas/openEndedAsk.test.ts`, `tests/canvas/openEndedCommand.test.ts`. Known command “let’s build the next thing” still maps to `buildNext`.
- Hover-select dwell is 1.5 s (`HAND_FEEL.dwellMs` and `CONFIRM_DWELL_MS` = 1500).
- During a two-fist grab, other UI ignores hover (no rings, no clicks). `tests/canvas/handPointerPipeline.test.ts` covers dwell-on-a-button during grab, then dwell working again after the grab ends.
- `HANDOVER.md` added at the repo root (this file), including the secrets-locations section.
- `.secrets/` added to `.gitignore`. `tests/gitignore.secrets.test.ts` asserts `.env.local` stays ignored. `.env.production` was untracked with `git rm --cached` (file left on disk; values not inspected).

`tsc --noEmit` clean; `vitest run` **2729 passed**, 1 skipped, 237 files. Then: `git push origin sim-main` (no force), preview-channel deploy only, and a check that the deployed JS does not contain the dead-end fallback string.

Preview: https://mendcraft--sim-main-o8jrlskh.web.app/canvas.html?fresh=1
