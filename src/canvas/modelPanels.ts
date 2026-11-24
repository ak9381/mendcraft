// Two live terminal windows — "nano · on this device" and "gemini · cloud" —
// replacing the old tinted activity cards. Each is a scrolling monospace log
// of honestly-labelled steps (received/redact/handoff/plan/build/fill/
// done/replied/queued/note); handoffs are log lines written into BOTH
// terminals, never a travelling card. sim mode must never fake which engine
// did the work: only call .log() on the engine that actually ran.
import { nothingRaw, type Person } from '../privacy/directory';
import { esc } from '../core/esc';
import { formatLedgerLine } from './ledger';
import type { EngineBar, EngineState } from './engineBar';

export type ModelEngine = 'nano' | 'gemini';

const ENGINE_LABEL: Record<ModelEngine, string> = { nano: 'Nano', gemini: 'Gemini' };
const otherEngine = (e: ModelEngine): ModelEngine => (e === 'nano' ? 'gemini' : 'nano');

/** "Nano → Gemini: plan the Kannada pack (too complex for on-device)" — a
 *  pure display string, independent of the terminal log lines below. */
export function handoffReason(from: ModelEngine, to: ModelEngine, reason: string): string {
  return `${ENGINE_LABEL[from]} → ${ENGINE_LABEL[to]}: ${reason}`;
}

export interface StayedLocalStripInput {
  /** Tokens redacted from this turn's prompt, e.g. from protectText(prompt).used. */
  used: readonly { token: string; personId: string }[];
  people: readonly Person[];
  bytesSent: number;
  engine: ModelEngine;
  routeLine: string;
}

export interface StayedLocalStrip {
  /** Real names Nano kept, e.g. "[Client A] = Sharma, never left". */
  keptLocalLines: string[];
  /** What actually reached the cloud, e.g. "Gemini saw: [Client A]". */
  sentToCloudLines: string[];
  bytesLabel: string;
  routeLabel: string;
}

/** Pure data shaping, kept for callers that still want the kept/cloud split
 *  (the terminal's "redact" log line is built from `redactLines` below). */
export function buildStayedLocalStrip(input: StayedLocalStripInput): StayedLocalStrip {
  const { used, people, bytesSent, engine, routeLine } = input;
  const byId = new Map(people.map((p) => [p.id, p] as const));
  const keptLocalLines = used.map((u) => {
    const person = byId.get(u.personId);
    return person ? `${u.token} = ${person.name}, never left` : `${u.token}, never left`;
  });
  const sentToCloudLines = used.map((u) => `Gemini saw: ${u.token}`);
  return {
    keptLocalLines: keptLocalLines.length ? keptLocalLines : ['No names in this turn.'],
    sentToCloudLines: sentToCloudLines.length ? sentToCloudLines : ['Nothing identifying left this device.'],
    bytesLabel: formatLedgerLine({ bytes: bytesSent, engine }),
    routeLabel: routeLine,
  };
}

/** "Sharma → [Client A]" per redacted name — the terminal's `redact` log
 *  line, built from the same protectTurn/buildStayedLocalStrip data. */
export function redactLines(used: readonly { token: string; personId: string }[], people: readonly Person[]): string[] {
  const byId = new Map(people.map((p) => [p.id, p] as const));
  return used.map((u) => {
    const person = byId.get(u.personId);
    return `${person ? person.name : '?'} → ${u.token}`;
  });
}

/** The hard privacy gate on the Gemini terminal's `received` line: it may
 *  only ever show `payload` (already run through protectForCloud) — never a
 *  raw name/phone/email. Throws rather than silently logging a leak, since
 *  a caller reaching this with unredacted text is a bug, not a user error. */
export function cloudReceivedDetail(payload: string, people: readonly Person[]): string {
  if (!nothingRaw(payload, people)) {
    throw new Error('modelPanels: refusing to log unredacted text to the Gemini terminal');
  }
  return payload;
}

export interface TurnReceiptInput {
  /** Which engine actually ran this turn's real network call. */
  engine: ModelEngine;
  /** The raw utterance — logged on Nano only; it never leaves the device. */
  utterance: string;
  used: readonly { token: string; personId: string }[];
  people: readonly Person[];
  /** The prompt text already run through protectForCloud — what a Gemini
   *  call, if any, actually sends. Ignored when `engine` is 'nano'. */
  cloudPayload: string;
}

/** Logs one turn's receipt in the one order privacy requires: Nano always
 *  logs `received` (the raw utterance, safe — it stays on this device) and
 *  then any `redact` lines, BEFORE a single byte of it reaches the Gemini
 *  terminal. Gemini's own `received` line (when it's the engine that ran)
 *  is built exclusively from `cloudPayload` via `cloudReceivedDetail`, so it
 *  can never carry a raw name. Structuring this as one function call (rather
 *  than leaving the ordering to call-site discipline) is what makes the
 *  order a real invariant instead of a convention someone can break. */
