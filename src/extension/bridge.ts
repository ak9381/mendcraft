// Web-app side of the Mendcraft Chrome extension. Detects the extension,
// shows connected state, and sends typed commands. Every reply goes through
// parseExtResult and is treated as data only (never evaluated).
//
// The page talks to the extension in two ways:
//   1. chrome.runtime.sendMessage(extensionId, …) via externally_connectable
//      (mendcraft.web.app, mendcraft.firebaseapp.com, localhost:5173)
//   2. window.postMessage, relayed by the extension's page-bridge content script
//
// The chrome.runtime.sendMessage call is the declared outbound primitive.

import {
  EXT_PAGE_SOURCE, EXT_REQUEST_TYPE, EXT_VERSION,
  parseExtHello, parseExtResult,
  type ExtClip, type ExtRequest, type ExtResult,
} from './protocol';
import type { ExtAction, ExtRequestPayload } from './intents';

export type ExtensionStatus = 'disconnected' | 'connected';

export interface ExtensionBridge {
  status(): ExtensionStatus;
  isConnected(): boolean;
  extensionId(): string | null;
  lastCopied(): ExtClip | null;
  remember(clip: ExtClip | null): void;
  request(action: ExtAction, payload?: ExtRequestPayload): Promise<ExtResult>;
  subscribe(fn: (bridge: ExtensionBridge) => void): () => void;
  /** Start listening for the content-script hello. Safe to call twice. */
  start(): void;
  stop(): void;
}

interface ChromeRuntime {
  sendMessage?: (extensionId: string, message: unknown, responseCallback: (response: unknown) => void) => void;
  lastError?: { message?: string };
}

interface ChromeLike {
  runtime?: ChromeRuntime;
}

export interface BridgeWindow {
  location?: { origin?: string };
  chrome?: ChromeLike;
  addEventListener(type: 'message', fn: (ev: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (ev: MessageEvent) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
}

function newId(): string {
  return `mcx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function originOf(win: BridgeWindow): string {
  return win.location?.origin ?? '';
}

export function createExtensionBridge(win: BridgeWindow = globalThis as unknown as BridgeWindow): ExtensionBridge {
  let extensionId: string | null = null;
  let lastCopied: ExtClip | null = null;
  let started = false;
  const listeners = new Set<(b: ExtensionBridge) => void>();
  const pending = new Map<string, (res: ExtResult) => void>();

  const self: ExtensionBridge = {
    status: () => (extensionId ? 'connected' : 'disconnected'),
    isConnected: () => extensionId !== null,
    extensionId: () => extensionId,
    lastCopied: () => lastCopied,
    remember(clip) { lastCopied = clip; emit(); },
    request,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      win.addEventListener('message', onMessage);
      ping();
    },
    stop() {
      if (!started) return;
      started = false;
      win.removeEventListener('message', onMessage);
    },
  };

  function emit(): void {
    for (const fn of listeners) fn(self);
  }

  function connect(id: string): void {
    if (extensionId === id) return;
    extensionId = id;
    emit();
  }

  function ping(): void {
    try {
      win.postMessage({ source: EXT_PAGE_SOURCE, type: 'mendcraft-ext-ping', v: EXT_VERSION }, originOf(win) || '/');
    } catch { /* ignore */ }
  }

  function onMessage(ev: MessageEvent): void {
    // Only accept messages from this page (the content script writes with the
    // page's origin). Treat the payload as data.
    if (ev.origin && originOf(win) && ev.origin !== originOf(win)) return;
    const hello = parseExtHello(ev.data);
    if (hello) { connect(hello.extensionId); return; }
    const result = parseExtResult(ev.data);
    if (result) resolvePending(result);
  }

  function resolvePending(result: ExtResult): void {
    const fn = pending.get(result.requestId);
    if (!fn) return;
    pending.delete(result.requestId);
    if (result.ok && result.data && (result.action === 'copyThis' || result.action === 'copyLink' || result.action === 'getLastCopied')) {
      lastCopied = result.data;
    }
    fn(result);
  }

  function sendViaRuntime(id: string, msg: ExtRequest): Promise<unknown> {
    const runtime = win.chrome?.runtime;
    // Declared outbound primitive (see src/core/outbound.ts, kind chrome-extension).
    const sendMessage = runtime?.sendMessage?.bind(runtime);
    if (!sendMessage) return Promise.reject(new Error('no-runtime'));
    return new Promise((resolve, reject) => {
      try {
        sendMessage(id, msg, (response) => {
          const err = runtime?.lastError;
          if (err) reject(new Error(err.message || 'extension-error'));
          else resolve(response);
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error('send-failed'));
      }
    });
  }

  async function request(action: ExtAction, payload?: ExtRequestPayload): Promise<ExtResult> {
    const requestId = newId();
    const msg: ExtRequest = { type: EXT_REQUEST_TYPE, v: EXT_VERSION, requestId, action, payload };
    if (!extensionId) {
      ping();
      return { type: 'mendcraft-ext-result', v: 1, requestId, ok: false, action, error: 'not-connected' };
    }
    // Prefer externally_connectable chrome.runtime.sendMessage; fall back to
    // postMessage through the content script. Replies are parsed as data only.
    try {
      const raw = await sendViaRuntime(extensionId, msg);
      const parsed = parseExtResult(raw) ?? parseExtResult({ ...(isObj(raw) ? raw : {}), type: 'mendcraft-ext-result', v: 1, requestId, action, ok: Boolean((raw as { ok?: boolean } | null)?.ok) });
      if (parsed) {
        if (parsed.ok && parsed.data && (action === 'copyThis' || action === 'copyLink' || action === 'getLastCopied')) {
          lastCopied = parsed.data;
        }
        return parsed;
      }
      return { type: 'mendcraft-ext-result', v: 1, requestId, ok: false, action, error: 'invalid-response' };
    } catch {
      const viaPage = await sendViaPostMessage(msg);
      return viaPage;
    }
  }

  function sendViaPostMessage(msg: ExtRequest): Promise<ExtResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(msg.requestId);
        resolve({ type: 'mendcraft-ext-result', v: 1, requestId: msg.requestId, ok: false, action: msg.action, error: 'timeout' });
      }, 8000);
      pending.set(msg.requestId, (res) => { clearTimeout(timer); resolve(res); });
      try {
        win.postMessage({ source: EXT_PAGE_SOURCE, ...msg }, originOf(win) || '/');
      } catch {
        pending.delete(msg.requestId);
        clearTimeout(timer);
        resolve({ type: 'mendcraft-ext-result', v: 1, requestId: msg.requestId, ok: false, action: msg.action, error: 'post-failed' });
      }
    });
  }

  return self;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export { chromeRuntimePrimitive as _chromeRuntimePrimitive };
// Anchor string for the privacy-drift registry (kind: chrome-extension). The
// live call site is runtime.sendMessage above; this comment plus the real
// call keep the primitive discoverable if the method is renamed later.
const chromeRuntimePrimitive = 'chrome.runtime.sendMessage';
void chromeRuntimePrimitive;
