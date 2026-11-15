// One-row editor toolbar with a "More" overflow. Core tools stay in the
// primary row; everything else (and, on a narrow viewport, Camera / Mic /
// Undo / Redo / 3D) moves into a 44px-row menu so the bar never wraps.

export const ALWAYS_OVERFLOW_IDS = [
  'btn-gestures',
  'btn-hands',
  'btn-keyboard',
  'btn-reference',
  'btn-routing',
  'btn-ledger',
  'btn-pair',
  'btn-lamp',
  'btn-a11y',
  'btn-teach',
  'btn-recipes',
  'btn-ai',
] as const;

/** Lowest priority last — first to move into More when the row is tight. */
export const OPTIONAL_PRIMARY_IDS = [
  'btn-demo',
  'btn-camera',
  'btn-mic',
  'btn-undo',
  'btn-redo',
  'btn-3d',
  'btn-copy-html',
] as const;

/** Canonical order of topbar children (ids). Used to re-insert overflowed items. */
export const PRIMARY_ORDER = [
  'mode-switch',
  'lang-pick',
  'btn-help',
  'btn-camera',
  'btn-register',
  'btn-reregister',
  'btn-mic',
  'topbar-spacer',
  'btn-undo',
  'btn-redo',
  'btn-3d',
  'btn-export',
  'btn-copy-html',
  'btn-demo',
  'more-wrap',
] as const;

/** Canonical order of items inside the More menu. */
export const MENU_ORDER = [
  ...OPTIONAL_PRIMARY_IDS,
  ...ALWAYS_OVERFLOW_IDS,
  'progress-wrap',
] as const;

/**
 * Decide which optional items stay in the primary row.
 * `optional` is high-priority first; items are dropped from the end until
 * `fits(kept)` is true. Always-overflow items never enter `kept`.
 */
export function pickOverflow<T>(
  optional: readonly T[],
  alwaysOverflow: readonly T[],
  fits: (kept: readonly T[]) => boolean,
): { kept: T[]; overflow: T[] } {
  const kept = optional.slice();
  const overflow = alwaysOverflow.slice();
  while (kept.length > 0 && !fits(kept)) {
    overflow.unshift(kept.pop()!);
  }
  return { kept, overflow };
}

export interface OverflowMenu {
  readonly button: HTMLButtonElement;
  readonly menu: HTMLElement;
  readonly wrap: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  toggle(): void;
  /** Open the menu when `el` is inside it (for the guided tour spotlight). */
  reveal(el: Element | null): void;
  contains(el: EventTarget | null): boolean;
  layout(): void;
  dispose(): void;
}

export interface OverflowMenuOptions {
  topbar: HTMLElement;
  /** Optional: already-built wrap from the markup. Created if missing. */
  wrap?: HTMLElement;
}

function byId(root: ParentNode, id: string): HTMLElement | null {
  return root.querySelector(`#${cssEscape(id)}`);
}

