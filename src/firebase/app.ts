// Firebase app init + config, split out of src/ai/hybrid.ts so the AI entry
// point stays thin. This module owns env() and the "is Firebase configured?"
// check; everything else (App Check, Remote Config, telemetry) builds on the
// FirebaseApp this returns.

import type { FirebaseApp } from 'firebase/app';
import { isUsableFirebaseApiKey } from './envGuard';

export { PLACEHOLDER_RE } from './envGuard';

export interface Env {
  [key: string]: string | boolean | undefined;
}

export function env(): Env {
  return ((import.meta as unknown as { env?: Env }).env ?? {}) as Env;
}

/** Firebase is usable only with a real API key (a placeholder means rules-only). */
export function isFirebaseConfigured(): boolean {
  return isUsableFirebaseApiKey(env().VITE_FIREBASE_API_KEY);
}

/** Reuse the already-initialised app (HMR-safe) or create one from env. */
export async function getFirebaseApp(): Promise<FirebaseApp> {
  const e = env();
  const { initializeApp, getApps } = await import('firebase/app');
  return (
    getApps()[0] ??
    initializeApp({
      apiKey: String(e.VITE_FIREBASE_API_KEY),
      authDomain: e.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
      projectId: e.VITE_FIREBASE_PROJECT_ID as string | undefined,
      appId: e.VITE_FIREBASE_APP_ID as string | undefined,
      messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
      storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
    })
  );
}
