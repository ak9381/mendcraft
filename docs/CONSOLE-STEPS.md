# Firebase console steps (human-only)

These are the clicks a person must do in the Firebase console. The app works
**without any of them** — every path falls back to the inline prompt, the
reusable App Check token, and browser `speechSynthesis`. Do them to turn on the
server-side enhancements. Nothing here is a code change.

Project: the Mendcraft Firebase project (same one `src/firebase/app.ts` reads
from `.env`). Firebase AI Logic + App Check must already be set up (they are —
App Check uses reCAPTCHA Enterprise; see `src/firebase/appCheck.ts`).

## 1. Publish the server prompt templates

For each file in `firebase/prompt-templates/`, create a server prompt template
with the **exact ID used as the file name** (the client reads these IDs from
Remote Config):

| File | Template ID |
| --- | --- |
| `template_plan_generate.prompt` | `template_plan_generate` |
| `template_screen_generate.prompt` | `template_screen_generate` |
| `template_part_design.prompt` | `template_part_design` |

1. Firebase console → **AI Logic** → **Prompt templates** (also reachable via the
   Firebase CLI / Genkit dotprompt tooling — the files are in dotprompt format).
2. **Create template** → paste the file contents (YAML frontmatter + body).
3. Set the template **ID** to the value in the table above.
4. Confirm the input variables are `request` and `preamble` (the client sends
   `templateVariables: { request, preamble }`).
5. **Publish** each template.

The client only calls a template when its Remote Config ID is non-empty (step 2),
and even then falls back to the inline prompt on any error — so publishing a
template is safe to do incrementally.

## 2. Point Remote Config at the templates (and TTS voice)

Firebase console → **Remote Config**. Add/set these parameters (string values).
Leaving a template param **empty** keeps the inline-prompt path — the default.

| Parameter | Value to enable | Default (empty = inline) |
| --- | --- | --- |
| `template_plan_generate` | `template_plan_generate` | *(empty)* |
| `template_screen_generate` | `template_screen_generate` | *(empty)* |
| `template_part_design` | `template_part_design` | *(empty)* |
| `cloud_tts_model` | e.g. `gemini-2.5-flash-preview-tts` | `gemini-2.5-flash-preview-tts` |
| `cloud_tts_voice` | a Chirp3 HD voice name, e.g. `Kore` | `Kore` |
| `cloud_model` | e.g. `gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` |
| `cloud_prompt_preamble` | optional extra instruction | *(empty)* |

**Publish** the Remote Config changes. The app fetches on load and listens for
realtime updates, so the template IDs / preamble / TTS voice take effect without
a redeploy. (`cloud_model` is read when the models are built, i.e. on next load.)

## 3. App Check replay protection — do this LAST

The client now requests **limited-use App Check tokens**
(`useLimitedUseAppCheckTokens: true` in `getAI`, `src/ai/hybrid.ts`). These are
single-use tokens that let the backend enforce replay protection.

1. First make sure a build **with** the limited-use flag is actually deployed and
   live (this change is in the code now — verify it shipped).
2. Only **after** that live build is confirmed: Firebase console → **AI Logic**
   (or App Check) → enable **replay protection** / "consume limited-use tokens"
   for the Firebase AI Logic / Vertex AI API.

Do NOT enable replay-protection enforcement before the limited-use build is live,
or in-flight clients using reusable tokens will start getting rejected. Enabling
it is the only console toggle that can break the app, so it goes last.
