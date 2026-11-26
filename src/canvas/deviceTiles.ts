// The lamp and speaker tiles (Lit side of catalogApi.ts), built gesture-first:
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
import { LampTileApi, MusicTileApi } from './catalogApi';
import {
  BRIGHTNESS_PRESETS, LAMP_COLOURS, LAMP_SCENES, LAMP_TILE_STEP, TEMP_DEFAULT, TEMP_STEP, VOLUME_PRESETS, VOLUME_TILE_STEP, WHITE_PRESETS,
  activeColourKey, lampStateLine,
} from './lampPresets';
import { BUILTIN_LABEL } from './spotifyConnector';

/** Shared look of every device tile and its discrete controls. */
export const levelStyles = css`
  :host { display: block; container-type: inline-size; }
  .tile { box-sizing: border-box; height: 100%; border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 16px; display: grid; gap: 12px; align-content: start;
    background: var(--panel, #FFFFFF); font: 500 16px/1.3 var(--font-sans, system-ui), 'Noto Sans Kannada', sans-serif; color: var(--text, #2B2B2B);
    transition: border-color 160ms ease-out, background-color 160ms ease-out; }
  .tile.active { border-color: var(--accent, #6B8F71); background: rgb(107 143 113 / 0.06); }
  .head { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; min-height: 56px; }
  .head .titles { flex: 1 1 140px; min-width: 0; display: grid; gap: 2px; }
  .label { font-size: 22px; font-weight: 650; line-height: 1.2; overflow-wrap: anywhere; }
  .state { font-size: 16px; color: var(--text-dim, #6E6A63); font-variant-numeric: tabular-nums; }
  .badge { font-size: 15px; font-weight: 650; color: var(--text-dim, #6E6A63); border: 1.5px solid var(--border, #E4E0D8); border-radius: 999px; padding: 2px 10px; white-space: nowrap; }
  .note { margin: 0; font-size: 15px; line-height: 20px; color: var(--text-dim, #6E6A63); }
  .note.error { color: var(--danger, #B5453A); font-weight: 600; }
  .cap { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-dim, #6E6A63); }
  .readout { font-size: 18px; font-weight: 650; color: var(--text, #2B2B2B); font-variant-numeric: tabular-nums; text-align: center; }
  .readout small { display: block; font-size: 15px; font-weight: 600; color: var(--text-dim, #6E6A63); }
  button { box-sizing: border-box; font-family: inherit; font-size: 16px; font-weight: 600; line-height: 1.15; min-height: 56px; min-width: 56px; padding: 4px 8px; border-radius: 12px;
    border: 2px solid var(--border, #E4E0D8); background: var(--panel, #FFFFFF); color: var(--text, #2B2B2B); cursor: pointer; touch-action: manipulation;
    transition: transform 120ms ease-out, background-color 140ms ease-out, border-color 140ms ease-out; }
  button:active { transform: scale(0.97); }
  @media (hover: hover) and (pointer: fine) { button:hover { border-color: #C9C2B4; } button.primary:hover { background: #8A5418; border-color: #8A5418; } }
  button:focus-visible { outline: 3px solid var(--focus, #5A7BA6); outline-offset: 3px; }
  button.primary { background: var(--action-fill, #9A5F1C); border-color: var(--action-fill, #9A5F1C); color: #FFFFFF; }
  button[aria-pressed="true"] { border-color: var(--action-fill, #9A5F1C); background: rgb(154 95 28 / 0.10); box-shadow: inset 0 0 0 1px var(--action-fill, #9A5F1C); }
  button.step { font-size: 26px; line-height: 1; padding: 0; }
  .level { display: grid; gap: 12px; }
  .steps { display: grid; grid-template-columns: 56px minmax(0, 1fr) 56px; gap: 12px; align-items: center; }
  .chips { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  @media (prefers-reduced-motion: reduce) { button, .tile { transition: none; } button:active { transform: none; } }
`;

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

