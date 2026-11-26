// The speaker and gimbal tiles (Lit side of catalogApi.ts; the lamp is a
// generated DeviceTile now, deviceTile.ts), built gesture-first:
// no slider anywhere. Every action is one press on a button the palm highlight
// can land on and a held thumbs-up can press — step buttons (− / +) and a few
// preset chips, each at least 56 px with 12 px between them.
//
// Level-control contract (shared with the gesture code, which clicks these):
// each level is ONE element carrying data-level="brightness|temp|volume" and
// data-level-step, holding a data-level-dec and a data-level-inc button (one
// step each, through the normal device path) and a live data-level-readout;
// its current value is in aria-valuenow (with aria-valuemin / aria-valuemax).
// Presets stay separate buttons.
import { html, nothing, css } from 'lit';
import { A2uiLitElement } from '@a2ui/lit/v0_9';
import { GimbalTileApi, MusicTileApi } from './catalogApi';
import { levelStyles } from './tileStyles';
import { GIMBAL_CUE_BUTTONS, GIMBAL_MODE_BUTTONS, GIMBAL_NO_STAND, GIMBAL_TILE_LABEL } from './gimbalTile';
import { VOLUME_PRESETS, VOLUME_TILE_STEP } from './lampPresets';
import { BUILTIN_LABEL } from './spotifyConnector';

type Act = ((arg?: never) => void) | undefined;
/** Fire an action with the pressed chip's own value (A2UI only allows `metadata.extensions`). */
const fire = (act: unknown, value: string | number): void => {
  (act as Act)?.({ metadata: { extensions: { value } } } as never);
};
/** Arrow keys on a focused level control: fine ±1 steps for keyboard users. */
function fineKey(e: KeyboardEvent): -1 | 0 | 1 {
  // A held key auto-repeats ~30 times a second: each would be a real lamp
  // command. One press = one step.
  if (e.repeat) return 0;
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') return 1;
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') return -1;
  return 0;
}

export class MusicTileElement extends A2uiLitElement<typeof MusicTileApi> {
  static readonly tagName = 'mc-music-tile';
  protected override readonly api = MusicTileApi;
  static override styles = [levelStyles, css`
    .track { display: grid; gap: 2px; min-height: 50px; align-content: center; }
    .title { font-size: 20px; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
    .transport { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr); gap: 12px; }
    .transport button { min-height: 64px; font-size: 17px; }
    .source { white-space: normal; }
  `];
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const playing = !!p.playing;
    const vol = typeof p.volume === 'number' ? Math.max(0, Math.min(100, Math.round(p.volume))) : 50;
    const track = p.trackTitle ? String(p.trackTitle) : '';
    const spotify = p.source === 'spotify';
    const where = p.playingOn ? String(p.playingOn) : '';
    return html`<div class="tile ${playing ? 'active playing' : ''}" role="group" aria-label=${String(p.label)}>
      <div class="head">
        <div class="titles"><span class="label">${p.label}</span>
          <span class="state source" data-source=${spotify ? 'spotify' : 'builtin'}>${spotify ? `Spotify${where ? ` · ${where}` : ''}` : BUILTIN_LABEL}</span></div>
      </div>
      <div class="track" aria-live="polite">
        <span class="state">${playing ? 'Now playing' : 'Paused'}${p.pending ? ' · checking…' : ''}</span>
        <span class="title" data-track>${track || 'Nothing playing yet'}</span>
      </div>
      ${p.error ? html`<p class="note error" role="status">${p.error}</p>` : nothing}
      <div class="transport" role="group" aria-label="Playback">
        <button data-act="previous" @click=${() => p.onPrevious?.()}>Previous</button>
        <button class="primary" data-act="playpause" @click=${() => p.onPlayPause?.()}>${playing ? 'Pause' : 'Play'}</button>
        <button data-act="next" @click=${() => p.onNext?.()}>Next</button>
      </div>
      <div class="level" data-level="volume" data-level-step=${VOLUME_TILE_STEP} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${vol} role="group" aria-label=${`Volume ${vol} %. Arrow keys change it by 1 %.`}
        @keydown=${(e: KeyboardEvent) => { const d = fineKey(e); if (d) { e.preventDefault(); fire(p.onVolume, Math.max(0, Math.min(100, vol + d))); } }}>
        <div class="steps">
          <button class="step dec" data-level-dec data-act="softer" aria-label="Quieter" @click=${() => p.onSofter?.()}>−</button>
          <div class="readout"><small>Volume</small><span data-level-readout>${vol} %</span></div>
          <button class="step inc" data-level-inc data-act="louder" aria-label="Louder" @click=${() => p.onLouder?.()}>+</button>
        </div>
        <div class="chips">
          ${VOLUME_PRESETS.map((v) => html`<button data-act="volume" data-value=${v.volume} aria-label=${`${v.label} volume`} aria-pressed=${vol === v.volume ? 'true' : 'false'} @click=${() => fire(p.onVolume, v.volume)}>${v.label}</button>`)}
        </div>
      </div>
    </div>`;
  }
}

/** The docked iPhone's stand: three mode buttons and two body-language cues,
 *  each one press (>= 56 px, palm highlight + thumbs-up pressable). The status
 *  line is only what the iPhone reported; a pressed mode is marked from that
 *  report, never from the press. */
export class GimbalTileElement extends A2uiLitElement<typeof GimbalTileApi> {
  static readonly tagName = 'mc-gimbal-tile';
  protected override readonly api = GimbalTileApi;
  static override styles = [levelStyles, css`
    .modes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .cues { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .modes button { min-height: 64px; }
    @container (max-width: 340px) { .modes { grid-template-columns: minmax(0, 1fr); } }
  `];
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const docked = !!p.docked;
    const mode = typeof p.mode === 'string' ? p.mode : '';
    const status = p.status ? String(p.status) : GIMBAL_NO_STAND;
    const label = p.label ? String(p.label) : GIMBAL_TILE_LABEL;
    return html`<div class="tile ${docked && mode !== 'hold' ? 'active' : ''}" role="group" aria-label=${label} data-gimbal-docked=${docked ? 'true' : 'false'}>
      <div class="head">
        <div class="titles"><span class="label">${label}</span>
          <span class="state" data-gimbal-status aria-live="polite">${status}</span></div>
      </div>
      ${p.error ? html`<p class="note error" role="status">${p.error}</p>` : nothing}
      <div class="chips modes" role="group" aria-label="Gimbal mode">
        ${GIMBAL_MODE_BUTTONS.map((b) => html`<button data-act="gimbal-mode" data-value=${b.value} aria-pressed=${docked && mode === b.value ? 'true' : 'false'} @click=${() => fire(p.onMode, b.value)}>${b.label}</button>`)}
      </div>
      <div class="chips cues" role="group" aria-label="Gimbal body language">
        ${GIMBAL_CUE_BUTTONS.map((b) => html`<button data-act="gimbal-cue" data-value=${b.value} @click=${() => fire(p.onCue, b.value)}>${b.label}</button>`)}
      </div>
    </div>`;
  }
}
