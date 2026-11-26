// Entry for /canvas.html (sim-main smart canvas).
import '../style.css';
import './canvas.css';
import { mountCanvas } from './canvasApp';
import { autoHandsFromSearch } from './canvasHands';
import { isPhoneCanvasShell } from './iphoneShell';
import { applyGuestSnapshot, phoneRouteBadge, startPhoneLookToEdit } from './phoneCanvasRuntime';
import { createLaptopLink, mountLaptopLinkUi } from './laptopLink';
import { createPhoneCamera, IPHONE_CAMERA_CONSTRAINTS, phoneHandsAllowed, phoneSensingAllowed } from './phoneCamera';
import { announcePhone } from './phoneGuestJoin';
import type { PhoneGuestSessionLike } from './laptopLink';
import { App } from '@capacitor/app';
import { createEngines, type CloudStream, type OnDeviceStream, type PromptApi } from './engines';
import { checkDeviceNano, hasUsableNano, type NanoCheck } from '../ai/nanoStatus';
import { getAppleAIPlugin, generateAppleText, type AppleAIPlugin } from '../ai/appleAI';
import { cloudAccessProblem, isEnabled, NANO_CREATE_OPTIONS, onOnDeviceUnloaded, onWarmState, prepareHybrid, streamCanvasPlanOrThrow, streamOnDevice, warmBoardOnDevice } from '../ai/hybrid';
import { bindDirectory, createDirectory, createIndexedDbDirectoryStore, createMemoryDirectoryStore } from '../privacy/directory';
import { createVoiceController } from '../input/voice';
import { installNanoTrace } from '../ai/nanoTrace';
import { createWarmKeeper, startWarmSchedule } from '../ai/nanoWarm';
import { replyTrace } from '../ai/replyTrace';
import { nanoQueue } from '../ai/nanoQueue';
import { activePeople } from '../privacy/directory';
import { createPhoneAiForwarder } from './phoneAiFeed';
import { ensureDeviceId } from '../relay/pairingStore';
import { createReplayEngines, fixtureDevices } from './replayEngine';
import { coerceLayout, joinCanvasDoc, LAYOUT_KEY, splitCanvasDoc, tooManyBoardsLine, unjoinedIds } from './canvasPersistence';
import { loadArtifacts, openArtifactStore, overCapLine, STORE_FALLBACK_LINE, STORE_READ_FAILED_LINE } from '../artifacts/store';
import { frameIdOfArtifactId, type Artifact, type ArtifactBy } from '../artifacts/artifact';
import type { CanvasDoc } from './frames';

const params = new URLSearchParams(location.search);
/** Test hooks and replay engines: dev server or a VITE_E2E=1 build only. */
const testBuild = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
/** Replay engines answer from recorded replies only in a test build with ?sim=1. */
const replayOn = testBuild && params.get('sim') === '1';
type McWindow = Window & { __mcCanvas?: unknown; __mcArtifacts?: unknown; __mcFixtures?: { replies?: Record<string, string>; devices?: unknown } };
const mcWindow = window as McWindow;

// ---- the starting document: layout (localStorage) + artifacts (the store) ----
// ?fresh=1 clears the layout and, in a test build, the stored artifacts.
const layoutStorage = (() => { try { return localStorage; } catch { return null; } })();
if (params.has('fresh')) { try { layoutStorage?.removeItem(LAYOUT_KEY); } catch { /* nothing kept */ } }
const { store: artifactStore, persistent } = await openArtifactStore();
if (params.has('fresh') && testBuild) await artifactStore.clear().catch(() => undefined);
const loaded = await loadArtifacts(artifactStore);
let artifacts: Artifact[] = loaded.ok;
const layout = (() => { try { return coerceLayout(JSON.parse(layoutStorage?.getItem(LAYOUT_KEY) ?? 'null')); } catch { return null; } })();
const joinDropped: { id: string; why: string }[] = [];
const startDoc = joinCanvasDoc(layout, artifacts, (d) => joinDropped.push(d));
// What the canvas does not show is never removed or overwritten by a save:
// boards past the cap, every board when the join failed, over-cap rows.
const keepIds = new Set([...unjoinedIds(startDoc, artifacts), ...loaded.overCap]);
artifacts = artifacts.filter((a) => !keepIds.has(a.id));
if (keepIds.size) console.warn(`[mendcraft] ${keepIds.size} stored item(s) not on the canvas are kept as they are.`);
const storeNotes = [
  persistent ? '' : STORE_FALLBACK_LINE,
  loaded.readFailed ? STORE_READ_FAILED_LINE : '',
  loaded.overCap.length ? overCapLine(loaded.overCap.length) : '',
  joinDropped.length ? tooManyBoardsLine(joinDropped.length) : '',
  !startDoc && keepIds.size > 0 ? "Stored boards couldn't be opened together. Nothing stored was changed." : '',
].filter(Boolean);
if (testBuild) mcWindow.__mcArtifacts = artifactStore;