export class LampTileElement extends A2uiLitElement<typeof LampTileApi> {
  static readonly tagName = 'mc-lamp-tile';
  protected override readonly api = LampTileApi;
  static override styles = [levelStyles, css`
    .power { min-width: 120px; padding: 4px 18px; }
    .presets { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .colours { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .scenes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .swatch { display: grid; justify-items: center; align-content: center; gap: 4px; min-height: 60px; font-size: 15px; padding: 4px 0; letter-spacing: -0.01em; }
    .dot { width: 22px; height: 22px; border-radius: 50%; border: 1px solid rgb(0 0 0 / 0.22); }
    @container (min-width: 560px) { .colours { grid-template-columns: repeat(8, minmax(0, 1fr)); } .scenes { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
    @container (max-width: 340px) {
      .tile:not(.compact) .presets { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
  `];
  /** Edit mode (editBoard.ts) holds the tile in a fixed-size box: there the
   *  tile keeps its rows as they are (compact) instead of wrapping taller
   *  than the box when it is squeezed. */
  private inEditBox = false;
  override connectedCallback() {
    super.connectedCallback();
    const boxed = !!this.closest('.mc-edit-item');
    if (boxed !== this.inEditBox) { this.inEditBox = boxed; this.requestUpdate(); }
  }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const on = !!p.on;
    const b = typeof p.brightness === 'number' ? p.brightness : 0;
    const temp = typeof p.temp === 'number' ? p.temp : 0;
    const color = typeof p.color === 'string' ? p.color : '';
    const sceneId = typeof p.sceneId === 'number' ? p.sceneId : 0;
    const look = { color, temp, sceneId };
    const colourKey = on ? activeColourKey(look) : '';
    const whiteOn = on && !color && !sceneId;
    return html`<div class="tile ${on ? 'active' : ''} ${this.inEditBox ? 'compact' : ''}" role="group" aria-label=${String(p.label)}>
      <div class="head">
        <div class="titles"><span class="label">${p.label}</span>
          <span class="state" aria-live="polite">${lampStateLine({ on, brightness: b, ...look })}${p.pending ? ' · checking…' : ''}</span></div>
        ${p.sim ? html`<span class="badge sim-badge" title="Simulated — the WiZ bridge isn't reachable">SIM</span>` : nothing}
        <button class="primary power" data-act="toggle" @click=${() => p.onToggle?.()}>${on ? 'Turn off' : 'Turn on'}</button>
      </div>
      ${p.error ? html`<p class="note error" role="status">${p.error}</p>` : nothing}
      <div class="level" data-level="brightness" data-level-step=${LAMP_TILE_STEP} aria-valuemin="10" aria-valuemax="100" aria-valuenow=${b} role="group" aria-label=${`Brightness ${on ? `${b} %` : 'off'}. Arrow keys change it by 1 %.`}
        @keydown=${(e: KeyboardEvent) => { const d = fineKey(e); if (d) { e.preventDefault(); fire(p.onLevel, Math.max(10, Math.min(100, (on ? b : 10) + d))); } }}>
        <div class="steps">
          <button class="step dec" data-level-dec data-act="dimmer" aria-label="Dimmer" @click=${() => p.onDimmer?.()}>−</button>
          <div class="readout"><small>Brightness</small><span data-level-readout>${on ? `${b} %` : 'Off'}</span></div>
          <button class="step inc" data-level-inc data-act="brighter" aria-label="Brighter" @click=${() => p.onBrighter?.()}>+</button>
        </div>
        <div class="chips presets">
          ${BRIGHTNESS_PRESETS.map((v) => html`<button data-act="level" data-value=${v} aria-label=${`Brightness ${v} %`} aria-pressed=${on && b === v ? 'true' : 'false'} @click=${() => fire(p.onLevel, v)}>${v}%</button>`)}
        </div>
      </div>
      <div class="chips colours" role="group" aria-label="Colour">
        ${LAMP_COLOURS.map((c) => html`<button class="swatch" data-act="color" data-value=${c.key} aria-pressed=${colourKey === c.key ? 'true' : 'false'} @click=${() => fire(p.onColor, c.key)}>
          <span class="dot" style="background:${c.swatch}" aria-hidden="true"></span>${c.label}</button>`)}
      </div>
      <div class="chips scenes" role="group" aria-label="Scenes">
        ${LAMP_SCENES.map((s) => html`<button data-act="scene" data-value=${s.key} aria-label=${`${s.label} scene`} aria-pressed=${on && sceneId === s.sceneId ? 'true' : 'false'} @click=${() => fire(p.onScene, s.key)}>${s.label}</button>`)}
      </div>
      <div class="level" data-level="temp" data-level-step=${TEMP_STEP} aria-valuemin="2200" aria-valuemax="6500" aria-valuenow=${temp || TEMP_DEFAULT} role="group" aria-label=${`White ${whiteOn && temp ? `${temp} kelvin` : 'not set'}. Arrow keys change it by 100 kelvin.`}
        @keydown=${(e: KeyboardEvent) => { const d = fineKey(e); if (d) { e.preventDefault(); fire(p.onWhite, Math.max(2200, Math.min(6500, (temp || TEMP_DEFAULT) + d * 100))); } }}>
        <div class="steps">
          <button class="step dec" data-level-dec data-act="warmer" aria-label="Warmer" @click=${() => p.onWarmer?.()}>−</button>
          <div class="readout"><small>White</small><span data-level-readout>${whiteOn && temp ? `${temp} K` : '—'}</span></div>
          <button class="step inc" data-level-inc data-act="cooler" aria-label="Cooler" @click=${() => p.onCooler?.()}>+</button>
        </div>
        <div class="chips">
          ${WHITE_PRESETS.map((w) => html`<button data-act="white" data-value=${w.key} aria-label=${`${w.label} white`} aria-pressed=${whiteOn && temp === w.temp ? 'true' : 'false'} @click=${() => fire(p.onWhite, w.key)}>${w.label}</button>`)}
        </div>
      </div>
    </div>`;
  }
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
