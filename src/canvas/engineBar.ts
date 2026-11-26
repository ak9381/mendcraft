// The engine bar: both engines, always visible, bottom-centre. Two cards —
// "Nano · on this device" and "Gemini · cloud" — each with a status dot, a
// state word and the last thing that engine did, a handoff arrow between them,
// and the running "N B sent to cloud" total. The numbers come from the real
// ledger (the caller passes them in); this module never invents any.
//
// Built with createElement only (no innerHTML) so it runs under the suite's
// node-only fake DOM. Hidden in the phone shell
// by CSS (canvas.css).
import type { EngineId } from './aiTurn';
import { formatFooterBytes } from './modelPanels';

export type EngineState = 'idle' | 'working' | 'done' | 'queued' | 'failed' | 'unavailable' | 'offline';

export interface EngineBar {
  set(engine: EngineId, state: EngineState, line?: string): void;
  /** The cloud can't be reached (real or simulated): Gemini says Offline,
   *  never Ready. Back online it returns to Ready unless something else
   *  (a queued request) has taken over the card. */
  setOffline(off: boolean): void;
  /** Animates the arrow between the cards for 1.2 s. */
  handoff(from: EngineId, to: EngineId): void;
  /** Real bytes that left; `simBytes` (SIM turns) shows as "SIM · would send N". */
  setCloudBytes(bytes: number, simBytes?: number): void;
  /** Queue drained: back to idle, but only if the card is still showing Queued. */
  clearQueued(engine: EngineId): void;
  /** A turn ended: any card still Working is finished, so it reads Done. */
  settle(): void;
  /** Swarm summary ("Nano · 1 call"); '' hides it. */
  setAgents(text: string): void;
  /** A card showing Failed for something that is not a broken engine (a
   *  refused request) goes back to Ready after `afterMs`. Only if it is
   *  still Failed then — a new turn's state is never overwritten. */
  calm(engine: EngineId, afterMs?: number): void;
  el: HTMLElement;
}

export const HANDOFF_MS = 1200;
/** How long a refusal stays red on the card before it reads Ready again. */
export const CALM_AFTER_MS = 6000;
export const ENGINE_LINE_MAX = 60;

const STATE_TEXT: Record<EngineState, string> = {
  idle: 'Ready', working: 'Working', done: 'Done', queued: 'Queued', failed: 'Failed', unavailable: 'Unavailable', offline: 'Offline',
};
const WHERE: Record<EngineId, string> = { nano: 'on this device', gemini: 'cloud' };
const NAME: Record<EngineId, string> = { nano: 'Nano', gemini: 'Gemini' };

