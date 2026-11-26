// Did a Gemini request really leave? The Firebase AI SDK gives no signal for
// "the fetch was issued", so while a cloud call is running this module wraps
// globalThis.fetch and watches for requests to the Gemini endpoint that carry
// that call's prompt. A request counts when the fetch function is called for it; it is
// taken back if that fetch fails without any response (the network never
// delivered it). When the last watcher stops, the original fetch is restored.
//
// This module issues no request of its own (it calls the original function
// it wrapped, with the caller's arguments).
// Nothing is read except the URL's host and whether the body contains the
// start of the prompt this call is sending. Nothing is changed: the request
// and its response pass through untouched.

/** Hosts that serve Firebase AI Logic's Gemini calls. */
const GEMINI_HOSTS = /(^|\.)firebasevertexai\.googleapis\.com$|(^|\.)generativelanguage\.googleapis\.com$|(^|\.)firebaseml\.googleapis\.com$/;

export function isGeminiRequestUrl(url: string): boolean {
  try { return GEMINI_HOSTS.test(new URL(url, 'https://x.invalid').hostname); } catch { return false; }
}

interface Watcher {
  /** The whole JSON-escaped prompt this call sends. */
  key: string;
  onIssued: () => void;
  onUndelivered: () => void;
}

type FetchFn = typeof fetch;
const watchers = new Set<Watcher>();
let original: FetchFn | null = null;
let wrapper: FetchFn | null = null;

const urlOf = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const o = input as { href?: unknown; url?: unknown };
    if (typeof o.href === 'string') return o.href;
    if (typeof o.url === 'string') return o.url;
  }
  return String(input ?? '');
};

function install(): boolean {
  const g = globalThis as { fetch?: FetchFn };
  if (wrapper && g.fetch === wrapper) return true;
  if (typeof g.fetch !== 'function') return false;
  const real = g.fetch;
  original = real;
  wrapper = function watchedFetch(this: unknown, input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) {
    let mine: Watcher[] = [];
    try {
      if (isGeminiRequestUrl(urlOf(input))) {
        const body = typeof init?.body === 'string' ? init.body : null;
        // A body we can read is matched on the WHOLE prompt (board prompts
        // share a long opening, so a prefix would book one turn's request to
        // every turn in flight). One we cannot read can only be attributed
        // when a single call is running; otherwise it is nobody's.
        mine = body != null ? [...watchers].filter((w) => body.includes(w.key)) : watchers.size === 1 ? [...watchers] : [];
        for (const w of mine) { try { w.onIssued(); } catch { /* bookkeeping only */ } }
      }
    } catch { mine = []; }
    const result = real.call(globalThis, input, init);
    if (mine.length) {
      result.catch((e: unknown) => {
        // A stopped request (our own timeout, a cancelled hedge) was issued
        // and may well have arrived. Any other rejection means no response
        // at all: the network never delivered it.
        if (e instanceof Error && e.name === 'AbortError') return;
        for (const w of mine) { try { w.onUndelivered(); } catch { /* bookkeeping only */ } }
      });
    }
    return result;
  } as FetchFn;
  g.fetch = wrapper;
  return true;
}

function uninstall(): void {
  const g = globalThis as { fetch?: FetchFn };
  // Only put the original back if nobody wrapped fetch after us.
  if (wrapper && original && g.fetch === wrapper) g.fetch = original;
  wrapper = null;
  original = null;
}

/** What identifies a call's request body: its whole prompt, JSON-escaped as
 *  the SDK serialises it. */
export function promptKey(prompt: string): string {
  return JSON.stringify(prompt).slice(1, -1);
}

export interface CloudFetchWatch {
  /** The global fetch could be watched (false: there is none in this environment). */
  readonly active: boolean;
  /** Requests issued and not taken back. */
  delivered(): number;
  /** Requests that were issued at all. */
  issued(): number;
  stop(): void;
}

/** Watch Gemini requests carrying `prompt` until stop(). */
export function watchCloudFetch(prompt: string, hooks: { onIssued?: () => void; onUndelivered?: () => void } = {}): CloudFetchWatch {
  let issued = 0;
  let undelivered = 0;
  const w: Watcher = {
    key: promptKey(prompt),
    onIssued: () => { issued++; hooks.onIssued?.(); },
    onUndelivered: () => { undelivered++; hooks.onUndelivered?.(); },
  };
  const active = install();
  if (active) watchers.add(w);
  return {
    active,
    issued: () => issued,
    delivered: () => issued - undelivered,
    stop() {
      // Stay for late outcomes of requests already issued (a hedge that loses
      // still counts); only stop matching NEW requests.
      watchers.delete(w);
      if (!watchers.size) uninstall();
    },
  };
}

/** Test seam: is fetch currently wrapped? */
export const cloudFetchWatched = (): boolean => !!wrapper && (globalThis as { fetch?: FetchFn }).fetch === wrapper;
