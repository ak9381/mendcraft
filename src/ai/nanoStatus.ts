// On-device Nano availability. Android uses ML Kit GenAI checkStatus
// (MendcraftNano plugin). Chrome uses the Prompt API. Web without either
// reports unavailable. Pure mapping is in privacyRouter; this file talks to
// the shell.
import {
  labelNanoStatus,
  mapMlKitStatus,
  type NanoStatus,
} from './privacyRouter';

export interface NanoCheck {
  status: NanoStatus;
  label: string;
  source: 'mlkit' | 'prompt-api' | 'none';
  isPhone: boolean;
}

interface CapacitorGlobal {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: {
      MendcraftNano?: {
        checkStatus: () => Promise<{ status?: number | string }>;
      };
    };
  };
  LanguageModel?: unknown;
}

export function isNativePhone(w: unknown = globalThis): boolean {
  const c = (w as CapacitorGlobal).Capacitor;
  if (!c?.isNativePlatform?.()) return false;
  const p = c.getPlatform?.();
  return p === 'android' || p === 'ios';
}

export function isAndroidShell(w: unknown = globalThis): boolean {
  const c = (w as CapacitorGlobal).Capacitor;
  return Boolean(c?.isNativePlatform?.()) && c?.getPlatform?.() === 'android';
}

function hasPromptApi(w: unknown): boolean {
  return typeof (w as CapacitorGlobal).LanguageModel !== 'undefined'
    && (w as CapacitorGlobal).LanguageModel != null;
}

/** Check ML Kit (Android) or Chrome's Prompt API. Never throws. */
export async function checkDeviceNano(w: unknown = globalThis): Promise<NanoCheck> {
  const phone = isNativePhone(w);
  if (isAndroidShell(w)) {
    const plugin = (w as CapacitorGlobal).Capacitor?.Plugins?.MendcraftNano;
    if (plugin?.checkStatus) {
      try {
        const raw = await plugin.checkStatus();
        const code = typeof raw.status === 'number' ? raw.status : Number(raw.status);
        const status = Number.isFinite(code) ? mapMlKitStatus(code) : 'unknown';
        return { status, label: labelNanoStatus(status, true), source: 'mlkit', isPhone: true };
      } catch {
        return { status: 'unavailable', label: labelNanoStatus('unavailable', true), source: 'mlkit', isPhone: true };
      }
    }
    return { status: 'unavailable', label: labelNanoStatus('unavailable', true), source: 'none', isPhone: true };
  }
  if (hasPromptApi(w) && !phone) {
    return { status: 'available', label: labelNanoStatus('available', false), source: 'prompt-api', isPhone: false };
  }
  if (phone) {
    return { status: 'unavailable', label: labelNanoStatus('unavailable', true), source: 'none', isPhone: true };
  }
  return { status: hasPromptApi(w) ? 'available' : 'unavailable', label: labelNanoStatus(hasPromptApi(w) ? 'available' : 'unavailable', false), source: hasPromptApi(w) ? 'prompt-api' : 'none', isPhone: false };
}

export function hasUsableNano(check: NanoCheck): boolean {
  return check.status === 'available';
}
