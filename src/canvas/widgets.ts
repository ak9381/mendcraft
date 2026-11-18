// Lit implementations of the smart-canvas catalog (DOM side of catalogApi.ts).
import { html, nothing, css } from 'lit';
import { A2uiLitElement } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { A2uiColumn, A2uiText } from '@a2ui/web_core/v0_9/basic_catalog';
import { LampTileApi, PlanBoardApi } from './catalogApi';
import { ROOM_CATALOG_ID } from './surfacePlan';
import { createPlanController } from '../plan/controller';
import { createPlanRenderer } from '../plan/renderer';
import { buildPlanTemplate } from '../plan/templates';

export class LampTileElement extends A2uiLitElement<typeof LampTileApi> {
  static readonly tagName = 'mc-lamp-tile';
  protected override readonly api = LampTileApi;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid #d9d4c7; border-radius: 16px; padding: 20px; min-height: 180px; display: grid; gap: 12px; background: var(--panel, #191917); font: 500 20px/1.3 var(--font-sans, system-ui), 'Noto Sans Kannada', sans-serif; color: var(--text, #f2f0ea); border-color: var(--border, #3a3934); }
    .tile.on { border-color: #f5a623; background: #2a2214; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .label { font-size: 24px; font-weight: 600; }
    .state { font-variant-numeric: tabular-nums; }
    button { font: inherit; min-height: 64px; min-width: 120px; border-radius: 12px; border: 2px solid var(--text, #f2f0ea); background: transparent; color: var(--text, #f2f0ea); cursor: pointer; }
    button:focus-visible { outline: 3px solid var(--focus, #8e9dff); outline-offset: 3px; }
    button.primary { background: var(--text, #f2f0ea); color: #0d0d0c; }
    .meter { height: 14px; border-radius: 7px; background: rgb(242 240 234 / 0.14); overflow: hidden; }
    .meter > i { display: block; height: 100%; background: #f5a623; }
    .pending { color: var(--text-dim, #bdb9b0); } .error { color: #ff8a7a; }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const on = !!p.on;
    const b = typeof p.brightness === 'number' ? p.brightness : 0;
    return html`<div class="tile ${on ? 'on' : ''}" role="group" aria-label=${String(p.label)}>
      <div class="row"><span class="label">${p.label}</span>
        <span class="state" aria-live="polite">${on ? `On · ${b}%` : 'Off'}</span>
        ${p.pending ? html`<span class="pending">checking…</span>` : nothing}</div>
      <div class="meter" aria-hidden="true"><i style="width:${on ? b : 0}%"></i></div>
      ${p.error ? html`<div class="error" role="status">${p.error}</div>` : nothing}
      <div class="row">
        <button class="primary" data-act="toggle" @click=${() => p.onToggle?.()}>${on ? 'Turn off' : 'Turn on'}</button>
        <button data-act="dimmer" @click=${() => p.onDimmer?.()}>Dimmer</button>
        <button data-act="brighter" @click=${() => p.onBrighter?.()}>Brighter</button>
      </div></div>`;
  }
}

/** Wraps today's plan engine + SVG renderer as one catalog widget. */
export class PlanBoardElement extends A2uiLitElement<typeof PlanBoardApi> {
  static readonly tagName = 'mc-plan-board';
  protected override readonly api = PlanBoardApi;
  private mounted: string | null = null;
  override createRenderRoot() { return this; }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    return html`<div class="mc-plan-board" style="height:420px;border:2px solid #d9d4c7;border-radius:16px;overflow:hidden;background:#fff;position:relative"></div>`;
  }
  override updated() {
    const p = this.controller?.props;
    const host = this.querySelector<HTMLElement>('.mc-plan-board');
    if (!p || !host) return;
    const key = `${p.boardId}:${p.template}`;
    if (this.mounted === key) return;
    this.mounted = key;
    host.innerHTML = '';
    const controller = createPlanController();
    controller.applyGenerated?.({ ops: buildPlanTemplate(p.template) });
    const view = createPlanRenderer(host, controller, () => {});
    view.render();
    requestAnimationFrame(() => { view.fit?.(); view.render(); });
  }
}

// Same shape as web_core's (internal) toWebComponentImplementation.
export const LampTile = { ...LampTileApi, tagName: LampTileElement.tagName, element: LampTileElement as unknown as CustomElementConstructor };
export const PlanBoard = { ...PlanBoardApi, tagName: PlanBoardElement.tagName, element: PlanBoardElement as unknown as CustomElementConstructor };

export const smartCanvasCatalog = new Catalog(ROOM_CATALOG_ID, '0.9', [A2uiColumn, A2uiText, LampTile, PlanBoard] as never);
