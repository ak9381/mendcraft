// "Artifacts" (Tools → More → Artifacts, or say "show artifacts"): every
// stored artifact — kind, title, who made it and when it was approved — each
// with a Remove button, plus Export and Import of the whole set as JSON.
//
// The list is read with loadArtifacts, so it shows only what passes its check
// right now. Export writes those checked artifacts and nothing else: no
// settings, no tokens, nothing outside the artifact store. Import never runs
// anything: the file is parsed as JSON and every entry goes through
// coerceArtifact, exactly as a load does; an entry that fails is left out and
// counted. Built with createElement/textContent only.
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

export const KIND_LABEL: Record<ArtifactKind, string> = {
  board: 'Board',
  plan: 'Floor plan drawing',
  connector: 'Connector',
  pack: 'Language pack',
  steps: 'Next steps',
};

/** "27 Nov 2026": the day an artifact was approved (or suggested). */
export function approvalDate(at: number): string {
  try { return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}

/** One line under an artifact: who made it and when. */
export function madeLine(a: Pick<Artifact, 'by' | 'at' | 'status'>): string {
  return `${ENGINE_LABEL[a.by]} · ${a.status === 'suggested' ? 'suggested' : 'approved'} ${approvalDate(a.at)}`;
}

export const EXPORT_FILE = 'mendcraft-artifacts.json';
export const EXPORT_FORMAT = 'mendcraft-artifacts';
export const NOT_AN_EXPORT_LINE = "That file isn't a Mendcraft export. Nothing changed.";
export const IMPORT_TOO_BIG_LINE = 'That file is too big for a Mendcraft export. Nothing changed.';
/** The largest file import reads: the most artifacts the store loads, each at its cap. */
export const IMPORT_MAX_CHARS = ARTIFACT_MAX_CHARS * 20;

/** Thrown by importArtifacts when the text is not an export at all. */
export class ImportRefused extends Error {}

const ENVELOPE_KEYS = ['id', 'kind', 'v', 'title', 'data', 'by', 'at', 'status'] as const;

/** The set as an export file. Each artifact is checked again and only its
 *  envelope is written (what coerceArtifact gives back), so nothing that is
 *  not an artifact — a token, a setting — can ride along. */
export function exportArtifacts(list: Artifact[]): string {
  const out: Artifact[] = [];
  for (const raw of list) {
    const r = coerceArtifact(raw);
    if (!r.ok) continue;
    const a = {} as Record<string, unknown>;
    for (const k of ENVELOPE_KEYS) a[k] = r.value[k];
    out.push(a as unknown as Artifact);
  }
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, artifacts: out }, null, 2);
}

/** An export file → the artifacts that pass coerceArtifact (as a load checks
 *  them) and how many entries were left out: failed their check, repeated an
 *  id, or came past ARTIFACT_MAX_COUNT. Text that is not an export throws
 *  ImportRefused. Nothing in the file is ever run. */
export function importArtifacts(text: string): { ok: Artifact[]; dropped: number } {
  if (text.length > IMPORT_MAX_CHARS) throw new ImportRefused(IMPORT_TOO_BIG_LINE);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ImportRefused(NOT_AN_EXPORT_LINE); }
  const entries: unknown = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' && (parsed as { format?: unknown }).format === EXPORT_FORMAT ? (parsed as { artifacts?: unknown }).artifacts
      : null;
  if (!Array.isArray(entries)) throw new ImportRefused(NOT_AN_EXPORT_LINE);
  const ok: Artifact[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const e of entries) {
    const r = coerceArtifact(e);
    if (!r.ok || seen.has(r.value.id) || ok.length >= ARTIFACT_MAX_COUNT) { dropped++; continue; }
    seen.add(r.value.id);
    ok.push(r.value);
  }
  return { ok, dropped };
}

export interface ArtifactsSheetDeps {
  store: ArtifactStore;
  /** The store changed (a Remove, an Import): the canvas catches up. */
  onChange(): void;
  /** A status line for the canvas. */
  say(line: string): void;
}

