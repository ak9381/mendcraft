// Shared DOM widgets for the on-canvas tool framework: the floating palette
// dock (click-to-arm or press-drag-to-place, mouse AND pinch), the corner
// trash zone (drag an element onto it to delete), and the fullscreen /
// move-to-screen control. All mode-agnostic; plan and ui modes mount them in
// their own renderer containers.

export interface PaletteItemSpec {
  toolId: string;
  label: string;
  icon: string;
  shortcut: string;
  placeable?: boolean;
  stub?: boolean;
  /** When present, this button is a flyout: clicking it opens a compact panel
   *  of these sub-items (each armable / draggable like a normal item). */
  group?: PaletteItemSpec[];
}

export interface PaletteHandle {
  setActive(toolId: string): void;
  /** Palette item under client px, for pinch presses (which bypass DOM events). */
  itemAt(clientX: number, clientY: number): PaletteItemSpec | null;
  element: HTMLElement;
  dispose(): void;
}

export function createPalette(
  host: HTMLElement,
  items: PaletteItemSpec[],
  cb: {
    /** Click/tap: make this the active tool. */
    onArm(toolId: string): void;
    /** Press + drag off the button: start pick-and-place with a ghost. */
    onPlaceStart(toolId: string, clientX: number, clientY: number): void;
  },
): PaletteHandle {
  const root = document.createElement('div');
  root.className = 'mc-palette';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Drawing tools');
  const buttons = new Map<string, HTMLButtonElement>();

  // Flat registry of every armable item (dock + open flyout) for pinch hit-tests.
  const flat: Array<{ item: PaletteItemSpec; btn: HTMLButtonElement; visible: () => boolean }> = [];
  const flyouts: HTMLElement[] = [];

  let press: { item: PaletteItemSpec; x: number; y: number } | null = null;
  function closeFlyouts(): void {
    for (const f of flyouts) f.hidden = true;
  }
  function onWinMove(e: PointerEvent): void {
    if (!press) return;
    // B-009: a move with no button held means the press ended where we never
    // saw it (hand left the frame, release outside the window) — drop the
    // stale press instead of misreading this move as a drag-to-place.
    // Synthetic hand events (isTrusted false) carry no buttons, so skip them.
    if (e.buttons === 0 && e.isTrusted !== false) { press = null; return; }
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
      const item = press.item;
      // B-023: a non-placeable tool (Wall) has no drag-to-place, so tremor
      // drift past 6px must not swallow the tap — keep the press and arm on
      // release, same as a clean tap.
      // A deliberate slide well off the button (> 48px) still cancels, like
      // releasing a mouse outside a button.
      if (!item.placeable) { if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 48) press = null; return; }
      press = null;
      closeFlyouts();
      cb.onPlaceStart(item.toolId, e.clientX, e.clientY);
    }
  }
  function onWinUp(): void {
    if (press) {
      cb.onArm(press.item.toolId);
      closeFlyouts();
    }
    press = null;
  }
  /** B-009: pointercancel / window blur end a press without arming. */
  function onWinCancel(): void { press = null; }
  window.addEventListener('pointermove', onWinMove);
  window.addEventListener('pointerup', onWinUp);
  window.addEventListener('pointercancel', onWinCancel);
  window.addEventListener('blur', onWinCancel);

  /** Build one armable button (press→arm, press+drag→place) into `parent`. */
  function makeButton(item: PaletteItemSpec, parent: HTMLElement, visible: () => boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mc-palette-btn' + (item.stub ? ' stub' : '');
    const stubNote = item.stub ? ' — coming in the next update' : '';
    const key = item.shortcut ? ` (${item.shortcut.toUpperCase()})` : '';
    // When the decorative icon is itself a letter/number (e.g. "T"/"H"), a
    // sighted user reads it immediately before the label with no gap ("TText"),
    // so WCAG 2.5.3 (Label in Name) wants that same string inside the accessible
    // name. Concatenate with no space to match the rendered run; symbol/emoji
    // icons are stripped by assistive tech and need no prefix.
    const iconWord = /^[a-z0-9]+$/i.test(item.icon.trim()) ? item.icon.trim() : '';
    btn.setAttribute('aria-label', `${iconWord}${item.label}${key}${stubNote}`);
    btn.title = `${item.label}${item.shortcut ? ` — ${item.shortcut.toUpperCase()}` : ''}${stubNote}${item.placeable ? '. Drag onto the canvas to place.' : ''}`;
    btn.innerHTML = `<span class="mc-ico" aria-hidden="true">${item.icon}</span><span class="mc-lbl">${item.label}</span>`;
    btn.dataset.tool = item.toolId;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press = { item, x: e.clientX, y: e.clientY };
    });
    buttons.set(item.toolId, btn);
    flat.push({ item, btn, visible });
    parent.appendChild(btn);
    return btn;
  }

  for (const item of items) {
    if (item.group) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mc-palette-btn mc-palette-group';
      btn.dataset.tool = item.toolId;
      const groupIconWord = /^[a-z0-9]+$/i.test(item.icon.trim()) ? item.icon.trim() : '';
      btn.setAttribute('aria-label', `${groupIconWord}${item.label} — open components`);
      btn.title = `${item.label} — pick a component`;
      btn.innerHTML = `<span class="mc-ico" aria-hidden="true">${item.icon}</span><span class="mc-lbl">${item.label} ▾</span>`;
      const flyout = document.createElement('div');
      flyout.className = 'mc-flyout';
      flyout.hidden = true;
      for (const sub of item.group) makeButton(sub, flyout, () => !flyout.hidden);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const willOpen = flyout.hidden;
        closeFlyouts();
        flyout.hidden = !willOpen;
      });
      flyouts.push(flyout);
      root.appendChild(btn);
      root.appendChild(flyout);
    } else {
      makeButton(item, root, () => true);
    }
  }
  host.appendChild(root);

  return {
    setActive(toolId) {
      for (const [id, btn] of buttons) btn.classList.toggle('active', id === toolId);
    },
    itemAt(x, y) {
      // C150: an open flyout sits visually ON TOP of the dock, so hit-test its
      // items first — a pinch must reach what the user sees, not the covered
      // dock button registered earlier.
      const inFlyout = (b: HTMLButtonElement) => flyouts.some((f) => !f.hidden && b.parentElement === f);
      const ordered = [...flat.filter((f) => inFlyout(f.btn)), ...flat.filter((f) => !inFlyout(f.btn))];
      for (const { item, btn, visible } of ordered) {
        if (!visible()) continue;
        const r = btn.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return item;
      }
      return null;
    },
    element: root,
    dispose() {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinCancel);
      window.removeEventListener('blur', onWinCancel);
      root.remove();
    },
  };
}

