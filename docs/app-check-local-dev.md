# App Check on the local dev server

Gemini calls go through Firebase AI Logic, which requires App Check. On the
hosted site App Check uses reCAPTCHA Enterprise. On `npm run dev` there is no
reCAPTCHA-approved domain, so the page presents a **debug token** instead.

A debug token only works after it has been registered in the Firebase console.
An unregistered one makes every Gemini call fail with HTTP 403, which the
canvas reports as:

> Gemini blocked: App Check 403 (this address isn’t registered)

## One token for every local address (do this once)

Without a configured token the Firebase SDK invents a new one for each origin
(`localhost:5173`, `127.0.0.1:5173`, another port…), and each would need
registering by hand. Use one stable token instead:

1. Make a token (any UUID v4):

   ```sh
   uuidgen | tr 'A-Z' 'a-z'
   ```

2. Give it to the dev server, in **one** of these places (first match wins):

   | Where | How |
   | --- | --- |
   | shell env | `APPCHECK_DEBUG_TOKEN=<uuid> npm run dev` |
   | `.env.local` (gitignored) | `APPCHECK_DEBUG_TOKEN=<uuid>` (or `VITE_APPCHECK_DEBUG_TOKEN=<uuid>`) |
   | a file | `~/.secrets/mendcraft-appcheck-debug` containing only the UUID |

   Prefer `APPCHECK_DEBUG_TOKEN`: a name without the `VITE_` prefix is never
   visible to client code.

3. Register it: Firebase console → **App Check** → **Apps** → the web app’s
   ⋮ menu → **Manage debug tokens** → **Add debug token** → paste the UUID.

4. Restart `npm run dev`. The server prints where the token came from (never
   the token itself):

   ```
   [mendcraft] App Check: using the debug token from APPCHECK_DEBUG_TOKEN (it must be registered in the Firebase console).
   ```

   If nothing is configured it prints a warning that Gemini will be refused.

## How it is applied

- `vite.config.ts` resolves the token (`src/firebase/debugToken.ts`) and
  injects `self.FIREBASE_APPCHECK_DEBUG_TOKEN` into the HTML **served by the
  local dev server**, and by `vite preview` only for `localhost` + `?debug`.
- `src/firebase/appCheck.ts` uses an injected token as is. In a Vite dev build
  with nothing injected it uses `VITE_APPCHECK_DEBUG_TOKEN` if set, and only
  then falls back to an SDK-generated per-origin token.
- A production bundle never contains a debug token: `vite build` blanks
  `VITE_APPCHECK_DEBUG_TOKEN`, and the injection only happens in a running
  local server. A value that is not a UUID is ignored.

## Other devices on the LAN (a phone opening the dev server)

`npm run dev -- --host` serves the canvas on the machine's LAN address
(for example `http://192.168.1.20:5173`), and a phone on the same Wi-Fi can
open it.

- The **same** stable token is injected there too: the dev server adds it to
  every HTML page it serves, whatever host name the page was opened with. So
  one registered token covers `localhost`, `127.0.0.1` and the LAN address;
  there is nothing extra to register for the phone.
- That also means anyone on the network who can reach the dev server can read
  the token from the page source. Only run `--host` on a network you trust,
  stop the server when you are done, and delete the token from the console
  (**Manage debug tokens**) after a session on shared Wi-Fi.
- Without a configured token, each LAN address is a new origin and the SDK
  generates a different token for it (printed in that device's console, which
  is awkward to read on a phone). Configure the stable token instead.
- A plain-`http` LAN address is not a secure context: the camera and
  microphone are unavailable there, and so is on-device Nano. Gemini calls
  still work once the token is registered. The native phone shells do not use
  debug tokens at all.
- `vite preview` injects the token only for `localhost` + `?debug`, never for
  a LAN address.

## Rules

- A debug token lets a browser skip reCAPTCHA for this project. Treat it like a
  password: never commit it, never paste it into an issue or a chat.
- Delete tokens you no longer use from the console (**Manage debug tokens**).
- The hosted preview/production site does not use debug tokens; if Gemini is
  blocked there, the site’s domain is missing from the reCAPTCHA Enterprise
  key’s allowed domains.

## Checking it worked

Open `http://127.0.0.1:5173/canvas.html`, run a Gemini turn (for example
“connect everything in this room”, approve the draft, and let Deep improve
it). The Gemini terminal shows a reply; the browser console has no
`AppCheck … 403`. The full live checklist is `scripts/live-probe.md`.
