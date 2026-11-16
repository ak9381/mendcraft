# Mendcraft

**Hands-free design for people with limited hand use.** The builder's mom has
arthritis and speaks Kannada; typing and a mouse hurt. Mendcraft lets her design
with a small **pinch** (camera hand-tracking) and short **voice** commands, in
English or any other language (polished in English). She can draw a floor **plan**, lay out a **UI** screen, or
fall back to a 3D **part** (a cup grip, a hook) and export it — and she can teach
the app a phrase once and reuse it forever. Every AI step is honest about where
it ran and what, if anything, left the device. Built for Google **#BuildHybridAI**.

Not milestone-ware: plan / ui / part modes, the hybrid router, the privacy
ledger, the offline queue, recipes, device pairing + iPad `/control`, and a judges' tour
are all in the build and exercised by the screenshot walk and the test suite.

---

## How it uses Firebase AI Logic (hybrid)

Mendcraft calls `firebase/ai` at runtime (`src/firebase/*`, `src/ai/*`). The core
rule: **the model never emits free geometry.** Every response is re-validated by
code (`validateOp`, the plan/ui coercers) before it can touch the scene, and
every edit carries an honest **AI-source badge** — `ON-DEVICE`, `CLOUD`, `RULES`
(local deterministic parser) or `SIM` — with the **router's reason** next to it
(e.g. `ON-DEVICE · nano handled it`, `CLOUD · escalated: low confidence`).