// People directory: tokens in cloud prompts, real names filled back on device.
// ?sim=1 keeps it in memory for the run; nobody is seeded.
const directoryStore = params.has('sim') ? createMemoryDirectoryStore([]) : createIndexedDbDirectoryStore();
bindDirectory(createDirectory(directoryStore));

// Honest engine selection: real Nano needs Chrome's Prompt API (and not a phone);
// real Gemini needs Firebase AI Logic. ?sim=1 has no live model: in a test
// build the replay engines answer from recorded replies, else nothing does.
// Do not await Apple/ML Kit availability before first paint — a hanging plugin
// left the iOS WKWebView on the dark body background (a black screen).
const languageModel = (globalThis as Record<string, unknown>).LanguageModel as PromptApi | undefined;
// ?nanoTrace=1: log every on-device create/prompt with its timings and sizes
// (never content), measured at LanguageModel itself, under the SDK.
if (params.get('nanoTrace') === '1' && languageModel) installNanoTrace(languageModel);
const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor ?? null;
const isPhone = !!capacitor?.isNativePlatform?.();
const phoneShell = isPhoneCanvasShell({ capacitor, viewportWidth: window.innerWidth });
const cloud: CloudStream | undefined = isEnabled()
  ? async (prompt, onText, o) => {
      // A failure throws with its plain reason (App Check 403, offline, …).
      const text = await streamCanvasPlanOrThrow(prompt, onText, o?.shape, { onSend: o?.onSend, onRetract: o?.onRetract });
      onText(text);
      return text;
    }
  : undefined;
// On-device Nano goes through Firebase AI Logic (ONLY_ON_DEVICE), like every
// other model call: one queued prompt per turn, however many cursors the
// canvas draws. Chrome's LanguageModel global is only checked for presence
// and availability. No Firebase config, a phone, or ?sim=1 means Nano is off.
const nanoStream: OnDeviceStream | null = languageModel && !isPhone && !params.has('sim') && isEnabled()
  ? (prompt, onText, o) => streamOnDevice({
      system: o?.system && o.user ? o.system : undefined,
      prompt: o?.system && o.user ? o.user : prompt,
      constraint: o?.constraint,
      signal: o?.signal,
      onChunk: onText,
      onStart: o?.onStart,
      onReady: o?.onReady,
      onLoading: o?.onLoading,
      maxChars: o?.maxChars,
    })
  : null;

