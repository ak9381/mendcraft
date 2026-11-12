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
