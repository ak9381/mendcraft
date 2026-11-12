// A small, accessible export preview for the UI-design mode. Shows the exported
// single-file HTML rendered in a sandboxed iframe alongside the code, with
// Download HTML / Copy HTML / Download SVG actions. Opened by the shell's Export
// button (instead of silently downloading two files). Esc closes it, focus is
// trapped while open, and focus returns to the opener on close.

function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ExportPanelData {
  html: string;
  svg: string | null;
  onStatus?: (message: string) => void;
}

/** Open the export panel. Returns a dispose() that also removes the backdrop. */
export function openExportPanel(data: ExportPanelData): () => void {
  const opener = document.activeElement as HTMLElement | null;
  const status = data.onStatus ?? (() => {});

  const backdrop = document.createElement('div');
  backdrop.className = 'export-backdrop';
  backdrop.id = 'ui-export-panel';

  const panel = document.createElement('div');
  panel.className = 'export-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'export-title');
  backdrop.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'export-head';
  const title = document.createElement('h2');
  title.id = 'export-title';
  title.textContent = 'Export — clean HTML / CSS';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'export-close';
  closeBtn.setAttribute('aria-label', 'Close export panel');
  closeBtn.textContent = '✕';
  header.append(title, closeBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'export-body';
  panel.appendChild(body);

  // Left: a sandboxed live preview of the exported document.
  const previewWrap = document.createElement('div');
  previewWrap.className = 'export-preview';
  const previewLabel = document.createElement('div');
  previewLabel.className = 'export-sublabel';
  previewLabel.textContent = 'Preview';
  const iframe = document.createElement('iframe');
  iframe.className = 'export-iframe';
  iframe.setAttribute('sandbox', ''); // no scripts, no same-origin — just render
  iframe.setAttribute('title', 'Exported HTML preview');
  iframe.srcdoc = data.html;
  previewWrap.append(previewLabel, iframe);

  // Right: the code itself.
  const codeWrap = document.createElement('div');
  codeWrap.className = 'export-codewrap';
  const codeLabel = document.createElement('div');
  codeLabel.className = 'export-sublabel';
  codeLabel.textContent = 'index.html';
  const code = document.createElement('pre');
  code.className = 'export-code';
  code.tabIndex = 0;
  code.setAttribute('aria-label', 'Exported HTML source');
  code.textContent = data.html;
  codeWrap.append(codeLabel, code);

  body.append(previewWrap, codeWrap);

  const actions = document.createElement('div');
  actions.className = 'export-actions';
  const mkBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const dlHtml = mkBtn('Download HTML', () => {
    download('mendcraft-ui.html', data.html, 'text/html');
    status('Downloaded HTML.');
  });
  const copyHtml = mkBtn('Copy HTML', async () => {
    try {
      await navigator.clipboard.writeText(data.html);
      status('HTML copied to clipboard.');
    } catch {
      status('Could not access the clipboard.');
    }
  });
  const dlSvg = mkBtn('Download SVG', () => {
    if (!data.svg) { status('No SVG to download.'); return; }
    download('mendcraft-ui.svg', data.svg, 'image/svg+xml');
    status('Downloaded SVG.');
  });
  dlSvg.disabled = !data.svg;
  actions.append(dlHtml, copyHtml, dlSvg);
  panel.appendChild(actions);

  document.body.appendChild(backdrop);

  // ---- a11y: focus trap + Esc + restore focus ----
  const focusables = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>('button, [href], input, pre[tabindex], iframe, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.hasAttribute('disabled'));

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    const active = document.activeElement as HTMLElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    opener?.focus?.();
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  closeBtn.focus();

  return close;
}
