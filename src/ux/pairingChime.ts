// Browser playback + on-device mic listen for the pairing chime. Samples never
// leave the device: no Relay, no upload, no cloud speech. The encoder/decoder
// themselves live in src/relay/soundPairing.ts and are unit-tested in Node.

import {
  decodePairingChime,
  encodePairingChime,
  PAIRING_SAMPLE_RATE,
} from '../relay/soundPairing';

export const CHIME_REPEAT_MS = 3_500;

export interface ChimeLoop {
  playOnce(): Promise<void>;
  start(): void;
  stop(): void;
  readonly playing: boolean;
}

export interface ChimeListener {
  /** 'stopped' when stop() ran before the mic opened (it is closed again). */
  start(): Promise<'listening' | 'denied' | 'unsupported' | 'stopped'>;
  stop(): void;
  readonly active: boolean;
}

type AudioCtx = AudioContext;

function getAudioContextCtor(): (typeof AudioContext) | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const w = typeof window !== 'undefined' ? (window as unknown as { webkitAudioContext?: typeof AudioContext }) : null;
  return w?.webkitAudioContext ?? null;
}

async function playBuffer(ctx: AudioCtx, samples: Float32Array, sampleRate: number): Promise<AudioBufferSourceNode> {
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume();
  src.start();
  return src;
}

/** Loop the pairing motif every few seconds while the laptop join panel is open. */
export function createChimeLoop(opts: {
  code: string;
  everyMs?: number;
  /** Injected player (tests). Default uses Web Audio. */
  play?: (samples: Float32Array, sampleRate: number) => Promise<void>;
}): ChimeLoop {
  const everyMs = opts.everyMs ?? CHIME_REPEAT_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = true;
  let ctx: AudioCtx | null = null;
  let current: AudioBufferSourceNode | null = null;
  const samples = encodePairingChime(opts.code);

  async function playOnce(): Promise<void> {
    if (opts.play) {
      await opts.play(samples, PAIRING_SAMPLE_RATE);
      return;
    }
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;
    if (!ctx) ctx = new Ctor();
    try { current?.stop(); } catch { /* already ended */ }
    current = await playBuffer(ctx, samples, PAIRING_SAMPLE_RATE);
  }

  return {
    playOnce,
    start() {
      if (!stopped) return;
      stopped = false;
      void playOnce();
      timer = setInterval(() => { if (!stopped) void playOnce(); }, everyMs);
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      try { current?.stop(); } catch { /* already ended */ }
      current = null;
    },
    get playing() { return !stopped; },
  };
}

/** Speak the grouped code aloud (laptop speechSynthesis). Letters, not a slur. */
export function speakPairingCode(grouped: string): void {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
  const spoken = grouped
    .replace(/-/g, ', ')
    .split('')
    .map((ch) => (ch === ',' || ch === ' ' ? ch : ch))
    .join(' ')
    .replace(/ , /g, ', ');
  const u = new SpeechSynthesisUtterance(spoken);
  u.rate = 0.85;
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  speechSynthesis.speak(u);
}

/**
 * Open the mic on this device only, run the in-repo decoder on a sliding
 * window, and invoke `onCode` once a valid short code is heard. Never uploads.
 */
export function createChimeListener(opts: {
  onCode: (code: string) => void;
  onError?: (reason: 'denied' | 'unsupported') => void;
  /** Injected capture (tests / sim). When omitted, uses getUserMedia. */
  startCapture?: (onSamples: (samples: Float32Array, sampleRate: number) => void) => Promise<() => void>;
}): ChimeListener {
  let stopCapture: (() => void) | null = null;
  let active = false;
  let reported = false;
  let generation = 0;

  function consider(samples: Float32Array, sampleRate: number): void {
    if (!active || reported) return;
    const code = decodePairingChime(samples, sampleRate);
    if (!code) return;
    reported = true;
    opts.onCode(code);
    stop();
  }

  async function defaultCapture(onSamples: (s: Float32Array, sr: number) => void): Promise<() => void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('unsupported');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error('unsupported');
    }
    const ctx = new Ctor();
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const windowSec = 3.2;
    let ring = new Float32Array(0);
    node.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      const next = new Float32Array(ring.length + input.length);
      next.set(ring, 0);
      next.set(input, ring.length);
      const keep = Math.floor(ctx.sampleRate * windowSec);
      ring = next.length > keep ? next.subarray(next.length - keep) : next;
      onSamples(ring, ctx.sampleRate);
    };
    src.connect(node);
    // ScriptProcessor must be in the graph; gain 0 so we never play the mic back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume();
    return () => {
      try { node.disconnect(); src.disconnect(); mute.disconnect(); } catch { /* ignore */ }
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
    };
  }

  async function start(): Promise<'listening' | 'denied' | 'unsupported' | 'stopped'> {
    stop();
    const gen = ++generation;
    reported = false;
    active = true;
    try {
      const startCap = opts.startCapture ?? defaultCapture;
      const stopper = await startCap(consider);
      // stop() (or a newer start()) ran while the mic permission prompt was
      // up: close the capture we just got instead of leaving the mic open.
      if (!active || gen !== generation) {
        try { stopper(); } catch { /* ignore */ }
        return 'stopped';
      }
      stopCapture = stopper;
      return 'listening';
    } catch (err) {
      if (gen !== generation) return 'stopped';
      active = false;
      const reason: 'denied' | 'unsupported' =
        err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'NotAllowedError'
          ? 'denied'
          : (err instanceof Error && err.message === 'unsupported' ? 'unsupported' : 'denied');
      opts.onError?.(reason);
      return reason;
    }
  }

  function stop(): void {
    active = false;
    if (stopCapture) {
      try { stopCapture(); } catch { /* ignore */ }
      stopCapture = null;
    }
  }

  return {
    start,
    stop,
    get active() { return active; },
  };
}
