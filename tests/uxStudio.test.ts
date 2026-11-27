import { describe, expect, it } from 'vitest';
import { routeGemini, routeNanoCanvas, routeOffline, routePlanData, routeSpeculative } from '../src/cad/routeReason';
import { actorByLine, BY_DEEP, BY_QUICK, GETTING_QUICK_READY, LATER_LIST, OFFLINE_QUICK_ONLY, QUICK_READY, WAITING_FOR_YOU } from '../src/ux/wording';
import { catalogRoute, formatWhatWasSent, ROUTE_LINES } from '../src/ux/routeCatalog';
import { formatStatus } from '../src/ux/statusLine';
import { applyHistoryFilter, parseHistoryFilter, reviewTrayLabel, undoProposalTitle, waitingCount } from '../src/ux/historyFilters';
import type { ChangeEntry } from '../src/cad/changeLog';
import { PALM_SLICES, pickPalmSlice, sliceForAngle, sliceFromSpeech } from '../src/ux/palmMenu';
import { numberOverlays, resolveFocus, snapToNearest, wantsNumbers, type Focusable } from '../src/ux/focusModel';
import { HERE_HANDS_LINE, hereActions, hereTitle } from '../src/ux/hereCard';
import { hintForFocus, recordHintUsed, setHintsHidden } from '../src/ux/hints';
import { discoveryLevel, isRetired, pickSuggestion, recordSuggestionDrop, type SuggestionSituation } from '../src/ux/suggestions';
import { advanceStep, backStep, FIRST_RUN_STEPS, isSkipUtterance, loadFirstRun, saveFirstRun, shouldOfferFirstRun, skipAll, skipCurrentStep } from '../src/ux/firstRun';
import { armLeave, canUndoLeave, completeHold, holdProgress, LEAVE_UNDO_MS, PINCH_HOLD_MS, startHold, undoLeave } from '../src/ux/leaveApp';
import { deepWorkingLabel, laterListLabel } from '../src/ux/deepWait';
import { backupVideoUrl, isSharmaHousePrompt, sharmaHouseOps, SHARMA_HOUSE } from '../src/ux/demoKit';
import { renderProposalCard, statusLabel } from '../src/ux/proposal';

function mem(init: Record<string, string> = {}) {
  const s = { ...init };
  return {
    getItem: (k: string) => (k in s ? s[k] : null),
    setItem: (k: string, v: string) => { s[k] = v; },
    data: s,
  };
}

function entry(p: Partial<ChangeEntry> & Pick<ChangeEntry, 'id' | 'actor' | 'status'>): ChangeEntry {
  return {
    tool: 'edit', title: 'Change', why: '', op: null, before: '', at: 1, source: 'rules',
    ...p,
  };
}

const room: Focusable = { id: 'r1', kind: 'room', name: 'Kitchen', x: 0, y: 0 };
const wall: Focusable = { id: 'w1', kind: 'wall', name: 'north wall', x: 100, y: 0 };
const door: Focusable = { id: 'd1', kind: 'door', name: 'Door 2', x: 200, y: 10 };

describe('route catalog', () => {
  it('maps plan data and on-device edits to Quick lines with nothing sent', () => {
    const plan = catalogRoute({ route: routePlanData() });
    expect(plan.helper).toBe('Quick');
    expect(plan.byLine).toBe(BY_QUICK);
    expect(plan.routeLine).toBe(ROUTE_LINES.planNumbers);
    expect(plan.whatWasSent).toBeNull();
    const edit = catalogRoute({ route: routeNanoCanvas(), kind: 'edit' });
    expect(edit.routeLine).toBe(ROUTE_LINES.smallEdit);
    expect(formatWhatWasSent(edit)).toBeNull();
  });

  it('maps offline and keep-on-device lines', () => {
    expect(catalogRoute({ route: routeOffline() }).routeLine).toBe(ROUTE_LINES.offline);
    expect(catalogRoute({ route: routeNanoCanvas(), keepOnDevice: true }).routeLine).toBe(ROUTE_LINES.keepOnDevice);
  });

  it('maps Deep kinds, including what was sent, and keeps the technical line', () => {
    const unsure = catalogRoute({ route: routeGemini({ nano: 'unsure' }), kind: 'escalation', sent: 'make [name] door 900' });
    expect(unsure.helper).toBe('Deep');
    expect(unsure.byLine).toBe(BY_DEEP);
    expect(unsure.routeLine).toBe(ROUTE_LINES.escalation);
    expect(formatWhatWasSent(unsure)).toContain('make [name] door 900');
    expect(unsure.technicalLine).toMatch(/Gemini|Nano unsure/);
    expect(catalogRoute({ route: routeGemini({ kind: 'hard' }), kind: 'lighting' }).routeLine).toBe(ROUTE_LINES.lighting);
    expect(catalogRoute({ route: routeGemini({ kind: 'hard' }), kind: 'connector' }).routeLine).toBe(ROUTE_LINES.connector);
    expect(catalogRoute({ route: routeGemini({ kind: 'hard' }), languageIsKannada: true }).routeLine).toBe(ROUTE_LINES.kannada);
  });

  it('keeps a speculative draft as Quick and a confirmation as Deep', () => {
    const draft = catalogRoute({ route: routeSpeculative({ state: 'draft' }) });
    expect(draft.helper).toBe('Quick');
    const conf = catalogRoute({ route: routeSpeculative({ state: 'confirmed', because: 'the opening is 900' }) });
    expect(conf.helper).toBe('Deep');
  });
});

