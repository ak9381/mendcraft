# Testing Mendcraft

**Live app:** https://mendcraft.web.app (opens the canvas).
**No account, login or credentials are needed.** Mendcraft asks for the
camera only if you turn on Hands, and for the microphone only if you speak.

## 1. Browser

- Desktop **Google Chrome**, current stable version (check `chrome://version`),
  on a computer that meets Chrome's hardware requirements for built-in AI.
- To use **Gemini Nano** on the device:
  1. Open `chrome://flags`, search for the Built-in AI / Gemini Nano flag (named **"Gemma 4 for Built-in AI"** in current Chrome per the contest rules), set it to
     **Enabled**, and relaunch Chrome.
  2. Open https://mendcraft.web.app. Chrome may need to download the model
     first. That can take a while, and the canvas does not wait for it.
  3. **How to tell Nano is ready:** the engine bar at the bottom shows a
     **Nano** card ("on this device") and a **Gemini** card ("cloud"). While
     the model loads, the Nano card says "Nano is loading the model…", then
     "Nano has loaded the model." You can also ask Chrome in the DevTools
     console with the same options Mendcraft uses:
     `await LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })`.
     Mendcraft uses Nano only when the answer is `"available"`, never while
     the model is still downloadable or downloading.

### Without Nano

Everything in the script below still works, on Gemini in the cloud. The app
says so instead of hiding it:

- the route line reads "Gemini · cloud — Nano isn't available here, so Deep
  drafted it";
- a dashboard review says "Gemini made this draft, so there is no second
  pass.";
- the bytes counter goes up for steps that Nano would have kept on the device.

## 2. A 3-minute script

Type each line into **"Type or say a command…"** and press **Go**. You can
also speak it: Chrome's speech recognition needs the network. Every
result opens a review card. Nothing changes until you press **Approve** (or
**Reject**).

| # | Type | What you should see |
| --- | --- | --- |
| 1 | *(page just opened)* | "Let's build something fun." The engine bar shows **0 B sent to cloud**. |
| 2 | `build the dashboard` | Nano drafts on the device, then Gemini improves the draft. The review's receipt reads like "Drafted by Nano on this device · 0 B; improved by Gemini · N KB". Approve. With no devices connected the board has no live device tiles. |
| 3 | `show my devices` | A devices board. Its table lists only what is really connected, so with no hardware it is empty. |
| 4 | `draw the floor plan` | Gemini writes a plan. The review lists the rooms and the checks. Approve: it opens on its own board. Try `show 3D`, `check accessibility`, `export DXF`. |
| 5 | `add a study next to bedroom 2` | Use a room name from your plan. The review chip says **"Nano · on this device"** and the byte counter does not move. If Nano can't make the edit, Gemini makes it, and the screen says so. |
| 6 | `add Kannada` | Gemini writes a Kannada pack. The review shows the labels; anything that stays English is listed. Approve: the bar turns Kannada. `undo` goes back to English. |
| 7 | `set the lamp to 500 percent` | **Needs a connected lamp.** With one: "Lamps go from 10 to 100 %. Nothing changed." This is a fixed rule, and no model is asked. With no lamp there is nothing to act on, so the line is not a device command. |
| 8 | **More → Demo → Simulate offline** | The button reads "Offline (simulated)" and the Gemini card says **Offline**. Now `build the dashboard` is drafted by Nano alone ("Offline · Quick only. Deep will improve it when you're back online."). `draw the floor plan` replies "Drawing a floor plan needs Gemini, and you are offline. Nothing was generated." Click the button again to go back online. |
| 9 | **Real offline** | Load the canvas once while online, then turn Wi-Fi off and reload: your approved boards and language pack come back from the device, the Gemini card says Offline, and Nano still drafts. Offline, type: voice needs the network. |
| 10 | `show artifacts` | Every approved board, plan, connector and pack, with who made it ("Gemini · cloud", "Gemini Nano · on device", "You") and Remove / Export / Import. |

Optional: **More → Hands** turns on the camera. Then "Palm to point · fist to
click · hold a fist to move." Hand tracking runs in the browser. **Register**
on the empty canvas locks control to your face and hands. If you look away, a
"Not facing" pill shows and the hands stop acting.

## 3. What needs hardware

| Feature | Needs | Without it |
| --- | --- | --- |
| Real lamp, "connect the lamp", lamp refusals | A WiZ bulb on your network and the local bridge (`npm run wiz-bridge` from the repo, then open the canvas once with `?wizToken=<printed token>`) | The canvas has no lamps. It never shows a fake one. |
| Speaker tile | Spotify Premium, signed in | Nothing plays. A speaker press says "Spotify isn't connected. Connect it, then try again. Nothing changed." |
| Phones | The iOS or Android companion app, paired by sound chime or code | The laptop canvas works alone. |
| Gimbal nod on Approve | iPhone app + a DockKit stand | Nothing moves. |

The video shows these with real hardware. To see the whole journey (lamp,
phones, connector, a reload with every outside host blocked, refusal) without hardware, run the
automated test from the repo: `npm install`, `npx vite`, then `npm run e2e`.
It uses recorded model replies and simulated devices, and labels them SIM and
Replay.

## 4. Known limits

- Voice input needs the network. Offline, type.
- The iPhone app's on-device path calls Apple Foundation Models directly, not
  through Firebase AI Logic. It is untested, and the web app does not use it.
