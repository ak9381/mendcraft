# Mendcraft iOS sources (`ios-src/`)

These Swift files are written on Linux and are **not compiled here** (no Mac /
Xcode on the build box). After you generate the Capacitor iOS project on a Mac,
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

Then in Xcode:

1. Add those files to the **App** target if they are not already in the project (drag from `ios/App/App` if needed).
2. Set the Main storyboard’s view controller class to `MendcraftViewController` (module **App**).
3. If Capacitor generated a `SceneDelegate.swift` that sets `rootViewController = CAPBridgeViewController()`, replace it with `ios-src/SceneDelegate.swift` so the root is `MendcraftViewController()`. A bare `CAPBridgeViewController` never registers `MendcraftAppleAI`, and can leave the WebView black.

`MendcraftGimbalPlugin.swift` turns DockKit system face tracking **off** in
`load()`, on `UIApplication.didBecomeActive` (resume), when a stand docks, and
again from `MendcraftViewController.viewDidAppear`. That call has to actually
run: otherwise the Flow 2 Pro keeps following a face inside Mendcraft. Tracking
is turned back on only when the app backgrounds.

The web layer (already in the hosted bundle) aims at her hands in normal use,
and in Add a device stops following so she can point or nudge pan/tilt, then
holds so the device stays in frame.

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
