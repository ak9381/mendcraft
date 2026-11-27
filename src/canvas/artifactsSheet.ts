// "Artifacts" (Tools → More → Artifacts, or say "show artifacts"): every
// stored artifact — kind, title, who made it and when it was approved — each
// with a Remove button, plus Export and Import of the whole set as JSON.
//
// The list is read with loadArtifacts, so it shows only what passes its check
// right now. Export writes those checked artifacts and nothing else: no
// settings, no tokens, nothing outside the artifact store. Import never runs
// anything: the file is parsed as JSON and every entry goes through
// coerceArtifact, exactly as a load does; an entry that fails is left out and
// counted. Nothing is written until she has seen what the import would add,
// replace and hide, and tapped Import. Imported rows are labelled imported.
// Built with createElement/textContent only.
import { ARTIFACT_MAX_CHARS, ARTIFACT_MAX_COUNT, coerceArtifact, type Artifact, type ArtifactBy, type ArtifactKind } from '../artifacts/artifact';
import { loadArtifacts, type ArtifactStore } from '../artifacts/store';

/** What every stored artifact's maker is shown as. */
export const ENGINE_LABEL: Record<ArtifactBy, string> = {
  nano: 'Gemini Nano · on device',
  gemini: 'Gemini · cloud',
  apple: 'Apple · on device',
  person: 'You',
  replay: 'Replay · recorded reply',
};

/** The maker as shown: "Imported · Gemini · cloud" for an imported row. */
export function makerLabel(a: { by: ArtifactBy; imported?: boolean }): string {
  return a.imported ? `Imported · ${ENGINE_LABEL[a.by]}` : ENGINE_LABEL[a.by];
}

export const KIND_LABEL: Record<ArtifactKind, string> = {
  board: 'Board',
  plan: 'Floor plan drawing',
  connector: 'Connector',
  pack: 'Language pack',
  steps: 'Next steps',
};

/** "27 Nov 2026": the day an artifact was approved (or suggested, or imported). */
export function approvalDate(at: number): string {
  try { return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}

/** One line under an artifact: who made it and when. */
export function madeLine(a: Pick<Artifact, 'by' | 'at' | 'status' | 'imported'>): string {
  const when = a.imported ? 'imported' : a.status === 'suggested' ? 'suggested' : 'approved';
  return `${makerLabel(a)} · ${when} ${approvalDate(a.at)}`;
}

export const EXPORT_FILE = 'mendcraft-artifacts.json';
export const EXPORT_FORMAT = 'mendcraft-artifacts';
export const NOT_AN_EXPORT_LINE = "That file isn't a Mendcraft export. Nothing changed.";
export const IMPORT_TOO_BIG_LINE = 'That file is too big for a Mendcraft export. Nothing changed.';
export const IMPORT_CANCELLED_LINE = 'Import cancelled. Nothing changed.';
/** The largest file import reads: the most artifacts the store loads, each at its cap. */
export const IMPORT_MAX_CHARS = ARTIFACT_MAX_CHARS * 20;
/** A file's size in bytes is checked before it is read (UTF-8 can run a little over its characters). */
export const IMPORT_MAX_BYTES = Math.ceil(IMPORT_MAX_CHARS * 1.1);

/** Recorded replies exist only in a test build: an artifact made from one
 *  is refused by an import anywhere else. */
const TEST_BUILD = !!(import.meta.env?.DEV || import.meta.env?.VITE_E2E === '1');

/** Thrown by importArtifacts when the text is not an export at all. */
export class ImportRefused extends Error {}

const ENVELOPE_KEYS = ['id', 'kind', 'v', 'title', 'data', 'by', 'at', 'status', 'imported'] as const;

/** The set as an export file. Each artifact is checked again and only its
 *  envelope is written (what coerceArtifact gives back), so nothing that is
 *  not an artifact — a token, a setting — can ride along. */
export function exportArtifacts(list: Artifact[]): string {
  const out: Artifact[] = [];
  for (const raw of list) {
    const r = coerceArtifact(raw);
    if (!r.ok) continue;
    const a = {} as Record<string, unknown>;
    for (const k of ENVELOPE_KEYS) if (r.value[k] !== undefined) a[k] = r.value[k];
    out.push(a as unknown as Artifact);
  }
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, artifacts: out }, null, 2);
}

/** An export file → the artifacts that pass coerceArtifact (as a load checks
 *  them), each marked imported with `at` = now, and how many entries were
 *  left out: failed their check, made from a recorded reply outside a test
 *  build, repeated an id, or came past ARTIFACT_MAX_COUNT. Text that is not
 *  an export (not JSON, no export envelope) throws ImportRefused. Nothing in
 *  the file is ever run. */
