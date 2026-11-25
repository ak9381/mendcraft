// ?nanoTrace=1 — time every on-device call where it really happens: at
// Chrome's LanguageModel, underneath the Firebase SDK. Logs how long create()
// took, how long each prompt took to its first chunk and to its end, and the
// SIZES of what went in and came out. Never the content: no prompt text, no
// reply text, no device names.

type Log = (line: string) => void;

interface TraceableSession {
  prompt?: (input: unknown, options?: unknown) => Promise<string>;
  promptStreaming?: (input: unknown, options?: unknown) => unknown;
}
interface TraceableModel {
  create?: (options?: unknown) => Promise<unknown>;
}

const size = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === 'string') return v.length;
  try { return JSON.stringify(v).length; } catch { return 0; }
};
/** Text characters only (the SDK passes messages as role/content objects). */
function textSize(input: unknown): number {
  if (typeof input === 'string') return input.length;
  let n = 0;
  const walk = (v: unknown): void => {
    if (typeof v === 'string') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.value === 'string') n += o.value.length;
      else if (typeof o.content === 'string') n += o.content.length;
      else Object.values(o).forEach(walk);
    }
  };
  walk(input);
  return n;
}

let traceOn = false;
let traceLog: Log = (line) => console.log(line);
export const nanoTraceOn = (): boolean => traceOn;
/** One trace line from the app's own side (queue waits, turn totals). */
export function nanoTrace(line: string): void { if (traceOn) traceLog(`[nano-trace] ${line}`); }

/** How long after a stop request the trace waits before saying "still going". */
export const TRACE_STILL_RUNNING_MS = 5000;

/** Wrap `lm.create` (and each session it returns) with timing logs. Safe to
 *  call once; a second call is a no-op.
 *
 *  It also answers the one question the app cannot see for itself: does
 *  stopping a session really stop Nano? When the AbortSignal given to
 *  create() is aborted, or destroy() is called, while a prompt is streaming,
 *  the trace logs how long the stream took to end after that and how much
 *  more text arrived — or, 5 s later, that it is still generating. */
