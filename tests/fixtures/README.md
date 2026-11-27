# Model replies kept as fixtures

The only place a model reply may be written down. `src/` holds none
(`tests/noSeededContent.test.ts` checks that).

Two folders, one file per reply: `<engine>.<turnKind>[.<sub>][.<n>].json`

- `replies/` — what the whole-journey e2e (`npm run e2e`, section `journey`)
  replays. `npm run record` fills it from live Gemini and Nano runs of the
  journey (`scripts/journey.lib.mjs` holds the lines) and marks each file
  `source: "recorded"`; the canvas then labels those turns
  "Replay · recorded reply". A file that still says `hand-written` is a
  stop-gap, labelled "Replay · written example".
- `written/` — hand-written examples the per-section e2e checks are pinned
  to. Some carry a bad control on purpose (a volume slider on a lamp, 500 %,
  made-up rows) so a section can check it is dropped. Always `hand-written`;
  never replaced by a recording.

Naming:

- `engine`: `nano` or `gemini`
- `turnKind`: one of `TURN_KINDS` in `src/canvas/replayEngine.ts`
- `sub` (optional): the language of a pack turn (`gemini.pack.kn`)
- `n` (optional): the nth turn of that kind on that engine in one run; without
  it, the file answers every turn of that kind. (`written/gemini.board.speaker`
  and `.gimbal` are swapped in by their e2e sections, not looked up by name.)

Each file is:

```json
{
  "engine": "gemini",
  "model": "the model id that answered",
  "turnKind": "board",
  "recordedAt": "2026-11-27T10:00:00Z",
  "promptSha": "sha-256 of the prompt that was sent",
  "source": "recorded",
  "note": "where it came from",
  "reply": "the reply text as the model wrote it (redacted like a cloud prompt)"
}
```

`tests/fixtures/fixtureShape.test.ts` checks every file: the fields, that the
reply passes the check its kind passes in the app, and that it holds no key,
token, address or email. `MC_REQUIRE_RECORDED=1` also fails while any file in
`replies/` is still hand-written (`npm run record` runs it that way).

## Recording

```
npx vite                       # a dev server (or a VITE_E2E=1 build: ?record=1 is off in production)
npm run record                 # or E2E_URL=<test build url> npm run record
git diff tests/fixtures/replies/   # read it for anything personal
npm run e2e
```

It needs real Gemini (Firebase AI Logic; App Check must pass on that address —
a registered debug token in `.env.local` for the dev server, or a hosted test
build) and real Nano (Chrome with the model downloaded in `RECORD_PROFILE`,
default `~/.mendcraft-record-chrome`, or `CHROME_CDP` to drive a running
Chrome). The journey runs with `?sim=1`, so its devices are the SIM fixtures
and a reply can only name a fixture id.
