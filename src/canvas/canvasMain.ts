// Entry for /canvas.html (sim-main smart canvas).
import '../style.css';
import './canvas.css';
import { mountCanvas } from './canvasApp';
import { autoHandsFromSearch } from './canvasHands';
import { isPhoneCanvasShell } from './iphoneShell';
import { applyGuestSnapshot, phoneRouteBadge, startPhoneLookToEdit } from './phoneCanvasRuntime';
import { createLaptopLink, mountLaptopLinkUi } from './laptopLink';
import { createPhoneCamera, phoneHandsAllowed } from './phoneCamera';
import { App } from '@capacitor/app';
import { createEngines, type CloudStream, type PromptApi } from './engines';
import { checkDeviceNano, hasUsableNano, type NanoCheck } from '../ai/nanoStatus';
import { getAppleAIPlugin, generateAppleText, type AppleAIPlugin } from '../ai/appleAI';
import { isEnabled, prepareHybrid, streamCanvasPlan } from '../ai/hybrid';
import { bindDirectory, createDirectory, createIndexedDbDirectoryStore, createMemoryDirectoryStore, nextToken } from '../privacy/directory';
import { createVoiceController } from '../input/voice';
import { activePeople } from '../privacy/directory';
import { createPhoneAiForwarder } from './phoneAiFeed';
import { ensureDeviceId } from '../relay/pairingStore';
import { createReplayPlayer, DEMO_JOURNEY, type ReplayResult } from './journeyReplay';
import { mountReplayBanner } from './replayBanner';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

