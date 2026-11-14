# Measured command accuracy

Honest numbers from a fixed eval set, not vibes. The set is realistic, short,
mom-style plan-mode utterances — disfluent and deictic ones included.

- Eval sets: `tests/eval/commands.en.json` (45 cases), `tests/eval/commands.kn.json` (40 cases).
- Run the rules path offline: `npm run eval:commands` → writes `eval/results-<date>.json` + `eval/summary.md`.
- Scoring is pure and unit-tested (`src/eval/commandEval.ts`, `tests/commandEval.test.ts`).

`expect` in each case is the TRUE intended op (what the cloud/Nano path should
produce). The rules path is deterministic and English-only; cases it can't
resolve are honest misses, not hidden.

## Rules path (offline, zero network) — 2026-11-14

| language | cases | before | after |
| --- | --- | --- | --- |
| English | 45 | **91%** (41/45) | **93%** (42/45) |
| Kannada | 40 | 0% (0/45) | 0% (0/40) |
| Kannada route-off | 40 | 100% | 100% |

**Kannada is 0% by design.** The rules parser is English-only, so every Kannada
utterance is correctly *declined* (clarify) and handed to the cloud translate+op
path (`src/ai/language.ts`). The meaningful offline metric for Kannada is the
**route-off rate** — how often rules correctly refuse rather than silently
mis-apply an op — which is **100%**. Op-level Kannada accuracy must be measured on
the cloud path (below).

### The one small improvement (before → after)

`"add a bedroom 4 by 3 meters"` used to match the whole-plan template branch
(`generate:twoBedroom`) because `bedroom` was checked before room dimensions.
Fixed in `src/plan/ruleParser.ts`: when a `bedroom` command carries explicit
`N by M` dimensions it is now a single named room (`add_room`). English 91% → 93%.

### Remaining English misses (after)

- `half a metre deep` → `clarify` (no numeral; "half a" not parsed as 0.5)
- `make this one bigger` → `clarify` ("bigger"/"smaller" has no plan op)
- `scoot it over` → `clarify` (no direction or distance)

These are left for the Nano/cloud path on purpose — the rules path should ask
back rather than guess, and the confirm step catches any over-eager fill-in.

## Nano / cloud path — how to measure (Chrome only)

The on-device (Gemini Nano) and cloud paths are not scriptable headless, so they
are measured by hand in Chrome:

1. Open the app in Chrome with Gemini Nano enabled (`chrome://flags` → Prompt API
   for Gemini Nano), plan mode, no `?sim=1`.
2. In DevTools console, load an eval set:
   `const set = await (await fetch('/tests/eval/commands.en.json')).json()`
   (or paste the array).
3. For each case call the hybrid path used in `src/main.ts`
   (`fuseIntent(text, …)` / `generatePlan(text)`), take the resulting op, and
   compare with `opLabel()` (import from `src/eval/commandEval.ts`) against
   `expect` — the same comparison the offline harness uses.
4. Record the per-language accuracy and the badge (ON-DEVICE vs CLOUD) each case
   resolved on, so the honest-source split is visible.

Record those numbers here under a new dated row when run; keep them honest.
