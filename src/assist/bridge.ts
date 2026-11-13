// Webview side of the Android assist bridge. Deliberately uses the runtime
// `window.Capacitor.Plugins` registry instead of importing @capacitor/core so
// the web bundle served by Firebase Hosting is unchanged — on the web these
// helpers simply report "no native shell". The native side is
// android/.../assist/AssistBridgePlugin.java; policy in src/assist/policy.ts.

export interface AssistBridgePlugin {
  isServiceEnabled(): Promise<{ enabled: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  scroll(opts: { direction: 'up' | 'down' }): Promise<void>;
  setAutoScroll(opts: { enabled: boolean }): Promise<void>;
  getAutoScrollState(): Promise<{ running: boolean }>;
  pauseAutoScroll(): Promise<void>;
  /** Types the draft into WhatsApp's compose field. Never sends. */
  stageDraft(opts: { text: string }): Promise<{ staged: boolean }>;
  cancelDraft(): Promise<void>;
}

interface CapacitorGlobal {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: { AssistBridge?: AssistBridgePlugin };
  };
}

/** True when running inside the Capacitor Android shell. */
export function isNativeShell(w: unknown = globalThis): boolean {
  return Boolean((w as CapacitorGlobal).Capacitor?.isNativePlatform?.());
}

/** The plugin, or null on the plain web (callers hide their UI then). */
export function getAssistBridge(w: unknown = globalThis): AssistBridgePlugin | null {
  if (!isNativeShell(w)) return null;
  return (w as CapacitorGlobal).Capacitor?.Plugins?.AssistBridge ?? null;
}
