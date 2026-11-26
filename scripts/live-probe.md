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
- Open DevTools → Console before each step. Use `?fresh` to start clean, and
  add `nanoTrace=1` to have the page time Nano for you:
  `http://127.0.0.1:5173/canvas.html?fresh&nanoTrace=1`

## The trace (`?nanoTrace=1`)

With the flag, every on-device call is timed at `LanguageModel` itself (under
the Firebase SDK) and logged with a `[nano-trace]` prefix. Timings and sizes
only — never prompt or reply text:

```
[nano-trace] create #2: 2600 ms (initialPrompts 318 chars)
[nano-trace] on-device call: waited 0 ms for the model's queue
[nano-trace] prompt #2 (session #2): input 131 chars, constraint 196 chars — started
[nano-trace] prompt #2 (session #2): input 131 chars, constraint 196 chars — first chunk 900 ms, done in 3100 ms, output 62 chars
[nano-trace] on-device call: done in 5800 ms, output 62 chars
```

What to read off it:

- **Output length is the time.** Nano writes about 20 characters a second
  here. A room draft should be ~60 characters (`{"t":…,"d":[ids]}`), a floor
  plan ~18 (`{"p":"twoBedroom"}`). An output over ~120 characters means the
  schema is not being enforced.
- **Cold start.** The first on-device prompt after a page load is slow
  (about 14 s measured) because Chrome loads the model. The page pays that
  itself right after load: look for `warm-up: started`, then
  `warm-up: session created after … ms`, then
  `warm-up: done — the model is loaded` before you ask for anything. If you
  ask during the warm-up, one that already has its session finishes first
  (your turn's queue wait shows the remainder); one still creating its
  session steps aside, and is tried once more 10 s later when the model is
  idle. With the page open 20 s or more, the first request should never show
  a cold-start-sized prompt time.
- **Schema keywords.** Chrome rejects a constraint that uses `uniqueItems`
  (and, to be safe, `pattern`, `format`, `$ref`) with `NotSupportedError`.
  None are used; if the status ever reads `Nano couldn’t run this request`,
  Chrome refused the request itself — note the Chrome version.
- **Queue wait** should be 0 ms for a board turn. Anything else means another
  on-device call was in the way.
- **Does a stop really stop Nano?** When a turn times out or is handed off,
  the app aborts the signal it gave to `create()` and calls `destroy()` on
  the SDK's session. The trace then prints one of:

  ```
  [nano-trace] session #2: after destroy(), prompt #2 ended 40 ms later with 0 more chars (0 chunks) — generation stopped
  [nano-trace] session #2: create-signal abort did NOT stop prompt #2 — still generating 5 s later (112 more chars, 9 chunks since)
  ```

  Use the hang/slow case in step 3 to see it. "did NOT stop" means Nano keeps
  the model busy after a handoff, and the next on-device call will wait.

## 0. The lamps are the real ones

1. Start the bridge (`npm run wiz-bridge`) and open the canvas with its
   token: `…/canvas.html?fresh&nanoTrace=1&wizToken=<token>`.
2. Wait for the status line `Found 1 lamp on this network.`

Expect:

- Exactly as many lamp devices as there are bulbs: one bulb → one lamp called
  **Lamp** (two → “Lamp”, “Lamp 2”). No “Desk lamp” / “Ceiling light”.
- The lamp tile shows the bulb's real on/off and brightness, with no SIM
  mark, and switching it switches the bulb.
- “connect everything in this room” drafts a board with that one lamp and the
  speaker; its title counts one lamp. In the trace the reply names
  `wiz-lamp-1`, never `wiz-desk`.
- Stop the bridge and reload: the two seeded lamps are back, marked SIM.

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

- First ghost tile as soon as the first device id arrives, and the review in
  **under 7 s** warm (the reply is ~60 characters).
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
  or, with the domain blocked, `… Gemini couldn’t be reached: no connection.
  Nothing was sent.` (the request was never delivered, so its bytes are taken
  back). A 403 answered by the Gemini endpoint itself reads `Gemini refused
  the request (403)` and its bytes stay booked.
- With the App Check 403 the byte total does **not** go up for that turn.
- A **Retry** button. No review opens. No draft appears. Nothing says SIM.
- Unblock the domain, press Retry: the turn succeeds.

## 4b. A busy Nano is said out loud

Start a Nano board turn and, while it is working, speak a canvas command
that needs the intent model. If that job goes to Gemini because the one
on-device model is busy, both terminals show a handoff line
`Nano busy → Gemini (…)`.

## 5. Next-step chips don’t spend Nano on load

1. Reload with `?nanoTrace=1` (or the prompt counter from step 1).
2. Do nothing for 3 s: the rule chips (“Suggested”) are already on the board.
3. Run a board turn and watch the trace until 10 s after its review closes.

Expect:

- No `next steps timed out` warning in the console, on any load.
- No Nano prompt (no `create #` / `prompt #` line) other than the board's own
  during a turn, while its review is open, or for 10 s after the turn ended.
  After that, once the board has sat still with nothing else running, the
  chips may switch to “Nano · on device”.
- The model is only used when `LanguageModel.availability()` says
  `"available"`; while it is `"downloadable"` or `"downloading"` the Nano
  step is drafted by Gemini and its route line says so.

## 6. Hosted preview (production build, reCAPTCHA)

Repeat steps 1–3 on the hosted preview URL, one tab only.

Expect the same results. If Gemini is blocked there, the line is
`Gemini blocked: App Check 403 …`: add the preview domain to the reCAPTCHA
Enterprise key’s allowed domains.

## What to write down

| Check | Target | Measured |
| --- | --- | --- |
| Nano “connect everything” → review | < 7 s, output ≤ 120 chars | |
| Nano “draw the floor plan” → review | < 5 s, output ≤ 20 chars | |
| Trace: queue wait for a board turn | 0 ms | |
| Trace: after a stop | “generation stopped” | |
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
