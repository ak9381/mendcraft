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
  /** Native frame size, so the preview can scale the whole layout to fit. */
  frameW?: number;
  frameH?: number;
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

  // Preview / Code tab toggle — each view gets the full panel width so the
  // preview is large enough to read a desktop layout (not a cramped half-pane).
  const tabs = document.createElement('div');
  tabs.className = 'export-tabs';
  tabs.setAttribute('role', 'tablist');
  const tabPreview = document.createElement('button');
  tabPreview.type = 'button';
  tabPreview.className = 'export-tab is-active';
  tabPreview.setAttribute('role', 'tab');
  tabPreview.setAttribute('aria-selected', 'true');
  tabPreview.textContent = 'Preview';
  const tabCode = document.createElement('button');
  tabCode.type = 'button';
  tabCode.className = 'export-tab';
  tabCode.setAttribute('role', 'tab');
  tabCode.setAttribute('aria-selected', 'false');
  tabCode.textContent = 'Code';
  tabs.append(tabPreview, tabCode);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'export-close';
  closeBtn.setAttribute('aria-label', 'Close export panel');
  closeBtn.textContent = '✕';
  header.append(title, tabs, closeBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'export-body';
  panel.appendChild(body);

  // Preview: a sandboxed render of the exported document, scaled to fit the
  // pane width so the whole frame is visible without horizontal scrolling.
  const previewWrap = document.createElement('div');
  previewWrap.className = 'export-preview';
  const stage = document.createElement('div');
  stage.className = 'export-stage';
  const scaler = document.createElement('div');
  scaler.className = 'export-scaler';
  const iframe = document.createElement('iframe');
  iframe.className = 'export-iframe';
  iframe.setAttribute('sandbox', ''); // no scripts, no same-origin — just render
  iframe.setAttribute('title', 'Exported HTML preview');
  iframe.srcdoc = data.html;
  const frameW = data.frameW && data.frameW > 0 ? data.frameW : 1440;
  const frameH = data.frameH && data.frameH > 0 ? data.frameH : 900;
  iframe.style.width = `${frameW}px`;
  iframe.style.height = `${frameH}px`;
  scaler.append(iframe);
  stage.append(scaler);
  previewWrap.append(stage);

  // Fit the frame into the stage; never upscale past 1 (keeps mobile crisp).
  function fitPreview(): void {
    const availW = stage.clientWidth - 24; // minus stage padding
    const availH = stage.clientHeight - 24;
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(1, availW / frameW, availH / frameH);
    iframe.style.transform = `scale(${scale})`;
    scaler.style.width = `${frameW * scale}px`;
    scaler.style.height = `${frameH * scale}px`;
  }

  // Code: the exported source.
  const codeWrap = document.createElement('div');
  codeWrap.className = 'export-codewrap';
  const code = document.createElement('pre');
  code.className = 'export-code';
  code.tabIndex = 0;
  code.setAttribute('aria-label', 'Exported HTML source');
  code.textContent = data.html;
  codeWrap.append(code);

  body.append(previewWrap, codeWrap);

  let tab: 'preview' | 'code' = 'preview';
  function showTab(next: 'preview' | 'code'): void {
    tab = next;
    const onPreview = next === 'preview';
    previewWrap.style.display = onPreview ? 'flex' : 'none';
    codeWrap.style.display = onPreview ? 'none' : 'flex';
    tabPreview.classList.toggle('is-active', onPreview);
    tabCode.classList.toggle('is-active', !onPreview);
    tabPreview.setAttribute('aria-selected', String(onPreview));
    tabCode.setAttribute('aria-selected', String(!onPreview));
    if (onPreview) fitPreview();
  }
  tabPreview.addEventListener('click', () => showTab('preview'));
  tabCode.addEventListener('click', () => showTab('code'));

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

  // Now that the stage has real dimensions, size the preview and keep it fitted.
  showTab('preview');
  const onResize = () => { if (tab === 'preview') fitPreview(); };
  window.addEventListener('resize', onResize);

  // ---- a11y: focus trap + Esc + restore focus ----
  const focusables = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>('button, [href], input, pre[tabindex], iframe, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

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
    window.removeEventListener('resize', onResize);
    backdrop.remove();
    opener?.focus?.();
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  closeBtn.focus();

  return close;
}
