# Risks & mitigations

Short, honest list of the ways Mendcraft can hurt, mislead, or exclude its user
(the builder's mom: arthritis, limited hand use, speaks Kannada), and what in the
code pushes back on each. Kept next to `docs/PRIVACY.md` and the run log in
`docs/LESSONS.md`.

## 1. Privacy — sensor data leaking to the cloud

- **Risk:** camera frames, hand landmarks, face mesh or raw voice audio reaching
  a cloud model; a new outbound path added without anyone noticing.
- **Mitigation:** only abstract text + design ops leave the device. Single
  documented image path (point-and-say). `redact()` backstop scrubs media /
  landmark vectors. `src/core/outbound.ts` + `tests/privacyDrift.test.ts` fail the
  build on any undeclared `fetch`/Firestore write/cloud model/image-to-cloud site.
- **Residual:** the phone↔laptop relay can carry stills **between paired
  devices** via Firestore (never to Gemini). It is user-initiated pairing; the
  room id is the shared secret. Mitigation: pairing is explicit, snapshots are
  privacy-coerced, and frames are only sent while a phone is actively paired.

## 2. Misfire / unsafe or destructive action

- **Risk:** a mis-heard command deletes work, sends a message, or applies a wrong
  edit; the model hallucinates free geometry.
- **Mitigation:** the model never emits geometry — every AI output is re-validated
  in code before it touches the scene. Confidence gating (`src/ai/confidence.ts`)
  splits sure / unsure / unknown; unsure → "Did you mean" chips; destructive ops
  need an explicit pinch/tap confirm; nothing auto-sends (WhatsApp drafts are
  never auto-sent). Every edit goes through the undo/redo op log.

## 3. Kannada (non-English) accuracy

- **Risk:** the deterministic rules parser is English-only, so a Kannada command
  silently does nothing or is mis-parsed; cloud mistranslation applies the wrong op.
- **Mitigation:** non-English utterances are detected and handled by a single
  cloud translate+op call (`src/ai/language.ts`), with an honest "Cloud · Kannada"
  badge and a localized confirmation from a fixed phrase table (never free TTS).
  Unsure results still go through confirm chips in her language.
- **Measured:** see `docs/ACCURACY.md`. Rules-only Kannada accuracy is ~0 by
  design (it is a cloud path); the eval instead measures that Kannada is correctly
  **routed** off the rules path. The Nano/cloud accuracy must be measured in Chrome.

## 4. Nano (on-device model) availability

- **Risk:** Gemini Nano is Chrome-only and may be absent / not-yet-downloaded, so
  the "on-device" promise can't be kept, or the app stalls waiting for it.
- **Mitigation:** three-tier fallback — rules → Nano (`PREFER_ON_DEVICE`) → cloud.
  Rules always work offline with zero network. The badge is honest about which
  tier actually answered. Hand-adaptive uses `ONLY_ON_DEVICE` so it degrades to
  "not ready" rather than silently uploading numbers.

## 5. Offline

- **Risk:** no network means cloud jobs (generate, a11y-explain, escalation) fail
  mid-task and lose the user's intent.
- **Mitigation:** an IndexedDB cloud-job queue (`src/offline/*`) defers big jobs
  when offline and drains them on reconnect as Apply/Reject previews; an
  online/offline indicator is shown. The rules path keeps working offline.

## 6. Accessibility

- **Risk:** the app itself is unusable for its target user — poor contrast, tiny
  targets, no screen-reader labels, keyboard traps.
- **Mitigation:** deterministic a11y checks run on generated designs
  (`src/core/a11y.ts`, before routing); the UI ships ARIA labels and large pinch
  targets. `npm run a11y:axe` runs axe-core over every main screen in headless
  Chromium and reports serious/critical violations (see the run log). Not in the
  default test suite — it needs a browser + a built preview.

## 7. Honest-AI-source drift

- **Risk:** the badge/ledger claims on-device while a call actually went to the
  cloud, or a new cloud call never shows up in the ledger.
- **Mitigation:** `CLOUD_LEDGER_JOBS` in `src/core/outbound.ts` + the privacy-drift
  test assert every cloud ledger job is declared, and every outbound primitive
  lives in a registered file. A `PREFER_ON_DEVICE` fallback records a cloud event.
