// The one device tile (Lit side of DeviceTileApi): any device leaf, drawn
// from its approved controls. Gesture-first: no slider anywhere — a
// "slider" control is a level with − / + step buttons (the level-control
// contract levelControl.ts clicks: data-level, data-level-dec,
// data-level-inc, data-level-readout), every button at least 56 px.
// A press fires the tile's one `device.act` action with ONLY its control
// (and option) index, or a level value for a slider set from the keyboard;
// canvasApp looks the control up in the approved plan (controlSpec.ts).
import { html, nothing, css } from 'lit';
import { A2uiLitElement } from '@a2ui/lit/v0_9';
import { DeviceTileApi } from './catalogApi';
import { levelStyles } from './tileStyles';
import { RANGES } from './deviceGuard';
import { LAMP_TILE_STEP, TEMP_DEFAULT, TEMP_STEP, VOLUME_TILE_STEP, lampStateLine, rgbHex } from './lampPresets';
import type { ControlSpec, IntentSpec, SliderKey, StateKey } from './controlSpec';

export const DEVICE_TILE_TAG = 'mc-device-tile';
export const NOT_CONNECTED_BADGE = 'Not connected';
export const STANDARD_CONTROLS_NOTE = 'Standard controls';

/** The tile's live state, as the data model hands it over. */
export interface TileState {
  cls: string; on: boolean; brightness: number; temp: number; color: string; sceneId: number;
  /** null = nothing has reported the volume yet. */
  playing: boolean; volume: number | null; trackTitle: string; playingOn: string; source: string; status: string;
  /** Gimbal: the mode the iPhone reported ('' = no stand / not known). */
  mode: string;
}
export function tileState(p: Record<string, unknown>): TileState {
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    cls: str(p.cls), on: !!p.on, brightness: num(p.brightness), temp: num(p.temp), color: str(p.color), sceneId: num(p.sceneId),
    playing: !!p.playing, volume: typeof p.volume === 'number' && Number.isFinite(p.volume) ? p.volume : null, trackTitle: str(p.trackTitle), playingOn: str(p.playingOn), source: str(p.source), status: str(p.status),
    mode: str(p.mode),
  };
}

/** "On · 70% · Relax", "Playing · Blue in Green", "Paused", "Off". */
export function stateLine(s: TileState): string {
  if (s.cls === 'lamp') return lampStateLine({ on: s.on, brightness: s.brightness, color: s.color, temp: s.temp, sceneId: s.sceneId });
  // The title only when Spotify (or a SIM fixture) named one; never a placeholder.
  if (s.cls === 'music') return s.playing ? (s.trackTitle ? `Playing · ${s.trackTitle}` : 'Playing') : 'Paused';
  if (s.cls === 'gimbal') return s.status || 'No stand docked';
  return s.on ? 'On' : 'Off';
}

/** Lit up: a lamp or switch that is on, a speaker playing, a stand the
 *  iPhone reports following (face or hands). */
export const tileActive = (s: TileState): boolean => (s.cls === 'music' ? s.playing : s.cls === 'gimbal' ? !!s.mode && s.mode !== 'hold' : s.on);

/** What a readout control shows. */
export function readoutText(show: StateKey, s: TileState): string {
  if (show === 'trackTitle') return s.trackTitle || 'Nothing playing yet';
  if (show === 'playingOn') return s.playingOn || '—';
  if (show === 'source') return s.source === 'spotify' ? 'Spotify' : '—';
  if (show === 'status') return s.status || '—';
  return stateLine(s);
}

/** Does this chip / button already describe the device (aria-pressed)? */
export function intentMatches(i: IntentSpec, s: TileState): boolean {
  if ('on' in i) return typeof i.on === 'boolean' ? s.on === i.on : s.on;
  if ('playing' in i) return typeof i.playing === 'boolean' ? s.playing === i.playing : s.playing;
  // A mode is marked from the iPhone's report, never from the press.
  if ('gimbalMode' in i) return s.cls === 'gimbal' && s.mode === i.gimbalMode;
  if (!s.on && s.cls === 'lamp') return false;
  if ('sceneId' in i) return s.sceneId === i.sceneId;
  if ('rgb' in i) return !s.sceneId && s.color.toLowerCase() === rgbHex(i.rgb);
  if ('brightness' in i) return typeof i.brightness === 'number' && s.brightness === i.brightness;
  if ('temp' in i) return typeof i.temp === 'number' && !s.color && !s.sceneId && s.temp === i.temp;
  if ('volume' in i) return typeof i.volume === 'number' && s.volume === i.volume;
  return false;
}

/** A slider control as a level: its step, range, value and readout. */
export function sliderView(key: SliderKey, s: TileState, o: { unreachable?: boolean } = {}): { step: number; min: number; max: number; now: number; readout: string; fine: number; known: boolean } {
  const [min, max] = RANGES[key];
  if (key === 'brightness') return { step: LAMP_TILE_STEP, min, max, now: s.brightness, readout: s.on ? `${s.brightness} %` : 'Off', fine: 1, known: true };
  if (key === 'temp') {
    const white = s.on && !s.color && !s.sceneId && s.temp > 0;
    return { step: TEMP_STEP, min, max, now: s.temp || TEMP_DEFAULT, readout: white ? `${s.temp} K` : '—', fine: 100, known: true };
  }
  // The speaker's real volume, or "—" while nothing has reported it (and when it isn't here).
  const known = s.volume !== null && !o.unreachable;
  return { step: VOLUME_TILE_STEP, min, max, now: s.volume ?? min, readout: known ? `${s.volume} %` : '—', fine: 1, known };
}

