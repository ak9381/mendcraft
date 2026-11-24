// Entry for /canvas.html (sim-main smart canvas).
import '../style.css';
import './canvas.css';
import { mountCanvas } from './canvasApp';
import { autoHandsFromSearch } from './canvasHands';
import { createEngines, type CloudStream, type PromptApi } from './engines';
import { checkDeviceNano, hasUsableNano } from '../ai/nanoStatus';
import { getAppleAIPlugin, generateAppleText } from '../ai/appleAI';
import { isEnabled, prepareHybrid, streamCanvasPlan } from '../ai/hybrid';
import { bindDirectory, createDirectory, createIndexedDbDirectoryStore, createMemoryDirectoryStore, nextToken } from '../privacy/directory';
import { createVoiceController } from '../input/voice';

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
const languageModel = (globalThis as Record<string, unknown>).LanguageModel as PromptApi | undefined;
const isPhone = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
const cloud: CloudStream | undefined = isEnabled()
  ? async (prompt, onText) => {
      const text = await streamCanvasPlan(prompt, onText);
      if (text == null) throw new Error('cloud unavailable');
      onText(text);
      return text;
    }
  : undefined;
const nano = await checkDeviceNano();
const appleReady = isPhone && nano.source === 'apple' && hasUsableNano(nano);
const applePlugin = appleReady ? getAppleAIPlugin() : null;
const engines = createEngines({
  languageModel: languageModel ?? null,
  cloud: cloud ?? null,
  isPhone,
  androidNano: isPhone && nano.source !== 'apple' && hasUsableNano(nano),
  appleOnDevice: appleReady,
  onDeviceGenerate: applePlugin
    ? (prompt, onText) => generateAppleText(prompt, onText, applePlugin)
    : undefined,
  sim: params.has('sim'),
});

const root = document.getElementById('canvas')!;
let handle: ReturnType<typeof mountCanvas> | null = null;
const voice = createVoiceController((t) => handle?.run(t));
handle = mountCanvas(root, {
  voice, engines, seed: params.has('seed'), fresh: params.has('fresh'), sim: params.has('sim'),
  showcase: params.get('showcase') === 'energy' ? 'energy' : undefined,
  autoHands: autoHandsFromSearch(location.search),
  privacyGemini: cloud
    ? (redacted) => cloud(redacted, () => undefined)
    : undefined,
});
if (isPhone && !hasUsableNano(nano)) {
  // Status chip in the AI panel uses the engine route note; this keeps
  // the same wording on the document title bar for a quick read.
  root.dataset.nano = nano.label;
}
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