export function logTurnReceipt(panels: ModelPanelsUi, input: TurnReceiptInput): void {
  const nano = panels.forEngine('nano');
  nano.log('received', input.utterance);
  redactLines(input.used, input.people).forEach((line) => nano.log('redact', line));
  if (input.engine === 'gemini') {
    panels.forEngine('gemini').log('received', cloudReceivedDetail(input.cloudPayload, input.people));
  }
}

export type LogVerb = 'received' | 'redact' | 'handoff' | 'plan' | 'build' | 'fill' | 'done' | 'replied' | 'queued' | 'note' | 'fail';

const VERB_MARK: Partial<Record<LogVerb, string>> = { received: '›', done: '✓', replied: '✓', fail: '!' };
const DONE_VERBS: ReadonlySet<LogVerb> = new Set(['done', 'replied', 'fail']);

function nowHHMMSS(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const MODEL_PANELS_HTML = `
  <div class="mc-terminals" hidden>
    <div class="mc-terminal-col">
      <section class="mc-terminal mc-terminal-nano" aria-label="Nano terminal, on this device">
        <div class="mc-term-head">
          <span class="mc-term-drag" data-mc-drag-handle role="button" tabindex="0" aria-label="Move the Nano terminal">
            <span class="mc-term-dot"></span><strong class="mc-term-title">nano</strong><span class="mc-term-where">· on this device</span>
          </span>
          <span class="mc-term-queued" role="status" hidden></span>
          <button type="button" class="mc-term-reset-pos" data-engine="nano" aria-label="Reset Nano terminal position">⟲</button>
        </div>
        <div class="mc-term-body" aria-live="polite">
          <div class="mc-term-lines"></div>
          <p class="mc-term-empty">Not used for this draft.</p>
          <span class="mc-term-cursor" aria-hidden="true" hidden>▌</span>
        </div>
        <span class="mc-term-resize" data-mc-resize-handle data-engine="nano" role="button" tabindex="0" aria-label="Resize the Nano terminal"></span>
      </section>
      <div class="mc-term-dock" data-engine="nano" aria-label="Nano agents">
        <div class="mc-term-dock-chips"></div>
        <details class="mc-term-dock-history" hidden>
          <summary>History (<span class="mc-term-dock-history-count">0</span>)</summary>
          <div class="mc-term-dock-history-chips"></div>
        </details>
      </div>
    </div>
    <div class="mc-terminal-col">
      <section class="mc-terminal mc-terminal-gemini" aria-label="Gemini terminal, cloud">
        <div class="mc-term-head">
          <span class="mc-term-drag" data-mc-drag-handle role="button" tabindex="0" aria-label="Move the Gemini terminal">
            <span class="mc-term-dot"></span><strong class="mc-term-title">gemini</strong><span class="mc-term-where">· cloud</span>
          </span>
          <button type="button" class="mc-term-reset-pos" data-engine="gemini" aria-label="Reset Gemini terminal position">⟲</button>
        </div>
        <div class="mc-term-body" aria-live="polite">
          <div class="mc-term-lines"></div>
          <p class="mc-term-empty">Not used for this draft.</p>
          <span class="mc-term-cursor" aria-hidden="true" hidden>▌</span>
        </div>
        <span class="mc-term-resize" data-mc-resize-handle data-engine="gemini" role="button" tabindex="0" aria-label="Resize the Gemini terminal"></span>
      </section>
      <div class="mc-term-dock" data-engine="gemini" aria-label="Gemini agents">
        <div class="mc-term-dock-chips"></div>
        <details class="mc-term-dock-history" hidden>
          <summary>History (<span class="mc-term-dock-history-count">0</span>)</summary>
          <div class="mc-term-dock-history-chips"></div>
        </details>
      </div>
    </div>
  </div>
  <p class="mc-ai-footer" hidden>Kept on this device: name, address, device IDs · <span class="mc-ai-footer-bytes">0 B sent to cloud</span></p>`;

/** "412 B sent to cloud" / "1.2 KB sent to cloud" — the footer's live byte
 *  count, generic (no engine name: the footer spans both terminals). */
export function formatFooterBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB sent to cloud`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB sent to cloud`;
  return `${Math.max(0, bytes)} B sent to cloud`;
}

export interface EnginePanelUi {
  /** Appends one timestamped log line; 'done'/'replied' hide the blinking
   *  cursor, every other verb shows it (this engine is working). */
  log(verb: LogVerb, detail: string): void;
  setWorking(working: boolean): void;
  setQueued(count: number | null): void;
  /** Log a one-line failure and blink this terminal red. */
  fail(detail: string): void;
}