type Act = ((arg?: never) => void) | undefined;
/** A press: the control index, the option index (chip, or 0 = −, 1 = +), or a level value. */
const press = (act: unknown, ext: { control: number; option?: number; value?: number }): void => {
  (act as Act)?.({ metadata: { extensions: ext } } as never);
};
/** Arrow keys on a focused level: one fine step per press (a held key
 *  auto-repeats, and each repeat would be a real device command). */
function fineKey(e: KeyboardEvent): -1 | 0 | 1 {
  if (e.repeat) return 0;
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') return 1;
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') return -1;
  return 0;
}

export class DeviceTileElement extends A2uiLitElement<typeof DeviceTileApi> {
  static readonly tagName = DEVICE_TILE_TAG;
  protected override readonly api = DeviceTileApi;
  static override styles = [levelStyles, css`
    .group { display: grid; gap: 8px; }
    .chips.many { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .toggle { min-width: 120px; padding: 4px 18px; }
    @container (max-width: 340px) { .chips, .chips.many { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `];
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const s = tileState(p as Record<string, unknown>);
    const controls = (Array.isArray(p.controls) ? p.controls : []) as ControlSpec[];
    const label = String(p.label ?? '');
    const active = tileActive(s);
    return html`<div class="tile ${active && !p.unreachable ? 'active' : ''}" role="group" aria-label=${label} data-device-cls=${s.cls}>
      <div class="head">
        <div class="titles"><span class="label">${label}</span>
          <span class="state" data-device-state aria-live="polite">${stateLine(s)}${p.pending ? ' · checking…' : ''}</span></div>
        ${p.unreachable ? html`<span class="badge reach-badge" data-unreachable title="This device isn't answering here">${NOT_CONNECTED_BADGE}</span>`
          : p.sim ? html`<span class="badge sim-badge" title="Simulated device">SIM</span>` : nothing}
      </div>
      ${p.error ? html`<p class="note error" role="status">${p.error}</p>` : nothing}
      ${controls.map((c, i) => this.control(c, i, s, p.onAct))}
      ${p.standard ? html`<p class="note" data-standard>${STANDARD_CONTROLS_NOTE}</p>` : nothing}
    </div>`;
  }
  private control(c: ControlSpec, i: number, s: TileState, act: unknown) {
    if (c.kind === 'toggle') {
      return html`<button class="primary toggle" data-act="toggle" data-control=${i} aria-pressed=${intentMatches(c.intent, s) ? 'true' : 'false'}
        @click=${() => press(act, { control: i })}>${c.label}</button>`;
    }
    if (c.kind === 'button') {
      return html`<button data-act="button" data-control=${i} @click=${() => press(act, { control: i })}>${c.label}</button>`;
    }
    if (c.kind === 'chips') {
      return html`<div class="group"><p class="cap">${c.label}</p>
        <div class="chips ${c.options.length > 6 ? 'many' : ''}" role="group" aria-label=${c.label}>
          ${c.options.map((o, j) => html`<button data-act="chip" data-control=${i} data-option=${j} aria-pressed=${intentMatches(o.intent, s) ? 'true' : 'false'}
            @click=${() => press(act, { control: i, option: j })}>${o.label}</button>`)}
        </div></div>`;
    }
    if (c.kind === 'slider') {
      const v = sliderView(c.key, s, { unreachable: !!this.controller?.props?.unreachable });
      return html`<div class="level" data-level=${c.key} data-level-step=${v.step} data-control=${i} aria-valuemin=${v.min} aria-valuemax=${v.max} aria-valuenow=${v.known ? v.now : nothing}
        role="group" aria-label=${`${c.label} ${v.readout}. Arrow keys change it a little.`}
        @keydown=${(e: KeyboardEvent) => { const d = fineKey(e); if (d) { e.preventDefault(); press(act, v.known ? { control: i, value: Math.max(v.min, Math.min(v.max, v.now + d * v.fine)) } : { control: i, option: d > 0 ? 1 : 0 }); } }}>
        <div class="steps">
          <button class="step dec" data-level-dec aria-label=${`${c.label} down`} @click=${() => press(act, { control: i, option: 0 })}>−</button>
          <div class="readout"><small>${c.label}</small><span data-level-readout>${v.readout}</span></div>
          <button class="step inc" data-level-inc aria-label=${`${c.label} up`} @click=${() => press(act, { control: i, option: 1 })}>+</button>
        </div>
      </div>`;
    }
    return html`<div class="readout" data-readout=${c.show}>${c.label ? html`<small>${c.label}</small>` : nothing}<span>${readoutText(c.show, s)}</span></div>`;
  }
}