describe('status line', () => {
  it('phrases online/offline, Quick ready, mic, and hand', () => {
    const online = formatStatus({ online: true, quick: 'ready', mic: 'listening', hand: 'seen' });
    expect(online.network).toBe('Online');
    expect(online.quick).toBe(QUICK_READY);
    expect(online.mic).toBe('Mic on');
    expect(online.hand).toBe('Hand seen');
    expect(online.summary).toContain('Quick ready');
    const off = formatStatus({ online: false, quick: 'getting-ready', quickPercent: 42, mic: 'sleep', hand: 'paused' });
    expect(off.network).toBe(OFFLINE_QUICK_ONLY);
    expect(off.quick).toBe(`${GETTING_QUICK_READY} 42%`);
    expect(off.hand).toBe('Hands paused');
  });
});

describe('review tray and history filters', () => {
  const rows = [
    entry({ id: '1', actor: 'gemini', status: 'pending', title: 'Widen door' }),
    entry({ id: '2', actor: 'her', status: 'applied', title: 'Move wall' }),
    entry({ id: '3', actor: 'nano', status: 'rejected', title: 'Add window' }),
  ];
  it('counts waiting and labels the tray', () => {
    expect(waitingCount(rows)).toBe(1);
    expect(reviewTrayLabel(2)).toBe('Review · 2 waiting');
    expect(reviewTrayLabel(0)).toBe('Review & History');
  });
  it('parses spoken filters and applies them', () => {
    expect(applyHistoryFilter(rows, parseHistoryFilter('show mine')!).map((e) => e.id)).toEqual(['2']);
    expect(applyHistoryFilter(rows, parseHistoryFilter('show Quick')!).map((e) => e.id)).toEqual(['3']);
    expect(applyHistoryFilter(rows, parseHistoryFilter('show Deep')!).map((e) => e.id)).toEqual(['1']);
    expect(applyHistoryFilter(rows, parseHistoryFilter('show dropped')!).map((e) => e.id)).toEqual(['3']);
    expect(parseHistoryFilter('draw a door')).toBeNull();
  });
  it('turns undo into a card title and uses Quick/Deep actor lines', () => {
    expect(undoProposalTitle(rows[1])).toBe('Undo: Move wall');
    expect(actorByLine('nano')).toBe(BY_QUICK);
    expect(actorByLine('gemini')).toBe(BY_DEEP);
  });
});

describe('palm menu', () => {
  it('has six fixed slices and picks by direction, not distance', () => {
    expect(PALM_SLICES).toHaveLength(6);
    expect(sliceForAngle(0).id).toBe('review');
    expect(sliceForAngle(60).id).toBe('view');
    expect(sliceForAngle(180).id).toBe('site');
    expect(sliceForAngle(300).id).toBe('here');
    const far = pickPalmSlice(0, -400, 1000);
    const nearSame = pickPalmSlice(0, -80, 1000);
    expect(far).toEqual(nearSame);
    expect(far.kind).toBe('slice');
    if (far.kind === 'slice') expect(far.slice.id).toBe('review');
  });
  it('returns to Studio when the pinch does not move, and accepts spoken labels', () => {
    expect(pickPalmSlice(2, -2, 1000)).toEqual({ kind: 'studio' });
    expect(sliceFromSpeech('what can I do')?.id).toBe('here');
    expect(sliceFromSpeech('go to history')?.id).toBe('review');
  });
});

