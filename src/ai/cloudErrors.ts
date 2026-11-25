// Why a Gemini (cloud) call failed, in words she can act on. The Firebase SDK
// reports failures as long technical strings; the canvas shows one plain line
// instead — and never a prepared draft in the model's place.

export type CloudBlock =
  | 'app-check-403'
  | 'app-check'
  | 'not-set-up'
  | 'offline'
  | 'forbidden'
  | 'quota'
  | 'busy'
  | 'timeout'
  | 'safety'
  | 'bad-reply'
  | 'unknown';

export const GEMINI_NOT_SET_UP = 'Gemini isn’t set up in this build (no Firebase config)';
export const APP_CHECK_403_LINE = 'Gemini blocked: App Check 403 (this address isn’t registered)';
/** What to do about it — shown once under the line, and in the docs. */
export const APP_CHECK_403_HINT =
  'Register this browser’s debug token in Firebase console → App Check → Apps → Manage debug tokens (see docs/app-check-local-dev.md).';

export interface CloudFailure {
  kind: CloudBlock;
  line: string;
  hint?: string;
  /** The failure happened BEFORE the request to Gemini was issued (no App
   *  Check token could be had, or there is no cloud model at all), so no
   *  prompt left this device. False whenever a request may have gone out —
   *  including a 403 from the Gemini endpoint itself. */
  nothingSent: boolean;
}

const text = (e: unknown): string => (e instanceof Error ? `${e.name} ${e.message}` : String(e ?? ''));

/** The App Check SDK failing to GET a token (its errors are prefixed
 *  "AppCheck:" and carry an `appCheck/…` code). With limited-use tokens the
 *  AI SDK then throws before it fetches, so the prompt never leaves. This is
 *  not the same as the Gemini endpoint answering 403 to a request it got. */
const TOKEN_FAILURE = /AppCheck:|appCheck\/[a-z-]+|app-check\/[a-z-]+/;

export function classifyCloudBlock(err: unknown): CloudBlock {
  const blob = text(err);
  if (TOKEN_FAILURE.test(blob)) {
    if (/\b403\b|forbidden|permission[_ -]?denied/i.test(blob)) return 'app-check-403';
    // App Check itself couldn't be contacted: that is the network, not a refusal.
    if (/fetch-network-error|failed to connect|failed to fetch|network/i.test(blob)) return 'offline';
    return 'app-check';
  }
  if (/no firebase config|isn.t set up|not configured/i.test(blob)) return 'not-set-up';
  if (/\b429\b|resource.?exhausted|rate.?limit|quota/i.test(blob)) return 'quota';
  if (/\b(500|502|503)\b|high.?demand|overloaded|service unavailable/i.test(blob)) return 'busy';
  // The endpoint itself said no (it received the request).
  if (/\b(401|403)\b|permission[_ -]?denied|forbidden|unauthenticated|app check token/i.test(blob)) return 'forbidden';
  if (/timed out|timeout/i.test(blob)) return 'timeout';
  if (/failed to fetch|network\s?error|err_internet|offline|load failed/i.test(blob)) return 'offline';
  if (/safety|blocked by|block.?reason/i.test(blob)) return 'safety';
  if (/\bparse\b|\bempty\b|not a board plan/i.test(blob)) return 'bad-reply';
  return 'unknown';
}

/** One honest line for a failed Gemini call. `detail` (trimmed) is kept on
 *  the unknown case only, so nothing technical is lost when we can't name it. */
export function explainCloudFailure(err: unknown): CloudFailure {
  const kind = classifyCloudBlock(err);
  // Only a token failure or a missing cloud model is certain to be pre-fetch.
  const tokenFailure = TOKEN_FAILURE.test(text(err));
  switch (kind) {
    case 'app-check-403': return { kind, line: APP_CHECK_403_LINE, hint: APP_CHECK_403_HINT, nothingSent: true };
    case 'app-check': return { kind, line: 'Gemini blocked: App Check didn’t pass on this address', hint: APP_CHECK_403_HINT, nothingSent: true };
    case 'not-set-up': return { kind, line: GEMINI_NOT_SET_UP, nothingSent: true };
    case 'offline': return { kind, line: 'Gemini couldn’t be reached: no connection', nothingSent: tokenFailure };
    case 'forbidden': return { kind, line: 'Gemini refused the request (403)', nothingSent: false };
    case 'quota': return { kind, line: 'Gemini couldn’t answer: the quota is used up (429)', nothingSent: false };
    case 'busy': return { kind, line: 'Gemini couldn’t answer: the service is busy (5xx)', nothingSent: false };
    case 'timeout': return { kind, line: 'Gemini didn’t answer in time', nothingSent: false };
    case 'safety': return { kind, line: 'Gemini refused this request (safety filter)', nothingSent: false };
    case 'bad-reply': return { kind, line: 'Gemini’s reply was not a board plan', nothingSent: false };
    default: {
      const detail = text(err).replace(/^Error\s+/, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return { kind, line: detail ? `Gemini couldn’t be reached: ${detail}` : 'Gemini couldn’t be reached', nothingSent: false };
    }
  }
}

/** A cloud failure that already carries its plain line (thrown by the cloud
 *  seam so every caller shows the same words). */
export class CloudCallError extends Error {
  readonly kind: CloudBlock;
  readonly hint?: string;
  /** Certain that no request reached Gemini (see CloudFailure.nothingSent). */
  readonly nothingSent: boolean;
  constructor(f: CloudFailure) {
    super(f.line);
    this.name = 'CloudCallError';
    this.kind = f.kind;
    this.hint = f.hint;
    this.nothingSent = f.nothingSent;
  }
}

/** Turn whatever the cloud seam knows into a CloudCallError. When the SDK's
 *  own message doesn't say why, ask App Check directly (`probeAppCheck`
 *  resolves with the token error, or null when a token was issued). */
export async function cloudCallError(
  lastError: unknown,
  probeAppCheck?: () => Promise<unknown | null>,
): Promise<CloudCallError> {
  let f = explainCloudFailure(lastError);
  if (probeAppCheck && f.kind === 'unknown') {
    try {
      const tokenError = await probeAppCheck();
      if (tokenError) {
        const viaProbe = explainCloudFailure(`AppCheck: ${text(tokenError)}`);
        // The probe names the likely cause; it cannot prove the failed call
        // never left, so it makes no "nothing was sent" claim.
        if (viaProbe.kind === 'app-check-403' || viaProbe.kind === 'app-check') f = { ...viaProbe, nothingSent: false };
      }
    } catch { /* the probe is a best effort */ }
  }
  return new CloudCallError(f);
}
