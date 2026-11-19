// Entry for /mobile.html — the phone + tablet companion to the desktop smart
// canvas hub. `?sim=1` renders every screen deterministically with mock data
// (no camera/hub/network) so screenshots are stable; otherwise `pair` opens a
// real Relay pairing session via startPhoneJoin, honestly left generic
// (hub name, devices, boards) until that hub actually syncs its canvas.
import '../style.css';
import './mobile/mobile.css';
import { startPhoneJoin } from './phoneJoin';
import { buildSimMobileState } from './mobile/mockState';
import { parseMobileScreen } from './mobile/mobileRoute';
import { detectPlatform, type CapacitorLike } from './mobile/platform';
import { mountMobile } from './mobile/mobileShell';

const params = new URLSearchParams(location.search);
const capacitor = (window as unknown as { Capacitor?: CapacitorLike }).Capacitor ?? null;
const platform = detectPlatform({ search: location.search, capacitor, viewportWidth: window.innerWidth });
const screen = parseMobileScreen(location.search);
const sim = params.has('sim');
const pairedOverride = params.has('paired') ? params.get('paired') === '1' : undefined;

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

function render(state = buildSimMobileState(screen, pairedOverride)): void {
  mountMobile(root, { platform, screen, state, onSay });
}

render();

if (!sim && screen === 'pair') {
  void startPhoneJoin({
    onState: (st) => { if (st === 'paired') render(buildSimMobileState(screen, true)); },
  }).then((res) => {
    if ('error' in res) return;
    const state = buildSimMobileState(screen, false);
    render({ ...state, pair: { ...state.pair, hubName: 'This Mac', code: res.code } });
  });
}
