// Entry for /canvas.html (sim-main smart canvas).
import '../style.css';
import './canvas.css';
import { mountCanvas } from './canvasApp';
import { autoHandsFromSearch } from './canvasHands';
import { isPhoneCanvasShell } from './iphoneShell';
import { applyGuestSnapshot, phoneRouteBadge, startPhoneLookToEdit } from './phoneCanvasRuntime';
import { createArrivalGate } from './boardGlow';
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
import { createReplayEngines, fixtureDevices, recordingEngines, type RecordedMeta } from './replayEngine';
import { remoteSettings } from '../firebase/remoteConfig';
import { redactForCloud } from '../ai/redact';
import { joinCanvasDoc, LAYOUT_KEY, tooManyBoardsLine, unjoinedIds } from './canvasPersistence';
import { loadArtifacts, openArtifactStore, overCapLine, STORE_FALLBACK_LINE, STORE_READ_FAILED_LINE } from '../artifacts/store';
import { frameIdOfArtifactId, type Artifact, type ArtifactBy } from '../artifacts/artifact';
import type { CanvasDoc } from './frames';
import { clearStoreForFresh, createOneWriter, createSaveFailNotice, loadLayout, loadLine, openFresh, reservedIds, revertFailedSave, saveCanvasDoc, STORE_SAVE_OFF_LINE, type SaveFailure } from './canvasStore';
import { coerceSnapshot } from '../relay/controlSnapshot';
import { wizTokenFreeUrl } from '../devices/wizClient';

const params = new URLSearchParams(location.search);
/** Test hooks and replay engines: dev server or a VITE_E2E=1 build only. */
const testBuild = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
/** Recording (scripts/record-fixtures.mjs): a test build with ?record=1&sim=1
 *  runs the LIVE models and keeps each reply in window.__mcRecorded. ?sim=1 is
 *  required (not added here) so every module that reads it from the address
 *  sees a SIM run: the devices and phones are the SIM fixtures the replay
 *  uses, so nothing real can reach a prompt or a reply. Never on in a
 *  production build. */
const recordOn = testBuild && params.get('record') === '1' && params.get('sim') === '1';
/** Replay engines answer from recorded replies only in a test build with ?sim=1. */
const replayOn = testBuild && params.get('sim') === '1' && !recordOn;
/** ?sim=1 means no live model — except while recording. Test builds only:
 *  in production ?sim is an ordinary address (final review I12). */
const noLiveModel = testBuild && params.has('sim') && !recordOn;
/** A SIM run: simulated devices and phones, no WiZ discovery, no Spotify, no
 *  real relay (canvasApp's `sim`). Recording always is one. */
const simRun = testBuild && (params.has('sim') || recordOn);
type Recorded = RecordedMeta & { recordedAt: string; source: 'recorded'; reply: string };
type McWindow = Window & { __mcCanvas?: unknown; __mcArtifacts?: unknown; __mcFixtures?: { replies?: Record<string, string>; recorded?: string[]; liveShape?: string[]; devices?: unknown }; __mcRecorded?: Record<string, Recorded>; __mcRecording?: { inFlight: number; skipped: string[] } };
const mcWindow = window as McWindow;

