// The gimbal tile (Lit side of catalogApi.ts; the lamp and the speaker are
// generated DeviceTiles now, deviceTile.ts), built gesture-first:
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
import { GimbalTileApi } from './catalogApi';
import { levelStyles } from './tileStyles';
import { GIMBAL_CUE_BUTTONS, GIMBAL_MODE_BUTTONS, GIMBAL_NO_STAND, GIMBAL_TILE_LABEL } from './gimbalTile';

type Act = ((arg?: never) => void) | undefined;
/** Fire an action with the pressed chip's own value (A2UI only allows `metadata.extensions`). */
const fire = (act: unknown, value: string | number): void => {
  (act as Act)?.({ metadata: { extensions: { value } } } as never);
};
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
