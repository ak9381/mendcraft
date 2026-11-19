// ON-CANVAS TOOL PALETTE (desktop/tablet). The toolbar's buttons + say box
// (`.mc-bar-tools`) start hidden — no fixed chrome at open — and come up on
// voice ("show tools" / "tools" / "menu"), an open palm, or this module's
// small always-visible "Tools" chip beside the mic. They go back down on
// "hide tools", palm again, Esc, or right after a tool runs. Phones keep
// phoneMenu.ts's own Menu sheet; this module no-ops there so the phone's
// primary say/mic/ai/new bar is left alone.
import { PHONE_QUERY } from './phoneMenu';

export type PaletteCommand = 'open' | 'close' | null;

const OPEN_RE = /^\s*(show\s+tools|tools|menu)\s*$/i;
const CLOSE_RE = /^\s*hide\s+tools\s*$/i;

/** Pure: which voice phrase (if any) opens or closes the palette. */
export function matchPaletteCommand(text: string): PaletteCommand {
  if (CLOSE_RE.test(text)) return 'close';
  if (OPEN_RE.test(text)) return 'open';
  return null;
}

export interface ToolPalette {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function mountToolPalette(root: HTMLElement, win: Window = window): ToolPalette {
  const doc = root.ownerDocument;
  const tools = root.querySelector<HTMLElement>('.mc-bar-tools')!;
  tools.id = 'mc-tool-palette';
  tools.setAttribute('aria-label', 'Tools');

  const chip = doc.createElement('button');
  chip.type = 'button';
  chip.className = 'mc-tools-chip';
  chip.setAttribute('aria-expanded', 'false');
  chip.setAttribute('aria-controls', 'mc-tool-palette');
  chip.textContent = 'Tools';
  root.append(chip);

  let phone = false;
  let openState = false;
  let lastFocus: HTMLElement | null = null;

  function apply(): void {
    tools.hidden = !phone && !openState;
    chip.hidden = phone;
    chip.setAttribute('aria-expanded', String(openState));
  }

  function open(): void {
    if (phone || openState) return;
    lastFocus = doc.activeElement as HTMLElement | null;
    openState = true;
    apply();
    tools.querySelector<HTMLElement>('button, input')?.focus();
  }
  function close(): void {
    if (phone || !openState) return;
    openState = false;
    apply();
    (lastFocus && lastFocus.isConnected ? lastFocus : chip).focus();
  }
  function toggle(): void {
    (openState ? close : open)();
  }

  chip.addEventListener('click', toggle);
  // A tool ran: close the palette after the delegated handler has seen the click.
  tools.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-cmd]')) win.setTimeout(close, 0);
  });
  tools.addEventListener('submit', () => win.setTimeout(close, 0));
  const onKey = (e: KeyboardEvent) => { if (openState && e.key === 'Escape') { e.preventDefault(); close(); } };
  doc.addEventListener('keydown', onKey);

  const mq = win.matchMedia?.(PHONE_QUERY);
  const onMq = () => { phone = !!mq?.matches; apply(); };
  mq?.addEventListener?.('change', onMq);
  onMq();

  return {
    open, close, toggle,
    isOpen: () => openState,
    destroy() {
      mq?.removeEventListener?.('change', onMq);
      doc.removeEventListener('keydown', onKey);
      chip.remove();
    },
  };
}
