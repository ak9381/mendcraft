// Remote Config: cloud model name, a prompt preamble for the big cloud jobs,
// and server prompt-template IDs — all with in-app defaults. The INITIAL fetched
// values are applied (the cloud model name is read when the models are built);
// a realtime listener keeps the preamble and template IDs (read per request)
// live without a redeploy. Defaults ship in-app, so nothing here is required.

import type { FirebaseApp } from 'firebase/app';

export interface RemoteSettings {
  /** Cloud model name applied to every in-cloud generateContent call. */
  cloudModel: string;
  /** Prepended to the big cloud-job prompts; '' = no change. */
  promptPreamble: string;
  /** Server prompt-template IDs per big job; '' = use the inline prompt. */
  templateIds: { plan: string; screen: string; part: string };
  /** Cloud text-to-speech model name (spoken replies in her language). */
  ttsModel: string;
  /** Prebuilt cloud voice name for TTS (e.g. a Chirp3 HD voice). */
  ttsVoice: string;
}

export const REMOTE_DEFAULTS: RemoteSettings = {
  cloudModel: 'gemini-3.5-flash-lite',
  promptPreamble: '',
  templateIds: { plan: '', screen: '', part: '' },
  ttsModel: 'gemini-2.5-flash-preview-tts',
  ttsVoice: 'Kore',
};

const KEYS = {
  cloudModel: 'cloud_model',
  promptPreamble: 'cloud_prompt_preamble',
  planTemplate: 'template_plan_generate',
  screenTemplate: 'template_screen_generate',
  partTemplate: 'template_part_design',
  ttsModel: 'cloud_tts_model',
  ttsVoice: 'cloud_tts_voice',
} as const;

/** 30 min, matching the Android sample's minimumFetchIntervalInSeconds = 1800. */
const MIN_FETCH_INTERVAL_MS = 1_800_000;

let current: RemoteSettings = cloneDefaults();

function cloneDefaults(): RemoteSettings {
  return { ...REMOTE_DEFAULTS, templateIds: { ...REMOTE_DEFAULTS.templateIds } };
}

/** The settings in effect right now (defaults until initRemoteConfig resolves). */
export function remoteSettings(): RemoteSettings {
  return current;
}

/** Test seam: forget any fetched values and return to in-app defaults. */
export function resetRemoteConfig(): void {
  current = cloneDefaults();
}

/** Test seam: force settings (merged over defaults) without Firebase. */
export function setRemoteConfigForTest(partial: Partial<RemoteSettings>): void {
  current = {
    ...cloneDefaults(),
    ...partial,
    templateIds: { ...REMOTE_DEFAULTS.templateIds, ...(partial.templateIds ?? {}) },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function read(getString: (rc: any, key: string) => string, rc: any): RemoteSettings {
  const nonEmpty = (v: string, fallback: string) => (v && v.trim() ? v : fallback);
  return {
    cloudModel: nonEmpty(getString(rc, KEYS.cloudModel), REMOTE_DEFAULTS.cloudModel),
    promptPreamble: getString(rc, KEYS.promptPreamble),
    templateIds: {
      plan: getString(rc, KEYS.planTemplate),
      screen: getString(rc, KEYS.screenTemplate),
      part: getString(rc, KEYS.partTemplate),
    },
    ttsModel: nonEmpty(getString(rc, KEYS.ttsModel), REMOTE_DEFAULTS.ttsModel),
    ttsVoice: nonEmpty(getString(rc, KEYS.ttsVoice), REMOTE_DEFAULTS.ttsVoice),
  };
}

/**
 * Fetch + activate Remote Config and apply it. Best-effort: any failure (unsupported
 * environment, no network) leaves the in-app defaults in place. onUpdate fires on
 * later realtime config changes so the preamble / template IDs stay current.
 */
export async function initRemoteConfig(
  app: FirebaseApp,
  onUpdate?: (s: RemoteSettings) => void,
): Promise<RemoteSettings> {
  try {
    const rcMod = await import('firebase/remote-config');
    const { getRemoteConfig, fetchAndActivate, getString, isSupported } = rcMod;
    if (typeof isSupported === 'function' && !(await isSupported())) return current;
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = MIN_FETCH_INTERVAL_MS;
    rc.defaultConfig = {
      [KEYS.cloudModel]: REMOTE_DEFAULTS.cloudModel,
      [KEYS.promptPreamble]: REMOTE_DEFAULTS.promptPreamble,
      [KEYS.planTemplate]: REMOTE_DEFAULTS.templateIds.plan,
      [KEYS.screenTemplate]: REMOTE_DEFAULTS.templateIds.screen,
      [KEYS.partTemplate]: REMOTE_DEFAULTS.templateIds.part,
      [KEYS.ttsModel]: REMOTE_DEFAULTS.ttsModel,
      [KEYS.ttsVoice]: REMOTE_DEFAULTS.ttsVoice,
    };
    await fetchAndActivate(rc);
    current = read(getString, rc);
    // Realtime updates (best-effort): re-activate and re-read on change.
    try {
      const { onConfigUpdate, activate } = rcMod;
      if (typeof onConfigUpdate === 'function') {
        onConfigUpdate(rc, {
          next: async () => {
            try {
              await activate(rc);
              current = read(getString, rc);
              onUpdate?.(current);
            } catch {
              /* keep the last-good settings */
            }
          },
          error: () => {},
          complete: () => {},
        });
      }
    } catch {
      /* realtime listener unavailable — the one-shot fetch above still applied */
    }
    return current;
  } catch {
    return current;
  }
}
