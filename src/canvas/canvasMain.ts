// Entry for /canvas.html (sim-main smart canvas).
import '../style.css';
import './canvas.css';
import { mountCanvas } from './canvasApp';
import { autoHandsFromSearch } from './canvasHands';
import { isPhoneCanvasShell } from './iphoneShell';
import { phoneRouteBadge, startPhoneLookToEdit, startPhoneRelayGuest } from './phoneCanvasRuntime';
import { createEngines, type CloudStream, type PromptApi } from './engines';
import { checkDeviceNano, hasUsableNano, type NanoCheck } from '../ai/nanoStatus';
import { getAppleAIPlugin, generateAppleText, type AppleAIPlugin } from '../ai/appleAI';
import { isEnabled, prepareHybrid, streamCanvasPlan } from '../ai/hybrid';
import { bindDirectory, createDirectory, createIndexedDbDirectoryStore, createMemoryDirectoryStore, nextToken } from '../privacy/directory';
import { createVoiceController } from '../input/voice';
import { activePeople } from '../privacy/directory';
import { createPhoneAiForwarder } from './phoneAiFeed';

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
      platform: phonePlatform,
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
handle = mountCanvas(root, {
  voice, engines, seed: params.has('seed'), fresh: params.has('fresh'), sim: params.has('sim'),
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
    startPhoneLookToEdit(handle, { sim: params.has('sim') });
    startPhoneRelayGuest(handle, {
      sim: params.has('sim'),
      platform: phonePlatform,
      aiForwarder: phoneAiFeed,
    });
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
