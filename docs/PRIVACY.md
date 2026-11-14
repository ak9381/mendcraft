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

**The camera frames, hand landmarks, face mesh and raw voice audio never leave this device** — with exactly one, user-initiated, documented exception (point-and-say), and one peer path (phone↔laptop relay). Everything the cloud ever sees is abstract: the command text and the re-validated design ops.

## Known outbound kinds

Each kind below is declared in `src/core/outbound.ts`. "Leaves device" = bytes
can actually reach another machine.

| kind | leaves device | what is sent | what is NOT sent |
| --- | --- | --- | --- |
| **cloud-ai-model** | yes (cloud modes only) | command text + design ops; for point-and-say, one cropped still | camera/hand/face/voice streams |
| **cloud-inference** (`ONLY_IN_CLOUD`) | yes | big jobs: generate plan/ui, a11y-explain, TTS, escalated intent/deixis | raw sensor data |
| **prefer-on-device** (`PREFER_ON_DEVICE`) | sometimes | runs on Nano; on fallback sends the same abstract text. Every fallback is a ledger cloud call | sensor streams |
| **on-device-only** (`ONLY_ON_DEVICE`) | **no** | hand-adaptive profile pick runs with no `inCloudParams` — raw hand numbers can never leave, even if Nano is missing | everything |
| **lan-bridge** (`fetch`) | **no (LAN only)** | HTTP to `127.0.0.1` local WiZ bridge → UDP to the lamp | nothing reaches the internet |
| **firestore-relay** | yes (peer) | privacy-safe control snapshots, taught-recipe summaries, commands, and — only when a phone camera is paired — still frames | frames go to the paired device, never to Gemini |
| **remote-config** | yes | a one-way config pull (model ids, prompt-template ids, flags) | no user data |

### Point-and-say — the one image-to-cloud path

When the user says "make **this** bigger" while pointing, the app crops a small
still around the pointer and may send it to a cloud multimodal model
(`deixisCloud`, `ONLY_IN_CLOUD`) to resolve which object "this" is. This is the
**only** path where image data reaches Gemini. It is:

- user-initiated (a deictic command), not a background stream;
- a single cropped frame, not the live camera;
- preferred on-device first (Nano) and only escalated when needed;
- recorded in the ledger as a `deixis` cloud call.

The privacy-drift test asserts that the only file constructing an `inlineData`
model part is `src/ai/hybrid.ts` — so no second image-to-cloud path can appear
unnoticed.

### Phone↔laptop relay — a peer path, not the cloud AI

Pairing a phone to the laptop uses a Firestore relay room. It can carry still
frames **between the two paired devices** (so the phone camera can drive the
laptop). Those frames go to Firestore for the paired device to read — they are
**never** sent to a Gemini model. This is a deliberate, user-initiated pairing
feature; see `docs/RISKS.md` for the residual risk and mitigation.

## Backstops

- **Redaction backstop** (`redact()` in `ledger.ts`): if a base64 media blob or a
  long landmark vector *ever* slips into a cloud payload through a future bug, it
  is replaced with a visible `[media removed]` / `[landmarks removed]` tag and
  counted, so a regression surfaces in the ledger instead of leaking silently.
- **Honest badge**: ON-DEVICE / CLOUD / RULES / SIM, always with the router's
  reason. A `PREFER_ON_DEVICE` call that fell back to the cloud shows CLOUD.
- **Confirm before apply/send**: any unsure or destructive change needs an
  explicit pinch/tap; nothing auto-sends.