describe('focus model', () => {
  const items = [room, wall, door];
  it('snaps to the nearest thing and numbers them', () => {
    expect(snapToNearest(items, 90, 0)?.id).toBe('w1');
    expect(numberOverlays(items, { x: 0, y: 0 }).map((o) => o.n + ':' + o.id)).toEqual(['1:r1', '2:w1', '3:d1']);
  });
  it('resolves pointed, names, numbers, and this/that/here in that order', () => {
    expect(resolveFocus('make this 900', { items, pointed: door, lastTouched: wall, numbersVisible: false })).toMatchObject({ kind: 'hit', how: 'pointed', item: { id: 'd1' } });
    expect(resolveFocus('check the kitchen', { items, numbersVisible: false })).toMatchObject({ kind: 'hit', how: 'name', item: { id: 'r1' } });
    expect(resolveFocus('make number 2 4 metres', { items, numbersVisible: true, lastTouched: room })).toMatchObject({ kind: 'hit', how: 'number' });
    expect(resolveFocus('make that 900', { items, lastTouched: wall, numbersVisible: false })).toMatchObject({ kind: 'hit', how: 'last', item: { id: 'w1' } });
    const ask = resolveFocus('make this 900', { items, numbersVisible: false });
    expect(ask.kind).toBe('ask');
    if (ask.kind === 'ask') expect(ask.prompt).toBe('Which one? Say a number');
    expect(wantsNumbers('show numbers')).toBe(true);
  });
});

describe('Here card and hint strip', () => {
  it('titles the card from the focused thing and offers three actions', () => {
    expect(hereTitle(room)).toBe('HERE: Kitchen (room)');
    const acts = hereActions(room, 2);
    expect(acts).toHaveLength(3);
    expect(acts[0].phrase).toBe('Check this room');
    expect(HERE_HANDS_LINE).toMatch(/pinch = keep/);
    expect(hereActions(room, 2, true).length).toBeGreaterThan(3);
  });
  it('shows one hint for the focus and retires it after three uses', () => {
    const store = mem();
    const first = hintForFocus(wall, store);
    expect(first?.text).toMatch(/make this 4 metres|put a door here/);
    recordHintUsed(store, first!.id);
    recordHintUsed(store, first!.id);
    recordHintUsed(store, first!.id);
    const next = hintForFocus(wall, store);
    expect(next?.id).not.toBe(first!.id);
    setHintsHidden(store, true);
    expect(hintForFocus(wall, store)).toBeNull();
  });
});

describe('suggestion engine', () => {
  it('returns one suggestion at a time and retires after two drops', () => {
    const store = mem();
    const sit = (over: Partial<SuggestionSituation> = {}): SuggestionSituation => ({
      level: 2, hasClosedRoom: true, trigger: 'room-closed', ...over,
    });
    const a = pickSuggestion(sit(), store);
    expect(a?.id).toBe('check');
    recordSuggestionDrop(store, 'check');
    expect(isRetired(store, 'check')).toBe(false);
    recordSuggestionDrop(store, 'check');
    expect(isRetired(store, 'check')).toBe(true);
    const b = pickSuggestion(sit(), store);
    expect(b?.id).toBe('walk');
    expect(b?.id).not.toBe('check');
    expect(pickSuggestion({ level: 1, emptyCanvas: true, trigger: 'first-open' }, store)?.id).toBe('draw');
    expect(discoveryLevel({ hasClosedRoom: true })).toBe(2);
    expect(discoveryLevel({ roomCount: 3 })).toBe(3);
    expect(discoveryLevel({ offline: true })).toBe(4);
  });
  it('does not suggest without a matching trigger', () => {
    const store = mem();
    expect(pickSuggestion({ level: 3, keptChanges: 2, trigger: 'kept-change' }, store)).toBeNull();
  });
});