export interface ModelPanelsUi {
  show(): void;
  forEngine(engine: ModelEngine): EnginePanelUi;
  /** Writes a handoff line into BOTH terminals: "→ gemini: reason" on the
   *  sender's side, "← nano: reason" on the receiver's — never a travelling
   *  card, and never fabricated on the engine that didn't send/receive it. */
  showHandoff(from: ModelEngine, reason: string): void;
  /** Updates the spanning footer's live "N B sent to cloud" count from the
   *  real cumulative ledger total — never a fabricated number. */
  setFooterBytes(bytes: number): void;
}

/** The slice of the engine bar the terminals mirror their state into. */
export type EngineBarSink = Pick<EngineBar, 'set' | 'handoff' | 'setCloudBytes'>;

function verbState(verb: LogVerb): EngineState {
  if (verb === 'fail') return 'failed';
  if (verb === 'done' || verb === 'replied') return 'done';
  if (verb === 'queued') return 'queued';
  return 'working';
}

function enginePanel(container: HTMLElement, engine: ModelEngine, doc: Document, bar?: EngineBarSink): EnginePanelUi {
  const panel = container.querySelector<HTMLElement>(`.mc-terminal-${engine}`)!;
  const lines = panel.querySelector<HTMLElement>('.mc-term-lines')!;
  const body = panel.querySelector<HTMLElement>('.mc-term-body')!;
  const empty = panel.querySelector<HTMLElement>('.mc-term-empty');
  const cursor = panel.querySelector<HTMLElement>('.mc-term-cursor')!;
  const queuedBadge = panel.querySelector<HTMLElement>('.mc-term-queued');
  const syncEmpty = () => { if (empty) empty.hidden = lines.childElementCount > 0; };
  syncEmpty();
  const api: EnginePanelUi = {
    log(verb, detail) {
      const line = doc.createElement('p');
      line.className = `mc-term-line mc-term-line--${verb}`;
      const mark = VERB_MARK[verb] ?? '';
      line.innerHTML = `<span class="mc-term-mark">${mark}</span><span class="mc-term-time">${nowHHMMSS()}</span>` +
        `<span class="mc-term-verb">${verb}</span><span class="mc-term-detail">${esc(detail)}</span>`;
      lines.append(line);
      syncEmpty();
      body.scrollTop = body.scrollHeight;
      api.setWorking(!DONE_VERBS.has(verb));
      if (verb === 'fail') panel.classList.add('is-failing');
      else if (DONE_VERBS.has(verb)) panel.classList.remove('is-failing');
      bar?.set(engine, verbState(verb), detail);
    },
    fail(detail) { api.log('fail', detail); },
    setWorking(working) {
      cursor.hidden = !working;
    },
    setQueued(count) {
      // A log line alone scrolls out of view the moment anything else logs
      // (a review arriving, the next turn's lines) — this badge lives in the
      // terminal's head, outside the scrolling body, so the full queued-offline message stays
      // visible and stable until reconnecting actually clears it.
      const n = count ?? 0;
      const msg = `${n} request${n === 1 ? '' : 's'} queued offline — will run on reconnect.`;
      if (queuedBadge) {
        queuedBadge.hidden = n <= 0;
        if (n > 0) queuedBadge.textContent = msg;
      }
      if (count === null || count <= 0) { bar?.set(engine, 'idle'); return; }
      api.log('queued', msg);
    },
  };
  return api;
}

export function mountModelPanels(aiPanel: HTMLElement, doc: Document = document, bar?: EngineBarSink): ModelPanelsUi {
  const panels = aiPanel.querySelector<HTMLElement>('.mc-terminals')!;
  const footer = aiPanel.querySelector<HTMLElement>('.mc-ai-footer')!;
  const footerBytes = footer.querySelector<HTMLElement>('.mc-ai-footer-bytes')!;
  const nano = enginePanel(aiPanel, 'nano', doc, bar);
  const gemini = enginePanel(aiPanel, 'gemini', doc, bar);
  return {
    show() { panels.hidden = false; footer.hidden = false; },
    forEngine(engine) { return engine === 'nano' ? nano : gemini; },
    showHandoff(from, reason) {
      const to = otherEngine(from);
      (from === 'nano' ? nano : gemini).log('handoff', `→ ${ENGINE_LABEL[to].toLowerCase()}: ${reason}`);
      (to === 'nano' ? nano : gemini).log('handoff', `← ${ENGINE_LABEL[from].toLowerCase()}: ${reason}`);
      bar?.handoff(from, to);
    },
    setFooterBytes(bytes) { footerBytes.textContent = formatFooterBytes(bytes); bar?.setCloudBytes(bytes); },
  };
}
