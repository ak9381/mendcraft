# Mendcraft iOS (Capacitor) — skeleton

This directory is a **placeholder**. No `.ipa` was built and no Xcode project is
committed here — the Capacitor iOS platform can only be generated and built on a
**Mac with Xcode + CocoaPods**, not on this Linux box. Nothing here pretends
otherwise.

The iPhone experience ships two ways:

1. **PWA (works today, no Mac needed).** Open the deployed site in iPhone Safari,
   go to `/phone`, then **Share → Add to Home Screen**. You get a standalone
   lamp & music remote. This is the recommended path.
2. **Native wrapper (optional, needs a Mac).** A thin Capacitor shell around the
   same `dist/` bundle, routing to `/phone`. Generate it on a Mac:

   ```sh
   npm install
   npm run build            # produces dist/
   npx cap add ios          # generates ios/App (Xcode project) — overwrites this skeleton
   npx cap sync ios
   npx cap open ios         # opens Xcode; set a signing team, then Run/Archive
   ```

   `@capacitor/ios` is already in `package.json`, and `capacitor.config.ts` has
   an `ios` section. Build artifacts (`ios/App/Pods`, `ios/App/build`,
   `DerivedData`, etc.) are git-ignored — see the repo `.gitignore`.

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

## Add-a-device native plugins (`ios/plugins/`, not compiled yet)

Written on the Linux build box, **not compiled or run** — no Mac/Xcode here and
the gimbal hasn't arrived. After `npx cap add ios`, drag the three files into
the `App` target and set the Main storyboard's view controller class to
`MendcraftViewController`.

- `MendcraftLanPlugin.swift` — UDP/HTTP to private LAN IPs only (same port
  allowlist as `src/devices/connector.ts`), WiZ broadcast discovery, Bonjour
  browse (names only; no IP resolve yet). Needs `NSLocalNetworkUsageDescription`,
  `NSBonjourServices`, `NSAllowsLocalNetworking`, and the
  `com.apple.developer.networking.multicast` entitlement (Apple must approve it)
  for the broadcast.
- `MendcraftGimbalPlugin.swift` — **optional** DockKit aiming (Insta360 Flow 2
  Pro). Follow me uses DockKit's own system tracking; Hold still turns it off;
  "Follow my hands" runs a native front-camera Vision hand tracker that drives
  `DockAccessory.track()` (the WebView camera is off meanwhile). Nod, shake
  and wake-up cues; manual pan/tilt with `setOrientation(relative:)`. iOS 18+,
  behind `#if canImport(DockKit)`; reports `available:false` otherwise.
  Nothing in the flow requires it.
- `MendcraftViewController.swift` — registers both plugins.
