// "Voice" (More → Voice, or say "change voice"): the installed voices for the
// language in use, nicest first, each with a Test button. On-device voices
// only, unless she turns on online voices (their text is sent to be spoken —
// the sheet says so). The choice is remembered on this device. On a Mac with
// no Premium / Enhanced voice it says, once, where to download one; nothing
// is ever downloaded from here. Built with createElement/textContent only.
import {
  clearSavedVoice, listPickerVoices, loadAllowCloud, loadReadAloud, loadSavedVoice, macVoiceHintOnce, previewPhrase,
  saveAllowCloud, saveReadAloud, saveVoice, voiceKindLabel, type SpeechPlatform,
} from '../ai/speechVoices';
import type { Speaker } from '../ai/speaker';

export interface VoiceSheetOptions {
  speaker: Speaker;
  /** BCP-47 of the language replies are in right now ("en-US", "kn-IN"). */
  lang(): string;
  platform: SpeechPlatform;
  storage?: Storage;
  /** A status line for the canvas ("Voice set to Ava (Premium)."). */
  say(text: string): void;
  onReadAloud?(on: boolean): void;
}

export interface VoiceSheet {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Repaint (the browser fills its voice list late). */
  refresh(): void;
}

export function mountVoiceSheet(root: HTMLElement, opts: VoiceSheetOptions, doc: Document = root.ownerDocument): VoiceSheet {
  const make = (tag: string, cls: string, text?: string): HTMLElement => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const el = make('section', 'mc-voice-sheet');
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Voice');
  el.setAttribute('data-hand-always', '');
  const head = make('div', 'mc-voice-head');
  const title = make('h2', 'mc-voice-title', 'Voice');
  const closeBtn = make('button', 'mc-btn mc-voice-close', 'Close');
  closeBtn.setAttribute('type', 'button');
  head.append(title, closeBtn);
  const hint = make('p', 'mc-voice-hint');
  hint.hidden = true;
  const note = make('p', 'mc-voice-note');
  const list = make('ul', 'mc-voice-list');
  list.setAttribute('aria-label', 'Installed voices');
  const foot = make('div', 'mc-voice-foot');
  el.append(head, hint, note, list, foot);
  root.append(el);

  let hintText: string | null = null;

  function toggle(label: string, on: boolean, onChange: (next: boolean) => void): HTMLElement {
    const b = make('button', 'mc-btn mc-voice-toggle', label);
    b.setAttribute('type', 'button');
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => onChange(b.getAttribute('aria-pressed') !== 'true'));
    return b;
  }

  function paint(): void {
    const lang = opts.lang();
    const allowCloud = loadAllowCloud(opts.storage);
    const saved = loadSavedVoice(opts.storage);
    const voices = listPickerVoices(opts.speaker.voices(), { lang, allowCloud });
    const current = opts.speaker.voiceFor(lang);
    // The Mac hint: decided once per device, then kept on screen while this sheet is open.
    hintText ??= macVoiceHintOnce(opts.speaker.voices(), opts.platform, lang, opts.storage);
    hint.hidden = !hintText;
    hint.textContent = hintText ?? '';

    list.textContent = '';
    if (!opts.speaker.supported) note.textContent = 'This browser cannot speak. Replies stay as text.';
    else if (!voices.length) note.textContent = `No voice for this language is installed on this device${allowCloud ? '' : ' (online voices are off)'}. Replies stay as text.`;
    else note.textContent = 'Voices on this device, nicest first. Your choice is remembered here.';

    for (const v of voices) {
      const row = make('li', 'mc-voice-row');
      const chosen = current?.voiceURI === v.voiceURI;
      const pick = make('button', 'mc-btn mc-voice-pick');
      pick.setAttribute('type', 'button');
      pick.setAttribute('aria-pressed', String(chosen));
      pick.setAttribute('aria-label', `Use the voice ${v.name}`);
      pick.append(make('span', 'mc-voice-name', v.name), make('span', 'mc-voice-kind', `${voiceKindLabel(v)} · ${v.lang}`));
      pick.addEventListener('click', () => {
        saveVoice(v, opts.storage);
        opts.say(`Voice set to ${v.name}.`);
        opts.speaker.speak(`Voice set to ${v.name.replace(/\s*\(.*\)$/, '')}.`, { voice: v });
        paint();
      });
      const test = make('button', 'mc-btn mc-voice-test', 'Test');
      test.setAttribute('type', 'button');
      test.setAttribute('aria-label', `Test the voice ${v.name}`);
      test.addEventListener('click', () => { opts.speaker.speak(previewPhrase(v.lang), { voice: v }); });
      row.append(pick, test);
      list.append(row);
    }

    foot.textContent = '';
    if (saved) {
      const reset = make('button', 'mc-btn mc-voice-reset', 'Use the usual voice');
      reset.setAttribute('type', 'button');
      reset.addEventListener('click', () => { clearSavedVoice(opts.storage); opts.say('Back to the usual voice.'); paint(); });
      foot.append(reset);
    }
    foot.append(
      toggle('Read replies aloud', loadReadAloud(opts.storage), (next) => {
        saveReadAloud(next, opts.storage);
        opts.onReadAloud?.(next);
        opts.say(next ? 'Replies are read aloud.' : 'Replies stay as text.');
        paint();
      }),
      toggle('Online voices (text is sent to be spoken)', allowCloud, (next) => {
        saveAllowCloud(next, opts.storage);
        opts.say(next ? 'Online voices are listed. Their text leaves this device to be spoken.' : 'Online voices are off. Only voices on this device are used.');
        paint();
      }),
    );
  }

  const sheet: VoiceSheet = {
    el,
    open() { el.hidden = false; paint(); (closeBtn as HTMLElement).focus?.(); },
    close() { el.hidden = true; hintText = null; },
    isOpen: () => !el.hidden,
    refresh() { if (!el.hidden) paint(); },
  };
  closeBtn.addEventListener('click', () => sheet.close());
  el.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); sheet.close(); } });
  return sheet;
}
