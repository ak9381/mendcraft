// Inference telemetry via Firebase Performance Monitoring, mirroring the Android
// sample's "hybrid-inference" trace. Each AI call records a trace carrying the
// inferenceSource (on-device / cloud / rules) and the job, so the on-device vs
// cloud split is visible over a session — the data behind the visible badge.
// Best-effort and fully guarded: telemetry must NEVER break or slow inference.

import type { FirebaseApp } from 'firebase/app';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Perf = any;

let perf: Perf | null = null;

/** Start Performance Monitoring. No-op (silently) in unsupported environments. */
export async function initTelemetry(app: FirebaseApp): Promise<void> {
  try {
    const { getPerformance } = await import('firebase/performance');
    perf = getPerformance(app);
  } catch {
    perf = null;
  }
}

/** Forget the collector (test seam / re-init). */
export function resetTelemetry(): void {
  perf = null;
}

/**
 * Record one inference. Fire-and-forget: callers do not await this, and any
 * error is swallowed so a telemetry failure can never affect the AI result or
 * the source badge.
 */
export function recordInference(source: string, job: string, ms?: number): void {
  if (!perf) return;
  void (async () => {
    try {
      const { trace } = await import('firebase/performance');
      const t = trace(perf, 'hybrid_inference');
      t.start();
      t.putAttribute('source', source);
      t.putAttribute('job', job);
      if (typeof ms === 'number' && Number.isFinite(ms)) {
        t.putMetric('latency_ms', Math.max(0, Math.round(ms)));
      }
      t.stop();
    } catch {
      /* telemetry is best-effort */
    }
  })();
}
