// Spoken-reply voice picker. Lists the browser's speechSynthesis voices
// (natural/enhanced first; Kannada and Indian English when installed),
// remembers the choice on this device, and previews on demand. No paid TTS.

import {
  clearSavedVoice,
  isIndianEnglish,
  isKannada,
  isNaturalVoice,
  loadAllowCloud,
  loadSavedVoice,
  rankVoices,
  usableVoices,
  saveVoice,
  type SavedVoice,
  type SynthVoice,
} from '../ai/speechVoices';

export interface VoicePanel {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Refresh the list (e.g. after speechSynthesis.onvoiceschanged). */
  refresh(voices?: readonly SynthVoice[]): void;
  dispose(): void;
}

export interface VoicePanelOptions {
  getVoices(): readonly SynthVoice[];
  onChange(saved: SavedVoice | null): void;
  onPreview(voice: SynthVoice): void;
}

function voiceLabel(voice: SynthVoice): string {
  const bits: string[] = [voice.name];
  const tags: string[] = [];
  if (isNaturalVoice(voice)) tags.push('Enhanced');
  if (isKannada(voice)) tags.push('Kannada');
  else if (isIndianEnglish(voice)) tags.push('Indian English');
  else if (voice.lang) tags.push(voice.lang);
  if (voice.localService === false) tags.push('not stored on this device');
  if (tags.length) bits.push(`(${tags.join(', ')})`);
  return bits.join(' ');
}

export function createVoicePanel(opts: VoicePanelOptions): VoicePanel {
  let selectedUri = loadSavedVoice()?.voiceURI ?? null;

  const root = document.createElement('section');
  root.className = 'mc-voice-panel';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', 'mc-voice-title');

  const header = document.createElement('div');
  header.className = 'mc-panel-head';
  const title = document.createElement('h2');
  title.id = 'mc-voice-title';
  title.textContent = 'Spoken voice';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mc-panel-x';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close spoken voice settings');
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);

  const lead = document.createElement('p');
  lead.className = 'mc-panel-note';
  lead.textContent = 'Replies use a voice already on this device. Nothing is sent to a paid voice service.';

  const list = document.createElement('div');
  list.className = 'mc-voice-list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Spoken reply voice');

  const empty = document.createElement('p');
  empty.className = 'mc-panel-note';
  empty.hidden = true;
  empty.textContent = 'This browser has no spoken voices. Replies will still show as text.';

  const footer = document.createElement('div');
  footer.className = 'mc-panel-foot';
  const defaultBtn = document.createElement('button');
  defaultBtn.type = 'button';
  defaultBtn.className = 'mc-btn-reset';
  defaultBtn.textContent = 'Use the browser default';
  defaultBtn.addEventListener('click', () => {
    selectedUri = null;
    clearSavedVoice();
    paint();
    opts.onChange(null);
  });
  footer.append(defaultBtn);

  root.append(header, lead, list, empty, footer);

  function currentVoices(): SynthVoice[] {
    // Online voices (their text is sent away to be spoken) are not listed —
    // so cannot be previewed or picked — unless she turned them on.
    return rankVoices(usableVoices(opts.getVoices(), loadAllowCloud()));
  }

  function choose(voice: SynthVoice): void {
    selectedUri = voice.voiceURI;
    saveVoice(voice);
    paint();
    opts.onChange({ voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang });
  }

  function paint(): void {
    const voices = currentVoices();
    list.replaceChildren();
    empty.hidden = voices.length > 0;
    list.hidden = voices.length === 0;
    defaultBtn.disabled = voices.length === 0;
    for (const voice of voices) {
      const row = document.createElement('div');
      row.className = 'mc-voice-row';

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'mc-voice-pick';
      pick.setAttribute('role', 'radio');
      const on = selectedUri === voice.voiceURI;
      pick.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) pick.classList.add('is-on');
      pick.setAttribute('aria-label', voiceLabel(voice));
      const name = document.createElement('span');
      name.className = 'mc-voice-name';
      name.textContent = voice.name;
      const meta = document.createElement('span');
      meta.className = 'mc-voice-meta';
      const tags: string[] = [];
      if (isNaturalVoice(voice)) tags.push('Enhanced');
      if (isKannada(voice)) tags.push('Kannada');
      else if (isIndianEnglish(voice)) tags.push('Indian English');
      else if (voice.lang) tags.push(voice.lang);
      if (voice.localService === false) tags.push('not stored here');
      meta.textContent = tags.join(' · ');
      pick.append(name, meta);
      pick.addEventListener('click', () => choose(voice));

      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'mc-voice-preview';
      preview.textContent = 'Preview';
      preview.setAttribute('aria-label', `Preview ${voice.name}`);
      preview.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onPreview(voice);
      });

      row.append(pick, preview);
      list.append(row);
    }
  }

  function open(): void {
    selectedUri = loadSavedVoice()?.voiceURI ?? selectedUri;
    paint();
    root.hidden = false;
    const on = list.querySelector<HTMLButtonElement>('.mc-voice-pick.is-on') ?? list.querySelector('.mc-voice-pick');
    on?.focus();
  }
  function close(): void { root.hidden = true; }
  function toggle(): void { if (root.hidden) open(); else close(); }
  function isOpen(): boolean { return !root.hidden; }
  function refresh(voices?: readonly SynthVoice[]): void {
    if (voices) {
      // Caller may pass a fresh snapshot; getVoices is still the source on next paint.
      void voices;
    }
    if (!root.hidden) paint();
  }
  function dispose(): void { root.remove(); }

  paint();
  return { element: root, open, close, toggle, isOpen, refresh, dispose };
}