function cssEscape(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function insertInOrder(parent: HTMLElement, node: HTMLElement, order: readonly string[]): void {
  const i = order.indexOf(node.id);
  if (i === -1) {
    parent.appendChild(node);
    return;
  }
  for (const nextId of order.slice(i + 1)) {
    for (const child of Array.from(parent.children)) {
      if ((child as HTMLElement).id === nextId) {
        parent.insertBefore(node, child);
        return;
      }
    }
  }
  parent.appendChild(node);
}

export function createOverflowMenu(opts: OverflowMenuOptions): OverflowMenu {
  const { topbar } = opts;
  let wrap = opts.wrap ?? byId(topbar, 'more-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'more-wrap';
    wrap.className = 'more-wrap';
    topbar.appendChild(wrap);
  }
  wrap.classList.add('more-wrap');

  let button = byId(wrap, 'btn-more') as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'btn-more';
    button.className = 'ghost';
    button.textContent = 'More';
    wrap.appendChild(button);
  }
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-controls', 'more-menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', 'More tools');
  button.title = 'More tools';

  let menu = byId(wrap, 'more-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'more-menu';
    menu.className = 'more-menu';
    wrap.appendChild(menu);
  }
  menu.classList.add('more-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const spacer = topbar.querySelector('.spacer') as HTMLElement | null;
  if (spacer && !spacer.id) spacer.id = 'topbar-spacer';

  function existing(ids: readonly string[]): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  function setItemRole(node: HTMLElement, inMenu: boolean): void {
    if (node.tagName === 'BUTTON') {
      if (inMenu) node.setAttribute('role', 'menuitem');
      else node.removeAttribute('role');
    }
  }

  function moveToMenu(node: HTMLElement): void {
    insertInOrder(menu!, node, MENU_ORDER);
    setItemRole(node, true);
  }

  function moveToPrimary(node: HTMLElement): void {
    insertInOrder(topbar, node, PRIMARY_ORDER);
    setItemRole(node, false);
  }

  let openState = false;

  function open(): void {
    if (openState) return;
    openState = true;
    menu!.hidden = false;
    button!.setAttribute('aria-expanded', 'true');
  }

  function close(): void {
    if (!openState) return;
    openState = false;
    menu!.hidden = true;
    button!.setAttribute('aria-expanded', 'false');
  }

  function toggle(): void {
    if (openState) close();
    else open();
  }

  function contains(el: EventTarget | null): boolean {
    return el instanceof Node && wrap!.contains(el);
  }

  function reveal(el: Element | null): void {
    if (el && menu!.contains(el)) open();
    else close();
  }

  function layout(): void {
    const optional = existing(OPTIONAL_PRIMARY_IDS);
    // Hidden optionals (e.g. 3D before the mode exposes it) stay in the
    // primary row as display:none so they don't take a row in the menu.
    for (const node of optional) {
      if (node.hidden) moveToPrimary(node);
    }
    const visible = optional.filter((n) => !n.hidden);
    const always = existing(ALWAYS_OVERFLOW_IDS);
    const progress = document.getElementById('progress-wrap');

    const place = (keptNow: readonly HTMLElement[]): void => {
      for (const n of visible) {
        if (keptNow.includes(n)) moveToPrimary(n);
        else moveToMenu(n);
      }
      for (const n of always) moveToMenu(n);
      if (progress) moveToMenu(progress);
    };

    const { kept } = pickOverflow(visible, always, (keptNow) => {
      place(keptNow);
      // Cap against the viewport, not the topbar's self-sized width — a
      // nowrap flex row will otherwise grow with its children and always "fit".
      const budget = Math.min(topbar.clientWidth, document.documentElement.clientWidth || window.innerWidth);
      return topbar.scrollWidth <= budget + 1;
    });
    place(kept);
  }

  function onButtonClick(e: Event): void {
    e.stopPropagation();
    toggle();
  }

  function onDocPointer(e: Event): void {
    if (!openState) return;
    const t = e.target;
    if (contains(t)) return;
    close();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && openState) {
      e.preventDefault();
      close();
      button!.focus();
    }
  }

  button.addEventListener('click', onButtonClick);
  document.addEventListener('pointerdown', onDocPointer);
  document.addEventListener('keydown', onKey);

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layout()) : null;
  ro?.observe(topbar);
  window.addEventListener('resize', layout);

  const mo = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => layout())
    : null;
  // Relayout when 3D / Copy HTML / progress appear or hide.
  for (const id of ['btn-3d', 'btn-copy-html', 'progress-wrap', 'btn-demo']) {
    const n = document.getElementById(id);
    if (n) mo?.observe(n, { attributes: true, attributeFilter: ['hidden'] });
  }

  // First layout after the current frame so flex metrics are ready.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => layout());
  else layout();

  return {
    button,
    menu,
    wrap,
    open,
    close,
    isOpen: () => openState,
    toggle,
    reveal,
    contains,
    layout,
    dispose() {
      close();
      button!.removeEventListener('click', onButtonClick);
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', layout);
      ro?.disconnect();
      mo?.disconnect();
    },
  };
}
