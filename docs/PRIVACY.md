# What leaves this device (privacy ledger)

Mendcraft is built for someone with limited hand use who designs by pinch + voice.
The camera, microphone, hand landmarks and face mesh are the *input* — they are the
most sensitive thing in the app, and the whole design keeps them on the machine.

This file is the human-readable twin of two machine-checked things:

- **`src/core/ledger.ts`** — the runtime "What left this device" ledger behind the
  honest AI-source badge. Every cloud round trip is recorded with the abstract
  payload, its byte size, and why it was routed out.
- **`src/core/outbound.ts`** — the static registry of every outbound *kind*.
  `tests/privacyDrift.test.ts` fails the build if a new network/cloud call appears
  in a file that is not registered, if the ledger emits an unknown cloud job, or
  if this document stops mentioning a declared kind.

So the three stories — the badge, the code, and this doc — cannot drift apart
silently.

## The one-line claim

**The camera frames, hand landmarks, face mesh and raw voice audio never leave this device** — with two user-initiated, documented exceptions (point-and-say, and add-a-device when Nano can't run), and one peer path (phone↔laptop relay). Everything the cloud ever sees is abstract: the command text and the re-validated design ops.

## Known outbound kinds

Each kind below is declared in `src/core/outbound.ts`. "Leaves device" = bytes
can actually reach another machine.

| kind | leaves device | what is sent | what is NOT sent |
| --- | --- | --- | --- |
| **cloud-ai-model** | yes (cloud modes only) | command text + design ops; for point-and-say, one cropped still | camera/hand/face/voice streams |
| **cloud-inference** (`ONLY_IN_CLOUD`) | yes | big jobs: generate plan/ui, a11y-explain, escalated intent/deixis; any-language fallbacks: `lang-detect` and non-English translate + intent | raw sensor data, voice audio |
| **prefer-on-device** (`PREFER_ON_DEVICE`) | sometimes | runs on Nano; on fallback sends the same abstract text. Every fallback is a ledger cloud call | sensor streams |
| **on-device-only** (`ONLY_ON_DEVICE`) | **no** | hand-adaptive profile pick runs with no `inCloudParams` — raw hand numbers can never leave, even if Nano is missing | everything |
| **lan-bridge** (`fetch`) | **no (LAN only)** | HTTP to `127.0.0.1` local WiZ bridge → UDP to the lamp; add-a-device connector calls to a private LAN IP only | nothing reaches the internet |
| **firestore-relay** | yes (peer) | privacy-safe control snapshots, taught-recipe summaries, commands, and — only when a phone camera is paired — still frames | frames go to the paired device, never to Gemini |
| **remote-config** | yes | a one-way config pull (model ids, prompt-template ids, flags) | no user data |
| **spotify** | yes | playback commands and search text to Spotify's API; optional Web Playback SDK | camera, hand, face, voice audio, access tokens (tokens stay in this browser) |
| **network-fetch** | sometimes | the declared `fetch()` allowlist (LAN lamp bridge + Spotify + Openverse / Wikimedia) | anything not registered here |
| **chrome-extension** | **no** | typed messages to the Mendcraft Chrome extension in this browser (copy text/link, paste after confirm, switch or open a tab, send a clip to the canvas) | camera, hand, face, voice audio; password and payment fields; nothing leaves this computer |
| **openverse** | yes | the picture-search text to `api.openverse.org` | camera, hand, face, voice audio |
| **wikimedia** | yes | the picture-search text to `commons.wikimedia.org` | camera, hand, face, voice audio |

### Point-and-say — the one image-to-cloud path

When the user says "make **this** bigger" while pointing, the app crops a small
still around the pointer and may send it to a cloud multimodal model
(`deixisCloud`, `ONLY_IN_CLOUD`) to resolve which object "this" is. Together with
add-a-device (below) these are the **only** paths where image data can reach Gemini. It is:

- user-initiated (a deictic command), not a background stream;
- a single cropped frame, not the live camera;
- preferred on-device first (Nano) and only escalated when needed;
- recorded in the ledger as a `deixis` cloud call.

The privacy-drift test asserts that the only file constructing an `inlineData`
model part is `src/ai/hybrid.ts` — so no second image-to-cloud path can appear
unnoticed.

### Add a device — the second image path (only if Nano can't run)

"Add a device" names the device from ONE still (and later compares a BEFORE and
an AFTER still) with `PREFER_ON_DEVICE` models (`deviceSee`, `effectCheck`).
On Chrome with multimodal Nano those stills never leave the laptop. Only if
Nano is unavailable or fails do they go to the cloud twin (`deviceSeeCloud`,
`effectCheckCloud`). It is user-initiated (she says "add device", presses +,
or uses her bound gesture), at most three stills per run, never stored, and
every cloud call is a ledger row (`add device · identify` / `· verify`).
Voice-only mode ("add the lamp") sends no image at all. The connector writer
(`ONLY_IN_CLOUD`) receives only the device kind and brand as text.

### Speak any language — text only, never audio

Mendcraft is polished in English. Speak any language. For a non-English
command, only the **recognised text** can leave, never the voice audio (speech
recognition gives us text; the audio is never handed to Gemini):

- **Language detection** runs on the device first: Chrome's built-in Language
  Detector (a small Chrome model, labelled "Chrome AI · on device"), then a
  Unicode script check and an English word check. Only in Auto mode, only for
  ambiguous Latin-script text, and only when Chrome's detector is missing, the
  transcript is sent to Gemini in the cloud to name the language. Each such call
  is a ledger row with job `lang-detect` (`lang-detect (simulated)` in SIM).
- **Turning it into a command**: Gemini Nano first when Chrome says Nano can run
  that language (today English, Spanish, Japanese); otherwise one cloud call
  translates + returns the English op (ledger job `intent`, with the router's
  reason, e.g. "Hindi: Nano can't run Hindi here → cloud").
- **Spoken replies** use the browser's own `speechSynthesis` — in her language
  when a voice exists, otherwise English. No reply audio is generated in the
  cloud by default (the `tts` job stays declared for the optional cloud voice).

### Phone↔laptop relay — a peer path, not the cloud AI

Pairing a phone to the laptop uses a Firestore relay room. It can carry still
frames **between the two paired devices** (so the phone camera can drive the
laptop). Those frames go to Firestore for the paired device to read — they are
**never** sent to a Gemini model. This is a deliberate, user-initiated pairing
feature; see `docs/RISKS.md` for the residual risk and mitigation.

### Spotify — user-initiated music, never sensors

When she connects Spotify (Premium) and plays, pauses, skips or asks for a
track ("play some old Kannada songs"), Mendcraft talks to Spotify's Web API
(`accounts.spotify.com` / `api.spotify.com`). Only the command and the search
text leave; the camera, hand landmarks, face mesh and raw voice audio never
do. Access tokens stay in this browser's `localStorage` and are stripped from
the ledger (`job: spotify`). If she is not connected, the built-in
public-domain player stays on this device and nothing is sent to Spotify.
Inside the iOS (or Android) Capacitor shell, sign-in is opened on the web app
at https://mendcraft.web.app because the `/spotify` redirect cannot return to
the app yet.

### Chrome extension — same computer, never the cloud

The optional Mendcraft Chrome extension lets her copy from and paste into any
Chrome tab with voice or a pinch. Mendcraft talks to it with
`chrome.runtime.sendMessage` (and a same-page `postMessage` relay) on
mendcraft.web.app / mendcraft.firebaseapp.com / localhost:5173 only. Messages
stay in this Chrome profile: the selected or main text of a page, a tab URL, or
the last copied clip. The camera, hand landmarks, face mesh and raw voice audio
never go to the extension, and nothing the extension reads is sent to a server.

Paste always waits for a pinch-to-confirm card in Mendcraft. Password and
payment fields are skipped. Forms are never auto-submitted. Every one of these
actions is declared as the `chrome-extension` outbound kind (leaves device: no).

The reference panel also uses the extension, when it is connected, to open a
site that refuses to be framed (LinkedIn, Google, Spotify, Instagram, Facebook,
X, WhatsApp, GitHub login) in a real Chrome tab, instead of sitting on
"Loading…". Hands-free reference search uses that same extension to open a
real Google Images or Pinterest tab, overlay numbered badges, and bring a
picked picture back to the canvas. The extension never types into any field,
including password or payment fields.

### Picture references — the real web, Openverse fallback, and Gemini drawings

When she says "find me references for drawings" (or "show me pictures of …")
and picks **Search the web**, Mendcraft asks the Chrome extension to open a
real Google Images or Pinterest tab. If the extension is not connected, it
falls back to the Openverse API (`api.openverse.org`) and the Wikimedia
Commons API (`commons.wikimedia.org`) and says so on the canvas. Only the
**search text** leaves the device; the camera, hand landmarks, face mesh and
raw voice audio never do. Results appear as numbered cards, each with its
source and licence.

When she picks **Generate with Gemini** (or says "draw me a reference of …" /
asks for landing-page inspirations or mockups), a cloud **text** Gemini model
returns 3–4 SVG sketches or layout frames, shown as numbered cards labeled
**Gemini · cloud**. That call is a ledger row with job `ref-generate`. Only
the request text is sent — never sensors, photos, or an image-generating
model. Image generation on Firebase AI Logic needs the paid Blaze plan;
billing is not enabled.

A fuzzy or non-English web-search request may be turned into a short English
search query by Gemini Nano on the device, or by Gemini in the cloud when
Nano cannot run that language. That call is a ledger row with job
`references`. Only the request text is sent, never sensors or the images
themselves.

## Backstops

- **Redaction backstop** (`redact()` in `ledger.ts`): if a base64 media blob or a
  long landmark vector *ever* slips into a cloud payload through a future bug, it
  is replaced with a visible `[media removed]` / `[landmarks removed]` tag and
  counted, so a regression surfaces in the ledger instead of leaking silently.
- **Honest badge**: ON-DEVICE / CLOUD / RULES / SIM, always with the router's
  reason. A `PREFER_ON_DEVICE` call that fell back to the cloud shows CLOUD.
- **Confirm before apply/send**: any unsure or destructive change needs an
  explicit pinch/tap; nothing auto-sends.
