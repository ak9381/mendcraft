// Chrome's Local Network Access: a page may be blocked from reaching the
// local WiZ bridge (localhost / the LAN). When Chrome says so, we say so in
// one plain line — never a silent fall back to simulated lamps.
export const LNA_BLOCKED_LINE = 'Chrome is blocking local network access for this page — allow it in Site settings to control your lamp.';
export const BULB_UNREACHABLE_LINE = 'I see a smart bulb, but I can’t reach it yet';

/** The permission names Chrome has used for it (newer first). */
const LNA_PERMISSIONS = ['local-network-access', 'loopback-network'] as const;

interface PermissionsLike {
  query(d: { name: string }): Promise<{ state: string }>;
}

/** True when Chrome reports local network access as 'denied' for this page.
 *  An unknown permission name (other browsers) throws: that is "not blocked". */
export async function localNetworkBlocked(perms: PermissionsLike | null | undefined = typeof navigator !== 'undefined' ? (navigator.permissions as unknown as PermissionsLike) : null): Promise<boolean> {
  if (!perms?.query) return false;
  for (const name of LNA_PERMISSIONS) {
    try {
      const s = await perms.query({ name });
      if (s?.state === 'denied') return true;
    } catch { /* not a permission this browser knows */ }
  }
  return false;
}

/** Ask once per page; the answer is reused (and the line logged once). */
export function createLocalNetworkCheck(perms?: PermissionsLike | null, log: (line: string) => void = (l) => console.warn(l)) {
  let answer: Promise<boolean> | null = null;
  let logged = false;
  return {
    blocked(): Promise<boolean> {
      answer ??= localNetworkBlocked(perms === undefined ? undefined : perms).catch(() => false);
      return answer;
    },
    /** The line to show when blocked ('' when not), logged the first time. */
    async line(): Promise<string> {
      if (!(await this.blocked())) return '';
      if (!logged) { logged = true; log(LNA_BLOCKED_LINE); }
      return LNA_BLOCKED_LINE;
    },
  };
}
