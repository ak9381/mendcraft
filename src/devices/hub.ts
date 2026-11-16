// CONNECT ANYTHING HUB (pure, storage- and API-injectable).
//
// The demo starts almost empty: a CAD canvas and "Add a device". Everything
// she can connect shows up here as a card:
//
//   ready      prebuilt connectors that ship with Mendcraft: this browser
//              (camera, mic, hands), the iPad control room, an Android phone
//              remote, and the DockKit gimbal (iOS app).
//   saved      connectors Gemini wrote earlier, kept on this device as DATA
//              (connectorCache.ts), so they work again with no internet.
//   speakers   speakers that have no local API (Marshall, Bose, JBL...) are
//              reached through Spotify Connect, i.e. her own Spotify account
//              playing on the speaker from her phone.
//
// Nothing here talks to a device directly. main.ts asks her to pinch-confirm
// before any connect, and the add-device flow does the LAN part.

import type { Connector } from './connector';
import type { PairedDevice } from './connectorCache';
import type { SpotifyDevice } from '../music/spotifyApi';

export type LinkId = 'browser' | 'ipad' | 'android' | 'gimbal';
export type CardState = 'connected' | 'ready' | 'needs';

export interface PrebuiltLink {
  id: LinkId;
  name: string;
  what: string;
  action: string;
}

export const PREBUILT_LINKS: readonly PrebuiltLink[] = [
  { id: 'browser', name: 'This browser', what: 'Camera, mic and hand tracking on this computer.', action: 'Turn on camera' },
  { id: 'ipad', name: 'iPad control room', what: 'Live view of the plan, changes and site checklist.', action: 'Show iPad link' },
  { id: 'android', name: 'Android phone', what: 'A remote and a second camera. Scan a code to join.', action: 'Show phone code' },
  { id: 'gimbal', name: 'Gimbal', what: 'A DockKit stand that follows your hands (iPhone app).', action: 'How to connect' },
];

export interface HubEnv {
  camera: boolean;
  /** The pairing room, if one is open, and whether a phone has joined it. */
  room: { token: string; phone: boolean } | null;
  iosApp: boolean;
  gimbal: boolean;
  online: boolean;
}

export interface HubCard {
  id: string;
  group: 'ready' | 'saved' | 'speaker';
  name: string;
  detail: string;
  state: CardState;
  action?: string;
  offline: boolean;
}

export function linkCard(link: PrebuiltLink, env: HubEnv): HubCard {
  const base = { id: link.id, group: 'ready' as const, name: link.name, action: link.action };
  switch (link.id) {
    case 'browser':
      return { ...base, detail: env.camera ? 'Camera and hands are on.' : link.what, state: env.camera ? 'connected' : 'ready', offline: true, ...(env.camera ? { action: undefined } : {}) };
    case 'ipad':
      return {
        ...base,
        detail: !env.online ? 'Needs internet to join the room.' : env.room ? 'Room is open. Open the link on the iPad.' : link.what,
        state: env.online ? 'ready' : 'needs',
        offline: false,
      };
    case 'android': {
      const joined = env.room?.phone === true;
      return {
        ...base,
        detail: joined ? 'Phone joined your room.' : env.online ? link.what : 'Needs internet to join the room.',
        state: joined ? 'connected' : env.online ? 'ready' : 'needs',
        offline: false,
        ...(joined ? { action: undefined } : {}),
      };
    }
    case 'gimbal':
      return {
        ...base,
        detail: env.gimbal ? 'Docked and following your hands.' : env.iosApp ? 'Dock the iPhone on the stand.' : 'Open Mendcraft on an iPhone with a DockKit stand.',
        state: env.gimbal ? 'connected' : env.iosApp ? 'ready' : 'needs',
        offline: true,
      };
  }
}

