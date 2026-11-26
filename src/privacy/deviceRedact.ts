// Session-scoped device-id privacy: before any device id reaches the Gemini
// cloud, Nano swaps it for a stable "Device N" placeholder (first-seen order
// within this session) — a second, independent redaction from the person
// directory's (see directory.ts), since a device id is never a person's
// name. Session-only: a fresh session (page reload) starts renumbering at
// Device 1, unlike the directory's tokens, which persist in IndexedDB.

export interface DeviceIdSession {
  /** The stable "Device N" placeholder for `id`, assigning the next number
   *  the first time this id is seen. */
  tokenFor(id: string): string;
  /** The real device id a placeholder stood for, or null if this session
   *  never assigned it (e.g. it came from a different session). */
  idFor(token: string): string | null;
}

export function createDeviceIdSession(): DeviceIdSession {
  const idToToken = new Map<string, string>();
  const tokenToId = new Map<string, string>();
  return {
    tokenFor(id) {
      let token = idToToken.get(id);
      if (!token) {
        token = `Device ${idToToken.size + 1}`;
        idToToken.set(id, token);
        tokenToId.set(token, id);
      }
      return token;
    },
    idFor(token) {
      return tokenToId.get(token) ?? null;
    },
  };
}

/** Swap every occurrence of a known real device id in `text` for its session
 *  token. Placeholders are assigned in `ids`' own order (so "Device 1",
 *  "Device 2"... reads the same as the device list), but the actual
 *  substring replacement runs longest-id-first so e.g. "lamp-1" never
 *  gets clipped by "lamp-10" matching first. Plain substring replace —
 *  ids are simple lowercase slugs (see surfacePlan.ts's ID_RE), never
 *  regex-special. An id absent from `text` is left unassigned. */
export function redactDeviceIds(text: string, ids: readonly string[], session: DeviceIdSession): string {
  let out = text;
  const present = ids.filter((id) => id && out.includes(id));
  present.forEach((id) => session.tokenFor(id));
  for (const id of [...present].sort((a, b) => b.length - a.length)) {
    out = out.split(id).join(session.tokenFor(id));
  }
  return out;
}

/** Put real device ids back wherever a reply used their "Device N" token —
 *  the reply-side mirror of redactDeviceIds, so a plan Gemini drafted still
 *  binds to the real device once it's applied locally. */
export function restoreDeviceIds(text: string, session: DeviceIdSession): string {
  return text.replace(/\bDevice (\d+)\b/g, (whole, n: string) => session.idFor(`Device ${n}`) ?? whole);
}
