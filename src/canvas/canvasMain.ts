// Entry for /canvas.html (sim-main smart canvas).
import '../style.css';
import './canvas.css';
import { mountCanvas } from './canvasApp';
import { createEngines, type CloudStream, type PromptApi } from './engines';
import { isEnabled, streamCanvasPlan } from '../ai/hybrid';
import { createVoiceController } from '../input/voice';

const params = new URLSearchParams(location.search);
if (params.has('fresh')) localStorage.removeItem('mc.canvas.v1');

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
const engines = createEngines({ languageModel: languageModel ?? null, cloud: cloud ?? null, isPhone, sim: params.has('sim') });

const root = document.getElementById('canvas')!;
let handle: ReturnType<typeof mountCanvas> | null = null;
const voice = createVoiceController((t) => handle?.run(t));
handle = mountCanvas(root, { voice, engines, seed: params.has('seed') });
(window as unknown as { __canvas: unknown }).__canvas = handle;
