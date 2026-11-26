# Recorded model replies

The only place a model reply may be written down. `src/` holds none
(`tests/noSeededContent.test.ts` checks that).

One file per reply: `<engine>.<turnKind>[.<n>].json`

- `engine`: `nano` or `gemini`
- `turnKind`: one of `TURN_KINDS` in `src/canvas/replayEngine.ts`
  (`board`, `boardBetter`, `devices`, `plan`, `planEdit`, `pack`, `connector`,
  `steps`, `morph`, `selfCheck`, `break`, `identify`, `ask`)
- `n` (optional): the nth turn of that kind on that engine in one run; without
  it, the file answers every turn of that kind

Each file is:

```json
{
  "engine": "gemini",
  "model": "the model id that answered",
  "turnKind": "board",
  "recordedAt": "2026-11-27T10:00:00Z",
  "promptSha": "sha-256 of the prompt that was sent",
  "source": "recorded",
  "reply": "the reply text exactly as the model wrote it"
}
```

`source` is `recorded` (captured from a live run) or `hand-written` (a
stop-gap only, and it must say so).

`scripts/e2e-actual.mjs` reads every `.json` file here into
`window.__mcFixtures.replies` (key = file name without `.json`, value =
`reply`) before the page loads. The canvas uses them only in a dev or
`VITE_E2E=1` build with `?sim=1`, through `createReplayEngines`, and every
turn they answer is labelled "Replay · recorded reply". A turn kind with no
file fails loudly; nothing is made up.
