# Lessons (read first, add to it at the end of every run)

## Scope freeze
No new feature ideas beyond the build tracker. After the iPhone app and "replies in her language", only
the listed Chrome items, recipes, quality items and polish. Bug fixes always allowed.

## Rules that keep biting
- Never read, print or commit `.env*` files (only `.env.example`). gitleaks runs before every commit.
- `npx vitest run` and `npm run build` must both be green at the end of the run. Do not delete tests to get green.
- Kill any `vite preview` / dev server / headless browser you start. The box is low on RAM.
- Do not git commit, push or deploy; the pipeline does that after the gate.
- Every edit goes through the shared op log (undo/redo) and must work with mouse AND pinch (same pointer stream).
- Keep part mode (cup grip) intact; it is the fallback.
- The model never emits free geometry; every AI output is re-validated in code before it touches the scene.
- The AI-source badge must stay honest (ON-DEVICE / CLOUD / RULES / SIM) with the router's reason.
- Anything that sends, submits or applies an unsure change needs an explicit confirm (pinch or tap). Never auto-send.
- Every new cloud call must show up in the "What left this device" ledger.
- Demo walks live in `src/sim.ts` (`/?sim=1`, `&mode=part`, `&mode=ui`); they need no camera, mic or Nano. Do not break them.
- Do not restyle the app shell; a UI redesign comes later.
- Do not use Firebase's FriendlyMeals sample as a base.
- `npm ci` can fail on this box; use `npm install` if deps are missing.
- Time-box: finish small and green rather than big and red. Write what is left in your final output.

## Run log (append one line per run: date, run name, lesson)