// ---- the starting document: layout (localStorage) + artifacts (the store) ----
// ?fresh=1 starts with no layout (and, in a test build, no stored artifacts)
// — but the saved layout is copied aside first (never just deleted), and
// `fresh` leaves the address bar so a later reload of this tab (a redeploy,
// F5) opens what she built here instead of wiping it again. A failed copy
// means this open is NOT fresh (nothing is reset).
const layoutStorage = (() => { try { return localStorage; } catch { return null; } })();
const freshOpen = openFresh(layoutStorage, location.href);
if (freshOpen.url) { try { history.replaceState(history.state, '', freshOpen.url); } catch { /* keep the address */ } }
// ?wizToken= is stored, then leaves the address bar (it would show on camera).
const tokenFree = wizTokenFreeUrl(location.href, layoutStorage);
if (tokenFree) { try { history.replaceState(history.state, '', tokenFree); } catch { /* keep the address */ } }
const { store: artifactStore, persistent } = await openArtifactStore();
// A test build's ?fresh also empties the store — after copying it aside.
if (freshOpen.fresh && testBuild && !(await clearStoreForFresh(artifactStore, layoutStorage))) console.warn('[mendcraft] ?fresh: stored boards could not be copied aside, so they were kept.');
const loaded = await loadArtifacts(artifactStore);
let artifacts: Artifact[] = loaded.ok;
// A layout this build can't read is copied aside before anything can write;
// if even that fails, the layout is not saved this session (canvasStore.ts).
const layoutLoad = loadLayout(layoutStorage, LAYOUT_KEY);
const layout = layoutLoad.layout;
const layoutSaveBlocked = !layoutLoad.safe;
const joinDropped: { id: string; why: string }[] = [];
const startDoc = joinCanvasDoc(layout, artifacts, (d) => joinDropped.push(d));
// What the canvas does not show is never removed or overwritten by a save:
// boards past the cap, every board when the join failed, over-cap rows.
const keepIds = new Set([...unjoinedIds(startDoc, artifacts), ...loaded.overCap]);
artifacts = artifacts.filter((a) => !keepIds.has(a.id));
if (keepIds.size) console.warn(`[mendcraft] ${keepIds.size} stored item(s) not on the canvas are kept as they are.`);
/** The Artifacts sheet's import line, kept across the reload that opens what it imported. */
const IMPORT_NOTE_KEY = 'mc.artifacts.importNote';
const importNote = (() => {
  try { const v = sessionStorage.getItem(IMPORT_NOTE_KEY); sessionStorage.removeItem(IMPORT_NOTE_KEY); return (v ?? '').slice(0, 300); } catch { return ''; }
})();
const storeNotes = [
  importNote,
  loadLine(layoutLoad) ?? '',
  persistent ? '' : STORE_FALLBACK_LINE,
  loaded.readFailed ? `${STORE_READ_FAILED_LINE} ${STORE_SAVE_OFF_LINE}` : '',
  loaded.overCap.length ? overCapLine(loaded.overCap.length) : '',
  joinDropped.length ? tooManyBoardsLine(joinDropped.length) : '',
  !startDoc && keepIds.size > 0 ? "Stored boards couldn't be opened together. Nothing stored was changed." : '',
].filter(Boolean);
if (testBuild) mcWindow.__mcArtifacts = artifactStore;

// People directory: tokens in cloud prompts, real names filled back on device.
// ?sim=1 keeps it in memory for the run; nobody is seeded.
const directoryStore = simRun ? createMemoryDirectoryStore([]) : createIndexedDbDirectoryStore();
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
const nanoStream: OnDeviceStream | null = languageModel && !isPhone && !noLiveModel && isEnabled()
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
  sim: noLiveModel,
});
/** A recording keeps each live reply as its fixture file will hold it,
 *  with names and emails redacted as in a cloud prompt. The digit-run
 *  (phone number) rule is left out: it would rewrite numbers inside the
 *  reply's JSON (plan sizes, levels). scripts/record-fixtures.mjs refuses
 *  to write a reply holding anything else personal. */
function recordReply(key: string, reply: string, meta: RecordedMeta): void {
  const book = (mcWindow.__mcRecorded ??= {});
  book[key] = { ...meta, recordedAt: new Date().toISOString(), source: 'recorded', reply: redactForCloud(reply, [], { phones: false }).text };
}
if (recordOn) mcWindow.__mcRecording = { inFlight: 0, skipped: [] };
const engines = recordOn
  ? recordingEngines(liveEngines, recordReply, {
      modelOf: (id) => (id === 'nano' ? 'gemini-nano (Chrome built-in)' : remoteSettings().cloudModel),
      onSkip: (line) => { (mcWindow.__mcRecording ??= { inFlight: 0, skipped: [] }).skipped.push(line); console.warn(`[mendcraft] record: ${line}`); },
      onFlight: (n) => { (mcWindow.__mcRecording ??= { inFlight: 0, skipped: [] }).inFlight = n; },
    })
  : replayOn ? createReplayEngines(mcWindow.__mcFixtures?.replies ?? {}, { recorded: mcWindow.__mcFixtures?.recorded, liveShape: mcWindow.__mcFixtures?.liveShape }) : liveEngines;
