# Live probe: real Nano + real Gemini in Chrome

The unit tests drive the AI path with fake engines. This is the by-hand check
in a real Chrome, with **no `?sim=1`**. About ten minutes.

## Before you start

- Chrome with Gemini Nano downloaded: `chrome://on-device-internals` shows the
  model as ready, and in DevTools `await LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })` returns `"available"`.
- `.env.local` has the Firebase keys.
- A registered App Check debug token for local dev — see
  `docs/app-check-local-dev.md`. `npm run dev` must print
  `App Check: using the debug token from …`.
- **One canvas tab only.** Two tabs share the one on-device model.
- Open DevTools → Console before each step. Use `?fresh` to start clean:
  `http://127.0.0.1:5173/canvas.html?fresh`

## 1. Nano is fast and is one call

1. Load the page, wait ~5 s (Nano warms while idle).
2. In the console, count on-device prompts (sessions are `LanguageModel`
   instances, so the prototype sees every one — the Firebase AI Logic SDK
   calls it for each on-device request):

   ```js
   (() => { const p = LanguageModel.prototype.promptStreaming; let n = 0;
     LanguageModel.prototype.promptStreaming = function (...a) { n++; console.log('Nano prompt #' + n, new Date().toISOString()); return p.apply(this, a); };
   })();
   ```

3. Say or type **connect everything in this room**. Start a stopwatch.

Expect:

- First ghost tiles / the review in **under 15 s** (typically 3–8 s warm).
- Exactly **one** `Nano prompt #…` line for the turn (two only if the first
  reply was refused and repaired). Never one per tile, never 14.
- The pill / engine bar reads `Nano · 1 call`. There is one Nano cursor for
  the call plus one per tile as each tile appears — never more cursors than
  tiles, and no Gemini cursor.
- The page stays responsive while Nano works: the hand cursor / mouse hover
  keeps moving, and `await new Promise(r => setTimeout(r, 0))` in the console
  returns at once.
- The review title matches the plan under it (e.g. “Draft: 1 lamp and 1
  speaker found in this room” over exactly one lamp tile and one speaker
  tile). The Nano terminal’s “N tiles filled” equals the tiles listed.
- Route line: `Nano · on device — nothing left this device`; bytes sent `0 B`.

## 2. Gemini works on local dev

Approve the draft. Deep (Gemini) improves it.

Expect:

- No `AppCheck … 403` in the console.
- The Gemini terminal logs a reply; the review shows what was sent and its
  size. No tile claims “Connected · 0” or similar; the Connect button reads
  “Connect a device”.
- Nothing on screen says **SIM**.

## 3. Nano fails → Gemini takes over

Force an on-device failure, then ask for a board:

```js
LanguageModel.prototype.promptStreaming = () => { throw new Error('probe: forced failure'); };
```

Reload is **not** needed. Use a new board (`new board`), then **draw the floor plan**.

Expect:

- Nano terminal: `couldn’t finish: …` and a handoff line.
- The review is by Deep/Gemini and its route line reads
  `Gemini · cloud — Nano couldn’t finish (…), so Gemini made this · 1.2 KB sent`
  (the size will differ; it must not be 0 B). The Gemini terminal has a
  `sent 1.2 KB` line.
- No SIM label, no “prepared draft”.
- On “connect everything in this room”, after you approve this Gemini-made
  draft there is **no** second “Better” Gemini turn (one cloud send): the
  Gemini terminal says `Gemini made this draft, so there is no second pass.`
- After the page was idle for a while, also check the abort really stops
  Nano: with the hang override, once the handoff has happened, `chrome://on-device-internals`
  (or the GPU load) should show the model go quiet. The SDK cannot abort an
  on-device call, so the app destroys the session through the signal it gave
  to `create()`; if Nano keeps running after the handoff, note it.

To check the **timeout** instead of an error, make Nano hang:

```js
LanguageModel.prototype.promptStreaming = () => new ReadableStream({});
```

The handoff must start about **20 s** after you ask, with
`Nano couldn’t finish (took longer than 20 s)`.

Reload the page afterwards to restore the real `LanguageModel`.

## 4. Both fail → an honest error and Retry

1. Keep the forced Nano failure from step 3 (or re-apply it after a reload).
2. Block Gemini: DevTools → Network → **Offline** is *not* the right test (the
   app then knows it is offline). Instead block the request: Network → right
   click any request → *Block request domain* → add
   `firebasevertexai.googleapis.com` (or start `npm run dev` with an
   unregistered `APPCHECK_DEBUG_TOKEN` to get the real 403).
3. Ask for a board.

Expect:

- One status line with both reasons, e.g.
  `Nano couldn’t finish (probe: forced failure). Gemini blocked: App Check 403 (this address isn’t registered). Nothing was sent.`
  or `… Gemini couldn’t be reached: no connection. Nothing was sent.`
- The byte total does **not** go up for that turn.
- A **Retry** button. No review opens. No draft appears. Nothing says SIM.
- Unblock the domain, press Retry: the turn succeeds.

## 4b. A busy Nano is said out loud

Start a Nano board turn and, while it is working, speak a canvas command
that needs the intent model. If that job goes to Gemini because the one
on-device model is busy, both terminals show a handoff line
`Nano busy → Gemini (…)`.

## 5. Next-step chips don’t spend Nano on load

1. Reload with the prompt counter from step 1 installed early (paste it
   right after load).
2. Do nothing for 3 s: the rule chips (“Suggested”) are already on the board.

Expect:

- No `next steps timed out` warning in the console, on any load.
- No Nano prompt during a turn or while a review is open. After the board has
  sat still ~3 s with nothing else running, the chips may switch to
  “Nano · on device”.

## 6. Hosted preview (production build, reCAPTCHA)

Repeat steps 1–3 on the hosted preview URL, one tab only.

Expect the same results. If Gemini is blocked there, the line is
`Gemini blocked: App Check 403 …`: add the preview domain to the reCAPTCHA
Enterprise key’s allowed domains.

## What to write down

| Check | Target | Measured |
| --- | --- | --- |
| Nano “connect everything” → review | < 15 s | |
| Nano “draw the floor plan” → review | < 15 s | |
| Nano prompts per turn | 1 | |
| Pill during a Nano turn | `Nano · 1 call`, cursors ≤ tiles | |
| Nano really stops after a 20 s handoff | yes | |
| Bytes after a refused Gemini call | unchanged, “Nothing was sent.” | |
| Page responsive during Nano | yes | |
| Gemini on 127.0.0.1 | replies, no 403 | |
| Nano forced fail → Gemini | review says Gemini made it + bytes | |
| Nano hang → Gemini | handoff at ~20 s | |
| Both fail | reason + Retry, no SIM | |
| Console on load | no next-steps warning | |
