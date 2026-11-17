// Tolerant JSON extraction, failure classification, and retry policy for
// Gemini structured-output (application/json) calls. Pure — no Firebase.

export type CloudFailKind = 'empty' | 'safety' | 'parse' | '429' | 'timeout' | 'other';

const FENCE_RE = /```(?:json)?/gi;
const TRAILING_COMMA_RE = /,\s*(?=[}\]])/g;
const SMART_QUOTES_RE = /[\u2018\u2019\u201A\u201B]/g;
const SMART_DOUBLE_RE = /[\u201C\u201D\u201E\u201F]/g;

/** Pull the first balanced `{...}` or `[...]` object out of a model string. */
function firstBalanced(text: string): string | null {
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  let start = -1;
  let open = '{';
  let close = '}';
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
    start = startObj;
  } else if (startArr >= 0) {
    start = startArr;
    open = '[';
    close = ']';
  }
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Truncated: close what we can and let JSON.parse / repair try.
  return text.slice(start) + close.repeat(depth);
}

/** Light repairs for almost-JSON that models sometimes emit. */
export function repairJson(text: string): string {
  return text
    .replace(SMART_QUOTES_RE, "'")
    .replace(SMART_DOUBLE_RE, '"')
    .replace(TRAILING_COMMA_RE, '');
}

/**
 * Parse a model string into JSON. Strips fences, takes the first balanced
 * object, and repairs trailing commas / smart quotes. Returns null on failure.
 */
export function extractJson(text: string): unknown {
  if (typeof text !== 'string' || !text.trim()) return null;
  const stripped = text.replace(FENCE_RE, '').trim();
  const candidates = [stripped, firstBalanced(stripped)].filter((s): s is string => !!s);
  for (const raw of candidates) {
    for (const variant of [raw, repairJson(raw)]) {
      try {
        return JSON.parse(variant);
      } catch {
        /* try the next variant */
      }
    }
  }
  return null;
}

function blobOf(err: unknown, text = ''): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const extra = err && typeof err === 'object' ? JSON.stringify(err).slice(0, 500) : '';
  return `${msg} ${extra} ${text}`.toLowerCase();
}

/** Classify a failed cloud generate: empty, safety block, parse error, 429, timeout, or other. */
export function classifyCloudFailure(err: unknown, text = ''): CloudFailKind {
  const blob = blobOf(err, text);
  if (/timed out after|timeout/i.test(blob) && /ms|timeout/.test(blob)) return 'timeout';
  if (/\b429\b|resource.?exhausted|rate.?limit|quota.?exceeded|too many requests|retry-after/.test(blob)) return '429';
  if (/block.?reason|safety|blocked|finishreason["']?\s*[:=]\s*["']?safety|prohibited|harm.?categor/.test(blob)) {
    return 'safety';
  }
  if (!text.trim() && !err) return 'empty';
  if (err && !text.trim() && !/json|parse|syntax/i.test(blob)) return 'other';
  if (!text.trim()) return 'empty';
  return 'parse';
}

export interface SafeTextResult {
  text: string;
  failKind: CloudFailKind | null;
}

type LooseResponse = {
  text?: () => string;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
};

/** Read response text without throwing on a safety block. */
export function safeResponseText(response: LooseResponse | null | undefined): SafeTextResult {
  if (!response) return { text: '', failKind: 'empty' };
  const block = response.promptFeedback?.blockReason;
  if (block) {
    return { text: '', failKind: 'safety' };
  }
  const finish = response.candidates?.[0]?.finishReason;
  if (finish && /safety|blocklist|prohibited|recitation/i.test(finish)) {
    return { text: '', failKind: 'safety' };
  }
  try {
    const text = typeof response.text === 'function' ? response.text() : '';
    if (typeof text === 'string' && text.trim()) return { text, failKind: null };
  } catch (err) {
    const kind = classifyCloudFailure(err);
    return { text: '', failKind: kind === 'other' ? 'safety' : kind };
  }
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const visible = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text!).join('');
  if (visible.trim()) return { text: visible, failKind: null };
  return { text: '', failKind: 'empty' };
}

export const RATE_LIMIT_BACKOFF_MS = [1000, 2000] as const;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
