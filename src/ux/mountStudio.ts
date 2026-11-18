// Studio chrome from the UX spec: status phrases, review tray, Proposal
// host, Here card, hint strip, palm menu, first run, Later list, numbers.

import type { ChangeEntry } from '../cad/changeLog';
import type { RouteInfo } from '../cad/routeReason';
import { catalogRoute, type CatalogKind } from './routeCatalog';
import { formatStatus, type HandState, type MicState, type QuickState } from './statusLine';
import { applyHistoryFilter, parseHistoryFilter, reviewTrayLabel, waitingCount, type HistoryFilter } from './historyFilters';
import { PALM_HOLD_MS, PALM_SLICES, pickPalmSlice, sliceFromSpeech, type PalmSlice } from './palmMenu';
import { hereActions, hereTitle, HERE_HANDS_LINE, HERE_SAY_LINE } from './hereCard';
import { hintForFocus, recordHintUsed, setHintsHidden, hintsHidden } from './hints';
import { pickSuggestion, recordSuggestionDrop, type Suggestion, type SuggestionSituation } from './suggestions';
import {
  FIRST_RUN_STEPS, advanceStep, backStep, isSkipUtterance, loadFirstRun, saveFirstRun,
  shouldOfferFirstRun, skipAll, skipCurrentStep, type FirstRunState,
} from './firstRun';
import { laterListLabel, type LaterItem } from './deepWait';

import { renderProposalCard, type ProposalModel } from './proposal';
import type { Focusable } from './focusModel';
import { numberOverlays, wantsNumbers } from './focusModel';
import { BACKUP_VIDEO_SLOT_LABEL, backupVideoUrl, isSharmaHousePrompt } from './demoKit';
import { LATER_LIST } from './wording';

export interface StudioChromeDeps {
  getFocus(): Focusable | null;
  getFocusables(): Focusable[];
  getChanges(): ChangeEntry[];
  getSuggestionSituation(): SuggestionSituation;
  onPalmSlice(id: PalmSlice['id'] | 'studio'): void;
  onHereAction(phrase: string): void;
  onSuggestionAccept(s: Suggestion): void;
  onFirstRunSpeak(text: string): void;
  onLoadSampleHouse(): void;
  onSkipPermissions?: (which: 'mic' | 'camera') => void;
  onRequestPermissions?: () => void;
}

export interface StudioChrome {
  element: HTMLElement;
  setStatus(s: { online: boolean; keepOnDevice?: boolean; quick: QuickState; quickPercent?: number; mic: MicState; hand: HandState }): void;
  setProposal(model: ProposalModel | null, handlers?: Parameters<typeof renderProposalCard>[2]): void;
  refresh(): void;
  openHere(): void;
  closeHere(): void;
  hereOpen(): boolean;
  openPalm(center?: { x: number; y: number }): void;
  closePalm(): void;
  palmOpen(): boolean;
  pickPalm(dx: number, dy: number, shortSide: number): void;
  showNumbers(on?: boolean): boolean;
  handleUtterance(utterance: string): 'handled' | 'first-run-skip' | null;
  openFirstRun(force?: boolean): void;
  closeFirstRun(): void;
  firstRunOpen(): boolean;
  setLater(items: LaterItem[]): void;
  reviewLabel(): string;
  setReviewButton(btn: HTMLButtonElement): void;
}

