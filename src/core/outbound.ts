// KNOWN OUTBOUND SURFACES — the single registry of every way a byte can leave
// this device, and the ledger's list of known outbound *kinds*.
//
// The "What left this device" ledger (core/ledger.ts) is the runtime accounting
// of cloud calls. THIS file is the static counterpart: a declared allowlist of
// which source files are permitted to open each network/cloud primitive, and
// which ledger job names are allowed to be a `cloud` event. The privacy-drift
// test (tests/privacyDrift.test.ts) statically scans src/ and fails if:
//   - a network/cloud primitive appears in a file that is NOT registered here
//     (someone added a new way off the device without declaring it), or
//   - a `cloud` ledger job name is used that is not in CLOUD_LEDGER_JOBS, or
//   - docs/PRIVACY.md does not mention a declared outbound kind.
//
// So adding a genuinely new outbound path forces a matching edit here + in
// docs/PRIVACY.md, and the honest badge / ledger / privacy ledger stay in sync.
//
// Pure data — no DOM, no network. Paths are repo-relative (from app/).

export interface OutboundSurface {
  /** Stable kind id, also used as the phrase the privacy docs must mention. */
  kind: string;
  /** Short human label for the kind. */
  label: string;
  /** A source-level primitive (JS RegExp source) that opens this surface. */
  primitive: string;
  /** The ONLY source files allowed to contain `primitive`. */
  files: readonly string[];
  /** True if data can actually leave the machine on this surface. */
  leavesDevice: boolean;
  /** Plain-language note: what is sent, and what is NOT. */
  note: string;
}

export const KNOWN_OUTBOUND: readonly OutboundSurface[] = [
  {
    kind: 'cloud-ai-model',
    label: 'Firebase AI Logic model',
    primitive: 'getGenerativeModel\\(',
    files: ['src/ai/hybrid.ts'],
    leavesDevice: true,
    note:
      'All Gemini models are built in one place. Only the cloud-mode models send ' +
      'anything out; what is sent is the abstract command text + design ops (plus, ' +
      'ONLY for point-and-say, one cropped still). Camera/hand/face/voice streams never pass here.',
  },
  {
    kind: 'cloud-inference',
    label: 'ONLY_IN_CLOUD inference',
    primitive: 'InferenceMode\\.ONLY_IN_CLOUD',
    files: ['src/ai/hybrid.ts'],
    leavesDevice: true,
    note: 'Big jobs (generate plan/ui, a11y explain, TTS, escalated intent/deixis) that run in the cloud.',
  },
  {
    kind: 'prefer-on-device',
    label: 'PREFER_ON_DEVICE inference',
    primitive: 'InferenceMode\\.PREFER_ON_DEVICE',
    files: ['src/ai/hybrid.ts'],
    leavesDevice: true,
    note: 'Runs on Nano when available; may fall back to the cloud. Every fallback is recorded in the ledger as a cloud call.',
  },
  {
    kind: 'on-device-only',
    label: 'ONLY_ON_DEVICE inference',
    primitive: 'InferenceMode\\.ONLY_ON_DEVICE',
    files: ['src/ai/hybrid.ts'],
    leavesDevice: false,
    note: 'Hand-adaptive profile pick. No inCloudParams at all; raw hand numbers can never leave the device even if Nano is missing.',
  },
  {
    kind: 'lan-bridge',
    label: 'Local WiZ lamp bridge',
    primitive: '\\bfetch\\(',
    files: ['src/devices/wizClient.ts'],
    leavesDevice: false,
    note: 'HTTP to 127.0.0.1 (the local Node bridge) which speaks UDP to the lamp on the LAN. Nothing goes to the internet.',
  },
  {
    kind: 'firestore-relay',
    label: 'Firestore relay room',
    primitive: '\\b(addDoc|setDoc|updateDoc|writeBatch)\\(',
    files: ['src/relay/firestoreTransport.ts', 'src/recipes/sync.ts'],
    leavesDevice: true,
    note:
      'Phone<->laptop pairing and taught-recipe sync write to a Firestore room doc. ' +
      'Relay carries privacy-safe control snapshots, taught recipe summaries, commands, and — ' +
      'ONLY when the user pairs a phone camera — still frames. Frames go to the paired device, never to Gemini.',
  },
  {
    kind: 'remote-config',
    label: 'Remote Config fetch',
    primitive: 'fetchAndActivate',
    files: ['src/firebase/remoteConfig.ts'],
    leavesDevice: true,
    note: 'Fetches model ids / prompt template ids / flags. A one-way config pull; no user data is sent.',
  },
];

/** The ledger job names that are allowed to be a `cloud` event. The drift test
 *  scans recordLedger('cloud', …)/source:'cloud' literals and asserts each base
 *  job (suffixes like " (queued)"/" (escalated)" stripped) is in this set. */
export const CLOUD_LEDGER_JOBS: readonly string[] = [
  'tts',
  'phone pairing',
  'recipe sync',
  'generate',
  'command',
  'intent',
  'fuse',
  'verify',
  'a11y-explain',
  'deixis',
];

/** Strip the parenthetical state suffix a ledger job can carry, e.g.
 *  "generate (queued)" -> "generate", "intent (escalated)" -> "intent". */
export function baseLedgerJob(job: string): string {
  return job.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Is this ledger job name a declared outbound kind? */
export function isKnownCloudJob(job: string): boolean {
  return CLOUD_LEDGER_JOBS.includes(baseLedgerJob(job));
}