// ─── Trash zone ─────────────────────────────────────────────────────────────

export interface TrashHandle {
  isOver(clientX: number, clientY: number): boolean;
  setHover(on: boolean): void;
  element: HTMLElement;
  dispose(): void;
}

export function createTrash(host: HTMLElement): TrashHandle {
  const root = document.createElement('div');
  root.className = 'mc-trash';
  // A labelled icon affordance (drag-to-delete, pointer only). role="img" lets a
  // plain <div> carry an accessible name; without a role, aria-label is prohibited.
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Trash — drag an element here to delete it');
  root.title = 'Drag an element here to delete it (undoable)';
  root.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M9 3v1H4v2h16V4h-5V3H9zm-3 5v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8H6zm3 2h2v9H9v-9zm4 0h2v9h-2v-9z"/></svg>';
  host.appendChild(root);
  return {
    isOver(x, y) {
      const r = root.getBoundingClientRect();
      return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
    },
    setHover(on) {
      root.classList.toggle('hover', on);
    },
    element: root,
    dispose: () => root.remove(),
  };
}

// ─── Fullscreen + move-to-screen ───────────────────────────────────────────

export interface FullscreenControl {
  toggle(): Promise<void>;
  element: HTMLElement;
  dispose(): void;
}

/** Fullscreen button (shortcut F) plus a "move to screen" picker built on the
 *  Chrome Window Management API (window.getScreenDetails + requestFullscreen
 *  ({screen})). When the API or its permission is unavailable we fall back to
 *  plain fullscreen and say so via onHint. */
export function createFullscreenControl(
  host: HTMLElement,
  target: HTMLElement,
  onHint: (text: string) => void,
): FullscreenControl {
  const root = document.createElement('div');
  root.className = 'mc-fsctl';
  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'mc-palette-btn';
  fsBtn.title = 'Fullscreen — F';
  fsBtn.setAttribute('aria-label', 'Fullscreen (F)');
  fsBtn.textContent = '⛶';
  const mvBtn = document.createElement('button');
  mvBtn.type = 'button';
  mvBtn.className = 'mc-palette-btn';
  mvBtn.title = 'Move fullscreen canvas to another screen';
  mvBtn.setAttribute('aria-label', 'Move to screen');
  mvBtn.textContent = '🖵';
  const menu = document.createElement('div');
  menu.className = 'mc-screenmenu';
  menu.hidden = true;
  root.append(fsBtn, mvBtn, menu);
  host.appendChild(root);

  async function toggle(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await target.requestFullscreen();
    } catch {
      onHint('Fullscreen was blocked by the browser.');
    }
  }

  async function openMenu(): Promise<void> {
    menu.innerHTML = '';
    const getDetails = (window as unknown as { getScreenDetails?: () => Promise<{ screens: Array<Record<string, unknown>> }> })
      .getScreenDetails;
    if (!getDetails) {
      await toggle();
      onHint('Multi-screen placement needs Chrome’s Window Management API — went plain fullscreen instead.');
      return;
    }
    try {
      const details = await getDetails.call(window);
      details.screens.forEach((s, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        const label = (s.label as string) || `Screen ${i + 1}`;
        b.textContent = `${label}${s.isPrimary ? ' (primary)' : ''}`;
        b.addEventListener('click', async () => {
          menu.hidden = true;
          try {
            await target.requestFullscreen({ screen: s } as FullscreenOptions);
          } catch {
            await toggle();
            onHint('Could not move to that screen — went fullscreen here instead.');
          }
        });
        menu.appendChild(b);
      });
      menu.hidden = false;
    } catch {
      await toggle();
      onHint('Screen access was denied — went plain fullscreen instead.');
    }
  }

  fsBtn.addEventListener('click', () => void toggle());
  mvBtn.addEventListener('click', () => void (menu.hidden ? openMenu() : (menu.hidden = true)));

  return { toggle, element: root, dispose: () => root.remove() };
}
