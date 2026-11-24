# Mendcraft iOS sources (`ios-src/`)

These Swift files were written on Linux. `MendcraftGimbalPlugin.swift` has
since been compile-checked with Xcode (generic iOS, no signing) but **not run
on a device with the stand**. After you generate the Capacitor iOS project on a Mac,
copy them into the App target.

## Copy into `ios/App/App`

From the `app/` directory, after `npx cap add ios` (or on a later `npx cap sync ios`):

```sh
cp ios-src/MendcraftGimbalPlugin.swift    ios/App/App/
cp ios-src/MendcraftViewController.swift ios/App/App/
cp ios-src/MendcraftLanPlugin.swift      ios/App/App/
cp ios-src/MendcraftAppleAIPlugin.swift  ios/App/App/
cp ios-src/SceneDelegate.swift           ios/App/App/
```

Then merge the Info.plist keys and permission strings from
`ios-src/Info.plist.additions.xml` into `ios/App/App/Info.plist`, and run
`npx cap sync ios` (full steps: `ios/README.md`).

Then in Xcode:

1. Add those files to the **App** target if they are not already in the project (drag from `ios/App/App` if needed).
2. Set the Main storyboard’s view controller class to `MendcraftViewController` (module **App**).
3. If Capacitor generated a `SceneDelegate.swift` that sets `rootViewController = CAPBridgeViewController()`, replace it with `ios-src/SceneDelegate.swift` so the root is `MendcraftViewController()`. A bare `CAPBridgeViewController` never registers `MendcraftAppleAI`, and can leave the WebView black.

## Gimbal (`MendcraftGimbalPlugin.swift`)

The web layer (`src/canvas/gimbalCanvas.ts`) picks one of three modes:

- **face** — DockKit's own subject tracking (`setSystemTrackingEnabled(true)`).
  We never aim in this mode. This is what "follow me" / "follow my face" /
  "track me" asks for, and what the iPhone app asks for on launch.
- **hands** — system tracking off; the web layer aims at her hands. Only when
  a hand tracker is producing frames; otherwise the app says "Hand following
  needs a hand tracker — following your face instead" and uses face.
- **hold** — both off ("hold still" / "stop following").

The plugin no longer forces system tracking off on load, resume, dock or in
`MendcraftViewController.viewDidAppear`. `aim()` turns system tracking off for
that one move and restores the last state the web layer chose; `release()`
restores it too. Backgrounding turns system tracking on (normal behaviour for
other apps); coming back re-applies the web layer's choice.
`setSystemTrackingEnabled` resolves `{ ok, enabled, keepAlive, error }`, with
`enabled` read back from DockKit — the status line only claims following when
that is true, and shows the native error text otherwise.

**UNVERIFIED — DockKit tracking with the WKWebView camera.** DockKit system
tracking works from an app's camera capture session. Mendcraft's camera is the
WebView's `getUserMedia`, which WebKit runs out of process, and the iPhone
canvas does not open a camera at all unless a feature asks for one. So face
tracking may do nothing until some camera is running. The status line says
"DockKit tracking on — needs a camera app/camera running" for that reason.

**Opt-in camera keep-alive (test option, off by default).** Passing
`keepAlive: true` with `enabled: true` starts a minimal front-camera
`AVCaptureSession` owned by the app: no preview, no recording, no frame
processing (a video-data output with no delegate). It stops on hold / hands /
background. Turn it on with `?gimbalKeepAlive=1` on the canvas URL, or by
saying "keep alive on" (and "keep alive off"). It may interrupt a WebView
camera that is already running — check that in the on-device test
(docs/TEST-CHECKLIST.md, section G). Uses the existing
`NSCameraUsageDescription`.

Room scan by gimbal is **not** implemented on live runs (the app says so);
`?sim=1` keeps the scripted, SIM-labelled scan.

**iPhone hand sensing** (`src/canvas/phoneSensor.ts`) runs hands + face on the
one shared WebView camera (`phoneCamera.ts`) while the stand is docked, the
Track pill is on, or a "follow my hands" / point request is active. It feeds
the gimbal's hands mode and point-to-connect (the photo is cut from the same
stream), never the UI. Hand **control** (Hands pill) is separate, off by
default, and facing-gated. Both are untested on the device.

## Apple on-device AI (`MendcraftAppleAIPlugin.swift`)

The iOS app uses Apple’s on-device Foundation Models (Apple Intelligence)
for the same Quick jobs Nano does on the web: a draft board, small
pinch-and-say edits, intent parsing, and redaction. Cloud Gemini still
runs in the web layer through Firebase AI Logic. The badge reads
**Apple · on device** when that path answers; otherwise it falls back
exactly as today (Gemini · cloud, or Rules, and Deep queues offline).

We talk to `FoundationModels` directly (`SystemLanguageModel.default` +
`LanguageModelSession`). Firebase’s iOS `HybridModel` API was removed in
firebase-ios-sdk 13.2.0 (16 Nov 2026). Do **not** add the Firebase AI
Logic or App Check iOS SDKs for this — no extra CocoaPods or Swift
packages, and no Firebase console / App Check / billing changes.

**These Swift files have not been compiled or run.** There is no Mac or
Xcode on the Linux build box. Verify on your iPhone before treating the
badge as proven.

### Build and run on your M2 Mac

You need Xcode 26 (or newer), iOS 26 or later on the phone, and an
iPhone 15 Pro or newer with Apple Intelligence. The Simulator often
does not include the on-device model — run on the device.

1. On `sim-main`: `npm install` then `npm run build`.
2. If the Xcode project is not there yet: `npx cap add ios`. Then `npx cap sync ios`.
3. Copy the four Swift files above into `ios/App/App/` and add them to the App target. Set the Main storyboard’s view controller class to `MendcraftViewController` (module **App**).
4. In Xcode, pick your signing team. No extra pods or Swift packages are required for Apple Intelligence (`FoundationModels` is a system framework).
5. On the iPhone: Settings → Apple Intelligence & Siri → turn Apple Intelligence on. Wait if it says the model is still downloading.
6. Plug in the iPhone 15 Pro, pick it as the run destination, and Run.
7. In the app, say a small Quick command (or pinch a tile and say a small edit). The badge / route line should read **Apple · on device**.
8. Turn on Airplane Mode and try Quick again — it should still answer on device. A Deep / cloud job should go on the Later list until you are back online.

If the badge still says there is no on-device AI: confirm iOS 26+, Apple
Intelligence is on, the plugin file is in the App target, and you are
not running on the Simulator.
