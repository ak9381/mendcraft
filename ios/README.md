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
npm run ios:setup             # scripts/ios-setup.mjs (below)
npx cap open ios              # pick your signing team, then Run on the iPhone
```

`npm run ios:setup` does, every time, what used to be done by hand:

1. `ios/App` missing → `npx cap add ios` (the tracked `ios/README.md` and
   `ios/plugins/` are set aside meanwhile; Capacitor refuses to add a platform
   whose folder exists).
2. Copies `ios-src/*.swift` (the LAN, gimbal and Apple on-device plugins, the
   view controller that registers them, the scene delegate that roots the
   window in it) into `ios/App/App/` and puts each in the **App** target.
3. Merges `ios-src/Info.plist.additions.xml` into `ios/App/App/Info.plist`
   (camera, microphone, speech recognition, local network / Bonjour, the scene
   manifest).
4. `npx cap sync ios`.
5. Checks: every copy byte-identical to `ios-src`, in the target, and no old
   copy still calling `requestSystemTrackingOff`.

An `ios/App` from an older checkout: delete it (`rm -rf ios/App`) and run
`npm run ios:setup` again; you then pick the signing team once more.

Compile check without a phone or signing:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/mc-ios-dd \
  CODE_SIGNING_ALLOWED=NO build && rm -rf /tmp/mc-ios-dd
```

The custom plugins are not in `packageClassList` (that lists npm plugins
only): `MendcraftViewController.capacitorDidLoad` registers them with
`registerPluginInstance`. A bare `CAPBridgeViewController` never does.

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