let nanoAvailable = false;
/** Ask Chrome whether Nano can answer right now; re-asked until it can. */
async function refreshNanoAvailable(): Promise<boolean> {
  const lm = languageModel as (PromptApi & { availability?: (o?: unknown) => Promise<string> }) | undefined;
  if (!nanoStream || !lm?.availability) { nanoAvailable = false; return false; }
  const was = nanoAvailable;
  try { nanoAvailable = (await lm.availability(NANO_CREATE_OPTIONS)) === 'available'; } catch { nanoAvailable = false; }
  // The model just became usable (a download finished): load it now, so the
  // cold start is not left for her first request.
  if (nanoAvailable && !was) warmKeeper.kick();
  // It stopped being available (evicted, or the model is being updated):
  // forget that it was warm, so it is loaded again when it comes back.
  if (!nanoAvailable && was) warmKeeper.reset();
  return nanoAvailable;
}
// Keeps Nano loaded: warms when the model becomes available, and once more
// (10 s later, when the model is idle) if a warm-up was pushed aside or failed.
const warmKeeper = createWarmKeeper({ warm: () => warmBoardOnDevice(), idle: () => nanoQueue.idle() });
if (nanoStream) {
  // As soon as the canvas is up: after its first paint, at the first idle
  // moment (bounded — hand tracking keeps the page busy), so the cold load
  // (up to ~45 s) is paid in the background, not by her first request.
  // Becoming usable warms it (refreshNanoAvailable → warmKeeper.kick); while
  // the warm-up loads, the engine bar says so. On-device only: never Gemini.
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  const schedule = (): { stop(): void } => startWarmSchedule({
    refresh: refreshNanoAvailable,
    available: () => nanoAvailable,
    subscribe: onWarmState,
    onState: (state) => handle?.nanoWarming(state),
    raf: typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : undefined,
    cancelRaf: (id) => cancelAnimationFrame(id as number),
    idle: typeof g.requestIdleCallback === 'function' ? (cb, o) => g.requestIdleCallback!(cb, o) : undefined,
    cancelIdle: (id) => g.cancelIdleCallback?.(id as number),
  });
  let warmSchedule = schedule();
  // Teardown: every pending callback and the subscription go with the page;
  // a page restored from the back/forward cache starts again.
  addEventListener('pagehide', () => warmSchedule.stop());
  addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) { warmSchedule.stop(); warmSchedule = schedule(); } });
  // An on-device call failed in a way that says the model was unloaded:
  // load it again now, before she asks for something else.
  onOnDeviceUnloaded(() => { warmKeeper.reset(); warmKeeper.kick(); });
}

const apple = {
  ready: false,
  androidNano: false,
  plugin: getAppleAIPlugin(),
};
const liveEngines = createEngines({
  languageModel: languageModel ?? null,
  // Nano is chosen for a turn only while Chrome says the model is
  // 'available' — never 'downloadable' or 'downloading' (a turn must not
  // start, or wait on, a multi-gigabyte download).
  get nanoStream() { return nanoAvailable ? nanoStream : null; },
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
const engines = replayOn ? createReplayEngines(mcWindow.__mcFixtures?.replies ?? {}) : liveEngines;
// Test build + ?sim=1 only: the devices a run registers (simulated, labelled SIM).
const simDevices = replayOn ? fixtureDevices(mcWindow.__mcFixtures?.devices) : null;

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
    // ?nanoTrace=1: how long the recognizer took to hand over her words.
    onHeard: (info) => replyTrace.heard(info.sinceStopMs, info.from),
    onError: (_code, message) => handle?.setTalkError(message),
  },
);
// Phone shells (Android and iPhone): ONE front camera for hand control,
// look-to-edit and — on the iPhone — hand sensing for the gimbal and
// point-to-connect (one getUserMedia, one tracker), opened only when a feature
// asks for it. The Capacitor App plugin's pause/resume also stops and
// restarts it (webviews don't reliably fire visibilitychange). Hand CONTROL
// (Hands pill) is off by default on both and facing-gated; iPhone SENSING
// never acts on the UI (phoneSensor.ts).
const phoneCamera = phoneHandsAllowed(phoneShell, phonePlatform)
  ? createPhoneCamera({ app: isPhone ? App : null, constraints: phonePlatform === 'ios' ? IPHONE_CAMERA_CONSTRAINTS : undefined })
  : undefined;
// The iPhone's live guest session (null while not joined): it answers the
// laptop's point request and re-announces its sensing status.
let guestSession: PhoneGuestSessionLike | null = null;
/** Frame ids of every stored board or drawing the canvas does not show
 *  (kept, over the cap, or past the store limit): new boards never take them. */
function reservedFrameIds(): string[] {
  const ids = new Set<string>();
  for (const id of keepIds) { const f = frameIdOfArtifactId(id); if (f) ids.add(f); }
  for (const a of loaded.ok) if (keepIds.has(a.id) && a.kind === 'plan') { const f = (a.data as { frameId?: unknown }).frameId; if (typeof f === 'string') ids.add(f); }
  return [...ids];
}
/** Who made a change: her own (hand edits, renames) unless the last kept
 *  history entry for that board says an engine; a replayed reply is 'replay'. */
