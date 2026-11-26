# Mendcraft iOS (Capacitor)

The Xcode project (`ios/App`) is **generated, not committed**: `npx cap add ios`
writes it on a Mac with Xcode, and it then holds your signing team
(`DEVELOPMENT_TEAM`). Never commit `ios/App`. Everything Mendcraft adds to it
is tracked elsewhere and copied in:

- `ios-src/*.swift` — the native plugins, the view controller and the scene delegate;
- `ios-src/Info.plist.additions.xml` — the Info.plist keys and permission
  strings (camera, microphone incl. the pairing chime, speech recognition,
  local network / Bonjour, the scene manifest).

The iPhone experience ships two ways:

1. **PWA (no Mac needed).** Open the deployed site in iPhone Safari, go to
   `/phone`, then **Share → Add to Home Screen** for a standalone lamp & music
   remote.
2. **Native app (needs a Mac with Xcode + CocoaPods).** A Capacitor shell
   around the same `dist/` bundle.

## Build the native app (after a fresh clone)

```sh
npm ci
npm run build                 # produces dist/
npx cap add ios               # generates ios/App (skip if it already exists)

# 1. the Swift sources (plugins, view controller, scene delegate)
cp ios-src/*.swift ios/App/App/ && grep -c requestSystemTrackingOff ios/App/App/*.swift
#    every count must print 0 (else an old plugin copy is still in the target);
#    SceneDelegate.swift replaces Capacitor's, if any

# 2. merge the Info.plist keys: copy every <key>/value pair from
#    ios-src/Info.plist.additions.xml into the top-level <dict> of
#    ios/App/App/Info.plist (replace keys Capacitor already wrote).
open -a Xcode ios/App/App/Info.plist     # or edit it as source

# 3. sync the web bundle and plugins into the project
npx cap sync ios
npx cap open ios
```

Then in Xcode:

1. Add the five Swift files to the **App** target if they are not already in
   it (drag them from `ios/App/App`).
2. Set the Main storyboard's view controller class to `MendcraftViewController`
   (module **App**). `SceneDelegate.swift` roots the window in it; a bare
   `CAPBridgeViewController` never registers the Mendcraft plugins.
3. Pick your signing team, then Run on the iPhone.

`ios/README.md` and `ios-src/` are committed; the generated project and all
build output are git-ignored (see the repo `.gitignore`). Keep `.bak` copies
of Info.plist or the project out of git.

## iOS limits (by design)

- **No Instagram / WhatsApp automation.** iOS has no equivalent of Android's
  AccessibilityService; the feed-scroll + WhatsApp-draft assist is Android-only.
  The iOS app is the full Mendcraft app (setup, gestures, Add a device,
  gimbal, lamp, music); the compact remote stays at /phone.
- **Spotify** playback needs a Premium account and a Client ID. Sign-in is
  Authorization Code with PKCE in the *web* app
  (`https://mendcraft.web.app/spotify`). The Capacitor webview cannot return
  from that redirect yet (a custom URL scheme comes later), so Connect opens
  the web app. Without a connection the built-in public-domain player is used.
- **Lamp control** needs the laptop's WiZ bridge (`npm run wiz-bridge`) reachable
  on the same Wi-Fi/LAN as the phone.

## Native plugins (`ios-src/`)

Copied into `ios/App/App` by the steps above. See `ios-src/README.md` for
the Xcode details, including Apple on-device AI.

- `MendcraftLanPlugin.swift` — UDP/HTTP to private LAN IPs only (same port
  allowlist as `src/devices/connector.ts`), WiZ broadcast discovery, Bonjour
  browse (names only; no IP resolve yet). Needs `NSLocalNetworkUsageDescription`,
  `NSBonjourServices`, `NSAllowsLocalNetworking`, and the
  `com.apple.developer.networking.multicast` entitlement (Apple must approve it)
  for the broadcast.
- `MendcraftGimbalPlugin.swift` — **optional** DockKit aiming (Insta360 Flow 2
  Pro). System face tracking is turned **off** on launch, on resume
  (`didBecomeActive`), when a stand docks, and from `viewDidAppear`. Manual
  pan/tilt with `setOrientation(relative:)`. iOS 18+, behind
  `#if canImport(DockKit)`; reports `available:false` otherwise. Nothing in
  the flow requires it. "Follow my hands" runs a native front-camera Vision
  hand tracker that drives `DockAccessory.track()` (the WebView camera is off
  meanwhile); in Add a device she can point or nudge and then it holds the frame.
- `MendcraftViewController.swift` — registers the plugins and re-asserts
  system tracking off on appear.
- `MendcraftAppleAIPlugin.swift` — on-device Apple Foundation Models
  (Apple Intelligence) for Quick draft, small edits, intent and redaction.
  iOS 26+, behind `#if canImport(FoundationModels)`; reports
  `unsupported` otherwise. No Firebase iOS SDK. See `ios-src/README.md`.
