// "WHAT LEFT THIS DEVICE" LEDGER — the honest accounting layer behind the badge.
//
// Every AI result in this app resolves to one of three sources: `cloud` (a round
// trip to Firebase AI Logic), `on-device` (Gemini Nano, nothing left the
// browser), or `rules` (the deterministic parser, no AI at all). This module is
// the single source of truth for WHAT that means in privacy terms:
//
//   - a `cloud` event is RECORDED in full: the abstract payload that was sent
//     (design ops + text only), its byte size, and the reason it was routed out;
//   - an `on-device`/`rules` event is COUNTED but never stored — it is a private
//     event, nothing to show because nothing left the machine.
//
// It is PURE (no DOM, no network, no Firebase): redact(), byteSize(), and the
// ledger reducer are all unit-tested without a browser. The camera, face, hand
// landmarks and voice audio are NEVER passed here — but redact() is a defensive
// backstop that scrubs any device-only signal that somehow reached a payload, so
// a future bug surfaces as a visible "[redacted]" in the ledger instead of a
// silent upload.

export type LedgerSource = 'cloud' | 'on-device' | 'rules';

/** A single cloud round trip — the only kind of event that leaves the device. */
export interface CloudCall {
  /** Monotonic id (1-based), for stable keys/ordering in the UI. */
  id: number;
  /** Which AI job sent it: 'fuse', 'generate', 'verify', 'a11y-explain', … */
  job: string;
  /** Human-readable routing reason, e.g. "big job", "low confidence". */
  reason: string;
  /** The redacted payload text that was sent (abstract ops + command text). */
  sent: string;
  /** UTF-8 byte size of the redacted payload. */
  bytes: number;
  /** How many device-only signals redact() scrubbed (normally 0). */
  redactions: number;
  /** Round-trip latency in ms, when known. */
  ms?: number;
}

/** Running tallies shown next to the ledger. */
export interface LedgerCounts {
  /** Cloud round trips (things that left the device). */
  cloud: number;
  /** On-device (Nano) inferences — private, nothing uploaded. */
  onDevice: number;
  /** Deterministic rule answers — private, no AI. */
  rules: number;
  /** Private events total (on-device + rules): the count that stayed local. */
  private: number;
  /** Total bytes that left the device across all cloud calls. */
  bytesSent: number;
}

/** One recorded event before the ledger assigns it an id. */
export interface LedgerInput {
  source: LedgerSource;
  job: string;
  reason?: string;
  /** Raw payload for a cloud call (ignored for private events). */
  sent?: string;
  ms?: number;
}

// ---------------------------------------------------------------------------
// Size + redaction (pure helpers, exported for direct testing).

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/** UTF-8 byte length of a string (so multi-byte text is sized honestly, not by
 *  character count). Falls back to a manual code-point sum if TextEncoder is
 *  somehow absent. */
export function byteSize(text: string): number {
  if (encoder) return encoder.encode(text).length;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; } // surrogate pair
    else bytes += 3;
  }
  return bytes;
}

/** Human byte label: "128 B", "1.4 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Device-only signals that must NEVER leave the browser. If any slips into a
 *  cloud payload (a future regression), redact() replaces it with a visible tag
 *  so the ledger shows the breach instead of silently transmitting it. */
const REDACTIONS: { re: RegExp; tag: string }[] = [
  // base64 image/audio/video blobs (a camera frame or captured audio clip)
  { re: /data:(image|audio|video)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, tag: '[media removed]' },
  // long runs of comma-separated decimals: hand/face landmark vectors
  { re: /(?:-?\d+\.\d+\s*,\s*){7,}-?\d+\.\d+/g, tag: '[landmarks removed]' },
];

export interface RedactResult {
  text: string;
  /** How many substitutions were made (0 for a clean abstract payload). */
  count: number;
}

/** Scrub any device-only signal from a payload bound for the cloud. Pure: given
 *  the same input it returns the same redacted text + substitution count. */
export function redact(raw: string): RedactResult {
  let text = raw;
  let count = 0;
  for (const { re, tag } of REDACTIONS) {
    text = text.replace(re, () => { count++; return tag; });
  }
  return { text, count };
}

// ---------------------------------------------------------------------------
// The ledger reducer.

export interface Ledger {
  /** Record one event. Cloud events are stored; private events are counted. */
  record(input: LedgerInput): void;
  /** Cloud calls, oldest first. */
  calls(): CloudCall[];
  /** Live tallies. */
  counts(): LedgerCounts;
  /** Forget everything (keeps subscribers). */
  clear(): void;
  /** Observe changes (fires after every record/clear). Returns unsubscribe. */
  subscribe(fn: (ledger: Ledger) => void): () => void;
}

export function createLedger(): Ledger {
  const calls: CloudCall[] = [];
  let onDevice = 0;
  let rules = 0;
  let bytesSent = 0;
  let nextId = 1;
  const listeners = new Set<(l: Ledger) => void>();

  const self: Ledger = {
    record(input) {
      if (input.source === 'cloud') {
        const { text, count } = redact(input.sent ?? '');
        const bytes = byteSize(text);
        bytesSent += bytes;
        calls.push({
          id: nextId++,
          job: input.job,
          reason: input.reason ?? '',
          sent: text,
          bytes,
          redactions: count,
          ms: input.ms,
        });
      } else if (input.source === 'on-device') {
        onDevice++;
      } else {
        rules++;
      }
      emit();
    },
    calls: () => calls.slice(),
    counts: () => ({
      cloud: calls.length,
      onDevice,
      rules,
      private: onDevice + rules,
      bytesSent,
    }),
    clear() {
      calls.length = 0;
      onDevice = 0;
      rules = 0;
      bytesSent = 0;
      nextId = 1;
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  function emit(): void {
    for (const fn of listeners) fn(self);
  }

  return self;
}