| Job | Inference mode | On-device vs cloud — why |
|---|---|---|
| **Intent fusion** (utterance + selection + scene → one validated op) | `PREFER_ON_DEVICE` (Gemini Nano in Chrome) | Fast, private, offline; the common case never leaves the device |
| **Edit verifier** (before/after + printability) | `PREFER_ON_DEVICE` | Cheap sanity check; stays local |
| **Hand-profile pick** (effort/tremor/pinch metrics → preset) | `ONLY_ON_DEVICE` | Raw hand metrics are sensitive; the numbers never leave the device |
| **Point-and-say** (deixis from a camera crop + pointer) | multimodal Nano | The only image path, user-initiated and logged |
| **Big generate** (plan / screen / part from a longer request) | cloud `gemini-3.5-flash-lite` | Needs more reasoning than Nano; escalated on low confidence |
| **Any language** (detected on device by Chrome's Language Detector; cloud `lang-detect` only if that API is missing) | Nano for en/es/ja, else cloud translate + op in ONE call | Polished in English. Speak any language. The badge and Routing panel say why |
| **Spoken replies in her language** | browser `speechSynthesis` | The model's short reply in her language when a voice exists, otherwise English; nothing leaves the device |

Firebase pieces wired in:

- **Router + badge** — `src/ai/router.ts` plans a route (`exactRuleParse` → Nano →
  cloud), escalates on low confidence, and produces the `source · reason` string.
  A dev **Routing** panel shows planned path vs. honest actual source.
- **"What left this device" ledger** — `src/core/ledger.ts` records every cloud
  round trip (abstract payload, byte size, why it routed out) behind the badge; a
  `/control`/in-app **Ledger** panel lists cloud calls vs. private on-device
  events. `src/core/outbound.ts` is a static registry of every outbound *kind*,
  and `tests/privacyDrift.test.ts` fails the build if an undeclared cloud call
  appears or `docs/PRIVACY.md` stops mentioning a kind.
- **Offline queue** — big cloud jobs made offline are queued in IndexedDB
  (`src/offline/queue.ts`), with an online/offline indicator; on reconnect they
  drain to a ready-to-apply preview (Apply / Reject), never auto-applied.
- **App Check** — initialised before any AI call (reCAPTCHA Enterprise; debug
  provider in dev), with **limited-use (replay-protected) tokens** on `getAI`.
- **Server prompt templates** — the big cloud jobs can run a server-managed
  template, gated on a Remote Config `templateId` (inline prompt otherwise).
- **Remote Config** — drives the cloud model name, a prompt preamble, template
  IDs, and the TTS model/voice. Initial values are *applied* (not ignored) and a
  realtime listener keeps per-request values live without a redeploy; in-app
  defaults ship so nothing is required.
- **Performance Monitoring** — AI calls are traced (`src/firebase/telemetry.ts`).

**Not a model:** MediaPipe HandLandmarker is a landmark sensor (pinch select /
drag) — camera frames are processed in the browser and **never uploaded**. Web
Speech does on-device transcription; a text box is always the fallback.

---

## Features by mode

One shared shell; `?mode=` picks the editor. All three share the op log (undo/
redo), the pinch/mouse pointer stream, the on-canvas palette, and voice.

- **plan** (default, `src/plan/*`) — 2D floor-plan CAD. Walls, rooms, doors/
  windows hosted on walls, furniture/stairs/columns fixtures, text, a measure
  tool, 3D extrude preview, **DXF** + JSON export.
- **ui** (`?mode=ui`, `src/ui/design/*`) — screen design. Frames (desktop/
  mobile), navbar/heading/input/button elements, alignment guides, properties
  panel, live preview and **HTML** export.
- **part** (`?mode=part`, fallback) — the original 3D "cup grip" flow (CSG holes
  via three-bvh-csg, STL export). Kept intact as the simplest grip.

Voice/pinch edits are re-validated per mode; an **accessibility** check runs
*before* routing and lists each issue with its cited standard and a one-click,
undoable fix. Unsure commands show **Did-you-mean** chips; anything destructive
or that sends needs an explicit confirm (pinch or tap) — **never auto-send**.

---

## Recipes — "taught once, done forever"

Record a short sequence once; replay it by name forever. The recorder taps the op
log (`src/recipes/*`), stores steps **anchor-relative** (concrete targets rewritten
to `selected`), and replays them as one undo group through the existing `batch`
op. On-device Nano picks which recipe a phrase means. Recipes also drive a WiZ
lamp and the music player (clamped device intents) and show up as privacy-safe
cards on the iPad `/control` room.

A recipe can also replay inside an **in-canvas browser panel**
(`src/recipes/browserDriver.ts`): it steps a same-origin iframe through the taught
sequence, highlighting each target and pausing for an explicit confirm before any
submit (the confirm gate is recomputed at replay time, so a real form submit stops
even without a send/pay/delete word). Cross-origin pages fall back to open-in-tab
with the remaining steps listed — it never silently bypasses the confirm.

---


## Chrome extension — copy and paste in any tab

A small Manifest V3 extension in `extension/` lets her copy from and paste into
**any Chrome tab** with voice or a pinch ("copy this", "copy the link", "send to
canvas", "paste here", "switch to Gmail"). Paste always waits for a pinch-to-confirm
card in Mendcraft; password and payment fields are skipped; forms are never
auto-submitted. Install: Chrome → `chrome://extensions` → Developer mode →
**Load unpacked** → pick the `extension/` folder. The studio status bar shows
**Chrome extension connected**. First-run setup has a short Connect Chrome step.
Details and the permission explanation are in `extension/README.md`.

Sites that refuse to be framed (LinkedIn, Google, Spotify, Instagram, Facebook,
X, WhatsApp, GitHub login) no longer sit on "Loading…" in the reference panel:
the Open card appears immediately, and with the extension connected it opens a
real Chrome tab instead.

## Device pairing + iPad `/control` + phone remotes

The entry fork lives in `src/boot.ts`; the pairing protocol/session/transport in
`src/relay/*`. **State honestly:**

- **Built & tested:** pairing (`ABCD-EFGH` code / QR), the privacy-safe
  `ControlSnapshot` (summary only — ids/names/device/recipe cards; **no ops and
  no full `PlanDoc` leave**), the read-mostly iPad `/control` dashboard (AI feed,
  ledger + offline queue, lamp/music + captions, SVG wireframe, and a fullscreen
  orbit **3D review** extruded from the snapshot primitives), a `/remote` + `/phone`
  controller, and a `fake-transport` fallback so the demo runs with no backend.
- **Needs a real device / human step:** Firestore **is** enabled (the `(default)`
  Native-mode database, with `firestore.rules` deployed by the pipeline), so real
  phone↔laptop pairing works — but cross-device sync needs **both devices online
  and in the same room/book**, and the frames are low-rate stills over Firestore,
  not WebRTC. The WiZ lamp (needs the local Node UDP bridge: `npm run wiz-bridge`)
  and Spotify Premium (needs a free Spotify developer Client ID in `VITE_SPOTIFY_CLIENT_ID`; otherwise an honest "Spotify not set up" state and the built-in public-domain player) each require a
  real device or console step. The Android shell
  (`android/`, Capacitor) boots to `/remote`; its opt-in AccessibilityService is
  allowlisted and **never auto-sends** WhatsApp drafts (`src/assist/policy.ts`).

---

## First-run setup and a gesture for every button

- **Set up hands** (More menu, or say "set up" / "ಹೊಂದಿಸು"; opens by itself the first time the camera turns on): measures her comfortable reach (that small box then covers the whole screen), how firmly she can pinch (thresholds sit inside it), and how steady her hand is (smoothing and dwell time). Numbers only, saved in this browser's localStorage. Code: `src/setup/calibration.ts`, `src/setup/setupState.ts`, `src/ui/setupPanel.ts`.
- **Record or replace a gesture in 3 tries**: poses are normalised for position, size and rotation; a try that doesn't match the others is asked for again (`src/input/gestureTemplates.ts`).
- **Map any toolbar button to a gesture or a spoken phrase** (Kannada kept as typed). Her bindings win over the defaults.
- **Optional face cues**: a held smile or raised eyebrows confirm something already waiting (chips, recipe card). They never start an action (`src/input/faceCues.ts`).
- **Default gestures** (`src/input/gestureCatalog.ts`, recogniser `src/input/motionGestures.ts`, dispatch `src/input/gestureDispatch.ts`): V = undo, three fingers = redo, palm flip = More, hold a pinch still = mic, open palm 1 s = stop/cancel, palm swipe = back/forward (panels), two-finger swipe = scroll, twist = rotate, air tap = tap, fingertip circle = select inside, palm raise/lower/tap = lamp (while the lamp panel is open), both palms = rest mode, wave = wake. Held poses need 400 ms so tremor doesn't fire them. Buttons with a gesture show a small badge; every button in the toolbar, menus and panels is also pinchable, or clickable by hovering (dwell).
- **Music:** Spotify Premium is the default source when connected (play/pause/skip/volume, voice search like "play some old Kannada songs"). Without a Client ID or before she connects, the built-in public-domain player is used. Pinch-slide (volume) and two-finger swipe (skip) work while the Music or Lamp panel is open. Code: `src/music/`. Redirect URI is `${origin}/spotify`. Connect opens a small pop-up for Spotify sign-in so she never leaves Mendcraft (accounts.spotify.com blocks iframes, so the in-canvas browser cannot host it); if the pop-up is blocked, it falls back to a full-page redirect.

## Judges' tour and `/judges`

- `http://localhost:5173/?sim=1` — the scripted demo (no camera/mic/Nano). A
  mouse-driven virtual hand emulates the pinch; sim output is badged `SIM`. Add
  `&mode=ui` or `&mode=part` for the other modes. Walks live in `src/sim.ts`.
- A guided **tour** (the "?" button, `src/ui/tour.ts`) spotlights the real app;
  first load *offers* it rather than forcing onboarding.
- `/?view=judges` (`src/judges/judgesPage.ts`) — a one-page map of what to look at.

---

## Accessibility and privacy

- **`docs/PRIVACY.md`** — the human-readable twin of the ledger + outbound
  registry: the one-line claim ("camera frames, hand landmarks, face mesh and raw
  voice audio never leave this device") and every known outbound *kind*.
- **`docs/RISKS.md`** — honest list of ways the app could hurt/mislead/exclude
  its user and what in the code pushes back.
- **`docs/ACCURACY.md`** — measured command accuracy from a fixed eval set
  (English rules path 93%; Kannada is routed off to clarify, 100%), not vibes.
- Accessibility is enforced: WCAG-tagged **axe** audit (`npm run a11y:axe`) and
  the in-app, standards-cited checker.

---

## Run locally

```bash
npm install                      # npm ci can fail on some boxes; use install
cp .env.example .env.local       # fill in your Firebase web config (never commit it)
npm run dev                      # http://localhost:5173
```

- **Without Firebase config** the app still runs: commands go through the local
  rule parser (badge `RULES`), and `/?sim=1` needs nothing at all.
- **On-device Gemini Nano:** Chrome desktop 139+, enable
  `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, then click
  **Enable on-device AI** (the model must init on a user gesture).
- **Debug App Check:** set `VITE_APPCHECK_DEBUG=true`, copy the printed debug
  token from DevTools, register it in Firebase console → App Check. Never commit it.
- **Human console steps** (for a full cloud/replay-protected run) are listed in
  `docs/CONSOLE-STEPS.md`.

---

## Tests and screenshots

```bash
npx vitest run     # unit suite: op validator, engine, undo/redo, printability,
                   # rule parser, router, confidence, a11y, ledger/privacy drift,
                   # queue, language, recipes, screen-grader helpers, …
npm run build      # tsc type-check + production build
npm run eval:commands   # offline command-accuracy eval → eval/summary.md
npm run a11y:axe        # WCAG axe audit over every main screen (report, not a gate)
```

### Screenshots + a second-opinion grader

`scripts/screens.mjs` drives the real app headlessly through the judge path and
writes a numbered PNG per milestone (+ a real exported DXF) to `../screens`.

`scripts/grade-screens.mjs` then asks a model from a **different company than the
one that builds the app** — Google's **Antigravity `agy` CLI** (Gemini) — to grade
each PNG on a fixed JSON rubric: **legibility, target size, contrast, clutter, and
does-it-match-the-caption**, plus an overall score and a would-I-ship boolean.

```bash
node scripts/screens.mjs          # needs playwright + a chromium (writes ../screens)
node scripts/grade-screens.mjs    # grades them with agy; writes ../screens/grades.json
```

It shells out to `agy -p … --output-format json --json-schema …` in print mode.
If `agy` is not installed it prints **"skipped: no grader available"** and exits 0
— grading is an optional review pass, never a build gate. Captions come from an
optional `<screens>/captions.json`, else they are derived from the filename. The
pure parsing/caption/summary logic is `scripts/screenGrade.lib.mjs` (unit-tested
in `tests/screenGrade.test.ts`); the script itself never calls `agy` during the
test suite.

---

## Honest limits

- **Cross-device sync is still-based, not WebRTC** — Firestore is enabled, but
  frames go over it as low-rate stills and sync needs **both devices online in the
  same room/book**; when no room is reachable the demo transport takes over.
  `/control` only ever receives the privacy-safe snapshot, never the full document.
- **Kannada rules accuracy is 0** by design (the offline rule parser is
  English-only); Kannada is deliberately routed to the cloud or clarified, and the
  badge says so.
- **WiZ lamp / Spotify / Android assist / point-and-say** need a real device,
  the local bridge, a Spotify Client ID + Premium account, or a live camera frame respectively; each
  degrades to an honest "not configured" state rather than faking a connection.
  Spotify sign-in uses PKCE in the web app; the iOS Capacitor shell cannot finish
  the `/spotify` redirect yet — connect at https://mendcraft.web.app instead.
- **iOS** is a Capacitor shell of the full app (built on a Mac) plus the PWA remote
  (`/phone`). No app-automation on iOS. Spotify connect is done in the web app.

---

## Pre-existing code and libraries

All project code was written during the contest (from 12 Nov 2026). The only
pre-existing code is the `create-vite` vanilla-ts starter (MIT), since replaced.

| Library | License | Use |
|---|---|---|
| firebase (`firebase/ai`, `firebase/app-check`, Remote Config, Performance) | Apache-2.0 | Hybrid inference, App Check, config, tracing |
| @mediapipe/tasks-vision (HandLandmarker) | Apache-2.0 | Hand landmarks (local sensor) |
| three + three-bvh-csg | MIT | 3D viewport + CSG |
| @capacitor/* | MIT | Android/iOS shells |
| vite, typescript, vitest, axe-core, puppeteer-core, playwright | MIT / Apache-2.0 | Tooling, audits, screenshots |

No third-party logos or trademarks are included. **License:** Apache-2.0 (see
[LICENSE](LICENSE)).
