// C172–C175: a native <select> opens an OS-drawn popup that hand tracking can't
// reach (it isn't in the page's DOM), so a hand user could focus a picker but
// never choose from it. A hand pinch on a <select> opens this in-page list
// instead: one hand-sized button per option, the current one marked, a tap
// anywhere outside (the scrim) or Escape to close. Choosing sets the value and
// fires input + change exactly like a native pick, so every picker's existing
// listener runs unchanged. Mouse/keyboard keep the native popup.

export interface SelectLike {
  value: string;
  options: ArrayLike<{ value: string; text: string; disabled?: boolean; selected?: boolean }>;
  disabled?: boolean;
  dispatchEvent(e: Event): boolean;
  getAttribute(n: string): string | null;
}

export interface HandOption { value: string; label: string; disabled: boolean; current: boolean }

/** The options a hand list shows, in order. */
export function handOptionsOf(sel: SelectLike): HandOption[] {
  const out: HandOption[] = [];
  for (let i = 0; i < sel.options.length; i++) {
    const o = sel.options[i];
    out.push({ value: o.value, label: (o.text || o.value).trim() || '(empty)', disabled: !!o.disabled, current: o.value === sel.value });
  }
  return out;
}

/** Pick `value` the way a native choice does; false (nothing fired) when it is
 *  disabled, unknown or already chosen. */
export function chooseHandOption(sel: SelectLike, value: string): boolean {
  const opt = handOptionsOf(sel).find((o) => o.value === value);
  if (!opt || opt.disabled || sel.disabled) return false;
  if (sel.value === value) return false;
  sel.value = value;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

let openSheet: { close(): void } | null = null;

/** Open the hand list for `sel` (closing any other). Returns a close function. */
export function openHandSelect(sel: HTMLSelectElement, doc: Document = document): () => void {
  openSheet?.close();
  const name = sel.getAttribute('aria-label') || sel.labels?.[0]?.textContent?.trim() || 'an option';
  const root = doc.createElement('div');
  root.className = 'mc-hand-select';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', `Choose ${name}`);
  const scrim = doc.createElement('button');
  scrim.type = 'button';
  scrim.className = 'mc-hand-select-scrim';
  scrim.setAttribute('aria-label', 'Close the list');
  const list = doc.createElement('div');
  list.className = 'mc-hand-select-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', name);
  for (const o of handOptionsOf(sel)) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'mc-hand-select-opt';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(o.current));
    b.dataset.value = o.value;
    b.textContent = (o.current ? '✓ ' : '') + o.label;
    b.disabled = o.disabled;
    b.addEventListener('click', () => { chooseHandOption(sel, o.value); close(); });
    list.append(b);
  }
  root.append(scrim, list);
  doc.body.append(root);
  // Sit by the picker (below it, or above when there's no room), on screen.
  const r = sel.getBoundingClientRect();
  const vw = doc.defaultView?.innerWidth ?? 1024, vh = doc.defaultView?.innerHeight ?? 768;
  const w = Math.min(Math.max(r.width, 240), vw - 16);
  list.style.width = `${w}px`;
  list.style.left = `${Math.min(Math.max(8, r.left), vw - w - 8)}px`;
  const h = Math.min(list.scrollHeight || 0, vh * 0.6);
  if (r.bottom + 8 + h <= vh - 8 || r.top < h + 16) list.style.top = `${Math.min(r.bottom + 8, Math.max(8, vh - h - 8))}px`;
  else list.style.top = `${Math.max(8, r.top - 8 - h)}px`;
  (list.querySelector('[aria-selected="true"]') as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });

  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  scrim.addEventListener('click', () => close());
  doc.addEventListener('keydown', onKey, true);
  let done = false;
  function close(): void {
    if (done) return;
    done = true;
    doc.removeEventListener('keydown', onKey, true);
    root.remove();
    if (openSheet === handle) openSheet = null;
    sel.focus?.({ preventScroll: true });
  }
  const handle = { close };
  openSheet = handle;
  return close;
}

export function closeHandSelect(): void { openSheet?.close(); }
