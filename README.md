# Mendcraft

Hands-free accessible 3D builder. A person with limited hand function designs and 3D-prints their own assistive part (a cup grip, a phone stand, a hook, a utensil holder) with a small pinch and short voice commands, then exports an STL. Built for Google #BuildHybridAI.

**Status:** milestone 1 (web app, Chrome desktop). Device hand-off ("the device you face is the device you keep working on") is planned next.

## How it uses Firebase AI Logic hybrid inference
Mendcraft imports `firebase/ai` and calls it at runtime (`src/ai/hybrid.ts`):

| Job | Mode | What it returns |
|---|---|---|
| Intent compiler: utterance + selected part + scene summary → one edit | `InferenceMode.PREFER_ON_DEVICE` (Gemini Nano in Chrome, cloud fallback) | Schema-constrained op JSON (enum op + numbers + target) |
| Edit verifier: before/after summaries + printability warnings | `PREFER_ON_DEVICE` | `{ matchesIntent, issue }` |
| Template generation from a longer request | `ONLY_IN_CLOUD` | Template name + parameters |

- The model never emits free geometry. Every response is re-validated by `validateOp` in code before it touches the scene.
- Every edit shows an **inferenceSource badge**: `ON-DEVICE`, `CLOUD`, `RULES` (local rule parser, used when Firebase isn't configured, the device is offline, or the model output is invalid) or `SIM`.
- App Check is initialised before any AI call (reCAPTCHA Enterprise provider; debug provider in development).

**Other components**
- MediaPipe HandLandmarker: used only as a landmark sensor for pinch select and pinch-drag.
- Web Speech API: short voice commands. A text box is the fallback.
- three.js and three-bvh-csg: the viewport and CSG for holes and booleans.
- Everything else is plain TypeScript.

## Privacy
Camera frames are processed in the browser by MediaPipe and never uploaded. Only the text command and a short scene summary are sent to the model (on-device when Nano is available).

## Run locally
```bash
npm install
cp .env.example .env.local   # fill in your Firebase web config (never commit it)
npm run dev
```
- **Without Firebase config**, the app still runs: commands go through the local rule parser (badge `RULES`).
- **On-device Gemini Nano:** use Chrome desktop 139+ and enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`. Then click **Enable on-device AI** (the model must be initialised on a user gesture).
- **Debug App Check:** set `VITE_APPCHECK_DEBUG=true` in `.env.local`, or run `npm run dev`. Open DevTools, copy the printed debug token, and register it in Firebase console → App Check → Apps → Manage debug tokens. Never commit the token.

```bash
npm test        # vitest: op validator, engine, undo/redo, printability, rule parser, templates, hybrid fallback, STL
npm run build   # type-check + production build
```

## WiZ lamp + music remote
The phone `/remote` page and the iPad `/control` room can drive a WiZ smart lamp
and an in-app music player; a discreet lamp control also lives in the laptop
editor (the **Lamp** toolbar button).

### WiZ lamp (needs the local bridge)
Browsers can't send UDP, so a tiny Node bridge does the datagrams to the bulb
(JSON-RPC on UDP `38899`) and exposes a localhost HTTP API:
```bash
npm run wiz-bridge                              # binds 127.0.0.1:38888 (this laptop)
npm run wiz-bridge -- --host 0.0.0.0            # let a phone on the same Wi-Fi reach it
npm run wiz-bridge -- --bulb 192.168.1.50       # pin a known bulb IP
```
- **Localhost by default.** `--host 0.0.0.0` is for same-Wi-Fi phones only — **never**
  expose the bridge to the public internet. No cloud, no WiZ account, no API keys.
- In the UI: **Discover** finds bulbs, then **On/Off**, brightness, warm/neutral/cool,
  and a couple of colours. If the bridge is down the UI says *"bridge offline — run
  `npm run wiz-bridge` on the laptop"* and never claims the lamp is connected.
- From a phone, point it at the laptop's bridge with `?bridge=http://<laptop-ip>:38888`
  on the `/remote` URL (persisted in `localStorage`). Default is `http://127.0.0.1:38888`.
- The pure command builder + response parser is `src/devices/wiz.ts` (unit-tested,
  no real UDP); the browser talks only to the bridge via `src/devices/wizClient.ts`.

### Music
An in-app `HTMLAudioElement` player on `/remote`: play/pause, next/prev, volume,
a small built-in public-domain playlist (streamed — needs internet) and an **Add
local tracks** picker that plays files from the phone fully offline. The player
state (title/playing/volume — never audio) is relayed to the `/control` room.
**Apple Music** is an honest stub: without a MusicKit *developer token* it shows
*"Apple Music needs a MusicKit developer token (not configured)"* and our own
player keeps working — no paid SDK, no faked connection. Pure reducer in
`src/music/player.ts`.

## Android app (thin Relay shell + phone assist)
A Capacitor wrapper around the same web bundle — inside the app, `src/boot.ts`
detects the native shell and boots straight into the `/remote` page (remote +
camera). Project lives in `android/` (`appId app.mendcraft.relay`); config in
`capacitor.config.ts`.

```bash
npm run build && npx cap sync android       # copy web assets into the shell
cd android && ./gradlew assembleDebug       # needs JDK 21 + Android SDK (free)
adb install app/build/outputs/apk/debug/app-debug.apk
```
Or open `android/` in Android Studio and press Run. No keystores,
`google-services.json` or other secrets are committed.

### Phone assist (AccessibilityService, opt-in)
After installing, enable **Mendcraft Assist** in *Android Settings →
Accessibility* (the in-app panel has an "Enable in Android Settings" shortcut).
It is **allowlisted to Instagram, Pinterest and WhatsApp (+ Business) only** —
the OS-level `packageNames` filter in
`android/app/src/main/res/xml/accessibility_service_config.xml` means it never
even receives events from other apps. It reads no passwords, notifications or
message content.

- **Scrolling** (Instagram/Pinterest): big ▲/▼ overlay buttons perform swipe
  gestures; an optional slow auto-scroll is **off by default**, clamped to a
  slow cadence, and pausable instantly.
- **WhatsApp replies never auto-send.** The app only *types a draft* (text you
  already confirmed in Mendcraft) into the compose field. Sending requires an
  explicit pinch or a tap on the big **✓ Send** overlay button *after the draft
  is visible* — one single click on WhatsApp's own send button. There is no
  timer path, no "send when compose fills", and **✕ Cancel** is always next to
  it. This is enforced by the unit-tested state machine in
  `src/assist/policy.ts` (mirrored by `assist/AssistPolicy.java`):
  `idle → staged → placed → confirm → sent`, where `confirm` is the only edge
  that sends.

## Judge path: `/?sim=1`
Open `http://localhost:5173/?sim=1`. It needs no camera or mic. A scripted demo (cup grip → select the sleeve → too-thin wall warning → fix → export) runs through the same command pipeline. A mouse-driven virtual hand cursor emulates the pinch. Sim outputs are labelled `SIM`.

## Pre-existing code and third-party libraries
All project code was written during the contest period, starting 12 Nov 2026 (the contest opened 11 Nov 2026). The only pre-existing code is the standard `create-vite` vanilla-ts starter (MIT), which was used for initial scaffolding and has since been replaced. Open-source libraries:

| Library | License | Use |
|---|---|---|
| firebase (Firebase JS SDK: `firebase/ai`, `firebase/app-check`) | Apache-2.0 | Hybrid inference, App Check |
| @mediapipe/tasks-vision (HandLandmarker model, Google AI Edge) | Apache-2.0 | Hand landmarks |
| three | MIT | 3D viewport |
| three-bvh-csg (+ three-mesh-bvh) | MIT | CSG booleans |
| vite, typescript, vitest | MIT / Apache-2.0 | Tooling |

No third-party logos or trademarks are included in the app or assets.

## License
Apache-2.0. See [LICENSE](LICENSE).