export function importArtifacts(text: string, o: { now?: number; allowReplay?: boolean } = {}): { ok: Artifact[]; dropped: number } {
  if (text.length > IMPORT_MAX_CHARS) throw new ImportRefused(IMPORT_TOO_BIG_LINE);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ImportRefused(NOT_AN_EXPORT_LINE); }
  const env = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as { format?: unknown; artifacts?: unknown } : null;
  if (!env || env.format !== EXPORT_FORMAT || !Array.isArray(env.artifacts)) throw new ImportRefused(NOT_AN_EXPORT_LINE);
  const now = o.now ?? Date.now();
  const allowReplay = o.allowReplay ?? TEST_BUILD;
  const ok: Artifact[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const e of env.artifacts) {
    const r = coerceArtifact(e);
    if (!r.ok || (r.value.by === 'replay' && !allowReplay) || seen.has(r.value.id) || ok.length >= ARTIFACT_MAX_COUNT) { dropped++; continue; }
    seen.add(r.value.id);
    ok.push({ ...r.value, at: now, imported: true });
  }
  return { ok, dropped };
}

/** What an import would do to the store, said before anything is written. */
export interface ImportPlan {
  rows: Artifact[];
  dropped: number;
  adds: number;
  /** Titles of the stored artifacts it would replace (same id). */
  replaces: string[];
  /** Older stored rows that would no longer load (past ARTIFACT_MAX_COUNT). */
  hides: number;
  /** Connector names in the file (each runs a lamp once imported). */
  connectors: string[];
}

export function planImport(got: { ok: Artifact[]; dropped: number }, stored: readonly Artifact[]): ImportPlan {
  const byId = new Map(stored.map((a) => [a.id, a]));
  const replaces = got.ok.filter((a) => byId.has(a.id)).map((a) => byId.get(a.id)!.title);
  const incoming = new Set(got.ok.map((a) => a.id));
  const after = stored.filter((a) => !incoming.has(a.id)).length + got.ok.length;
  return {
    rows: got.ok, dropped: got.dropped,
    adds: got.ok.length - replaces.length, replaces,
    hides: Math.max(0, after - ARTIFACT_MAX_COUNT),
    connectors: got.ok.filter((a) => a.kind === 'connector').map((a) => a.title),
  };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const leftOut = (n: number): string => (n ? `${plural(n, 'entry', 'entries')} failed ${n === 1 ? 'its' : 'their'} check and ${n === 1 ? 'was' : 'were'} left out.` : '');

/** "Adds 2, replaces 1 (Desk), hides 3 older (over the 200 cap)." and the rest. */
export function importSummary(p: ImportPlan): string[] {
  const parts = [`Adds ${p.adds}`, `replaces ${p.replaces.length}${p.replaces.length ? ` (${p.replaces.join(', ')})` : ''}`];
  if (p.hides) parts.push(`hides ${p.hides} older (over the ${ARTIFACT_MAX_COUNT} cap)`);
  return [
    `${parts.join(', ')}.`,
    p.connectors.length ? `Connectors: ${p.connectors.join(', ')}.` : '',
    leftOut(p.dropped),
    'Nothing is written until you tap Import.',
  ].filter(Boolean);
}

export interface ArtifactsSheetDeps {
  store: ArtifactStore;
  /** The store changed (a Remove, an Import): the canvas catches up. */
  onChange(): void;
  /** A status line for the canvas. */
  say(line: string): void;
  /** Writing an import (or putting a removed row back) starts (true) or ended
   *  with nothing written (false): the canvas saves what it has first and
   *  holds its saves meanwhile, so no save writes over what comes in. */
  importing?(on: boolean): void;
}

export interface ArtifactsSheet {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Read an export (what the file picker reads) and show what importing it would do. */
  importText(text: string): Promise<void>;
  /** Export the checked set (downloads mendcraft-artifacts.json); resolves to the file text. */
  exportNow(): Promise<string | null>;
}

const errLine = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return /Nothing changed\.$/.test(m) ? m : `The store couldn't be changed (${m.replace(/[.\s]+$/, '')}). Nothing changed.`;
};
/** How long the second tap of Remove is waited for. */
export const REMOVE_CONFIRM_MS = 6000;

