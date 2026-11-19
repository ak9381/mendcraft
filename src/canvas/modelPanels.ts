// Two live model panels — Nano (on device) and Gemini (cloud) — replacing the
// single AI-activity turn view. Each shows the prompt it received, the reply
// as it streams, and a status line; animated handoff cards travel between
// them when work is passed from one model to the other.
import { formatLedgerLine } from './ledger';
import type { Person } from '../privacy/directory';
import { esc } from '../core/esc';

export type ModelEngine = 'nano' | 'gemini';

const ENGINE_LABEL: Record<ModelEngine, string> = { nano: 'Nano', gemini: 'Gemini' };

/** "Nano → Gemini: plan the Kannada pack (too complex for on-device)" */
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

export const MODEL_PANELS_HTML = `
  <div class="mc-model-panels" hidden>
    <section class="mc-model-panel mc-model-nano" aria-label="Nano (on device)">
      <h3 class="mc-model-h">Nano (on device)</h3>
      <p class="mc-model-status" aria-live="polite"></p>
      <p class="mc-model-queue" hidden></p>
      <details class="mc-model-prompt" open><summary>Prompt</summary><pre></pre></details>
      <p class="mc-model-sent"></p>
      <p class="mc-model-ledger"></p>
      <details class="mc-model-reply" open><summary>Reply</summary><pre aria-live="off"></pre></details>
    </section>
    <div class="mc-handoff-track" aria-live="polite"></div>
    <section class="mc-model-panel mc-model-gemini" aria-label="Gemini (cloud)">
      <h3 class="mc-model-h">Gemini (cloud)</h3>
      <p class="mc-model-status" aria-live="polite"></p>
      <details class="mc-model-prompt" open><summary>Prompt (redacted)</summary><pre></pre></details>
      <p class="mc-model-sent"></p>
      <p class="mc-model-ledger"></p>
      <details class="mc-model-reply" open><summary>Reply</summary><pre aria-live="off"></pre></details>
    </section>
  </div>
  <div class="mc-stayed-local" hidden>
    <h3 class="mc-ai-h3">Data that stayed on this device</h3>
    <ul class="mc-stayed-local-kept"></ul>
    <ul class="mc-stayed-local-cloud"></ul>
    <p class="mc-stayed-local-bytes"></p>
    <p class="mc-stayed-local-route"></p>
  </div>`;

export interface EnginePanelUi {
  setPrompt(text: string): void;
  setSent(sent: string | null): void;
  appendSentNote(note: string): void;
  setRoute(routeLine: string): void;
  setStatus(text: string): void;
  setLedger(text: string): void;
  setReply(text: string): void;
  setQueued(count: number | null): void;
}

export interface ModelPanelsUi {
  show(): void;
  forEngine(engine: ModelEngine): EnginePanelUi;
  showHandoff(text: string, opts?: { reducedMotion?: boolean }): void;
  showStayedLocalStrip(strip: StayedLocalStrip): void;
  hideStayedLocalStrip(): void;
}

function enginePanel(container: HTMLElement, engine: ModelEngine): EnginePanelUi {
  const panel = container.querySelector<HTMLElement>(`.mc-model-${engine}`)!;
  const q = (sel: string) => panel.querySelector<HTMLElement>(sel)!;
  return {
    setPrompt(text) { q('.mc-model-prompt pre').textContent = text; },
    setSent(sent) { q('.mc-model-sent').textContent = sent ? `What was sent: ${sent}` : 'What was sent: nothing. Stays on this device.'; },
    appendSentNote(note) { q('.mc-model-sent').textContent += note; },
    setRoute(routeLine) { panel.dataset.route = routeLine; },
    setStatus(text) { q('.mc-model-status').textContent = text; },
    setLedger(text) { q('.mc-model-ledger').textContent = text; },
    setReply(text) { q('.mc-model-reply pre').textContent = text; },
    setQueued(count) {
      const el = q('.mc-model-queue');
      if (count === null || count <= 0) { el.hidden = true; el.textContent = ''; return; }
      el.hidden = false;
      el.textContent = `${count} request${count === 1 ? '' : 's'} queued offline — will run on reconnect.`;
    },
  };
}

export function mountModelPanels(aiPanel: HTMLElement, doc: Document = document): ModelPanelsUi {
  const panels = aiPanel.querySelector<HTMLElement>('.mc-model-panels')!;
  const track = aiPanel.querySelector<HTMLElement>('.mc-handoff-track')!;
  const strip = aiPanel.querySelector<HTMLElement>('.mc-stayed-local')!;
  const nano = enginePanel(aiPanel, 'nano');
  const gemini = enginePanel(aiPanel, 'gemini');
  return {
    show() { panels.hidden = false; },
    forEngine(engine) { return engine === 'nano' ? nano : gemini; },
    showHandoff(text, opts = {}) {
      const card = doc.createElement('p');
      card.className = 'mc-handoff-card';
      card.textContent = text;
      if (!opts.reducedMotion) card.classList.add('is-traveling');
      track.append(card);
      setTimeout(() => card.remove(), 2600);
    },
    showStayedLocalStrip(s) {
      strip.hidden = false;
      strip.querySelector('.mc-stayed-local-kept')!.innerHTML = s.keptLocalLines.map((l) => `<li>${esc(l)}</li>`).join('');
      strip.querySelector('.mc-stayed-local-cloud')!.innerHTML = s.sentToCloudLines.map((l) => `<li>${esc(l)}</li>`).join('');
      strip.querySelector<HTMLElement>('.mc-stayed-local-bytes')!.textContent = s.bytesLabel;
      strip.querySelector<HTMLElement>('.mc-stayed-local-route')!.textContent = s.routeLabel;
    },
    hideStayedLocalStrip() { strip.hidden = true; },
  };
}
