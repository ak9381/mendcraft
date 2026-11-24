// Apple on-device Foundation Models, reached through the Capacitor plugin
// MendcraftAppleAI (ios-src/MendcraftAppleAIPlugin.swift). Used only in the
// iOS shell. Cloud Gemini stays on the existing Firebase web path.
//
// Firebase's iOS HybridModel API was removed in firebase-ios-sdk 13.2.0
// (16 Nov 2026), so this talks to Apple's FoundationModels framework
// directly. Untested until Akash builds it in Xcode.

import { isIosShell } from '../devices/native';
import type { TextGenModel } from './hybrid';
import type { DeviceModelStatus } from './hybrid';
import type { NanoStatus } from './privacyRouter';

export type AppleAvailabilityStatus =
  | 'available'
  | 'deviceNotEligible'
  | 'appleIntelligenceNotEnabled'
  | 'modelNotReady'
  | 'unavailable'
  | 'unsupported';

export interface AppleAvailability {
  status: AppleAvailabilityStatus;
}

export interface AppleGenerateResult {
  text: string;
  source: 'on_device';
}

export interface AppleAIPlugin {
  availability(): Promise<{ status?: string }>;
  generate(opts: {
    prompt: string;
    schema?: string;
    instructions?: string;
  }): Promise<{ text?: string; source?: string }>;
  prewarm?(): Promise<{ ok?: boolean; status?: string }>;
}

interface CapacitorGlobal {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: { MendcraftAppleAI?: AppleAIPlugin };
  };
}

export function getAppleAIPlugin(w: unknown = globalThis): AppleAIPlugin | null {
  if (!isIosShell(w)) return null;
  return (w as CapacitorGlobal).Capacitor?.Plugins?.MendcraftAppleAI ?? null;
}

const STATUSES = new Set<AppleAvailabilityStatus>([
  'available',
  'deviceNotEligible',
  'appleIntelligenceNotEnabled',
  'modelNotReady',
  'unavailable',
  'unsupported',
]);

export function parseAppleStatus(raw: string | undefined): AppleAvailabilityStatus {
  return raw && STATUSES.has(raw as AppleAvailabilityStatus)
    ? (raw as AppleAvailabilityStatus)
    : 'unavailable';
}

export function appleStatusToNano(status: AppleAvailabilityStatus): NanoStatus {
  if (status === 'available') return 'available';
  if (status === 'modelNotReady') return 'downloading';
  return 'unavailable';
}

export function appleStatusToDevice(status: AppleAvailabilityStatus): DeviceModelStatus {
  if (status === 'available') return 'ready';
  if (status === 'modelNotReady') return 'downloading';
  if (status === 'unsupported') return 'unsupported';
  return 'unavailable';
}

export async function checkAppleAvailability(
  plugin: AppleAIPlugin | null = getAppleAIPlugin(),
): Promise<AppleAvailability | null> {
  if (!plugin?.availability) return null;
  try {
    const raw = await plugin.availability();
    return { status: parseAppleStatus(raw.status) };
  } catch {
    return { status: 'unavailable' };
  }
}

/** TextGenModel that talks to the Apple plugin and always labels on_device. */
export function appleTextModel(
  schema?: Record<string, unknown>,
  plugin: AppleAIPlugin | null = getAppleAIPlugin(),
  instructions?: string,
): TextGenModel {
  return {
    generateContent: async (request: string) => {
      if (!plugin?.generate) throw new Error('Apple on-device model is not available');
      const out = await plugin.generate({
        prompt: request,
        schema: schema ? JSON.stringify(schema) : undefined,
        instructions,
      });
      const text = typeof out.text === 'string' ? out.text : '';
      return { response: { text: () => text, inferenceSource: 'on_device' } };
    },
    initializeDeviceModel: async () => {
      await plugin?.prewarm?.();
    },
  };
}

/** Stream adapter for the canvas Quick draft (one shot; the plugin is not streamed). */
export async function generateAppleText(
  prompt: string,
  onText: (full: string) => void,
  plugin: AppleAIPlugin | null = getAppleAIPlugin(),
  schema?: Record<string, unknown>,
): Promise<string> {
  if (!plugin?.generate) throw new Error('Apple on-device model is not available');
  const out = await plugin.generate({
    prompt,
    schema: schema ? JSON.stringify(schema) : undefined,
  });
  const text = typeof out.text === 'string' ? out.text : '';
  onText(text);
  return text;
}
