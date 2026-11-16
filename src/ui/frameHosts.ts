// Hosts known to refuse iframe embedding (X-Frame-Options / CSP frame-ancestors).
// Pure and unit-tested. The reference panel uses this to show the "Open in new
// tab" card immediately instead of sitting on "Loading…" forever. Other sites
// still wait for a load event, then fall back after FRAME_LOAD_TIMEOUT_MS.

export const FRAME_LOAD_TIMEOUT_MS = 4000;

/** Registrable-domain suffixes that refuse to be framed. */
export const FRAME_BLOCKING_HOST_SUFFIXES = [
  'linkedin.com',
  'google.com',
  'spotify.com',
  'instagram.com',
  'facebook.com',
  'fb.com',
  'x.com',
  'twitter.com',
  'whatsapp.com',
  'whatsapp.net',
] as const;

/** google.co.uk / google.de / etc. are not under google.com. */
const GOOGLE_HOST = /(^|\.)google\.(com|ad|ae|al|am|as|at|az|ba|be|bf|bg|bi|bj|bs|bt|by|ca|cd|cf|cg|ch|ci|cl|cm|cn|co\.[a-z]{2}|cz|de|dj|dk|dm|dz|ee|es|fi|fm|fr|ga|ge|gg|gl|gm|gr|gy|hn|hr|ht|hu|ie|im|iq|is|it|je|jo|kg|ki|kz|la|li|lk|lt|lu|lv|md|me|mg|mk|ml|mn|ms|mu|mv|mw|ne|nl|no|nr|nu|pl|pn|ps|pt|ro|rs|ru|rw|sc|se|sh|si|sk|sm|sn|so|sr|st|td|tg|tk|tl|tm|tn|to|tt|vu|ws|ir|rs)$/i;

export type FrameFallback = 'immediate' | 'wait-load';

function hostnameOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function isGithubLogin(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'github.com' && !host.endsWith('.github.com')) return false;
    const path = u.pathname.toLowerCase();
    return path === '/login' || path.startsWith('/login/') || path.startsWith('/session') || path.startsWith('/sessions');
  } catch {
    return false;
  }
}

/** True when this URL is on a host (or GitHub login path) known to block framing. */
export function hostBlocksFraming(url: string): boolean {
  if (isGithubLogin(url)) return true;
  const host = hostnameOf(url);
  if (!host) return false;
  if (GOOGLE_HOST.test(host)) return true;
  return FRAME_BLOCKING_HOST_SUFFIXES.some((s) => hostMatchesSuffix(host, s));
}

/** How the reference panel should treat this URL. */
export function frameFallbackPolicy(url: string): FrameFallback {
  return hostBlocksFraming(url) ? 'immediate' : 'wait-load';
}
