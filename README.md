# Mendcraft

**A smart canvas that Gemini Nano and Gemini turn into anything.** Open an
infinite canvas, say what you want, and Mendcraft builds it as live
[A2UI](https://github.com/google/A2UI) boards: a device dashboard for the room
you are in, a CAD floor plan, a translated layout. Every change shows the prompt
going in, which engine worked on it, and waits for a human to keep or drop it.
Built for Google **#BuildHybridAI**.

---

## The demo flow (one canvas, five steps)

1. **Open a new canvas** — `/canvas.html?fresh=1`.
2. **Connect the room** — Mendcraft finds the lamp and builds an interactive
   device dashboard board. With the local WiZ bridge running, the lamps are the
   bulbs it really finds (one per bulb, with its real on/brightness; one bulb
   in the room is one lamp on the canvas). Without it, two labelled `SIM`
   lamps stand in.
3. **Say "save"** — the dashboard is pinned to the side of the canvas.
4. **Build the CAD plan** — a floor-plan board appears next to the pinned
   dashboard; DXF export works.
5. **Say "add Kannada"** — Gemini drafts the language pack, and a **Proposal
   card** (Keep / Drop) waits for human approval before anything changes.

The camera gimbal (iPhone app) follows you while a board is being built; on the
web it soft-fails with a clear note.

## Hybrid AI: Nano drafts, Gemini upgrades

- **Firebase AI Logic** (`firebase/ai`) with Gemini Nano in Chrome for fast,
  private drafts and cloud Gemini (with a lite-model hedge) for bigger plans.
  Nano-only jobs use `ONLY_ON_DEVICE`; anything that may reach the cloud is
  redacted first. Every Nano prompt, board drafts included, is a `firebase/ai`
  call in `ONLY_ON_DEVICE` mode — Chrome's `LanguageModel` global is only
  asked whether the model is available. One on-device prompt runs at a time.
- **Nano first, Gemini second, never a stand-in.** A board draft is one short
  on-device call whose JSON-schema reply is only Nano's decision — a title
  and the device ids (or a floor-plan template); tiles and labels are built
  from the device list. If Nano errors, takes longer than
  20 s or returns an invalid plan, Gemini makes the board and the review says
  so, with the bytes sent. If Gemini fails too, the canvas shows the reason
  (for example `Gemini blocked: App Check 403`) and a Retry. Scripted drafts
  exist only under `?sim=1`.
- **The model never emits raw UI.** Every plan passes the surface-plan validator
  (whitelisted tile types, safe ids) before A2UI renders it with Lit, and lands
  in the Proposal keep/drop buffer first.
- **Byte ledger** — every cloud round trip is logged with its byte size, so the
  canvas shows exactly what left the machine. Bytes are booked on the real
  `fetch` to the Gemini endpoint (a hedge or retry counts again); a call
  that never issued a request, or whose request the network never delivered,
  books nothing and says "Nothing was sent."
- **App Check** (reCAPTCHA Enterprise) runs before any AI call.

## Privacy router: phones go through the desktop hub

Phones and connected apps send requests to the desktop Chrome hub over the room
link. The hub strips personal data first (rules, people-directory names →
`[Client A]`, optional Nano), sends only the cleaned prompt to Gemini, and puts
the names back locally. Every change carries its route:

| Label | Meaning |
|---|---|
| `routed via Mac: Nano cleaned, then Gemini` | Phone → desktop hub cleaned it → Gemini |
| `on this device` | Nano handled it locally |
| `Gemini (no Nano on this phone)` | Phones without on-device Nano (all iPhones, and Android phones outside the AICore list, e.g. Nothing Phone 3a) |

With no hub and no Nano, Mendcraft asks before sending anything uncleaned.

## Hands, gestures and "teach a gesture"

- MediaPipe hand and face landmarks stay on the device. The overlay is smoothed
  (one-euro filter), fades in and out, and respects reduced motion.
- **A glass-hand cursor on your palm.** The cursor sits on the palm centre
  (curling a finger barely moves it); the targeted control gets a hover
  highlight with a soft snap. **Tap a fist** (close and open quickly) to
  click; **hold a fist** and move to drag a board, or on the bare canvas to
  pan; **two fists** zoom. **Hover to click** (rest the palm) is an opt-in
  fallback in Tools. Pinch is not used. Hands pause while you look away from
  the screen. Debug landmarks: `?debugHands=1`.
- **Teach a gesture** — record 2–3 samples, say what it should do ("save the
  canvas"), approve it on a Proposal card. Poses match by nearest template,
  motions by DTW, with a confidence threshold and a warning on conflicts with
  built-in gestures. Custom gestures are stored on this device only. Demo:
  thumbs up = save.

## Phone companion (iOS and Android)

`/mobile.html` is the Capacitor companion: pairing (QR or 8-character code),
a one-handed canvas view with a board strip, the pinned dashboard, Proposal
cards as bottom sheets with Keep/Drop in the thumb zone, privacy-route chips,
and the gimbal camera. iOS follows the HIG, Android follows Material 3, and
a wide viewport gets a split view. Deep links: `?mobileScreen=pair|canvas|dashboard|approval|gimbal|tablet&sim=1`.

## Feature flags

Older modules (the old landing page, studio, phone remote, `/control`, legacy
judges page) are kept but off by default; every route lands on the canvas. Turn
one on with `?flags=landing,studio,remote,control,judgesLegacy` or `localStorage['mc.flags']`.

---

## Run locally

```bash
npm install                      # npm ci can fail on some boxes; use install
cp .env.example .env.local       # fill in your Firebase web config (never commit it)
npm run dev                      # http://localhost:5173/canvas.html?fresh=1&sim=1
npm run wiz-bridge               # optional: real WiZ lamp on the LAN (prints a token; open the canvas with ?wizToken=…)
```

- **Without Firebase config** the app still runs: commands go through the local
  rule parser (badge `RULES`), and `/canvas.html?sim=1` needs nothing at all.
- **On-device Gemini Nano:** Chrome desktop 139+, enable
  `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, then click
  **Enable on-device AI** (the model must init on a user gesture).
- **App Check on `npm run dev`:** put one stable debug token in
  `APPCHECK_DEBUG_TOKEN` (`.env.local`) or `~/.secrets/mendcraft-appcheck-debug`
  and register it once in Firebase console → App Check → Apps → Manage debug
  tokens. Without it Gemini is refused (403) on local addresses. Steps:
  `docs/app-check-local-dev.md`. Never commit the token.
- **Checking real Nano + Gemini by hand:** `scripts/live-probe.md`. Add
  `?nanoTrace=1` to log every on-device call's timings and sizes (never its
  content) to the console.
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
- **iOS** is a Capacitor shell (built on a Mac); the gimbal needs the iPhone app.
- **Gemini Nano** runs in desktop Chrome and on Android AICore devices only;
  other phones route through the desktop hub or are labelled `Gemini (no Nano on this phone)`.

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