describe('first run v1', () => {
  it('is about 7 minutes of skippable, resumable steps', () => {
    expect(FIRST_RUN_STEPS.length).toBeGreaterThanOrEqual(8);
    expect(FIRST_RUN_STEPS[0].says).toMatch(/English, Kannada, or both/);
    expect(FIRST_RUN_STEPS.at(-1)?.id).toBe('done');
    const store = mem();
    expect(shouldOfferFirstRun(store)).toBe(true);
    saveFirstRun(store, { step: 3, done: false });
    expect(loadFirstRun(store).step).toBe(3);
    expect(skipCurrentStep({ step: 3, done: false }).step).toBe(4);
    expect(skipAll({ step: 3, done: false })).toMatchObject({ done: true, skipped: true, step: 3 });
    expect(advanceStep({ step: FIRST_RUN_STEPS.length - 1, done: false }).done).toBe(true);
    expect(backStep({ step: 1, done: false }).step).toBe(0);
    expect(isSkipUtterance('sāku')).toBe(true);
    expect(isSkipUtterance('skip')).toBe(true);
    saveFirstRun(store, { step: 0, done: true });
    expect(shouldOfferFirstRun(store)).toBe(false);
  });
});

describe('pinch-and-hold and the 10 s undo window', () => {
  it('arms, requires a full hold, then allows undo only inside the window', () => {
    let s = armLeave({ kind: 'email', title: 'Email Priya', detail: 'draft' });
    const t0 = 1_000;
    s = startHold(s, t0);
    expect(holdProgress(s, t0 + PINCH_HOLD_MS / 2)).toBeCloseTo(0.5, 1);
    expect(completeHold(s, t0 + PINCH_HOLD_MS / 2).phase).toBe('holding');
    s = completeHold(s, t0 + PINCH_HOLD_MS);
    expect(s.phase).toBe('sent');
    expect(canUndoLeave(s, t0 + PINCH_HOLD_MS + 1_000)).toBe(true);
    expect(canUndoLeave(s, t0 + PINCH_HOLD_MS + LEAVE_UNDO_MS + 1)).toBe(false);
    const undone = undoLeave(s, t0 + PINCH_HOLD_MS + 2_000);
    expect(undone.phase).toBe('undone');
  });
});

describe('Deep waiting and the Later list', () => {
  it('gives an estimate and names the Later list', () => {
    expect(deepWorkingLabel('lighting')).toBe('Deep · online · about 15 s · keep working');
    expect(laterListLabel([{ id: '1', title: 'Check the beam', kind: 'copilot' }])).toMatch(new RegExp(`${LATER_LIST}.*back online`));
  });
});

describe('demo kit', () => {
  it('seeds Sharma House with a site and levels, not rooms, and accepts a backup video URL', () => {
    expect(SHARMA_HOUSE).toBe('Sharma House');
    const ops = sharmaHouseOps();
    expect(ops.filter((o) => o.op === 'add_wall')).toHaveLength(4);
    expect(ops.some((o) => o.op === 'add_room')).toBe(false);
    expect(ops.some((o) => String(o.text).includes('Level 0'))).toBe(true);
    expect(isSharmaHousePrompt('sample house')).toBe(true);
    expect(backupVideoUrl(mem({ 'mendcraft:demo-backup-video': 'https://example.com/demo.mp4' }))).toBe('https://example.com/demo.mp4');
    expect(backupVideoUrl(mem({ 'mendcraft:demo-backup-video': 'javascript:alert(1)' }))).toBeNull();
  });
});

describe('Proposal card', () => {
  it('renders what, why, by, the route line, and keep/drop', () => {
    expect(statusLabel('waiting')).toBe(WAITING_FOR_YOU);
    const catalog = catalogRoute({ route: routeGemini({ nano: 'unsure' }), kind: 'escalation', sent: 'make this 900' });
    // node has no DOM; skip render when document is missing.
    if (typeof document === 'undefined') {
      expect(catalog.byLine).toBe(BY_DEEP);
      return;
    }
    const el = renderProposalCard(document, {
      id: 'p1',
      title: 'Door D2: 750 → 900 mm',
      youAsked: 'make this door wheelchair friendly',
      why: 'our wheelchair guideline uses 900 mm clear',
      catalog,
      status: 'waiting',
    });
    expect(el.querySelector('.mc-proposal-title')?.textContent).toMatch(/Door D2/);
    expect(el.textContent).toContain('Waiting for you');
    expect(el.textContent).toContain('By: Deep · online');
    expect(el.textContent).toContain(ROUTE_LINES.escalation);
    expect(el.textContent).toContain('PINCH  keep');
  });
});