export interface ArtifactsSheet {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Import from text (what the file picker reads). */
  importText(text: string): Promise<void>;
  /** Export the checked set (downloads mendcraft-artifacts.json); resolves to the file text. */
  exportNow(): Promise<string | null>;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
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
  el.append(head, note, list, foot);
  host.append(el);

  let paintSeq = 0;
  let armed: { id: string; until: number } | null = null;

  async function paint(): Promise<void> {
    const seq = ++paintSeq;
    const loaded = await loadArtifacts(deps.store);
    if (seq !== paintSeq) return;
    list.textContent = '';
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
      const kind = make('span', 'mc-artifacts-kind', KIND_LABEL[a.kind]);
      const title = make('span', 'mc-artifacts-name', a.title);
      const made = make('span', 'mc-artifacts-made', madeLine(a));
      made.dataset.by = a.by;
      text.append(kind, title, made);
      const remove = button('mc-artifacts-remove', 'Remove');
      remove.setAttribute('aria-label', `Remove ${KIND_LABEL[a.kind].toLowerCase()} ${a.title}`);
      remove.addEventListener('click', () => { void removeOne(a, remove); });
      row.append(text, remove);
      list.append(row);
    }
  }

  // Remove asks for a second tap: a stored artifact removed here is gone for good.
  async function removeOne(a: Artifact, btn: HTMLButtonElement): Promise<void> {
    const now = Date.now();
    if (!armed || armed.id !== a.id || now > armed.until) {
      armed = { id: a.id, until: now + REMOVE_CONFIRM_MS };
      for (const b of list.querySelectorAll<HTMLButtonElement>('.mc-artifacts-remove[data-confirm]')) { b.removeAttribute('data-confirm'); b.textContent = 'Remove'; }
      btn.dataset.confirm = '';
      btn.textContent = 'Tap again to remove';
      deps.say(`Tap Remove again to remove “${a.title}” for good.`);
      return;
    }
    armed = null;
    try { await deps.store.remove(a.id); } catch (e) { deps.say(errLine(e)); await paint(); return; }
    deps.say(`Removed “${a.title}”.`);
    await paint();
    deps.onChange();
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

  async function importText(text: string): Promise<void> {
    let got: { ok: Artifact[]; dropped: number };
    try { got = importArtifacts(text); } catch (e) { deps.say(e instanceof ImportRefused ? e.message : NOT_AN_EXPORT_LINE); return; }
    const left = got.dropped ? ` ${plural(got.dropped, 'entry', 'entries')} failed ${got.dropped === 1 ? 'its' : 'their'} check and ${got.dropped === 1 ? 'was' : 'were'} left out.` : '';
    if (!got.ok.length) { deps.say(`Nothing was imported.${left} Nothing changed.`); return; }
    let put = 0;
    for (const a of got.ok) {
      try { await deps.store.put(a); put++; } catch (e) {
        deps.say(put ? `Imported ${put} of ${got.ok.length}, then: ${errLine(e)}` : errLine(e));
        await paint();
        if (put) deps.onChange();
        return;
      }
    }
    deps.say(`Imported ${plural(put, 'artifact')}.${left}`);
    await paint();
    deps.onChange();
  }

  exportBtn.addEventListener('click', () => { void exportNow(); });
  importBtn.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > IMPORT_MAX_CHARS * 4) { deps.say(IMPORT_TOO_BIG_LINE); return; }
    void f.text().then(importText, () => deps.say(NOT_AN_EXPORT_LINE));
  });

  const sheet: ArtifactsSheet = {
    el,
    open() { el.hidden = false; armed = null; void paint(); closeBtn.focus?.(); },
    close() { el.hidden = true; armed = null; },
    isOpen: () => !el.hidden,
    importText,
    exportNow,
  };
  closeBtn.addEventListener('click', () => sheet.close());
  el.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); sheet.close(); } });
  return sheet;
}
