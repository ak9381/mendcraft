// Entry for /mobile.html — the phone + tablet companion to the desktop smart
// canvas hub. `?sim=1` renders every screen deterministically with mock data
// (no camera/hub/network) so screenshots are stable; otherwise it pairs with the
// real hub, remembers the room, pins locally, and keeps the sync status honest.
import '../style.css';
import './mobile/mobile.css';
import { startPhoneJoin } from './phoneJoin';
import { buildSimMobileState, type SimMobileState } from './mobile/mockState';
import { parseMobileScreen } from './mobile/mobileRoute';
import { detectPlatform, type CapacitorLike } from './mobile/platform';
import { mountMobile } from './mobile/mobileShell';
import { ensureDeviceId, loadPhonePair } from '../relay/pairingStore';
import { loadPin, togglePin } from './phonePin';
import { shouldSync, type SyncReason } from '../input/gazeSync';
import { coerceSurfacePlan, type SurfacePlan } from './surfacePlan';

const params = new URLSearchParams(location.search);
const capacitor = (window as unknown as { Capacitor?: CapacitorLike }).Capacitor ?? null;
const platform = detectPlatform({ search: location.search, capacitor, viewportWidth: window.innerWidth });
const screen = parseMobileScreen(location.search);
const sim = params.has('sim');
const pairedOverride = params.has('paired') ? params.get('paired') === '1' : undefined;

const storage: Storage | null = (() => { try { return window.localStorage; } catch { return null; } })();
// A stable, non-identifying device id so the hub can tell two phones apart.
if (!sim && storage) ensureDeviceId(storage);
const savedPair = sim ? null : loadPhonePair(storage);

const root = document.getElementById('mobile')!;

const toast = document.createElement('p');
toast.className = 'mc-m-toast';
toast.setAttribute('role', 'status');
toast.setAttribute('aria-live', 'polite');
document.body.append(toast);
let toastTimer = 0;
function onSay(text: string): void {
  clearTimeout(toastTimer);
  toast.textContent = `Heard: "${text}"`;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2500);
}

// The phone's own view of what stays local: the pinned board + how it last synced.
let lastSyncAt: number | null = null;
let syncReason: SyncReason = 'idle';

function liveState(): SimMobileState {
  const base = buildSimMobileState(screen, pairedOverride);
  const pin = loadPin(storage);
  // Platform → whether the Apple on-device model path is available.
  const hasAppleAI = platform.os === 'ios';
  return {
    ...base,
    pair: savedPair
      ? { ...base.pair, paired: true, hubName: savedPair.hubName }
      : base.pair,
    pinned: pin.pinned,
    hasAppleAI,
    arrangement: {
      side: savedPair?.side ?? base.arrangement.side,
      otherPhone: base.arrangement.otherPhone,
    },
    sync: { reason: syncReason === 'face' ? 'face' : syncReason === 'focus' ? 'focus' : 'idle', at: lastSyncAt ? 'just now' : base.sync.at },
  };
}

/** A minimal SurfacePlan from the current device tiles, so "Pin on this device"
 *  captures something the phone can keep rendering offline. */
function boardFromState(state: SimMobileState): SurfacePlan {
  const tiles = state.devices.map((d) => ({ type: d.kind, deviceId: d.id, label: d.label }));
  const coerced = coerceSurfacePlan({ kind: 'room', title: `${state.boards.find((b) => b.active)?.title ?? 'Dashboard'}`, tiles });
  return coerced.ok ? coerced.value : { kind: 'room', title: 'Dashboard', tiles: [] };
}

function render(state = (sim ? buildSimMobileState(screen, pairedOverride) : liveState())): void {
  mountMobile(root, { platform, screen, state, onSay });
  // Persist the pin for real (independent of the dashboard's visual aria flip).
  if (!sim && storage) {
    const pinBtn = root.querySelector<HTMLButtonElement>('[data-mc-pin]');
    pinBtn?.addEventListener('click', () => { togglePin(storage, boardFromState(state)); });
  }
}

render();

// Auto-sync fallback: app focus / page visibility re-sync the board (the camera
// gaze path uses the same shouldSync logic — see input/gazeSync.ts — but never
// opens the front camera when a live stream exists or the gimbal is active).
if (!sim && savedPair) {
  const evaluate = (facing: boolean): void => {
    const res = shouldSync({
      visible: document.visibilityState === 'visible',
      facing,
      focused: document.hasFocus(),
      lastSyncAt,
      now: Date.now(),
      minIntervalMs: 4000,
    });
    if (res.sync) {
      lastSyncAt = Date.now();
      syncReason = res.reason;
      render();
    }
  };
  document.addEventListener('visibilitychange', () => evaluate(false));
  window.addEventListener('focus', () => evaluate(false));
  evaluate(false);
}

// First-time pairing (no remembered room): the typable-code flow. startPhoneJoin
// honestly leaves the view generic until the hub actually syncs its canvas.
if (!sim && !savedPair && screen === 'pair') {
  void startPhoneJoin({
    onState: (st) => { if (st === 'paired') render(); },
  }).then((res) => {
    if ('error' in res) return;
    const state = liveState();
    render({ ...state, pair: { ...state.pair, hubName: 'This Mac', code: res.code } });
  });
}
