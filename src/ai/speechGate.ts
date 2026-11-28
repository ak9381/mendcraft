// Spoken replies are never lost without a word on screen. Two ways Chrome
// stays silent:
//   - no click on this page since it loaded (autoplay policy): the chip
//     "Sound is off. Click once." stays up (it does not fade), the last line
//     is held, and it is spoken on her first pointerdown or keydown;
//   - Chrome's speech is stuck browser-wide (speaker.ts sees a line not start
//     on a clicked page): the chip says to relaunch Chrome. Lines are still
//     tried (the chip goes once one starts) and always shown as text.
// The gate wraps the read-aloud lines, so callers keep calling line() /
// sentence(); nothing else changes.
import type { ReadAloud } from './readAloud';
import { VOICE_BACKUP_LINE, VOICE_STUCK_LINE } from './speaker';

export const SOUND_OFF_CHIP = 'Sound is off. Click once.';
export { VOICE_BACKUP_LINE, VOICE_STUCK_LINE };

export interface SpeechGateDeps {
  /** True once the page has had a real click / key (missing API → true). */
  hasBeenActive(): boolean;
  /** Read aloud is on at all (off: nothing is held, no chip). */
  enabled(): boolean;
  /** This browser can speak at all (no synth: lines are text, nothing logged). */
  supported?(): boolean;
  /** Show this chip text, or take it down (null). */
  chip(text: string | null): void;
  /** Call `f` once, on her first pointerdown or keydown. */
  onFirstGesture(f: () => void): void;
  log?(line: string): void;
}

export interface SpeechGate extends ReadAloud {
  /** speaker.ts onStuck. */
  setStuck(stuck: boolean): void;
  /** speaker.ts onBackup: the Mac's voice speaks for a stuck Chrome. */
  setBackup(on: boolean): void;
  /** The line waiting for her click, if any. */
  held(): string | null;
  /** The chip on screen now (null = none). */
  chipText(): string | null;
}

export function createSpeechGate(inner: ReadAloud, d: SpeechGateDeps): SpeechGate {
  let held: string | null = null;
  let stuck = false;
  let backup = false;
  let blockedLogged = false;
  let waitingGesture = false;
  let chip: string | null = null;
  const render = (): void => {
    const next = stuck ? (backup ? VOICE_BACKUP_LINE : VOICE_STUCK_LINE) : held !== null ? SOUND_OFF_CHIP : null;
    if (next === chip) return;
    chip = next;
    d.chip(next);
  };
  const release = (): void => {
    waitingGesture = false;
    const line = held;
    held = null;
    render();
    if (line) {
      const ok = inner.line(line);
      d.log?.(ok ? 'speech: held line spoken after the click' : 'speech: held line not spoken (no voice for it)');
    }
  };
  /** Not spoken yet: hold it (latest wins) and wait for her click. */
  const hold = (text: string, append: boolean): void => {
    held = append && held ? `${held} ${text}` : text;
    if (!blockedLogged) { blockedLogged = true; d.log?.('speech: blocked (no click yet)'); }
    render();
    if (!waitingGesture) { waitingGesture = true; d.onFirstGesture(release); }
  };
  const blocked = (): boolean => d.enabled() && !d.hasBeenActive();
  let lastWhy = '';
  const spoke = (ok: boolean, what: string): boolean => {
    if (ok) { lastWhy = ''; return ok; }
    if (!d.enabled() || d.supported?.() === false) return ok;
    // Once per reason in a row, not once per line.
    const why = stuck ? 'voice stuck' : 'no on-device voice for it, or it was said just now';
    if (why !== lastWhy) { lastWhy = why; d.log?.(`speech: not spoken (${why}): ${what.slice(0, 60)}`); }
    return ok;
  };
  return {
    line(text, o) {
      if (blocked()) { hold(text, false); return false; }
      return spoke(inner.line(text, o), text);
    },
    sentence(text, first, o) {
      if (blocked()) { hold(text, !first); return false; }
      return spoke(inner.sentence(text, first, o), text);
    },
    stop() { inner.stop(); },
    setStuck(s) {
      if (s === stuck) return;
      stuck = s;
      d.log?.(s ? 'speech: stuck in Chrome (a line did not start in 3 s) — relaunch Chrome' : 'speech: voice is back');
      render();
    },
    setBackup(on) {
      if (on === backup) return;
      backup = on;
      d.log?.(on ? "speech: Chrome's voice is stuck — the Mac's voice speaks instead" : "speech: the Mac's voice stopped");
      render();
    },
    held: () => held,
    chipText: () => chip,
  };
}
