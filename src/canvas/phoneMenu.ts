// PHONE TOOLS MENU. On phones the canvas bar keeps only the primary actions in
// the thumb zone (say + mic, Review, New board, Menu); every other tool moves
// into a labelled menu sheet. Desktop keeps the full toolbar unchanged.
//
// The real buttons are MOVED (not cloned) so there is one instance of each:
// aria-pressed / aria-expanded state and the delegated click handler keep
// working. iOS gets a bottom sheet, Android a Material 3 modal drawer-style
// sheet; both close on Esc, the scrim, a downward swipe, or after a tool runs,
// and trap focus while open.

export const PHONE_QUERY = '(max-width: 600px)';

/** Primary actions that stay in the phone bar (in this order). */
export const PHONE_PRIMARY = ['ai', 'new'] as const;

/** Tool groups shown in the menu sheet. */
export const PHONE_GROUPS: ReadonlyArray<{ title: string; cmds: readonly string[] }> = [
  { title: 'Canvas', cmds: ['everything', 'save', 'undo'] },
  { title: 'Hands and gestures', cmds: ['hands', 'dwell', 'reregister', 'teach', 'gestures'] },
  { title: 'Sound', cmds: ['voice'] },
  { title: 'Testing', cmds: ['offline'] },
];

export type PhoneMenu = { open(): void; close(): void; isOpen(): boolean; destroy(): void };

const FOCUSABLE = 'button:not([disabled]):not([hidden]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Pure: which platform style to use for the sheet. */
export function sheetStyle(ua: string, override?: string | null): 'ios' | 'android' {
  if (override === 'ios' || override === 'android') return override;
  return /iphone|ipad|ipod|macintosh/i.test(ua) && !/android/i.test(ua) ? 'ios' : 'android';
}

export function mountPhoneMenu(root: HTMLElement, win: Window = window): PhoneMenu {
  const doc = root.ownerDocument;
  const bar = root.querySelector<HTMLElement>('.mc-bar')!;
  const btns = root.querySelector<HTMLElement>('.mc-bar-btns')!;
  // Every tool button, wherever it sits on desktop (the bar row or the More
  // menu's groups), and where to put it back.
  const original = Array.from(btns.querySelectorAll<HTMLElement>('[data-cmd]'));
  const homes = new Map(original.map((b) => [b, b.parentElement ?? btns] as const));
  const byCmd = (c: string) => original.find((b) => b.dataset.cmd === c);

  const style = sheetStyle(win.navigator?.userAgent ?? '', new URLSearchParams(win.location?.search ?? '').get('platform'));

  const actions = doc.createElement('div');
  actions.className = 'mc-phone-actions';
  const menuBtn = doc.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'mc-btn mc-menu-btn';
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-controls', 'mc-menu-sheet');
  menuBtn.setAttribute('aria-haspopup', 'dialog');
  menuBtn.innerHTML = '<span class="mc-menu-icon" aria-hidden="true"></span><span>Menu</span>';

  const scrim = doc.createElement('div');
  scrim.className = 'mc-menu-scrim';
  scrim.dataset.handDismiss = '';
  scrim.hidden = true;
  const sheet = doc.createElement('div');
  sheet.id = 'mc-menu-sheet';
  sheet.className = `mc-menu-sheet mc-menu-${style}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'mc-menu-title');
  sheet.hidden = true;
  sheet.innerHTML = `<span class="mc-menu-grabber" role="button" tabindex="-1" aria-label="Close menu (or swipe down)" data-mc-drag-handle></span>
    <div class="mc-menu-head"><h2 id="mc-menu-title" class="mc-menu-title">Tools</h2>
      <button type="button" class="mc-btn mc-menu-close" aria-label="Close menu">Close</button></div>
    ${PHONE_GROUPS.map((g, i) => `<section class="mc-menu-group" aria-labelledby="mc-menu-g${i}">
      <h3 class="mc-menu-group-title" id="mc-menu-g${i}">${g.title}</h3><div class="mc-menu-items" data-group="${i}"></div></section>`).join('')}`;
  root.append(scrim, sheet);

  let phone = false;
  let lastFocus: HTMLElement | null = null;

  const isOpen = () => !sheet.hidden;
  function open(): void {
    if (!phone || isOpen()) return;
    lastFocus = doc.activeElement as HTMLElement | null;
    scrim.hidden = false; sheet.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    root.classList.add('mc-menu-open');
    (sheet.querySelector<HTMLElement>('.mc-menu-items ' + FOCUSABLE) ?? sheet.querySelector<HTMLElement>('.mc-menu-close'))?.focus();
  }
  function close(): void {
    if (!isOpen()) return;
    scrim.hidden = true; sheet.hidden = true; sheet.style.transform = '';
    menuBtn.setAttribute('aria-expanded', 'false');
    root.classList.remove('mc-menu-open');
    (lastFocus && lastFocus.isConnected ? lastFocus : menuBtn).focus();
  }

  function layout(nextPhone: boolean): void {
    if (nextPhone === phone) return;
    phone = nextPhone;
    if (phone) {
      PHONE_GROUPS.forEach((g, i) => {
        const box = sheet.querySelector<HTMLElement>(`[data-group="${i}"]`)!;
        g.cmds.forEach((c) => { const b = byCmd(c); if (b) box.append(b); });
      });
      PHONE_PRIMARY.forEach((c) => { const b = byCmd(c); if (b) actions.append(b); });
      actions.append(menuBtn);
      bar.querySelector('.mc-bar-tools')!.append(actions);
      root.classList.add('mc-phone');
    } else {
      close();
      original.forEach((b) => (homes.get(b) ?? btns).append(b));
      actions.remove();
      root.classList.remove('mc-phone');
    }
  }

  const onMenu = () => (isOpen() ? close() : open());
  menuBtn.addEventListener('click', onMenu);
  sheet.querySelector('.mc-menu-close')!.addEventListener('click', close);
  scrim.addEventListener('click', close);
  // A tool ran: close the sheet after the delegated handler has seen the click.
  sheet.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-cmd]')) win.setTimeout(close, 0);
  });
  const onKey = (e: KeyboardEvent) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  doc.addEventListener('keydown', onKey);

  // Swipe down to dismiss (follows the finger; no animation under reduced motion).
  let startY = -1;
  sheet.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('.mc-menu-grabber, .mc-menu-head')) startY = e.clientY; });
  sheet.addEventListener('pointermove', (e) => { if (startY >= 0) sheet.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`; });
  const endSwipe = (e: PointerEvent) => {
    if (startY < 0) return;
    const dy = e.clientY - startY; startY = -1;
    if (dy > 60) close(); else sheet.style.transform = '';
  };
  sheet.addEventListener('pointerup', endSwipe);
  // A tap on the grabber closes too: a hand pinch-tap there (no drag) clicks it.
  sheet.querySelector('.mc-menu-grabber')?.addEventListener('click', () => close());
  sheet.addEventListener('pointercancel', endSwipe);

  const mq = win.matchMedia?.(PHONE_QUERY);
  const onMq = () => layout(!!mq?.matches);
  mq?.addEventListener?.('change', onMq);
  onMq();

  return {
    open, close, isOpen,
    destroy() {
      layout(false);
      mq?.removeEventListener?.('change', onMq);
      doc.removeEventListener('keydown', onKey);
      scrim.remove(); sheet.remove();
    },
  };
}
