# Mendcraft

**A canvas for running your room with your voice and your hands, in your own
language, with the private parts kept on your laptop.**

Mendcraft is for people for whom small buttons and touch screens are hard. We
built it first for the developer's mother, who has arthritis and speaks Kannada. You open
one canvas in Chrome and say what you need: "build the dashboard", "draw the
floor plan", "add Kannada". Gemini Nano works on the laptop through Firebase AI
Logic, and Gemini in the cloud does the heavier work. Every board, lamp
connector, floor plan and language pack comes back as a proposal you review.
Nothing changes until you press Approve, and a counter shows every byte sent to
Gemini.

**Live demo:** https://mendcraft.web.app (desktop Chrome; see
[docs/submission/TESTING.md](docs/submission/TESTING.md)). Built for Google
**#BuildHybridAI**.

---

## How it works on `main`

The code is scaffolding only: the canvas, a review card, fixed checkers and the
device transports. The content is made by the models:

| What she asks for | Who makes it | What the code does with it |
| --- | --- | --- |
| "build the dashboard" (a board for the room) | Nano drafts on the laptop, then Gemini improves the draft | Checked against the board schema, shown in review |
| "show my devices" | Gemini lays out the board (Nano offline) | The table rows come from what each device reports, never from the reply |
| "draw the floor plan" | Gemini writes the plan as a document | Code draws it as checked geometry; accessibility check, 3D and DXF export run locally |
| "add a study next to bedroom 2" | Nano decides the edit on the laptop (Gemini only if Nano can't and you are online) | Code applies it to a copy; you review the change |
| "connect the lamp" | Gemini writes the lamp's protocol as data | Fixed rules check every port and action; a fixed interpreter runs it |
| "add Kannada" | Gemini writes the language pack | Only known keys, the language's own script, no markup |

Each approved result is an **artifact**: data stored on the device, apart from
the code, in IndexedDB
([src/artifacts/store.ts](src/artifacts/store.ts)). Every artifact is checked
when it is written and **checked again every time it loads**, because storage
can be edited; nothing in an artifact is ever run
([src/artifacts/artifact.ts](src/artifacts/artifact.ts)). Say "show artifacts"
to list them with who made each one ("Gemini · cloud", "Gemini Nano · on
device", "You"), and to remove, export or import them.

---

## How we use Firebase AI Logic

All model calls on the canvas go through the Firebase AI Logic web SDK
(`firebase/ai`). The one exception is the iPhone app's Apple model path, which
is described under [Honest limits](#honest-limits).

**Setup**

- `getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true })`.
  Each request carries a fresh limited-use App Check token
  ([src/ai/hybrid.ts#L1297](src/ai/hybrid.ts#L1297)).
- App Check with reCAPTCHA Enterprise starts before any model is built. If it
  fails, no model is used
  ([src/firebase/appCheck.ts#L121-L125](src/firebase/appCheck.ts#L121-L125),
  [src/ai/hybrid.ts#L1272-L1279](src/ai/hybrid.ts#L1272-L1279)).
- Remote Config supplies the cloud model name (default `gemini-3.5-flash-lite`)
  before the models are built. If the primary has no valid answer after 2 s, a
  backup call to `gemini-3.1-flash-lite` starts and the first valid answer wins ([src/firebase/remoteConfig.ts](src/firebase/remoteConfig.ts),
  [src/ai/hedge.ts](src/ai/hedge.ts)).

**Inference mode per feature (the models the canvas calls)**

| Model | Mode | Used for | Why this mode |
| --- | --- | --- | --- |
| Per-turn on-device model ([hybrid.ts#L1312-L1315](src/ai/hybrid.ts#L1312-L1315), called by `streamOnDevice` [#L746](src/ai/hybrid.ts#L746), wired in [canvasMain.ts#L134-L146](src/canvas/canvasMain.ts#L134-L146)) | `ONLY_ON_DEVICE` | Board drafts, plan edits, chat replies, the devices board offline | Her raw words go to Nano unredacted. `ONLY_ON_DEVICE` has no silent cloud path. If Nano fails, the canvas hands off to Gemini with the redacted prompt and says so on screen. |
| Canvas cloud model ([hybrid.ts#L1560-L1563](src/ai/hybrid.ts#L1560-L1563)) and its backup ([#L1564-L1569](src/ai/hybrid.ts#L1564-L1569)), called by `runCanvasCloud` ([#L591](src/ai/hybrid.ts#L591)) | `ONLY_IN_CLOUD` | Improving the board draft, floor plans, connectors, language packs, handoffs | Bigger jobs that Nano does not do well (Nano is set up for English text). The prompt is redacted first and its bytes are counted on the real request ([hybrid.ts#L601-L606](src/ai/hybrid.ts#L601-L606)). |
| Device identify ([hybrid.ts#L1494-L1498](src/ai/hybrid.ts#L1494-L1498)) with a cloud twin ([#L1499-L1502](src/ai/hybrid.ts#L1499-L1502)), called by `identifyDevice` ([#L2597](src/ai/hybrid.ts#L2597)) | `PREFER_ON_DEVICE` | Point at a device: a cropped camera frame is named | Nano first with image input, Gemini if Nano is not ready. This is the one canvas feature where a photo crop can leave the laptop, and the canvas counts it ([hybrid.ts#L2562-L2591](src/ai/hybrid.ts#L2562-L2591)). |

How the canvas picks an engine for each step, and labels the step honestly when
Nano is not there, is in [src/canvas/engines.ts](src/canvas/engines.ts).

The same `initFirebase` function
([hybrid.ts#L1267](src/ai/hybrid.ts#L1267)) also builds older models: intent,
verify, fusion, template, copilot, hand profile, condense, TTS and others (for
example `intent` at [#L1327](src/ai/hybrid.ts#L1327) and `handAdapt` at
[#L1437](src/ai/hybrid.ts#L1437)). They belong to the **legacy studio**
(`?flags=studio`), and the canvas does not call them.

---

## Privacy

- **Redaction before the cloud.** Device IDs become "Device N" placeholders and
  addresses are never sent. Device **names** are sent, and the review card says
  so ("sent your words and device names…"). People's names (next to words like
  "mom" or in "Meera's room"), phone numbers and emails are swapped for tokens
  by fixed rules, not a model
  ([src/canvas/aiTurn.ts#L121-L164](src/canvas/aiTurn.ts#L121-L164),
  [src/ai/redact.ts](src/ai/redact.ts)).
- **Bytes ledger.** The engine bar shows "N B sent to cloud": every byte sent to
  Gemini, counted on the real request. Each review card shows its own receipt,
  for example "Drafted by Nano on this device · 0 B; improved by Gemini · 2.1 KB"
  ([src/canvas/engineBar.ts](src/canvas/engineBar.ts),
  [src/canvas/reviewDialog.ts#L124-L132](src/canvas/reviewDialog.ts#L124-L132)).
  It does not count Chrome's speech recognition, Spotify, the phone link or
  model downloads.
- **Hand and face tracking on the device.** MediaPipe landmarks are computed in
  the browser and never uploaded. The wasm and model files are downloaded from
  a CDN ([src/input/hands.ts](src/input/hands.ts),
  [src/input/presence.ts](src/input/presence.ts)). Register keeps a face
  signature and hand proportions in sessionStorage only
  ([src/canvas/scanRegistration.ts](src/canvas/scanRegistration.ts)).
- **Offline.** Approved boards, plans and packs load from the device. Offline,
  Nano still drafts, the Gemini card says "Offline", and anything that needs
  Gemini says so and changes nothing.

## Accessibility

- **Hands instead of small buttons.** "Palm to point · fist to click · hold a
  fist to move." A fist is easier than a fingertip pinch.
- **Hover to click** (More → Hands): rest the palm on a button to press it.
- **Owner lock.** Register (face, then left hand, then right hand) so only the
  owner's hands control the canvas.
- **Look-away pause.** When she is not facing the screen, a "Not facing" pill
  shows and the hands stop acting ([src/ui/facingBanner.ts](src/ui/facingBanner.ts)).
- **Voice or typing.** Speak through Chrome's speech recognition, or type in
  "Type or say a command…".
- **Read aloud.** Replies, review titles and refusals are spoken with the
  browser's on-device voices ([src/ai/speaker.ts](src/ai/speaker.ts)).
- **Her language.** A Gemini-written pack translates the bar and the review
  words, and adds spoken phrases for the lamp and canvas commands
  ([src/canvas/languagePack.ts](src/canvas/languagePack.ts)).
- **Teach a gesture.** Record a few samples, say what the gesture should do,
  and approve it.
- **Fixed limits.** "Set the lamp to 500 percent" gets "Lamps go from 10 to
  100 %. Nothing changed." The check is a fixed rule, not a model
  ([src/canvas/deviceGuard.ts](src/canvas/deviceGuard.ts)).

## Devices

- **WiZ lamp** through a local bridge, `scripts/wiz-bridge.mjs`. Browsers cannot
  send UDP, so this small Node process talks to the bulb and listens only on
  127.0.0.1 by default with a per-run token. "Connect the lamp" asks Gemini to
  write the connector. The canvas starts with no lamps: the lamps it shows are
  the bulbs the bridge finds ([src/canvas/realLamps.ts](src/canvas/realLamps.ts)).
- **Spotify** (Premium) for the speaker tile. When Spotify is not connected,
  nothing plays and the tile says so ([src/canvas/spotifyConnector.ts](src/canvas/spotifyConnector.ts)).
- **Phones as companions** (Capacitor apps in `android/` and `ios/`, Swift in
  `ios-src/`). A phone joins the laptop with a short sound chime or a typed
  code. You can hold a board at the edge of the screen to send it to the phone
  ("Moved from laptop"). The phone's AI activity shows in the laptop's AI
  monitor.
- **DockKit gimbal** (iPhone): the stand nods when you approve something, and
  can follow your hands
  ([ios-src/MendcraftGimbalPlugin.swift](ios-src/MendcraftGimbalPlugin.swift)).

---

## Setup and run

```bash
npm install
cp .env.example .env.local   # your Firebase web config + reCAPTCHA Enterprise site key; never commit it
npm run dev                  # http://localhost:5173/canvas.html
npm run build                # tsc + vite build (needs a real Firebase API key and site key)
npm run wiz-bridge           # optional: a real WiZ bulb on your network; prints a token
```

- **Firebase project:** turn on Firebase AI Logic (Gemini Developer API) and App
  Check with reCAPTCHA Enterprise. The console steps are in
  [docs/CONSOLE-STEPS.md](docs/CONSOLE-STEPS.md).
- **Local App Check:** put `APPCHECK_DEBUG_TOKEN=<uuid>` in `.env.local` and
  register that token in Firebase console → App Check → Manage debug tokens. The
  dev server injects it into local pages only; it is never written into `dist`.
- **Without Firebase config** the canvas opens, but neither Nano nor Gemini
  runs, and it says so.
- **WiZ:** open the canvas once with `?wizToken=<printed token>`. The token is
  stored and then removed from the address bar.
- **Spotify:** set `VITE_SPOTIFY_CLIENT_ID` (a public client ID; sign-in uses
  PKCE).

## Tests

```bash
npm test             # vitest unit suite (tests/**/*.test.ts)
npx vite             # then, in a second terminal:
npm run e2e          # scripts/e2e-actual.mjs: the whole demo journey in Chrome from recorded replies and SIM devices
npm run eval:commands
npm run a11y:axe
```

`npm run e2e` replays model replies from `tests/fixtures/`. The page does not
script them. The test checks every review, the lamp refusal, an offline reload
that stays in Kannada, a tampered stored artifact, and export/import.

---

## Honest limits

- **Nano needs desktop Chrome with on-device AI enabled.** Without it, the
  "Nano" step is done by Gemini and the route line says so ("Nano isn't
  available here").
- **Voice needs the network.** Chrome's speech recognition does not work
  offline. Offline, type the command.
- **Offline reload.** Approved artifacts live in IndexedDB, but the page itself
  and the MediaPipe files come from the network or the browser cache. We test
  the offline reload against a local server (`npm run e2e`). On the live site,
  load the page while online first.
- **iPhone on-device AI is not Firebase AI Logic, and it is untested.** In the
  iOS shell, the "Nano" step can call Apple Foundation Models directly through
  our Capacitor plugin
  ([src/ai/appleAI.ts](src/ai/appleAI.ts),
  [ios-src/MendcraftAppleAIPlugin.swift](ios-src/MendcraftAppleAIPlugin.swift)).
  The note in `appleAI.ts` explains why: the Firebase iOS hybrid API it was
  written against was removed, so it calls Apple's framework directly. We have
  not run this path on a device. The web app and the demo do not use it.
- **Phones are companions.** `npm run e2e` covers pairing and sending a board
  to SIM phones. We have not tested AI requests made on the phones themselves,
  and no automated test covers the real gimbal.
- **Real devices.** The lamp needs a WiZ bulb and the local bridge. The speaker
  needs Spotify Premium. Without them those tiles say what is missing; they do
  not fake a connection.
- **Kannada:** the pack translates the bar, the review words and a set of
  command phrases. Model prompts and replies stay in English.

## Built during the submission period

Started on 12 Nov 2026 from the Vite vanilla-ts starter. Everything else was
written during the submission period. Mendcraft has no public users yet.

## Pre-existing code and libraries

The only pre-existing code is the `create-vite` vanilla-ts starter (MIT), which
has since been replaced.

| Library | License | Use |
| --- | --- | --- |
| firebase (`firebase/ai`, `firebase/app-check`, Remote Config, Performance, Firestore) | Apache-2.0 | Hybrid inference, App Check, config, tracing, phone link |
| @a2ui/lit, @a2ui/web_core | Apache-2.0 | Rendering boards |
| lit | BSD-3-Clause | Web components |
| @mediapipe/tasks-vision | Apache-2.0 | Hand and face landmarks (on device) |
| three, three-bvh-csg | MIT | 3D floor-plan view |
| zod | MIT | Schema checks |
| qrcode | MIT | Pairing codes |
| @capacitor/* | MIT | Android and iOS shells |
| vite, vitest, happy-dom | MIT | Build and tests |
| typescript, puppeteer-core, fake-indexeddb | Apache-2.0 | Type-check, e2e, tests |
| axe-core | MPL-2.0 | Accessibility audit (dev only) |

No third-party logos or trademarks are included.

## License

Apache-2.0. See [LICENSE](LICENSE).
