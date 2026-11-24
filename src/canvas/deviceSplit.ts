// "Stays on this device / Goes to the cloud" — PURE, per-platform. The split is
// the honest answer to "what left this phone": the iPhone with the Apple
// on-device model (MendcraftAppleAI) keeps Quick/small edits, intent and
// redaction local and only sends big boards to Gemini; the Nothing phone has no
// on-device model, so edits go to Gemini cloud — but gaze frames, the pin state,
// rules and WiZ LAN still never leave the device.

export type DevicePlatform = 'ios' | 'android' | 'laptop';

export interface DeviceSplit {
  /** Short badge: "Apple · on device" or "Gemini · cloud". */
  badge: string;
  /** What never leaves the device. */
  stays: string[];
  /** What is sent to the cloud (Gemini via Firebase AI Logic). */
  goes: string[];
  /** True when there is a usable on-device model (Apple Foundation Models). */
  onDevice: boolean;
}

/** Things that ALWAYS stay local, on every phone, regardless of model. */
const ALWAYS_LOCAL = [
  'Gaze camera frames',
  'Pin state',
  'Local rules',
  'WiZ lamp (LAN)',
  'Pairing-chime mic (never uploaded)',
] as const;

/**
 * The stays/goes split + badge for a platform. `hasAppleAI` reflects whether the
 * Apple Foundation Models plugin is actually available (iPhone 15 Pro+); when it
 * is, Quick path work stays on device and only big boards escalate to Gemini.
 */
export function deviceSplit(platform: DevicePlatform, hasAppleAI = false): DeviceSplit {
  if (platform === 'ios' && hasAppleAI) {
    return {
      badge: 'Apple · on device',
      onDevice: true,
      stays: [
        'Quick edits',
        'Small edits',
        'Intent parsing',
        'Redaction',
        ...ALWAYS_LOCAL,
      ],
      goes: ['Big boards → Gemini cloud'],
    };
  }
  // Nothing phone (no Nano / no Apple model) and the iPhone off its model path:
  // edits route to Gemini cloud, but presence/pin/rules/LAN still stay local.
  return {
    badge: 'Gemini · cloud',
    onDevice: false,
    stays: [...ALWAYS_LOCAL],
    goes: ['Edits & boards → Gemini cloud', 'Intent → Gemini cloud'],
  };
}

/** One honest line for a sync status row. */
export function splitSummary(split: DeviceSplit): string {
  return split.onDevice
    ? 'Quick edits stay on this phone; big boards use Gemini.'
    : 'Edits use Gemini cloud; gaze, pin, rules and the lamp stay on this phone.';
}
