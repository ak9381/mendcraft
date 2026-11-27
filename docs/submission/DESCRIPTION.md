# Mendcraft

**Platform:** Web/Chrome (with iOS/Android companion apps)

## Inspiration

My mother has arthritis and speaks Kannada. Small switches hurt her hands, most
apps are English-only, and most smart-home apps send camera, voice and data to
the cloud. We wanted something she could run with her voice and an open hand,
in her language, with the private parts kept on her laptop.

## What it does

Mendcraft is one canvas in Chrome. She says what she needs, and the models
build it:

- "build the dashboard" and "show my devices": boards for her lamp and devices
- "draw the floor plan", then "add a study next to bedroom 2"
- "connect the lamp": Gemini writes the lamp's protocol, as data
- "add Kannada": a language pack for the bar, reviews and spoken commands

Each result is a proposal on one review card; nothing changes until she
presses Approve. Approved results are stored on the device as data, apart from
the code, and re-checked on every load.

**Accessibility:** palm to point, fist to click, hover to click, voice or
typing, read aloud, her language, an owner lock so only her registered hands
control it, and a pause when she looks away.

**Privacy:** hand and face tracking run in the browser. Device IDs and
addresses stay on the laptop. A counter shows every byte sent to Gemini.
Offline, her approved boards stay and Nano still drafts.

## How we built it

Every model call on the canvas goes through the Firebase AI Logic web SDK:
`getAI` with `GoogleAIBackend` and limited-use App Check tokens (reCAPTCHA
Enterprise). Each feature has its own inference mode:

- **`ONLY_ON_DEVICE`** (Gemini Nano in Chrome) for anything that carries her
  raw words: board drafts, floor-plan edits and chat. It has no silent cloud
  fallback. If Nano can't answer, the canvas hands off to Gemini with a
  redacted prompt and says so.
- **`ONLY_IN_CLOUD`** for heavier jobs: improving Nano's board draft, floor
  plans, lamp connectors and language packs. Prompts are redacted first.
  Device names are sent, and the review card says so. A backup model starts if
  the first one is slow.
- **`PREFER_ON_DEVICE`** for pointing at a device: Nano names a cropped camera
  frame; Gemini does it if Nano is not ready, and those bytes are counted.

The handoff is visible: an engine bar shows Nano ("on this device") ▶ Gemini
("cloud") and "N B sent to cloud", and each review has a receipt such as "Drafted by Nano on this device · 0 B; improved by Gemini ·
2.1 KB". Remote Config sets the cloud model name.

The code is scaffolding: canvas, review card, fixed checkers and device
transports. A local bridge reaches the WiZ lamp (browsers cannot send UDP).
Phones pair with a sound chime and receive boards; the iPhone nods a DockKit
stand when she approves.

## Challenges

- Chrome gives the page one Nano model, and a new call replaces the last
  session, so every on-device call goes through one queue.
- A fallback is easy to hide, so we made every step show which engine ran it
  and where.
- Model output is checked against fixed schemas and allow-lists. "Set the lamp
  to 500 percent" is refused by a fixed rule, not a model.

## Accomplishments

- One request, one review: a Nano draft improved by Gemini, with a byte count.
- Gemini writes the lamp's protocol once. After she approves it, the lamp runs
  on it without asking Gemini again.
- An end-to-end test runs the whole journey in Chrome, including an offline
  reload and a tampered stored artifact.

## What we learned

Hybrid is chosen per feature. Our strongest reasons to stay on the device were
the camera and her raw words, more than speed. Clear refusals ("Nothing
changed.") matter as much as good answers.

## What's next

- Daily use with my mother, including Kannada voice input.
- Offline reload on the live site; AI on the phones; the iPhone's on-device
  path on Firebase AI Logic.

## Built during the submission period

Started on 12 Nov 2026 from the Vite starter template. Everything else was
built during the submission period. No public users yet.

**Disclosure:** in the iOS app, the on-device step can call Apple Foundation
Models directly, not through Firebase AI Logic. That path is untested, and the
web app and the demo do not use it. Voice input uses Chrome's speech
recognition, which needs the network.
