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
};

export default config;