export function clipLine(s: string, max = ENGINE_LINE_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function mountEngineBar(root: HTMLElement, opts: { onOpen(engine: EngineId): void; sim?: boolean }): EngineBar {
  // SIM before anything ran: still say SIM, so the canvas always shows one marker.
  const bytesText = (n: number, sim = 0): string => (opts.sim && n <= 0 && sim <= 0 ? 'SIM · nothing sent' : formatFooterBytes(n, sim));
  const doc = root.ownerDocument;
  const make = <T extends HTMLElement>(tag: string, cls: string, text?: string): T => {
    const e = doc.createElement(tag) as T;
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const bar = make<HTMLElement>('div', 'mc-engine-bar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Nano on this device, Gemini in the cloud');

  const cards = {} as Record<EngineId, { card: HTMLElement; state: HTMLElement; line: HTMLElement }>;
  const buildCard = (engine: EngineId) => {
    const card = make<HTMLButtonElement>('button', 'mc-engine-card');
    card.setAttribute('type', 'button');
    card.setAttribute('data-engine', engine);
    card.setAttribute('data-state', 'idle');
    card.setAttribute('aria-label', `${NAME[engine]}, ${WHERE[engine]}. Open AI activity.`);
    const head = make('span', 'mc-engine-head');
    const dot = make('span', 'mc-engine-dot');
    dot.setAttribute('aria-hidden', 'true');
    head.append(dot, make('strong', 'mc-engine-name', NAME[engine]), make('span', 'mc-engine-where', WHERE[engine]));
    const state = make('span', 'mc-engine-state', STATE_TEXT.idle);
    const line = make('span', 'mc-engine-line', '');
    line.hidden = true;
    const body = make('span', 'mc-engine-body');
    body.append(state, line);
    card.append(head, body);
    card.addEventListener('click', () => opts.onOpen(engine));
    cards[engine] = { card, state, line };
    return card;
  };

  const link = make('span', 'mc-engine-link');
  link.setAttribute('aria-hidden', 'true');
  link.append(make('span', 'mc-engine-link-line'), make('span', 'mc-engine-link-head', '▶'));

  const bytes = make('span', 'mc-engine-bytes', bytesText(0));
  bytes.setAttribute('role', 'status');
  bytes.title = 'Total bytes that actually left this device, from the ledger';
  const agents = make('span', 'mc-engine-agents', '');
  agents.hidden = true;

  bar.append(buildCard('nano'), link, buildCard('gemini'), bytes, agents);
  root.append(bar);

  let handoffTimer: ReturnType<typeof setTimeout> | null = null;
  const calmTimers: Record<EngineId, ReturnType<typeof setTimeout> | null> = { nano: null, gemini: null };

  return {
    el: bar,
    set(engine, state, line) {
      const c = cards[engine];
      c.card.setAttribute('data-state', state);
      c.state.textContent = STATE_TEXT[state];
      if (line !== undefined) {
        const t = clipLine(line);
        c.line.textContent = t;
        c.line.title = line;
        c.line.hidden = !t;
      }
    },
    setOffline(off) {
      const c = cards.gemini;
      const cur = c.card.getAttribute('data-state');
      if (off) {
        if (cur === 'queued') return; // "Queued" already says it waits for the network
        c.card.setAttribute('data-state', 'offline');
        c.state.textContent = STATE_TEXT.offline;
      } else if (cur === 'offline') {
        c.card.setAttribute('data-state', 'idle');
        c.state.textContent = STATE_TEXT.idle;
      }
    },
    handoff(from, to) {
      if (handoffTimer) clearTimeout(handoffTimer);
      bar.setAttribute('data-handoff', `${from}-${to}`);
      bar.classList.remove('is-handoff');
      // Restart the CSS animation when a second handoff lands inside the window.
      void (bar as HTMLElement).offsetWidth;
      bar.classList.add('is-handoff');
      handoffTimer = setTimeout(() => { bar.classList.remove('is-handoff'); handoffTimer = null; }, HANDOFF_MS);
    },
    settle() {
      (['nano', 'gemini'] as const).forEach((e) => {
        if (cards[e].card.getAttribute('data-state') !== 'working') return;
        cards[e].card.setAttribute('data-state', 'done');
        cards[e].state.textContent = STATE_TEXT.done;
      });
    },
    clearQueued(engine) {
      if (cards[engine].card.getAttribute('data-state') !== 'queued') return;
      cards[engine].card.setAttribute('data-state', 'idle');
      cards[engine].state.textContent = STATE_TEXT.idle;
    },
    setCloudBytes(n, sim = 0) { bytes.textContent = bytesText(n, sim); },
    setAgents(text) { agents.textContent = text; agents.hidden = !text; },
    calm(engine, afterMs = CALM_AFTER_MS) {
      const c = cards[engine];
      if (calmTimers[engine]) clearTimeout(calmTimers[engine]!);
      calmTimers[engine] = setTimeout(() => {
        calmTimers[engine] = null;
        if (c.card.getAttribute('data-state') !== 'failed') return;
        c.card.setAttribute('data-state', 'idle');
        c.state.textContent = STATE_TEXT.idle;
        c.line.textContent = '';
        c.line.hidden = true;
      }, afterMs);
    },
  };
}
