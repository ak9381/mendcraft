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
    // The iOS shell boots the full Mendcraft app (setup, gestures, Add a
    // device, DockKit gimbal, music). Instagram/WhatsApp assist is Android-only.
    // The compact lamp & music remote stays at /phone. Spotify sign-in must be
    // completed in the web app (https://mendcraft.web.app) — the /spotify
    // redirect cannot return to this webview yet.
    contentInset: 'always',
  },
};

export default config;
