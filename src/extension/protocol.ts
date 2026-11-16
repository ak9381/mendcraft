// Shared message shapes between the web app and the Chrome extension.
// Responses are treated as DATA ONLY: parseExtResult validates a plain object
// and never evaluates it.

import type { ExtAction, ExtRequestPayload } from './intents';
import type { SensitiveReason } from './fieldGuard';

export const EXT_REQUEST_TYPE = 'mendcraft-ext';
export const EXT_RESULT_TYPE = 'mendcraft-ext-result';
export const EXT_HELLO_TYPE = 'mendcraft-ext-hello';
export const EXT_PAGE_SOURCE = 'mendcraft-page';
export const EXT_SOURCE = 'mendcraft-extension';
export const EXT_VERSION = 1 as const;

export const EXT_ACTIONS: readonly ExtAction[] = [
  'copyThis', 'copyLink', 'pasteHere', 'switchTab', 'openTab', 'getStatus', 'getLastCopied', 'openRefs', 'refsCommand', 'closeRefs',
];

export interface ExtRequest {
  type: typeof EXT_REQUEST_TYPE;
  v: typeof EXT_VERSION;
  requestId: string;
  action: ExtAction;
  payload?: ExtRequestPayload;
}

export interface ExtClip {
  kind: 'text' | 'link' | 'image';
  text?: string;
  url?: string;
  title?: string;
  tabId?: number;
  fieldLabel?: string;
  skipped?: SensitiveReason;
}

export interface ExtResult {
  type: typeof EXT_RESULT_TYPE;
  v: typeof EXT_VERSION;
  requestId: string;
  ok: boolean;
  action: ExtAction;
  data?: ExtClip;
  error?: string;
}

const ALLOWED_DATA_KEYS = new Set(['kind', 'text', 'url', 'title', 'tabId', 'fieldLabel', 'skipped']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAction(v: unknown): v is ExtAction {
  return typeof v === 'string' && (EXT_ACTIONS as readonly string[]).includes(v);
}

function asString(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.slice(0, max);
}

/** Validate an untrusted extension reply. Returns null if it is not safe data. */
export function parseExtResult(raw: unknown): ExtResult | null {
  if (!isPlainObject(raw)) return null;
  if (raw.type !== EXT_RESULT_TYPE) return null;
  if (raw.v !== EXT_VERSION) return null;
  if (typeof raw.requestId !== 'string' || raw.requestId.length === 0 || raw.requestId.length > 80) return null;
  if (typeof raw.ok !== 'boolean') return null;
  if (!isAction(raw.action)) return null;
  // Reject any function / unexpected prototype hook in the payload.
  for (const key of Object.keys(raw)) {
    if (typeof raw[key] === 'function') return null;
  }
  let data: ExtClip | undefined;
  if (raw.data !== undefined) {
    if (!isPlainObject(raw.data)) return null;
    for (const key of Object.keys(raw.data)) {
      if (!ALLOWED_DATA_KEYS.has(key) || typeof raw.data[key] === 'function') return null;
    }
    const kind = raw.data.kind;
    if (kind !== undefined && kind !== 'text' && kind !== 'link' && kind !== 'image') return null;
    const skipped = raw.data.skipped;
    if (skipped !== undefined && skipped !== 'password' && skipped !== 'payment') return null;
    const tabId = raw.data.tabId;
    if (tabId !== undefined && (typeof tabId !== 'number' || !Number.isFinite(tabId))) return null;
    data = {
      kind: kind === 'link' ? 'link' : kind === 'image' ? 'image' : 'text',
      text: asString(raw.data.text, 20_000),
      url: asString(raw.data.url, 2000),
      title: asString(raw.data.title, 300),
      tabId: typeof tabId === 'number' ? tabId : undefined,
      fieldLabel: asString(raw.data.fieldLabel, 200),
      skipped: skipped === 'password' || skipped === 'payment' ? skipped : undefined,
    };
  }
  const error = asString(raw.error, 300);
  return { type: EXT_RESULT_TYPE, v: EXT_VERSION, requestId: raw.requestId, ok: raw.ok, action: raw.action, data, error };
}

export function parseExtHello(raw: unknown): { extensionId: string } | null {
  if (!isPlainObject(raw)) return null;
  if (raw.source !== EXT_SOURCE || raw.type !== EXT_HELLO_TYPE || raw.v !== EXT_VERSION) return null;
  if (typeof raw.extensionId !== 'string' || raw.extensionId.length < 8 || raw.extensionId.length > 80) return null;
  if (!/^[a-z]{16,80}$/.test(raw.extensionId)) return null;
  return { extensionId: raw.extensionId };
}