export function mountStudioChrome(parent: HTMLElement, deps: StudioChromeDeps): StudioChrome {
  const root = document.createElement('div');
  root.className = 'mc-studio-chrome';
  parent.append(root);

  const status = document.createElement('div');
  status.className = 'mc-status-line';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-label', 'System status');
  const statusBits = {
    network: chip(status, 'Network'),
    quick: chip(status, 'Quick'),
    mic: chip(status, 'Mic'),
    hand: chip(status, 'Hand'),
  };

  const tray = document.createElement('button');
  tray.type = 'button';
  tray.className = 'mc-review-tray';
  tray.textContent = 'Review & History';
  tray.setAttribute('aria-label', 'Review & History');

  const hint = document.createElement('div');
  hint.className = 'mc-hint-strip';
  hint.setAttribute('role', 'status');

  const proposalHost = document.createElement('div');
  proposalHost.className = 'mc-proposal-host';

  const here = document.createElement('aside');
  here.className = 'mc-here-card';
  here.hidden = true;
  here.setAttribute('role', 'dialog');
  here.setAttribute('aria-label', 'What you can do here');

  const palm = document.createElement('div');
  palm.className = 'mc-palm-menu';
  palm.hidden = true;
  palm.setAttribute('role', 'menu');
  palm.setAttribute('aria-label', 'Palm menu');

  const numbers = document.createElement('div');
  numbers.className = 'mc-focus-numbers';
  numbers.hidden = true;
  numbers.setAttribute('aria-live', 'polite');

  const first = document.createElement('div');
  first.className = 'mc-first-run';
  first.hidden = true;

  const later = document.createElement('aside');
  later.className = 'mc-later-list';
  later.hidden = true;
  later.setAttribute('role', 'status');
  later.setAttribute('aria-label', LATER_LIST);

  root.append(hint, proposalHost, here, palm, numbers, later);
  // Reuse the existing status bar and Review button; only first-run is a new overlay.
  status.hidden = true;
  tray.hidden = true;
  parent.append(first);

  let numbersOn = false;
  let firstState: FirstRunState = loadFirstRun(localStorage);
  let laterItems: LaterItem[] = [];
  let reviewBtn: HTMLButtonElement | null = null;

  function refreshTray(): void {
    const label = reviewTrayLabel(waitingCount(deps.getChanges()));
    tray.textContent = label;
    tray.setAttribute('aria-label', label);
    if (reviewBtn) {
      reviewBtn.textContent = label;
      reviewBtn.setAttribute('aria-label', label);
      reviewBtn.title = label;
    }
  }

  function renderHint(): void {
    const sit = deps.getSuggestionSituation();
    const suggestion = pickSuggestion(sit, localStorage);
    const focus = deps.getFocus();
    const phrase = suggestion ? suggestion.text : hintForFocus(focus, localStorage)?.text;
    hint.textContent = '';
    if (!phrase) {
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    const text = document.createElement('p');
    text.textContent = phrase;
    hint.append(text);
    if (suggestion) {
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.textContent = 'Yes';
      yes.addEventListener('click', () => deps.onSuggestionAccept(suggestion));
      const no = document.createElement('button');
      no.type = 'button';
      no.textContent = 'Drop';
      no.addEventListener('click', () => {
        recordSuggestionDrop(localStorage, suggestion.id);
        renderHint();
      });
      hint.append(yes, no);
    }
  }

  function renderHere(more = false): void {
    const focus = deps.getFocus();
    const level = deps.getSuggestionSituation().level;
    const acts = hereActions(focus, level, more);
    here.innerHTML = '';
    const h = document.createElement('h2');
    h.id = 'mc-here-title';
    h.textContent = hereTitle(focus);
    here.setAttribute('aria-labelledby', 'mc-here-title');
    here.append(h);
    const list = document.createElement('ol');
    acts.forEach((a, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${i + 1}  “${a.phrase}”`;
      b.addEventListener('click', () => {
        const hint = hintForFocus(deps.getFocus(), localStorage);
        if (hint) recordHintUsed(localStorage, hint.id);
        deps.onHereAction(a.phrase);
        here.hidden = true;
      });
      const det = document.createElement('span');
      det.textContent = a.detail;
      li.append(b, det);
      list.append(li);
    });
    const hands = document.createElement('p');
    hands.className = 'mc-here-hands';
    hands.textContent = HERE_HANDS_LINE;
    const say = document.createElement('p');
    say.className = 'mc-here-say';
    say.textContent = HERE_SAY_LINE;
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'mc-here-more';
    moreBtn.textContent = more ? 'Show less' : 'More';
    moreBtn.addEventListener('click', () => renderHere(!more));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mc-here-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = 'Close';
    close.addEventListener('click', () => { here.hidden = true; });
    here.append(list, hands, say, moreBtn, close);
  }

  function renderPalm(center?: { x: number; y: number }): void {
    palm.innerHTML = '';
    if (center) {
      palm.style.left = `${center.x}px`;
      palm.style.top = `${center.y}px`;
    }
    for (const s of PALM_SLICES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mc-palm-slice is-${s.id}`;
      b.setAttribute('role', 'menuitem');
      b.textContent = s.label;
      b.style.setProperty('--deg', String(s.centerDeg));
      b.addEventListener('click', () => {
        palm.hidden = true;
        if (s.id === 'here') { renderHere(); here.hidden = false; }
        deps.onPalmSlice(s.id);
      });
      palm.append(b);
    }
    const home = document.createElement('span');
    home.className = 'mc-palm-home';
    home.textContent = 'Studio';
    palm.append(home);
  }

  function renderNumbers(): void {
    const items = numberOverlays(deps.getFocusables());
    numbers.innerHTML = '';
    if (!numbersOn || !items.length) {
      numbers.hidden = true;
      return;
    }
    numbers.hidden = false;
    for (const o of items) {
      const s = document.createElement('span');
      s.className = 'mc-focus-num';
      s.textContent = String(o.n);
      s.title = o.name;
      numbers.append(s);
    }
    numbers.setAttribute('aria-label', items.map((o) => `${o.n}: ${o.name}`).join(', '));
  }

  function renderFirst(): void {
    first.innerHTML = '';
    if (first.hidden) return;
    const step = FIRST_RUN_STEPS[firstState.step] ?? FIRST_RUN_STEPS[0];
    const card = document.createElement('div');
    card.className = 'mc-first-run-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'mc-first-run-title');
    const h = document.createElement('h2');
    h.id = 'mc-first-run-title';
    h.textContent = step.title;
    const cap = document.createElement('p');
    cap.textContent = step.caption;
    const says = document.createElement('p');
    says.className = 'mc-first-run-says';
    says.textContent = step.says;
    const nav = document.createElement('div');
    nav.className = 'mc-first-run-nav';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => stepFirst(skipCurrentStep(firstState), true));
    const skipAllBtn = document.createElement('button');
    skipAllBtn.type = 'button';
    skipAllBtn.textContent = 'Skip the rest';
    skipAllBtn.addEventListener('click', () => stepFirst(skipAll(firstState), true));
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Back';
    back.disabled = firstState.step === 0;
    back.addEventListener('click', () => stepFirst(backStep(firstState)));
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'mc-first-run-next';
    next.textContent = step.id === 'done' ? 'Start drawing' : 'Next';
    next.addEventListener('click', () => {
      if (step.id === 'done') stepFirst(advanceStep(firstState));
      else stepFirst(advanceStep(firstState));
    });
    nav.append(back, skip, skipAllBtn, next);
    if (step.id === 'done') {
      const sample = document.createElement('button');
      sample.type = 'button';
      sample.textContent = 'Load the sample house';
      sample.addEventListener('click', () => {
        deps.onLoadSampleHouse();
        stepFirst(advanceStep(firstState));
      });
      nav.insertBefore(sample, next);
    }
    const prog = document.createElement('p');
    prog.className = 'mc-first-run-prog';
    prog.textContent = `Step ${firstState.step + 1} of ${FIRST_RUN_STEPS.length} · about 7 minutes · skippable`;
    card.append(h, cap, says, nav, prog);
    first.append(card);
    deps.onFirstRunSpeak(step.says);
  }

  function stepFirst(next: FirstRunState, skipped = false): void {
    firstState = next;
    saveFirstRun(localStorage, firstState);
    if (firstState.done) {
      first.hidden = true;
      first.innerHTML = '';
      return;
    }
    first.hidden = false;
    renderFirst();
    void skipped;
  }

  function renderLater(): void {
    later.innerHTML = '';
    if (!laterItems.length) {
      later.hidden = true;
      return;
    }
    later.hidden = false;
    const h = document.createElement('h2');
    h.textContent = LATER_LIST;
    const p = document.createElement('p');
    p.textContent = laterListLabel(laterItems);
    const ul = document.createElement('ul');
    for (const it of laterItems) {
      const li = document.createElement('li');
      li.textContent = it.title;
      ul.append(li);
    }
    later.append(h, p, ul);
  }

  const api: StudioChrome = {
    element: root,
    setStatus(s) {
      const phr = formatStatus(s);
      statusBits.network.textContent = phr.network;
      statusBits.quick.textContent = phr.quick;
      statusBits.mic.textContent = phr.mic;
      statusBits.hand.textContent = phr.hand;
      status.setAttribute('aria-label', phr.summary);
    },
    setProposal(model, handlers) {
      proposalHost.innerHTML = '';
      if (!model) return;
      proposalHost.append(renderProposalCard(document, model, handlers));
    },
    refresh() {
      refreshTray();
      renderHint();
      if (!here.hidden) renderHere();
      if (numbersOn) renderNumbers();
    },
    openHere() { renderHere(); here.hidden = false; palm.hidden = true; },
    closeHere() { here.hidden = true; },
    hereOpen: () => !here.hidden,
    openPalm(center) { renderPalm(center); palm.hidden = false; },
    closePalm() { palm.hidden = true; },
    palmOpen: () => !palm.hidden,
    pickPalm(dx, dy, shortSide) {
      const pick = pickPalmSlice(dx, dy, shortSide);
      palm.hidden = true;
      if (pick.kind === 'studio') { deps.onPalmSlice('studio'); return; }
      if (pick.slice.id === 'here') { renderHere(); here.hidden = false; }
      deps.onPalmSlice(pick.slice.id);
    },
    showNumbers(on) {
      numbersOn = on ?? !numbersOn;
      renderNumbers();
      return numbersOn;
    },
    handleUtterance(utterance) {
      if (!first.hidden && isSkipUtterance(utterance)) {
        stepFirst(skipCurrentStep(firstState), true);
        return 'first-run-skip';
      }
      if (wantsNumbers(utterance)) {
        const on = api.showNumbers(true);
        return on ? 'handled' : 'handled';
      }
      if (/^hide hints$|^stop hints$/i.test(utterance.trim())) {
        setHintsHidden(localStorage, true);
        renderHint();
        return 'handled';
      }
      if (isSharmaHousePrompt(utterance)) {
        deps.onLoadSampleHouse();
        return 'handled';
      }
      const slice = sliceFromSpeech(utterance);
      if (slice) {
        if (slice.id === 'here') { renderHere(); here.hidden = false; }
        deps.onPalmSlice(slice.id);
        return 'handled';
      }
      const filter = parseHistoryFilter(utterance);
      if (filter) {
        // Stash on the tray so History can read it; also announce.
        tray.dataset.filter = JSON.stringify(filter);
        deps.onPalmSlice('review');
        return 'handled';
      }
      return null;
    },
    openFirstRun(force) {
      firstState = loadFirstRun(localStorage);
      if (!force && !shouldOfferFirstRun(localStorage)) return;
      if (firstState.done && force) firstState = { step: 0, done: false };
      first.hidden = false;
      renderFirst();
    },
    closeFirstRun() { first.hidden = true; },
    firstRunOpen: () => !first.hidden,
    setLater(items) { laterItems = items; renderLater(); },
    reviewLabel: () => reviewTrayLabel(waitingCount(deps.getChanges())),
    setReviewButton(btn) { reviewBtn = btn; tray.hidden = true; refreshTray(); },
  };

  tray.addEventListener('click', () => deps.onPalmSlice('review'));
  renderPalm();
  return api;
}

function chip(parent: HTMLElement, key: string): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'mc-status-chip';
  const k = document.createElement('span');
  k.className = 'status-k';
  k.textContent = key;
  const v = document.createElement('span');
  v.className = 'status-v';
  v.textContent = '—';
  wrap.append(k, v);
  parent.append(wrap);
  return v;
}

export function proposalFromChange(e: ChangeEntry, kind?: CatalogKind): ProposalModel {
  const catalog = catalogRoute({
    route: e.route ?? {
      tier: e.source === 'cloud' ? 'gemini' : e.source === 'on-device' ? 'nano' : 'plan-data',
      engine: e.source === 'cloud' ? 'gemini' : e.source === 'on-device' ? 'nano' : 'rules',
      reason: e.why || 'a change to your plan',
    },
    kind,
  });
  return {
    id: e.id,
    title: e.title,
    youAsked: e.why,
    catalog,
    status: e.status === 'pending' ? 'waiting' : e.status === 'applied' ? 'kept' : e.status === 'rejected' ? 'dropped' : 'waiting',
  };
}

export { catalogRoute, parseHistoryFilter, applyHistoryFilter, PALM_HOLD_MS, backupVideoUrl, BACKUP_VIDEO_SLOT_LABEL, hintsHidden };
export type { HistoryFilter, RouteInfo };