// Test build + ?sim=1 only: the devices a run registers (simulated, labelled SIM).
const simDevices = replayOn || recordOn ? fixtureDevices(mcWindow.__mcFixtures?.devices) : null;

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
/** Frame ids new boards never take (canvasStore.reservedIds). */
function reservedFrameIds(): string[] {
  return reservedIds({ keepIds, loaded: loaded.ok, readFailed: !!loaded.readFailed, layout });
}
/** Who made what an artifact shows now. A board this phone received keeps
 *  the laptop's maker until she edits it here. Then this session's own
 *  change (canvasApp makerOf: hers → 'person', a model's → that engine, a
 *  replayed reply → 'replay'; a drawing has its own maker, so her hand edit
 *  to a generated plan makes the drawing hers and leaves the board the
 *  engine's). With no change this session — an app-made re-fit, such as a
 *  lamp tile re-bound after a reload — the stored maker stands. */
function artifactMaker(id: string): ArtifactBy {
  const frameId = frameIdOfArtifactId(id);
  const received = frameId ? handle?.receivedBy(frameId) : undefined;
  if (received) return received;
  const made = handle?.makerOf(id);
  if (made) return made === 'person' ? 'person' : replayOn ? 'replay' : made;
  return artifacts.find((a) => a.id === id)?.by ?? 'person';
}
/** Who made the board on a frame, as the next save would record it: the
 *  stored artifact's maker while its content is unchanged, else the maker of
 *  this session's change. Undefined for a board nobody made (never stored, no
 *  change this session): such a board is not sent to a phone. */
function boardMaker(frameId: string): ArtifactBy | undefined {
  const id = `board-${frameId}`;
  const plan = handle?.snapshot().surfaces[frameId];
  if (!plan) return undefined;
  const stored = artifacts.find((a) => a.id === id);
  if (stored && JSON.stringify((stored.data as { plan?: unknown }).plan) === JSON.stringify(plan)) return stored.by;
  const touched = !!handle?.receivedBy(frameId) || !!handle?.makerOf(id) || !!stored;
  return touched ? artifactMaker(id) : undefined;
}
/** Every save: the layout now, the changed artifacts without waiting.
 *  Nothing is written when the store couldn't be read (an unread board must
 *  never be overwritten), nor the layout when it couldn't be kept safe. */
/** Set once an import is about to reload the page: nothing more is saved
 *  (a save now could write the old board over the one just imported). */
let reloading = false;
/** A failed save is said once (until one works) and tried again on the next
 *  change: the failed artifact is not counted as stored. */
const saveFail = createSaveFailNotice();
function saveFailed(f: SaveFailure): void {
  artifacts = revertFailedSave(artifacts, f);
  const line = saveFail.after(false);
  if (line) handle?.say(line);
}
const saveOk = (): void => { saveFail.after(true); };
function persistDoc(doc: CanvasDoc): void {
  if (reloading) return;
  artifacts = saveCanvasDoc(doc, artifacts, artifactMaker, Date.now(), keepIds, {
    layoutStorage, store: artifactStore, layoutBlocked: layoutSaveBlocked, storeBlocked: !!loaded.readFailed,
    onFail: saveFailed, onOk: saveOk,
  });
  // A connector or next steps the store refused is written again too.
  oneWriter.retry();
}
/** One artifact written on its own (a connector, next steps). Never to a
 *  store that could not be read; a failure is said and, like a board save,
 *  tried again on the next change. */
const oneWriter = createOneWriter({
  get: () => artifacts,
  set: (list) => { artifacts = list; },
  put: (a) => artifactStore.put(a),
  blocked: () => !!loaded.readFailed || reloading,
  onOk: saveOk,
  onFail: saveFailed,
});
function keepOne(a: Artifact): void { oneWriter.keep(a); }

