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
  The iOS app is lamp + music + pairing, nothing more.
- **Apple Music** playback needs a MusicKit developer token; without one the app
  honestly falls back to its own local-file player (`src/music/appleMusic.ts`).
- **Lamp control** needs the laptop's WiZ bridge (`npm run wiz-bridge`) reachable
  on the same Wi-Fi/LAN as the phone.
