# Mendcraft Chrome extension

A small Manifest V3 extension so someone with limited hand use (Akash's mom,
who has arthritis) can copy from and paste into **any Chrome tab** with
Mendcraft's voice and pinch gestures.

It is not a full browser inside Mendcraft. It talks to the real Chrome tab.

## What it can do

From Mendcraft Studio, say:

- **“copy this”** — copies the selected text, or the main text of the page if
  nothing is selected (a readability-style extraction).
- **“copy the link”** — copies the tab's URL.
- **“send to canvas”** — adds a text or link card on the open Mendcraft Studio
  canvas.
- **“paste here”** — shows a pinch-to-confirm card in Mendcraft, then inserts
  the last copied item into the focused field of the active tab. It never
  submits the form.
- **“switch to Gmail”** (or any tab name) — focuses that Chrome tab.
- **“find me references for X”** — after she picks **Search the web**, opens a real Google Images tab (or Pinterest if she says “on Pinterest”), overlays large numbered badges on the visible pictures, and listens for “number 3”, “next page”, hand scroll, pinch, or dwell. The picked picture comes back onto the Mendcraft canvas. **“close”** or an open palm closes the tab and returns focus to Studio.


## What it will not do

- It never pastes into **password** or **payment** fields.
- It never auto-submits a form, even after you confirm a paste.
- It never sends page text, camera, hand or voice data off this computer. The
  messages stay inside this Chrome profile.
- A paste into a field always waits for a pinch or a Confirm tap in Mendcraft.

## Permissions (why each one)

Chrome will show a permission warning when you load the extension. Here is
what each permission is for — nothing else uses them:

| Permission | Why |
| --- | --- |
| **Read and change site data** (from the content script on `http`/`https`) | So “copy this” can read the selected or main text, and “paste here” can type into the focused field. Password and payment fields are skipped. |
| **tabs** | So “switch to …” and “copy the link” can find a tab by name, and so the reference panel can open a page in a real Chrome tab when the site blocks framing. |
| **storage** | Remembers the last copied text or link on this computer, so “send to canvas” and “paste here” can use it. |
| **activeTab** + **scripting** | Lets Mendcraft ask the extension to work in the tab you are using, without a broader host permission. |

There is no account, no analytics, and no network call of the extension's own.

## Install (Load unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top right).
3. Click **Load unpacked**.
4. Pick this `extension/` folder (the one that contains `manifest.json`).
5. Open [Mendcraft Studio](https://mendcraft.web.app/studio). The status bar
   should say **Chrome extension connected**. First-run setup also has a short
   **Connect Chrome** step.

To update after a pull, click **Reload** on the Mendcraft card in
`chrome://extensions`, then refresh the Studio tab.

If you unzipped `mendcraft-extension.zip`, pick the unzipped folder that
contains `manifest.json`.

## Talking to Mendcraft

The extension is `externally_connectable` only from:

- `https://mendcraft.web.app`
- `https://mendcraft.firebaseapp.com`
- `http://localhost:5173` and `http://127.0.0.1:5173` for local development
- `http://localhost:4173` and `http://127.0.0.1:4173` for a local preview build

If the extension is not installed or not connected, Studio falls back to an on-canvas picture grid and says so.

Hands-free reference search never types into any field, including password or payment fields. Google Images and Pinterest may still show cookie or login walls, change their layout so badges miss a result, or only give thumbnail URLs that later fail to load on the canvas.


Mendcraft treats every reply from the extension as data. It never evaluates it
as code.
