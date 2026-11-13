import type { CapacitorConfig } from '@capacitor/cli';

// Thin Android shell around the existing web app. The webview boots the same
// bundle Firebase Hosting serves; boot.ts detects the native shell and mounts
// the Relay remote + camera page (equivalent of opening /remote).
const config: CapacitorConfig = {
  appId: 'app.mendcraft.relay',
  appName: 'Mendcraft Relay',
  webDir: 'dist',
  android: {
    // Camera preview (MediaPipe pinch) needs getUserMedia; Capacitor's
    // https://localhost scheme is a secure context so this works offline.
    allowMixedContent: false,
  },
  ios: {
    // The iOS shell is the lamp & music remote only (no Instagram/WhatsApp
    // assist — that is Android-only). Run `npx cap add ios` on a Mac to
    // generate the Xcode project in ios/; see ios/README.md. The webview boots
    // the same dist/ bundle at path '/', so boot.ts's isNativeShell branch
    // mounts the full remote; set the webview URL to '/phone' (or add an iOS
    // branch in boot.ts) to get the compact lamp & music variant on device.
    contentInset: 'always',
  },
};

export default config;