// ?replay=demo: the judge replay (journeyReplay.ts) plays the whole journey by
// itself. It implies ?sim=1&hands=0 (scripted engines, SIM-labelled; never the
// camera) — written into the URL so what is simulated is visible there too —
// and runs on an in-memory canvas so a saved canvas is never overwritten.
const replayDemo = new URLSearchParams(location.search).get('replay') === 'demo';
if (replayDemo) {
  const q = new URLSearchParams(location.search);
  q.set('sim', '1'); q.set('hands', '0');
  history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`);
}
const params = new URLSearchParams(location.search);
if (params.has('fresh')) localStorage.removeItem('mc.canvas.v1');

// People directory: tokens in cloud prompts, real names filled back on device.
// ?sim=1: seed one example person (Sharma / client / [Client A]) in a fresh,
// in-memory directory so "floor plan for Mrs Sharma's flat" has something to redact.
const directoryStore = params.has('sim')
  ? createMemoryDirectoryStore([{
      id: 'sim-sharma', name: 'Sharma', role: 'client',
      token: nextToken('client', []), notes: [], createdAt: Date.now(),
    }])
  : createIndexedDbDirectoryStore();
bindDirectory(createDirectory(directoryStore));

// Honest engine selection: real Nano needs Chrome's Prompt API (and not a phone);
// real Gemini needs Firebase AI Logic. ?sim=1 forces the scripted box engines.
// Do not await Apple/ML Kit availability before first paint — a hanging plugin
// left the iOS WKWebView on the dark body background (a black screen).
const languageModel = (globalThis as Record<string, unknown>).LanguageModel as PromptApi | undefined;
const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor ?? null;
const isPhone = !!capacitor?.isNativePlatform?.();
const phoneShell = isPhoneCanvasShell({ capacitor, viewportWidth: window.innerWidth });
const cloud: CloudStream | undefined = isEnabled()
  ? async (prompt, onText) => {
      const text = await streamCanvasPlan(prompt, onText);
      if (text == null) throw new Error('cloud unavailable');
      onText(text);
      return text;
    }
  : undefined;

const apple = {
  ready: false,
  androidNano: false,
  plugin: getAppleAIPlugin(),
};
const engines = createEngines({
  languageModel: languageModel ?? null,
  cloud: cloud ?? null,
  isPhone,
  get androidNano() { return apple.androidNano; },
  get appleOnDevice() { return apple.ready; },
  onDeviceGenerate: (prompt, onText) => {
    const plugin: AppleAIPlugin | null = apple.plugin ?? getAppleAIPlugin();
    apple.plugin = plugin;
    return generateAppleText(prompt, onText, plugin);
  },
  sim: params.has('sim'),
});

// Phone shell: forward this phone's AI terminal activity to the paired
// laptop's AI monitor (compact, redacted, ≤5/s; dropped with no session).
// The "nano" terminal is Apple on an iPhone with Apple Intelligence, the
// Android on-device model when ML Kit has one, else no model ('rules').
const phonePlatform = capacitor?.getPlatform?.() === 'ios' ? 'ios' as const : 'android' as const;
const phoneAiFeed = phoneShell
  ? createPhoneAiForwarder({
      deviceId: ensureDeviceId((() => { try { return localStorage; } catch { return null; } })()),
      localEngine: () => (apple.ready ? 'apple' : apple.androidNano ? 'nano' : 'rules'),
      people: () => activePeople(),
    })
  : undefined;

const root = document.getElementById('canvas')!;
let handle: ReturnType<typeof mountCanvas> | null = null;
const voice = createVoiceController(
  (t) => handle?.run(t),
  {
    onInterim: (text) => handle?.setTalkCaption(text),
    onError: (_code, message) => handle?.setTalkError(message),
  },
);
// Hand control is for the ANDROID phone only (the iPhone sits on the gimbal and
// keeps its own front-camera uses untouched). On Android: ONE front camera for
// hand control and look-to-edit (one getUserMedia, one tracker), opened only
// when a feature asks for it. The Capacitor App plugin's pause/resume also
// stops and restarts it (webviews don't reliably fire visibilitychange).
// No camera hub → no Hands pill, no hand tracker (mountCanvas), and iPhone
// look-to-edit stays on its original path.
const phoneCamera = phoneHandsAllowed(phoneShell, phonePlatform)
  ? createPhoneCamera({ app: isPhone ? App : null })
  : undefined;
handle = mountCanvas(root, {
  voice, engines, seed: params.has('seed'), fresh: params.has('fresh') || replayDemo, sim: params.has('sim'), gimbalKeepAlive: params.get('gimbalKeepAlive') === '1',
  phoneCamera,
  storage: replayDemo ? memoryStorage() : undefined,
  showcase: params.get('showcase') === 'energy' ? 'energy' : undefined,
  autoHands: phoneShell ? false : autoHandsFromSearch(location.search),
  phoneShell,
  phoneAiFeed,
  routeBadge: phoneShell
    ? phoneRouteBadge({
        appleReady: !!apple.plugin,
        ios: capacitor?.getPlatform?.() === 'ios',
        sim: params.has('sim'),
        cloud: !!cloud,
      })
    : undefined,
  privacyGemini: cloud
    ? (redacted) => cloud(redacted, () => undefined)
    : undefined,
});

function applyNano(nano: NanoCheck): void {
  apple.plugin = getAppleAIPlugin() ?? apple.plugin;
  apple.ready = isPhone && nano.source === 'apple' && hasUsableNano(nano);
  apple.androidNano = isPhone && nano.source !== 'apple' && hasUsableNano(nano);
  if (apple.ready) apple.plugin = apple.plugin ?? getAppleAIPlugin();
  if (phoneShell && handle) {
    handle.setRouteBadge(phoneRouteBadge({
      appleReady: apple.ready,
      ios: capacitor?.getPlatform?.() === 'ios',
      sim: params.has('sim'),
      cloud: !!cloud,
      appleReason: nano.appleStatus,
    }));
  }
  if (isPhone && !hasUsableNano(nano)) root.dataset.nano = nano.label;
}

void (async () => {
  const nanoP = checkDeviceNano();
  try {
    const nano = await Promise.race([
      nanoP,
      new Promise<null>((resolve) => { setTimeout(() => resolve(null), 1500); }),
    ]);
    if (nano) applyNano(nano);
    else {
      const late = await nanoP.catch(() => null);
      if (late) applyNano(late);
    }
  } catch {
    /* stay on the painted shell; mic path will retry getAppleAIPlugin() */
  }
})();

function afterFirstPaint(fn: () => void): void {
  const run = (): void => { setTimeout(fn, 400); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}
afterFirstPaint(() => {
  if (phoneShell && handle) {
    startPhoneLookToEdit(handle, { sim: params.has('sim'), camera: phoneCamera });
    // Join laptop: a remembered pair rejoins silently (no mic); otherwise the
    // phone shows "Join laptop", which opens the mic only when tapped and
    // joins by the laptop's chime (or a typed code). Every join binds the AI
    // feed forwarder and the re-announce (joinPhoneSession).
    const h = handle;
    const sim = params.has('sim');
    let ui: { update(): void } | null = null;
    const link = createLaptopLink({
      storage: (() => { try { return localStorage; } catch { return null; } })(),
      platform: phonePlatform,
      native: isPhone,
      sim,
      aiForwarder: phoneAiFeed,
      onSnapshot: (snap) => { applyGuestSnapshot(snap, h.showRemoteBoard, phonePlatform); },
      onChange: () => ui?.update(),
    });
    ui = mountLaptopLinkUi(root, link, { sim, hasBoard: () => h.frames().length > 0 });
    void link.rejoinSaved();
    // Native webviews rarely fire pagehide on backgrounding: close the mic when
    // hidden (a connected session stays), and rejoin a remembered pair when
    // we come back if it dropped meanwhile.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') link.cancel();
      else void link.resume();
    });
    window.addEventListener('pagehide', () => { void link.stop(); });
    // Restored from the back/forward cache after pagehide closed the session.
    window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) void link.resume(); });
  }
});
(window as unknown as { __canvas: unknown }).__canvas = handle;

// ?sim=1&demo=morph (best with &seed=1): the deterministic morph replay —
// a scripted pinch-hold on the first tile, the card, an injected utterance,
// the scripted Gemini patch — with no camera or mic.
if (params.has('sim') && params.get('demo') === 'morph') {
  setTimeout(() => {
    void (window as unknown as { __mcMorph?: { replay(index?: number, utterance?: string): Promise<boolean> } })
      .__mcMorph?.replay();
  }, 2500);
}

// Warm App Check + cloud models in the background so the first keep isn't a
// cold start — but never under ?sim=1, which stays fully scripted/on-device
// by design (same reasoning as skipping the WiZ bridge probe above); an
// auto-generated preview channel domain is often not in the App Check /
// reCAPTCHA authorized-domains list, so this call alone can 403 there for no
// reason a sim run needs to care about.
if (!params.has('sim')) void prepareHybrid();

// ?replay=demo: play the journey once the canvas has painted. The outcome is
// also on window.__replay for scripts/e2e-journey.mjs.
if (replayDemo && handle) {
  const h = handle;
  const state: { done: boolean; result: ReplayResult | null; log: string[] } = { done: false, result: null, log: [] };
  (window as unknown as { __replay: unknown }).__replay = state;
  const player = createReplayPlayer(h.replay, DEMO_JOURNEY, {
    beatMs: 1500,
    onStep: (i, n, step) => { banner.step(i, n, step.label); state.log.push(`step ${i}/${n} ${step.id}`); },
    onNote: (t) => { banner.note(t); if (t) state.log.push(t); },
    onStepDone: (r) => { if (r.outcome !== 'done') console.info(`[replay] ${r.id}: ${r.outcome}${r.note ? ` — ${r.note}` : ''}`); },
    onDone: (r) => {
      state.result = r; state.done = true;
      const skipped = r.steps.filter((s) => s.outcome === 'skipped').length;
      const failed = r.steps.find((s) => s.outcome === 'failed');
      banner.finish(r.stopped ? 'Replay stopped — the canvas is yours.'
        : failed ? `Replay stopped at “${failed.label}”: ${failed.note ?? 'failed'}`
          : `Replay done · ${r.steps.length - skipped} steps${skipped ? ` (${skipped} skipped)` : ''} · ${(r.ms / 1000).toFixed(0)} s`, failed ? 0 : 8000);
    },
  });
  const banner = mountReplayBanner(root, () => player.stop());
  setTimeout(() => { void player.start(); }, 1200);
}
