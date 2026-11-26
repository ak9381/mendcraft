import type { CapacitorConfig } from '@capacitor/cli';

// Thin Android shell around the existing web app. The webview boots the same
// bundle Firebase Hosting serves; boot.ts detects the native shell and mounts
// the Relay remote + camera page (equivalent of opening /remote).
const config: CapacitorConfig = {
  appId: 'app.mendcraft.relay',
  appName: 'Mendcraft Relay',
  webDir: 'dist',
  plugins: {
    // The canvas is light in both system themes: dark status-bar and
    // gesture-bar icons always (Capacitor's default follows the system theme,
    // which put white icons on the light canvas in dark mode). 'LIGHT' is
    // "light background, dark content" on Android and iOS alike.
    SystemBars: { style: 'LIGHT' },
  },
  // Behind the web content until (and around) the page: the canvas colour.
  backgroundColor: '#F7F5F0',
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
    // The canvas colour behind the web content. Capacitor's default is
    // systemBackground — black in Dark Mode — which showed as a solid black
    // band under the status bar (the content inset) on the iPhone.
    backgroundColor: '#F7F5F0',
  },
};

export default config;