export function controlUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/control?room=${encodeURIComponent(token)}`;
}

// ---- speakers via Spotify Connect ------------------------------------------

/** Speaker brands with no public local API: reach them through Spotify Connect. */
export const SPOTIFY_CONNECT_BRANDS: readonly string[] = ['marshall', 'bose', 'jbl', 'sonos', 'bang & olufsen', 'b&o', 'harman', 'ultimate ears', 'sony'];

export function usesSpotifyConnect(kind: string, brand: string): boolean {
  if (kind !== 'speaker') return false;
  const b = brand.trim().toLowerCase();
  return !b || SPOTIFY_CONNECT_BRANDS.some((x) => b.includes(x));
}

/** Pick the Spotify device that is her speaker: the brand in its name first,
 *  then any device Spotify calls a speaker. Never a computer or phone. */
export function findSpeaker(devices: readonly SpotifyDevice[], brand: string): SpotifyDevice | null {
  const b = brand.trim().toLowerCase();
  if (b) {
    const named = devices.find((d) => d.name.toLowerCase().includes(b));
    if (named) return named;
  }
  return devices.find((d) => /speaker|avr|audio_dongle|cast_audio/i.test(d.type)) ?? null;
}

export interface SpeakerLink {
  key: string;
  brand: string;
  deviceName: string;
  addedAt: number;
}

export const SPEAKERS_KEY = 'mendcraft.speakers';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStore = (): Store | null => (typeof localStorage !== 'undefined' ? localStorage : null);

export function loadSpeakers(store: Store | null = defaultStore()): SpeakerLink[] {
  try {
    const raw = JSON.parse(store?.getItem(SPEAKERS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is SpeakerLink => !!s && typeof s === 'object'
      && typeof s.key === 'string' && typeof s.brand === 'string' && typeof s.deviceName === 'string' && typeof s.addedAt === 'number')
      .map((s) => ({ key: s.key.slice(0, 60), brand: s.brand.slice(0, 40), deviceName: s.deviceName.slice(0, 60), addedAt: s.addedAt }))
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function saveSpeaker(s: SpeakerLink, store: Store | null = defaultStore()): SpeakerLink[] {
  const list = [s, ...loadSpeakers(store).filter((x) => x.key !== s.key)].slice(0, 20);
  try { store?.setItem(SPEAKERS_KEY, JSON.stringify(list)); } catch { /* quota */ }
  return list;
}

export interface SpeakerApi {
  connected(): boolean;
  listDevices(): Promise<SpotifyDevice[]>;
  transferPlayback(deviceId: string): Promise<void>;
}

export type SpeakerResult =
  | { ok: true; link: SpeakerLink; device: SpotifyDevice }
  | { ok: false; reason: 'spotify' | 'not-found' | 'declined' | 'error'; detail: string };

/** Connect a speaker through Spotify Connect. `confirm` is her pinch; nothing
 *  plays on the speaker until she says yes. */
export async function connectSpeaker(
  brand: string,
  api: SpeakerApi,
  confirm: (deviceName: string) => Promise<boolean>,
  now: () => number = Date.now,
): Promise<SpeakerResult> {
  if (!api.connected()) return { ok: false, reason: 'spotify', detail: 'Connect Spotify first (Music > Connect). The speaker is reached through your Spotify account.' };
  let devices: SpotifyDevice[];
  try { devices = await api.listDevices(); } catch (e) { return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : 'Spotify did not answer.' }; }
  const d = findSpeaker(devices, brand);
  if (!d) {
    return { ok: false, reason: 'not-found', detail: `I can't see a ${brand || 'speaker'} in Spotify. Open Spotify on your phone, tap the speaker icon and pick it once, then try again.` };
  }
  if (!(await confirm(d.name))) return { ok: false, reason: 'declined', detail: 'Okay, not connected.' };
  try { await api.transferPlayback(d.id); } catch (e) { return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : 'Spotify could not switch to the speaker.' }; }
  const link: SpeakerLink = { key: `spotify|${(brand || d.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`, brand: brand || d.name, deviceName: d.name, addedAt: now() };
  return { ok: true, link, device: d };
}

/** "connect the Marshall speaker" / "add my Bose" / "play on the JBL" →
 *  the brand; "add the speaker" → ''. Null when it isn't about a speaker. */
export function speakerRequest(utterance: string): string | null {
  const t = utterance.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (!/^(please\s+)?(add|connect|pair|set ?up|link)\b/.test(t)) return null;
  const brand = SPOTIFY_CONNECT_BRANDS.find((b) => t.includes(b));
  if (brand) return brand.replace(/\b\w/g, (c) => c.toUpperCase());
  return /\bspeaker\b/.test(t) ? '' : null;
}

// ---- the cards -------------------------------------------------------------

export function savedCards(connectors: Record<string, Connector>, devices: readonly PairedDevice[]): HubCard[] {
  const out: HubCard[] = [];
  for (const d of devices) {
    const c = connectors[d.connectorKey];
    out.push({
      id: d.id, group: 'saved', name: d.name,
      detail: `${c ? `${c.brand || 'Device'} · ${c.actions.length} actions · written by ${c.source === 'cloud' ? 'Gemini' : c.source === 'builtin' ? 'Mendcraft' : c.source}` : 'Connector missing'} · ${d.host}${d.verified === 'done' ? ' · seen working' : ''}`,
      state: c ? 'connected' : 'needs', offline: true,
    });
  }
  // Connectors with no paired device yet still show: they are reusable.
  const used = new Set(devices.map((d) => d.connectorKey));
  for (const c of Object.values(connectors)) {
    if (used.has(c.key)) continue;
    out.push({ id: `connector:${c.key}`, group: 'saved', name: `${c.brand || 'Device'} ${c.deviceKind}`.trim(), detail: `Saved connector · ${c.actions.length} actions · ready for the next one`, state: 'ready', offline: true });
  }
  return out;
}

export function speakerCards(list: readonly SpeakerLink[], online: boolean): HubCard[] {
  return list.map((s) => ({
    id: s.key, group: 'speaker', name: s.deviceName, detail: `${s.brand} via Spotify Connect${online ? '' : ' · needs internet'}`,
    state: online ? 'connected' : 'needs', offline: false,
  }));
}

export function hubCards(env: HubEnv, connectors: Record<string, Connector>, devices: readonly PairedDevice[], speakers: readonly SpeakerLink[]): HubCard[] {
  return [...PREBUILT_LINKS.map((l) => linkCard(l, env)), ...savedCards(connectors, devices), ...speakerCards(speakers, env.online)];
}

/** The demo branch opens in Connect-anything mode; `?full=1` shows every tool. */
export function isConnectDemo(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.get('full') !== '1';
}
