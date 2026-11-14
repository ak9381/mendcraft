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
- gitleaks flags high-entropy string constants (e.g. alphabets); add an inline `// gitleaks:allow (reason)` only when it is truly not a secret.
- `npm ci` can fail on this box; use `npm install` if deps are missing.
- Time-box: finish small and green rather than big and red. Write what is left in your final output.

## Run log (append one line per run: date, run name, lesson)
- 2026-11-14 · Judges' guided tour + /judges page · Keep tour step logic, bounds, skip-missing and persistence as a pure DOM-free module (src/ui/tour.ts) and the sim playback as a pure state machine (createSimPlayback) so both are unit-testable; the spotlight/callout DOM and controls bar stay in main.ts. A module that reads `window` at top level (sim.ts SIM_ACTIVE) isn't importable in node vitest — guard with `typeof window !== 'undefined'`. First load should OFFER the tour, not force onboarding; gate the auto-open on a separate `mendcraft.tourSeen` key so dismissal sticks but the "?" button always reopens.
- 2026-11-14 · Firebase quick wins + replies in her language · Spoken confirmations must come from a fixed en/kn phrase table keyed off the applied op (never free TTS); reserve the cloud Gemini voice for her language only (English stays on browser speechSynthesis) so the ledger isn't spammed and every reply has a synth fallback. Gemini TTS returns raw L16 PCM — wrap it in a WAV header before decodeAudioData. `useLimitedUseAppCheckTokens` is a client-only getAI flag; console replay-protection enforcement is a separate human step that must go LAST, after the limited-use build is live.
- 2026-11-14 · Recipes part 2 (browser plan + iPad cards + device recipes) · Keep the new surface area as pure, re-validated modules: browser.ts (step interpreter + confirm-gate word list + hard URL/host allowlist + buildBrowserPlan), deviceRun.ts (lamp→LampIntent, music→PlayerAction, clamped), and relay run/runStatus/runControl messages validated the same way as cmd/frame. Recipe cards ride the ControlSnapshot (privacy-safe summary only — id/name/device/taughtBy/summary/steps, NO ops leave) through build+coerce+demo, so /control shows them and taps sendRun. Session: run requests are handled BEFORE the control early-return (control is read-mostly but may REQUEST a run). To run lamp recipes from Chrome, expose apply() on LampControl/LampPanel (same guarded path as the buttons). Left: the in-canvas iframe step-replay DOM panel (highlight + per-step confirm) — interpreter/plan/confirm-gate are done and tested, the DOM driver is not.
- 2026-11-14 · Confidence states + confirm step + rules-decide a11y · Keep ALL gating decisions in a pure module (src/ai/confidence.ts: classifier, chooser builder, choice-word parser, destructive detector) and let main.ts own only the chips' DOM; the voice reply intercept must run FIRST in runUtteranceInner (before recipes/phrasebook eat "first"/"cancel") and must treat long utterances as a new command, not a pick. Choice words need explicit-ordinal-before-number-word matching ("the second one" contains "one"). A11y fix recheck = apply → re-run deterministic checks → undo on not-fixed/new-issue (recheckFix in core/a11y.ts, pure); sim 'accept-a11y' stages the preview then programmatically accepts it so the confirm step stays mandatory.
- 2026-11-14 · Taught-once recipes (Chrome designer) · Tap the op log by wrapping controller.applyResult/applyOp ONCE in main.ts (with a `replaying` guard so a replay batch never re-records) instead of sprinkling record calls per call-site; relative replay = store steps anchor-relative + rewrite concrete targets to 'selected' (created items self-select) and replay via the existing 'batch' op for one undo group. Kannada voice phrases: `[^\p{L}\p{N}\s]` normalization destroys Kannada — vowel signs/virama are \p{M} marks, keep them. A "do <name>" meta-command must return null (→ normal routing) when nothing matches, or it eats real commands.