handle = mountCanvas(root, {
  voice, engines, fresh: freshOpen.fresh, sim: simRun,
  ...(simDevices && Object.keys(simDevices.devices).length ? { devices: simDevices.devices, deviceLabels: simDevices.labels } : {}),
  ...(simDevices?.stand ? { simStand: true } : {}),
  gimbalKeepAlive: params.get('gimbalKeepAlive') === '1',
  doc: startDoc,
  onPersist: persistDoc,
  artifactBy: boardMaker,
  // Lamp connectors she approved (each checked again at load, in loadArtifacts).
  connectors: artifacts.filter((a) => a.kind === 'connector'),
  // Language packs she approved (each checked again at load).
  packs: artifacts.filter((a) => a.kind === 'pack'),
  onConnector: keepOne,
  // Generated next-step suggestions (each checked again at load, in loadArtifacts).
  steps: artifacts.filter((a) => a.kind === 'steps'),
  // A store that could not be read is never written to this session.
  onSteps: keepOne,
  dropped: loaded.dropped,
  loadNotes: loaded.notes,
  // The Artifacts sheet: list, Remove, Export, Import (an import reloads, so
  // every imported artifact is checked and opened exactly as a load does).
  artifactStore,
  artifactsReadOnly: !!loaded.readFailed,
  onArtifactsRemoved: (ids) => { const gone = new Set(ids); artifacts = artifacts.filter((a) => !gone.has(a.id)); },
  onArtifactsImported: (line) => {
    reloading = true;
    // Said again once the page is back (a partial failure too).
    try { if (line) sessionStorage.setItem(IMPORT_NOTE_KEY, line); } catch { /* the line was said once already */ }
    setTimeout(() => location.reload(), 1200);
  },
  artifactInfo: (frameId) => { const a = artifacts.find((x) => x.id === `board-${frameId}`); return a ? { by: a.by, at: a.at, ...(a.imported ? { imported: true } : {}) } : undefined; },
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
        sim: simRun,
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
      sim: simRun,
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
    startPhoneLookToEdit(handle, { sim: simRun, camera: phoneCamera });
    // Join laptop: a remembered pair rejoins silently (no mic); otherwise the
    // phone shows "Join laptop", which opens the mic only when tapped and
    // joins by the laptop's chime (or a typed code). Every join binds the AI
    // feed forwarder and the re-announce (joinPhoneSession).
    const h = handle;
    const sim = simRun;
    // A board the laptop really sent lights up once ("Moved from laptop");
    // the gate remembers the last send, so replays and reloads stay quiet.
    const arrival = { gate: createArrivalGate((() => { try { return localStorage; } catch { return null; } })()), now: () => Date.now() };
    let ui: { update(): void } | null = null;
    const link = createLaptopLink({
      storage: (() => { try { return localStorage; } catch { return null; } })(),
      platform: phonePlatform,
      native: isPhone,
      sim,
      aiForwarder: phoneAiFeed,
      // A snapshot buffered for a late listener is age-checked; a live one is not.
      onSnapshot: (snap, meta) => { applyGuestSnapshot(snap, h.showRemoteBoard, phonePlatform, h.say, { ...arrival, buffered: !!meta?.buffered }); },
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
    // Sim + dev/e2e build: feed a relay `state` snapshot (wire JSON) through the
    // SAME path a real one takes (coerceSnapshot, then applyGuestSnapshot).
    if (sim && (import.meta.env.DEV || import.meta.env.VITE_E2E === '1')) {
      (window as unknown as { __mcGuestSnapshot?: (raw: unknown) => boolean }).__mcGuestSnapshot = (raw) => {
        const snap = coerceSnapshot(raw);
        return !!snap && applyGuestSnapshot(snap, h.showRemoteBoard, phonePlatform, h.say, arrival);
      };
    }
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
if (!noLiveModel) {
  void prepareHybrid().then(async () => {
    // Say it once, up front, when this address can't pass App Check — rather
    // than leaving it to be discovered on the first Gemini turn.
    const blocked = await cloudAccessProblem();
    if (blocked) console.warn(`[mendcraft] ${blocked.line}. ${blocked.hint ?? ''}`);
  });
}
