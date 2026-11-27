// Swarm dock: a compact row of chips under each terminal, one per agent of
// that terminal's model only — built from the SAME SwarmAgentSpec[] the
// canvas cursors already use (buildSwarmAgents / buildMixedSwarmPlan), never
// a second list. A chip appears the moment its agent starts (staggered, not
// all at once), pulses while working, checks off when done, and opens a
// floating mini terminal streaming that one agent's own log when tapped or
// pinched. Canvas cursors stay pointer-events:none; chips are real <button>s.
import type { SwarmAgentSpec, SwarmKind } from './swarmAgents';

const STAGGER_MS = 70;
const MAX_STAGGER_MS = 900;
const MAX_VISIBLE = 6;

type ChipState = 'pending' | 'working' | 'done';
interface AgentLine { time: string; text: string }
interface AgentRecord {
  agent: SwarmAgentSpec;
  state: ChipState;
  chip: HTMLElement | null;
  lines: AgentLine[];
}

function nowHHMMSS(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "Nano · labels" -> "labels" (the dock already lives under the Nano
 *  terminal, so the engine prefix is redundant on the chip itself). */
export function shortAgentName(label: string): string {
  return label.replace(/^(Nano|Gemini)\s*[·:]\s*/i, '');
}

export interface SwarmDockOptions {
  doc?: Document;
  setTimeoutFn?: (cb: () => void, ms: number) => number;
  clearTimeoutFn?: (id: number) => void;
  /** Highlight ring hook: the matching `.mc-swarm-cursor[data-agent-id]` on
   *  the canvas while this agent's mini terminal is open. */
  onOpenAgent?: (agentId: string, kind: SwarmKind) => void;
  onCloseAgent?: (agentId: string, kind: SwarmKind) => void;
}

export interface SwarmDockStartOptions {
  reducedMotion?: boolean;
  /** The exact payload each engine's one real network call received this
   *  turn (already redacted for 'gemini' — see modelPanels.cloudReceivedDetail).
   *  A chip's mini terminal opens with this as its first line, honestly —
   *  never fabricated per sub-step cursor, and omitted for an engine that
   *  made no real call this turn. */
  payloads?: Partial<Record<SwarmKind, string>>;
}

export interface SwarmDockUi {
  start(agents: SwarmAgentSpec[], opts?: SwarmDockStartOptions): void;
  /** The real work this turn stood for just finished: every agent still
   *  pending or working flips to done, in the same order the chips render. */
  settle(): void;
  destroy(): void;
}

function dockEl(aiPanel: HTMLElement, engine: SwarmKind): { chips: HTMLElement; history: HTMLDetailsElement; historyChips: HTMLElement; historyCount: HTMLElement } {
  const dock = aiPanel.querySelector<HTMLElement>(`.mc-term-dock[data-engine="${engine}"]`)!;
  return {
    chips: dock.querySelector<HTMLElement>('.mc-term-dock-chips')!,
    history: dock.querySelector<HTMLDetailsElement>('.mc-term-dock-history')!,
    historyChips: dock.querySelector<HTMLElement>('.mc-term-dock-history-chips')!,
    historyCount: dock.querySelector<HTMLElement>('.mc-term-dock-history-count')!,
  };
}

export function mountSwarmDock(aiPanel: HTMLElement, root: HTMLElement, opts: SwarmDockOptions = {}): SwarmDockUi {
  const doc = opts.doc ?? (typeof document !== 'undefined' ? document : aiPanel.ownerDocument);
  const setTimeoutFn = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms) as unknown as number);
  const clearTimeoutFn = opts.clearTimeoutFn ?? ((id) => clearTimeout(id));

  const mini = doc.createElement('div');
  mini.className = 'mc-mini-terminal';
  mini.hidden = true;
  mini.innerHTML = `<div class="mc-term-head"><span class="mc-term-dot"></span><strong class="mc-term-title"></strong>` +
    `<span class="mc-term-where"></span><button type="button" class="mc-mini-close" aria-label="Close">×</button></div>` +
    `<div class="mc-term-body"><div class="mc-term-lines"></div><span class="mc-term-cursor" aria-hidden="true" hidden>▌</span></div>`;
  root.append(mini);
  const miniTitle = mini.querySelector<HTMLElement>('.mc-term-title')!;
  const miniWhere = mini.querySelector<HTMLElement>('.mc-term-where')!;
  const miniLines = mini.querySelector<HTMLElement>('.mc-term-lines')!;
  const miniCursor = mini.querySelector<HTMLElement>('.mc-term-cursor')!;

  const records = new Map<string, AgentRecord>();
  let order: string[] = [];
  let openId: string | null = null;
  let timers: number[] = [];
  let reducedMotion = false;
  let payloads: Partial<Record<SwarmKind, string>> = {};
  let overflowDone: Partial<Record<SwarmKind, boolean>> = {};

  function clearTimers(): void {
    timers.forEach((id) => clearTimeoutFn(id));
    timers = [];
  }

  function renderMiniLines(): void {
    if (!openId) return;
    const rec = records.get(openId);
    if (!rec) return;
    // Her words reach these lines (the payload): text only, never markup (I11).
    miniLines.textContent = '';
    for (const l of rec.lines) {
      const p = doc.createElement('p'); p.className = 'mc-term-line';
      const time = doc.createElement('span'); time.className = 'mc-term-time'; time.textContent = l.time;
      const detail = doc.createElement('span'); detail.className = 'mc-term-detail'; detail.textContent = l.text;
      p.append(time, detail);
      miniLines.append(p);
    }
  }

  function setMiniCursor(working: boolean): void {
    miniCursor.hidden = !working;
  }

  function closeMini(): void {
    if (!openId) return;
    const rec = records.get(openId);
    const prev = openId;
    openId = null;
    mini.hidden = true;
    if (rec) {
      rec.chip?.setAttribute('aria-pressed', 'false');
      opts.onCloseAgent?.(prev, rec.agent.kind);
    }
  }

  function openMini(id: string): void {
    const rec = records.get(id);
    if (!rec) return;
    if (openId === id) { closeMini(); return; }
    if (openId) closeMini();
    openId = id;
    rec.chip?.setAttribute('aria-pressed', 'true');
    mini.dataset.kind = rec.agent.kind;
    miniTitle.textContent = shortAgentName(rec.agent.label);
    miniWhere.textContent = `· ${rec.agent.kind}`;
    renderMiniLines();
    setMiniCursor(rec.state === 'working');
    mini.hidden = false;
    opts.onOpenAgent?.(id, rec.agent.kind);
  }

  function onDocPointerDown(e: Event): void {
    if (!openId) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (mini.contains(target)) return;
    const openChip = records.get(openId)?.chip;
    if (openChip?.contains(target)) return;
    closeMini();
  }
  doc.addEventListener('pointerdown', onDocPointerDown, true);
  // A hand pinch (handPointer's HAND_PRESS) dismisses the same way a mouse press does.
  doc.addEventListener('mc-hand-press', onDocPointerDown, true);

  function markWorking(id: string): void {
    const rec = records.get(id);
    if (!rec) return;
    rec.state = 'working';
    const payload = payloads[rec.agent.kind];
    if (payload && rec.lines.length === 0) {
      rec.lines.push({ time: nowHHMMSS(), text: `received   ${payload}` });
    }
    rec.lines.push({ time: nowHHMMSS(), text: `start      ${rec.agent.label}` });
    const chip = rec.chip;
    if (chip) { chip.classList.add('is-working'); chip.classList.remove('is-done'); }
    if (openId === id) { renderMiniLines(); setMiniCursor(true); }
  }

  function markDone(id: string): void {
    const rec = records.get(id);
    if (!rec || rec.state === 'done') return;
    rec.state = 'done';
    const detail = rec.agent.tileIndex != null ? `tile ${rec.agent.tileIndex + 1} filled` : 'settled';
    rec.lines.push({ time: nowHHMMSS(), text: `done       ${detail}` });
    const chip = rec.chip;
    if (chip) {
      chip.classList.remove('is-working');
      chip.classList.add('is-done');
      chip.querySelector<HTMLElement>('.mc-dock-chip-mark')!.textContent = '✓';
    }
    if (openId === id) { renderMiniLines(); setMiniCursor(false); }
  }

  function chipHtml(agent: SwarmAgentSpec): HTMLElement {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'mc-dock-chip';
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute('data-agent-id', agent.id);
    chip.style.setProperty('--chip-color', agent.color);
    chip.innerHTML = `<span class="mc-dock-chip-cursor"></span><span class="mc-dock-chip-name"></span><span class="mc-dock-chip-mark"></span>`;
    chip.querySelector<HTMLElement>('.mc-dock-chip-name')!.textContent = shortAgentName(agent.label);
    chip.addEventListener('click', () => openMini(agent.id));
    return chip;
  }

  function addChip(id: string): void {
    const rec = records.get(id);
    if (!rec || rec.chip) return;
    const kind = rec.agent.kind;
    const { chips } = dockEl(aiPanel, kind);
    const overflow = chips.querySelector<HTMLElement>('.mc-dock-chip-overflow');
    if (overflow) {
      // The overflow control already exists for this kind: fold into its
      // count instead of rendering a 7th+ chip. (Once an overflow is
      // expanded it's removed for good — see its click handler below — so
      // this branch never re-triggers after that.)
      overflow.dataset.hiddenIds = `${(overflow.dataset.hiddenIds ?? '')},${id}`.replace(/^,/, '');
      overflow.textContent = `+${(overflow.dataset.hiddenIds ?? '').split(',').filter(Boolean).length}`;
      return;
    }
    const visible = order.filter((oid) => records.get(oid)?.chip && records.get(oid)!.agent.kind === kind).length;
    // The MAX_VISIBLE+1'th chip for this kind introduces the overflow
    // control (folding itself in) instead of being rendered — exactly
    // MAX_VISIBLE chips stay visible, never MAX_VISIBLE-1.
    if (!overflowDone[kind] && visible >= MAX_VISIBLE && order.filter((oid) => records.get(oid)?.agent.kind === kind).length > MAX_VISIBLE) {
      overflowDone[kind] = true;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'mc-dock-chip mc-dock-chip-overflow';
      btn.setAttribute('aria-expanded', 'false');
      btn.dataset.hiddenIds = id;
      btn.textContent = '+1';
      btn.addEventListener('click', () => {
        const ids = (btn.dataset.hiddenIds ?? '').split(',').filter(Boolean);
        btn.remove();
        ids.forEach((hid) => addChip(hid));
      });
      chips.append(btn);
      return;
    }
    const chip = chipHtml(rec.agent);
    rec.chip = chip;
    chips.append(chip);
    markWorking(id);
  }

  /** A chip that was folded into the live-dock overflow (or never reached
   *  addChip before the next turn started) still needs a real element to
   *  live in history — materialise it now, already marked done. */
  function materializeHistoryChip(id: string): HTMLElement {
    const rec = records.get(id)!;
    const chip = chipHtml(rec.agent);
    rec.chip = chip;
    return chip;
  }

  /** Every agent chip from the turn that's ending moves into its engine's
   *  foldable history (never discarded) — still tappable to reopen that
   *  agent's own log for the rest of the session — and the live dock clears
   *  for the next turn's chips. */
  function foldPreviousTurn(): void {
    const grouped: Record<SwarmKind, string[]> = { nano: [], gemini: [] };
    order.forEach((id) => { const rec = records.get(id); if (rec) grouped[rec.agent.kind].push(id); });
    (['nano', 'gemini'] as const).forEach((kind) => {
      const ids = grouped[kind];
      if (!ids.length) return;
      const { chips, history, historyChips, historyCount } = dockEl(aiPanel, kind);
      ids.forEach((id) => {
        const chip = records.get(id)!.chip ?? materializeHistoryChip(id);
        chip.classList.remove('is-working');
        chip.classList.add('is-done');
        chip.querySelector<HTMLElement>('.mc-dock-chip-mark')!.textContent = '✓';
        historyChips.append(chip);
      });
      chips.innerHTML = '';
      historyCount.textContent = String(historyChips.children.length);
      history.hidden = false;
    });
  }

  return {
    start(agents, startOpts = {}) {
      clearTimers();
      closeMini();
      foldPreviousTurn();
      order = agents.map((a) => a.id);
      reducedMotion = !!startOpts.reducedMotion;
      payloads = startOpts.payloads ?? {};
      overflowDone = {};
      agents.forEach((a) => records.set(a.id, { agent: a, state: 'pending', chip: null, lines: [] }));
      agents.forEach((a, i) => {
        if (reducedMotion) { addChip(a.id); return; }
        const id = setTimeoutFn(() => addChip(a.id), Math.min(i * STAGGER_MS, MAX_STAGGER_MS));
        timers.push(id);
      });
    },
    settle() {
      clearTimers();
      order.forEach((id) => { if (!records.get(id)?.chip) addChip(id); });
      order.forEach((id) => markDone(id));
    },
    destroy() {
      clearTimers();
      doc.removeEventListener('pointerdown', onDocPointerDown, true);
      doc.removeEventListener('mc-hand-press', onDocPointerDown, true);
      mini.remove();
    },
  };
}