function artifactMaker(id: string): ArtifactBy {
  const frameId = frameIdOfArtifactId(id);
  const last = frameId ? handle?.history().filter((h) => h.frameId === frameId && !h.undone).at(-1) : undefined;
  if (!last || last.by === 'her') return 'person';
  return replayOn ? 'replay' : last.by;
}
/** Every save: the layout now, the changed artifacts without waiting. */
function persistDoc(doc: CanvasDoc): void {
  const out = splitCanvasDoc(doc, artifacts, artifactMaker, Date.now(), keepIds);
  // A full localStorage (quota) must not stop the artifacts being kept.
  try { layoutStorage?.setItem(LAYOUT_KEY, JSON.stringify(out.layout)); } catch (e) { console.warn(`[mendcraft] couldn't keep the layout: ${e instanceof Error ? e.message : String(e)}`); }
  const gone = new Set(out.remove);
  const put = new Map(out.put.map((a) => [a.id, a]));
  artifacts = [...artifacts.filter((a) => !gone.has(a.id) && !put.has(a.id)), ...put.values()];
  for (const a of out.put) void artifactStore.put(a).catch((e) => console.warn(`[mendcraft] couldn't keep ${a.id}: ${e instanceof Error ? e.message : String(e)}`));
  for (const id of out.remove) void artifactStore.remove(id).catch(() => undefined);
}

handle = mountCanvas(root, {
  voice, engines, fresh: params.has('fresh'), sim: params.has('sim'),
  ...(simDevices ? { devices: simDevices.devices, deviceLabels: simDevices.labels } : {}),
  gimbalKeepAlive: params.get('gimbalKeepAlive') === '1',
  doc: startDoc,
  onPersist: persistDoc,
  artifactBy: (frameId) => artifacts.find((a) => a.id === `board-${frameId}`)?.by,
  dropped: loaded.dropped,
  loadNotes: loaded.notes,
  reservedFrameIds: reservedFrameIds(),
  storeNote: storeNotes.length ? storeNotes.join(' ') : undefined,
  phoneCamera,
  phoneSensing: phoneSensingAllowed(phoneShell, phonePlatform),
  sendPointResult: (text) => { void guestSession?.sendCommand({ kind: 'pointResult', text }).catch(() => undefined); },
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
      onSession: (s) => {
        guestSession = s;
        // Which device she faces (the laptop's pong carries it): a phone that
        // can't see her face only takes over when no other device has her.
        h.setRelayAttention(s ? {
          get: () => s.attention?.() ?? null,
          probe: () => { void s.ping?.(`f${Date.now().toString(36)}`).catch(() => undefined); },
        } : null);
        // Only the iPhone, only for its own platform, and only from the host
        // (the session drops any sensePoint not sent by the host).
        s?.onSensePoint?.((platform) => { if (phonePlatform === 'ios' && platform === 'ios' && h.phoneSenseStatus()) h.pointForLaptop(); });
        // Gimbal body language from the laptop (nod / shake / wakeup). The
        // session already validated + rate-limited it; no stand → no-op.
        if (phonePlatform === 'ios') s?.onGimbalCue?.((kind) => h.gimbalCue(kind));
        // The laptop's gimbal tile: follow me / follow my hands / hold still.
        // Same handler as the spoken phrase; the re-announce reports the result.
        if (phonePlatform === 'ios') s?.onGimbalMode?.((mode) => h.gimbalMode(mode));
      },
      joinExtras: { announceStatus: () => h.phoneSenseStatus() },
    });
    // A sensing change re-announces at once (the laptop row reads it).
    h.onPhoneSenseChange(() => {
      if (!guestSession) return;
      const storage = (() => { try { return localStorage; } catch { return null; } })();
      announcePhone(guestSession, phonePlatform, { deviceId: storage ? ensureDeviceId(storage) : undefined, native: isPhone, refresh: true, status: () => h.phoneSenseStatus() });
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
if (testBuild) mcWindow.__mcCanvas = handle;

// Warm App Check + cloud models in the background so the first keep isn't a
// cold start — but never under ?sim=1, which has no live model by design
// by design (same reasoning as skipping the WiZ bridge probe above); an
// auto-generated preview channel domain is often not in the App Check /
// reCAPTCHA authorized-domains list, so this call alone can 403 there for no
// reason a sim run needs to care about.
if (!params.has('sim')) {
  void prepareHybrid().then(async () => {
    // Say it once, up front, when this address can't pass App Check — rather
    // than leaving it to be discovered on the first Gemini turn.
    const blocked = await cloudAccessProblem();
    if (blocked) console.warn(`[mendcraft] ${blocked.line}. ${blocked.hint ?? ''}`);
  });
}
