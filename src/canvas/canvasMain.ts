// Entry for /canvas.html (sim-main smart canvas).
import '../style.css';
import './canvas.css';
import { mountCanvas } from './canvasApp';
import { createEngines, type CloudStream, type PromptApi } from './engines';
import { checkDeviceNano, hasUsableNano } from '../ai/nanoStatus';
import { isEnabled, prepareHybrid, streamCanvasPlan } from '../ai/hybrid';
import { bindDirectory, createDirectory, createIndexedDbDirectoryStore } from '../privacy/directory';
import { createVoiceController } from '../input/voice';

const params = new URLSearchParams(location.search);
if (params.has('fresh')) localStorage.removeItem('mc.canvas.v1');

// People directory: tokens in cloud prompts, real names filled back on device.
bindDirectory(createDirectory(createIndexedDbDirectoryStore()));

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
const engines = createEngines({
  languageModel: languageModel ?? null,
  cloud: cloud ?? null,
  isPhone,
  androidNano: isPhone && hasUsableNano(nano),
  sim: params.has('sim'),
});

const root = document.getElementById('canvas')!;
let handle: ReturnType<typeof mountCanvas> | null = null;
const voice = createVoiceController((t) => handle?.run(t));
handle = mountCanvas(root, {
  voice, engines, seed: params.has('seed'), fresh: params.has('fresh'), sim: params.has('sim'),
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

// Warm App Check + cloud models in the background so the first keep isn't a cold start.
void prepareHybrid();