export function installNanoTrace(lm: unknown, opts: { log?: Log; now?: () => number; stillRunningMs?: number } = {}): boolean {
  const model = lm as (TraceableModel & { __mcTraced?: boolean }) | null | undefined;
  if (!model || typeof model.create !== 'function' || model.__mcTraced) return false;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const stillRunningMs = opts.stillRunningMs ?? TRACE_STILL_RUNNING_MS;
  if (opts.log) traceLog = opts.log;
  traceOn = true;
  const ms = (from: number): string => `${Math.round(now() - from)} ms`;
  let creates = 0;
  let prompts = 0;
  const create = model.create.bind(model);

  interface Stop { how: string; at: number }
  interface Running { n: number; out: number; ended: boolean; stop: Stop | null; charsAtStop: number; chunksAfter: number; timer: ReturnType<typeof setTimeout> | null }

  const wrapSession = (session: TraceableSession & { destroy?: () => void }, id: number, createSignal: AbortSignal | undefined): void => {
    const live = new Set<Running>();
    let stopped: Stop | null = null;
    const noteStop = (how: string): void => {
      if (stopped) return;
      stopped = { how, at: now() };
      if (!live.size) { nanoTrace(`session #${id}: ${how} with no prompt running`); return; }
      for (const r of live) {
        r.stop = stopped; r.charsAtStop = r.out;
        nanoTrace(`session #${id}: ${how} while prompt #${r.n} was streaming (${r.out} chars so far)`);
        r.timer = setTimeout(() => {
          r.timer = null;
          if (!r.ended) nanoTrace(`session #${id}: ${how} did NOT stop prompt #${r.n} — still generating ${Math.round(stillRunningMs / 1000)} s later (${r.out - r.charsAtStop} more chars, ${r.chunksAfter} chunks since)`);
        }, stillRunningMs);
      }
    };
    createSignal?.addEventListener('abort', () => noteStop('create-signal abort'), { once: true });
    const destroy = session.destroy?.bind(session);
    if (destroy) session.destroy = () => { noteStop('destroy()'); return destroy(); };

    const streaming = session.promptStreaming?.bind(session);
    if (streaming) {
      session.promptStreaming = (input: unknown, options?: unknown) => {
        const r: Running = { n: ++prompts, out: 0, ended: false, stop: null, charsAtStop: 0, chunksAfter: 0, timer: null };
        const t0 = now();
        const head = `prompt #${r.n} (session #${id}): input ${textSize(input)} chars, constraint ${size((options as { responseConstraint?: unknown } | undefined)?.responseConstraint)} chars`;
        nanoTrace(`${head} — started`);
        let first = '';
        const seen = (chunk: unknown): void => {
          if (!first) first = ms(t0);
          r.out += typeof chunk === 'string' ? chunk.length : 0;
          if (r.stop) r.chunksAfter++;
        };
        const done = (how: string): void => {
          if (r.ended) return;
          r.ended = true;
          live.delete(r);
          if (r.timer) { clearTimeout(r.timer); r.timer = null; }
          nanoTrace(`${head} — first chunk ${first || 'never'}, ${how} ${ms(t0)}, output ${r.out} chars`);
          if (r.stop) nanoTrace(`session #${id}: after ${r.stop.how}, prompt #${r.n} ended ${Math.round(now() - r.stop.at)} ms later with ${r.out - r.charsAtStop} more chars (${r.chunksAfter} chunks) — ${r.chunksAfter ? 'it kept generating until then' : 'generation stopped'}`);
        };
        let result: unknown;
        try { result = streaming(input, options); } catch (e) { done('threw after'); throw e; }
        live.add(r);
        if (stopped) { r.stop = stopped; }
        const source = result as { getReader?: () => ReadableStreamDefaultReader<unknown>; [Symbol.asyncIterator]?: () => AsyncIterator<unknown> };
        if (typeof source?.getReader === 'function' && typeof ReadableStream !== 'undefined') {
          const reader = source.getReader();
          return new ReadableStream<unknown>({
            async pull(controller) {
              try {
                const step = await reader.read();
                if (step.done) { done('done in'); controller.close(); return; }
                seen(step.value);
                controller.enqueue(step.value);
              } catch (e) { done('failed after'); controller.error(e); }
            },
            cancel(reason) { done('cancelled after'); return reader.cancel(reason); },
          });
        }
        if (source && typeof source[Symbol.asyncIterator] === 'function') {
          return (async function* () {
            try { for await (const chunk of source as AsyncIterable<unknown>) { seen(chunk); yield chunk; } done('done in'); }
            catch (e) { done('failed after'); throw e; }
            finally { done('cancelled after'); }
          })();
        }
        done('returned (not a stream) after');
        return result;
      };
    }
    const once = session.prompt?.bind(session);
    if (once) {
      session.prompt = async (input: unknown, options?: unknown) => {
        const n = ++prompts;
        const t0 = now();
        const head = `prompt #${n} (session #${id}, not streamed): input ${textSize(input)} chars, constraint ${size((options as { responseConstraint?: unknown } | undefined)?.responseConstraint)} chars`;
        nanoTrace(`${head} — started`);
        try {
          const text = await once(input, options);
          nanoTrace(`${head} — done in ${ms(t0)}, output ${text.length} chars${stopped ? ` (finished ${Math.round(now() - stopped.at)} ms AFTER ${stopped.how}: it was not stopped)` : ''}`);
          return text;
        } catch (e) {
          nanoTrace(`${head} — failed after ${ms(t0)}${stopped ? ` (${Math.round(now() - stopped.at)} ms after ${stopped.how}: stopped)` : ''}`);
          throw e;
        }
      };
    }
  };

  model.create = async (options?: unknown) => {
    const id = ++creates;
    const t0 = now();
    const o = options as { initialPrompts?: unknown; signal?: AbortSignal } | undefined;
    try {
      const session = await create(options);
      nanoTrace(`create #${id}: ${ms(t0)} (initialPrompts ${textSize(o?.initialPrompts)} chars)`);
      if (session && typeof session === 'object') wrapSession(session as TraceableSession, id, o?.signal);
      return session;
    } catch (e) {
      nanoTrace(`create #${id}: failed after ${ms(t0)}`);
      throw e;
    }
  };
  model.__mcTraced = true;
  nanoTrace('on: timings and sizes only, never content');
  return true;
}

/** Test seam. */
export function resetNanoTrace(): void { traceOn = false; traceLog = (line) => console.log(line); }