export function mountArtifactsSheet(host: HTMLElement, deps: ArtifactsSheetDeps): ArtifactsSheet {
  const doc = host.ownerDocument;
  const make = (tag: string, cls: string, text?: string): HTMLElement => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const button = (cls: string, text: string): HTMLButtonElement => {
    const b = make('button', `mc-btn ${cls}`, text) as HTMLButtonElement;
    b.type = 'button';
    return b;
  };
  const el = make('section', 'mc-artifacts-sheet');
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Artifacts');
  el.setAttribute('data-hand-always', '');
  const head = make('div', 'mc-artifacts-head');
  const closeBtn = button('mc-artifacts-close', 'Close');
  head.append(make('h2', 'mc-artifacts-title', 'Artifacts'), closeBtn);
  const note = make('p', 'mc-artifacts-note');
  const undoBtn = button('mc-artifacts-undo', 'Undo remove');
  undoBtn.hidden = true;
  // The import confirm: what it would add, replace and hide; Import / Cancel.
  const confirm = make('section', 'mc-artifacts-confirm');
  confirm.hidden = true;
  confirm.setAttribute('aria-label', 'Import these artifacts?');
  const confirmText = make('div', 'mc-artifacts-confirm-text');
  const confirmBtns = make('div', 'mc-artifacts-confirm-btns');
  const doImport = button('primary mc-artifacts-do-import', 'Import');
  const cancelImport = button('mc-artifacts-cancel-import', 'Cancel');
  confirmBtns.append(doImport, cancelImport);
  confirm.append(make('h3', 'mc-artifacts-confirm-title', 'Import these artifacts?'), confirmText, confirmBtns);
  const list = make('ul', 'mc-artifacts-list');
  list.setAttribute('aria-label', 'Stored artifacts');
  const foot = make('div', 'mc-artifacts-foot');
  const exportBtn = button('mc-artifacts-export', 'Export');
  const importBtn = button('mc-artifacts-import', 'Import');
  const file = make('input', 'mc-artifacts-file') as HTMLInputElement;
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.hidden = true;
  foot.append(exportBtn, importBtn, file);
  el.append(head, note, undoBtn, confirm, list, foot);
  host.append(el);

  let paintSeq = 0;
  let armed: { id: string; until: number } | null = null;
  /** The last row removed this session, as it was stored: "Undo remove" puts it back. */
  let lastRemoved: Artifact | null = null;
  let staged: ImportPlan | null = null;
  let writing = false;

  async function paint(): Promise<void> {
    const seq = ++paintSeq;
    const loaded = await loadArtifacts(deps.store);
    if (seq !== paintSeq) return;
    list.textContent = '';
    undoBtn.hidden = !lastRemoved;
    if (lastRemoved) undoBtn.setAttribute('aria-label', `Undo remove: put back “${lastRemoved.title}”`);
    if (loaded.readFailed) { note.textContent = "Stored artifacts couldn't be read. Nothing is listed, and nothing stored was changed."; return; }
    const failed = loaded.dropped.length;
    const shown = loaded.ok.length;
    note.textContent = [
      shown ? `${plural(shown, 'stored artifact')}, each checked again just now.` : 'Nothing is stored yet.',
      failed ? `${plural(failed, 'stored item')} failed ${failed === 1 ? 'its' : 'their'} check and ${failed === 1 ? 'is' : 'are'} not listed.` : '',
      loaded.overCap.length ? `${plural(loaded.overCap.length, 'older item')} past the limit of ${ARTIFACT_MAX_COUNT} ${loaded.overCap.length === 1 ? 'is' : 'are'} not listed.` : '',
    ].filter(Boolean).join(' ');
    for (const a of loaded.ok) {
      const row = make('li', 'mc-artifacts-row');
      row.dataset.artifact = a.id;
      const text = make('div', 'mc-artifacts-text');
      const made = make('span', 'mc-artifacts-made', madeLine(a));
      made.dataset.by = a.by;
      if (a.imported) made.dataset.imported = '';
      text.append(make('span', 'mc-artifacts-kind', KIND_LABEL[a.kind]), make('span', 'mc-artifacts-name', a.title), made);
      const remove = button('mc-artifacts-remove', 'Remove');
      remove.setAttribute('aria-label', `Remove ${KIND_LABEL[a.kind].toLowerCase()} ${a.title}`);
      remove.addEventListener('click', () => { void removeOne(a, remove); });
      row.append(text, remove);
      list.append(row);
    }
  }

  // Remove asks for a second tap; the row is kept in memory for "Undo remove".
  async function removeOne(a: Artifact, btn: HTMLButtonElement): Promise<void> {
    const now = Date.now();
    if (!armed || armed.id !== a.id || now > armed.until) {
      armed = { id: a.id, until: now + REMOVE_CONFIRM_MS };
      for (const b of list.querySelectorAll<HTMLButtonElement>('.mc-artifacts-remove[data-confirm]')) { b.removeAttribute('data-confirm'); b.textContent = 'Remove'; }
      btn.dataset.confirm = '';
      btn.textContent = 'Tap again to remove';
      deps.say(`Tap Remove again to remove “${a.title}”.`);
      return;
    }
    armed = null;
    const raw = (await deps.store.list().catch(() => [] as Artifact[])).find((x) => x.id === a.id) ?? a;
    try { await deps.store.remove(a.id); } catch (e) { deps.say(errLine(e)); await paint(); return; }
    lastRemoved = JSON.parse(JSON.stringify(raw)) as Artifact;
    deps.say(`Removed “${a.title}”. Tap Undo remove to put it back.`);
    await paint();
    deps.onChange();
  }

  /** Write rows (an import, or the row Undo remove puts back). */
  async function write(rows: Artifact[], doneLine: (n: number) => string): Promise<void> {
    if (writing) return;
    writing = true;
    deps.importing?.(true);
    let put = 0;
    try {
      for (const a of rows) {
        try { await deps.store.put(a); put++; } catch (e) {
          deps.say(put ? `Imported ${put} of ${rows.length}, then: ${errLine(e)}` : errLine(e));
          if (!put) deps.importing?.(false);
          await paint();
          if (put) deps.onChange();
          return;
        }
      }
      deps.say(doneLine(put));
      await paint();
      deps.onChange();
    } finally { writing = false; }
  }

  async function undoRemove(): Promise<void> {
    const row = lastRemoved;
    if (!row) return;
    lastRemoved = null;
    undoBtn.hidden = true;
    await write([row], () => `Put back “${row.title}”.`);
  }

  async function exportNow(): Promise<string | null> {
    const loaded = await loadArtifacts(deps.store);
    if (loaded.readFailed) { deps.say("Stored artifacts couldn't be read, so nothing was exported."); return null; }
    if (!loaded.ok.length) { deps.say('Nothing is stored yet, so there is nothing to export.'); return null; }
    const text = exportArtifacts(loaded.ok);
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = doc.createElement('a');
      a.href = url;
      a.download = EXPORT_FILE;
      a.hidden = true;
      host.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { /* no download here (tests); the text is still returned */ }
    deps.say(`Exported ${plural(loaded.ok.length, 'artifact')} to ${EXPORT_FILE}. It holds no tokens and no settings.`);
    return text;
  }

  function hideConfirm(): void { staged = null; confirm.hidden = true; confirmText.textContent = ''; }

  async function importText(text: string): Promise<void> {
    hideConfirm();
    let got: { ok: Artifact[]; dropped: number };
    try { got = importArtifacts(text); } catch (e) { deps.say(e instanceof ImportRefused ? e.message : NOT_AN_EXPORT_LINE); return; }
    if (!got.ok.length) { deps.say(['Nothing was imported.', leftOut(got.dropped), 'Nothing changed.'].filter(Boolean).join(' ')); return; }
    let stored: Artifact[];
    try { stored = (await deps.store.list()).filter((a) => coerceArtifact(a).ok); } catch { deps.say("Stored artifacts couldn't be read, so nothing was imported. Nothing changed."); return; }
    staged = planImport(got, stored);
    const lines = importSummary(staged);
    confirmText.textContent = '';
    for (const line of lines) confirmText.append(make('p', 'mc-artifacts-confirm-line', line));
    confirm.hidden = false;
    deps.say(`${lines[0]} Tap Import to bring them in, or Cancel.`);
    doImport.focus?.();
  }

  doImport.addEventListener('click', () => {
    const plan = staged;
    if (!plan) return;
    hideConfirm();
    void write(plan.rows, (n) => [`Imported ${plural(n, 'artifact')}.`, leftOut(plan.dropped)].filter(Boolean).join(' '));
  });
  cancelImport.addEventListener('click', () => { if (!staged) return; hideConfirm(); deps.say(IMPORT_CANCELLED_LINE); });
  undoBtn.addEventListener('click', () => { void undoRemove(); });
  exportBtn.addEventListener('click', () => { void exportNow(); });
  importBtn.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > IMPORT_MAX_BYTES) { deps.say(IMPORT_TOO_BIG_LINE); return; }
    void f.text().then(importText, () => deps.say(NOT_AN_EXPORT_LINE));
  });

  const sheet: ArtifactsSheet = {
    el,
    open() { el.hidden = false; armed = null; void paint(); closeBtn.focus?.(); },
    close() { el.hidden = true; armed = null; if (staged) { hideConfirm(); deps.say(IMPORT_CANCELLED_LINE); } },
    isOpen: () => !el.hidden,
    importText,
    exportNow,
  };
  closeBtn.addEventListener('click', () => sheet.close());
  el.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); sheet.close(); } });
  return sheet;
}
