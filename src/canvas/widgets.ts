// Lit implementations of the smart-canvas catalog (DOM side of catalogApi.ts).
import { html, svg, nothing, css } from 'lit';
import { A2uiLitElement } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { A2uiColumn, A2uiText } from '@a2ui/web_core/v0_9/basic_catalog';
import {
  CardApi,
  ChartTileApi,
  ConnectTileApi,
  FormTileApi,
  GridApi,
  LampTileApi,
  MusicTileApi,
  PlanBoardApi,
  RowApi,
  SceneTileApi,
  SplitApi,
  StatTileApi,
  SwitchTileApi,
  TableTileApi,
  TabsApi,
  VisualTileApi,
} from './catalogApi';
import { ROOM_CATALOG_ID, type FormField } from './surfacePlan';
import { createPlanController } from '../plan/controller';
import { createPlanRenderer } from '../plan/renderer';
import type { ViewportHandle } from '../core/controller';
import type { HandSurface } from './handPointer';
import { buildPlanTemplate } from '../plan/templates';
import { sanitizeVisualMarkup } from './visualSanitize';
import { buildVisualDom } from './visualMount';

export class LampTileElement extends A2uiLitElement<typeof LampTileApi> {
  static readonly tagName = 'mc-lamp-tile';
  protected override readonly api = LampTileApi;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 20px; min-height: 180px; display: grid; gap: 12px; background: var(--panel, #FFFFFF); font: 500 20px/1.3 var(--font-sans, system-ui), 'Noto Sans Kannada', sans-serif; color: var(--text, #2B2B2B); }
    .tile.on { border-color: var(--accent, #6B8F71); background: rgb(107 143 113 / 0.08); }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .label { font-size: 24px; font-weight: 600; }
    .state { font-variant-numeric: tabular-nums; }
    button { font: inherit; min-height: 64px; min-width: 120px; border-radius: 12px; border: 2px solid var(--border, #E4E0D8); background: transparent; color: var(--text, #2B2B2B); cursor: pointer; }
    button:focus-visible { outline: 3px solid var(--focus, #5A7BA6); outline-offset: 3px; }
    button.primary { background: var(--action, #C98B3C); border-color: var(--action, #C98B3C); color: #FFFFFF; }
    .meter { height: 14px; border-radius: 7px; background: var(--panel-2, #F1EEE6); overflow: hidden; }
    .meter > i { display: block; height: 100%; background: var(--action, #C98B3C); }
    .pending { color: var(--text-dim, #6E6A63); } .error { color: var(--danger, #B5453A); }
    .sim-badge { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; color: var(--text-dim, #6E6A63); border: 1.5px solid var(--border, #E4E0D8); border-radius: 999px; padding: 2px 8px; }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const on = !!p.on;
    const b = typeof p.brightness === 'number' ? p.brightness : 0;
    return html`<div class="tile ${on ? 'on' : ''}" role="group" aria-label=${String(p.label)}>
      <div class="row"><span class="label">${p.label}</span>
        <span class="state" aria-live="polite">${on ? `On · ${b}%` : 'Off'}</span>
        ${p.sim ? html`<span class="sim-badge" title="Simulated — the WiZ bridge isn't reachable">SIM</span>` : nothing}
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
  private view: ViewportHandle | null = null;
  override createRenderRoot() { return this; }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    // tabindex: the plan's own keys (Esc ends a wall, Delete, V/W/R tool
    // shortcuts, arrows) listen on this element, which could never take focus.
    return html`<div class="mc-plan-board" tabindex="0" aria-label="Floor plan drawing area" style="height:420px;border:2px solid #E4E0D8;border-radius:16px;overflow:hidden;background:#fff;position:relative"></div>`;
  }
  override updated() {
    const p = this.controller?.props;
    const host = this.querySelector<HTMLElement>('.mc-plan-board');
    if (!p || !host) return;
    const key = `${p.boardId}:${p.template}`;
    if (this.mounted === key) return;
    this.mounted = key;
    this.view?.dispose();
    host.innerHTML = '';
    const controller = createPlanController();
    controller.applyGenerated?.({ ops: buildPlanTemplate(p.template) });
    const view = createPlanRenderer(host, controller, () => {});
    this.view = view;
    // Hand parity: the canvas hand pointer only clicks controls, so a pinch on
    // the drawing area itself did nothing (no walls, no select, no move). Expose
    // the plan's own pinch API (the one the old studio fed) as a hand surface.
    let handPan: { x: number; y: number } | null = null;
    let two: { mid: { x: number; y: number }; span: number } | null = null;
    host.dataset.handSurface = '';
    // Read-only seam for walks/tests: the board's plan document.
    (host as HTMLElement & { __mcPlanDoc?: () => unknown }).__mcPlanDoc = () => controller.snapshot();
    (host as HTMLElement & { __mcHandSurface?: HandSurface }).__mcHandSurface = {
      hover: (x, y) => view.hover?.(x, y),
      // Nothing grabbed (Select tool on empty floor) pans the plan, the same
      // as a mouse drag on empty floor.
      beginDrag: (x, y) => {
        host.focus({ preventScroll: true });
        const grabbed = view.beginDrag?.(x, y) ?? false;
        handPan = grabbed ? null : { x, y };
        return grabbed;
      },
      drag: (x, y) => {
        if (handPan) { view.panByPx?.(x - handPan.x, y - handPan.y); handPan = { x, y }; return; }
        view.drag?.(x, y);
      },
      endDrag: () => { if (handPan) { handPan = null; return; } view.endDrag?.(); },
      pinch2: (phase, a, b) => {
        if (phase === 'end' || !a || !b) { two = null; return; }
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const span = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        if (phase === 'start' || !two) { two = { mid, span }; return; }
        // Incremental: zoom about the previous midpoint by the span ratio, then
        // carry that point to the new midpoint — grabbed points track fingers.
        view.zoomAt?.(span / two.span, two.mid.x, two.mid.y);
        view.panByPx?.(mid.x - two.mid.x, mid.y - two.mid.y);
        two = { mid, span };
      },
      tap: (x, y) => {
        host.focus({ preventScroll: true }); // like a mouse press: plan keys (Esc, Delete) work next
        if (view.tap?.(x, y)) return;
        // Same as the old studio's pinch-tap: magnet-aim, then select what's there.
        const id = view.aim?.(x, y)?.id ?? view.pick(x, y);
        if (id) { controller.selectId(id); view.render(); }
      },
    };
    view.render();
    requestAnimationFrame(() => { view.fit?.(); view.render(); });
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.view?.dispose();
    this.view = null;
    this.mounted = null;
  }
}

export class MusicTileElement extends A2uiLitElement<typeof MusicTileApi> {
  static readonly tagName = 'mc-music-tile';
  protected override readonly api = MusicTileApi;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 20px; min-height: 180px; display: grid; gap: 12px; background: var(--panel, #FFFFFF); font: 500 20px/1.3 system-ui, sans-serif; color: var(--text, #2B2B2B); }
    .tile.playing { border-color: var(--accent, #6B8F71); background: rgb(107 143 113 / 0.08); }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .label { font-size: 24px; font-weight: 600; }
    .state { font-variant-numeric: tabular-nums; }
    button { font: inherit; min-height: 64px; min-width: 120px; border-radius: 12px; border: 2px solid var(--border, #E4E0D8); background: transparent; color: var(--text, #2B2B2B); cursor: pointer; }
    button:focus-visible { outline: 3px solid var(--focus, #5A7BA6); outline-offset: 3px; }
    button.primary { background: var(--action, #C98B3C); border-color: var(--action, #C98B3C); color: #FFFFFF; }
    .meter { height: 14px; border-radius: 7px; background: var(--panel-2, #F1EEE6); overflow: hidden; }
    .meter > i { display: block; height: 100%; background: var(--action, #C98B3C); }
    .pending { color: var(--text-dim, #6E6A63); } .error { color: var(--danger, #B5453A); }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const playing = !!p.playing;
    const vol = typeof p.volume === 'number' ? Math.max(0, Math.min(100, Math.round(p.volume))) : 50;
    const track = p.trackTitle ? String(p.trackTitle) : '';
    return html`<div class="tile ${playing ? 'playing' : ''}" role="group" aria-label=${String(p.label)}>
      <div class="row">
        <span class="label">${p.label}</span>
        <span class="state" aria-live="polite">${playing ? 'Playing' : 'Paused'}${track ? ` · ${track}` : ''} · ${vol}%</span>
        ${p.pending ? html`<span class="pending">checking…</span>` : nothing}
      </div>
      <div class="meter" aria-hidden="true"><i style="width:${vol}%"></i></div>
      ${p.error ? html`<div class="error" role="status">${p.error}</div>` : nothing}
      <div class="row">
        <button class="primary" data-act="playpause" @click=${() => p.onPlayPause?.()}>${playing ? 'Pause' : 'Play'}</button>
        <button data-act="softer" @click=${() => p.onSofter?.()}>Softer</button>
        <button data-act="louder" @click=${() => p.onLouder?.()}>Louder</button>
        ${p.onNext ? html`<button data-act="next" @click=${() => p.onNext?.()}>Next</button>` : nothing}
      </div>
    </div>`;
  }
}

export class SwitchTileElement extends A2uiLitElement<typeof SwitchTileApi> {
  static readonly tagName = 'mc-switch-tile';
  protected override readonly api = SwitchTileApi;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 20px; min-height: 180px; display: grid; gap: 12px; background: var(--panel, #FFFFFF); font: 500 20px/1.3 system-ui, sans-serif; color: var(--text, #2B2B2B); }
    .tile.on { border-color: var(--accent, #6B8F71); background: rgb(107 143 113 / 0.08); }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .label { font-size: 24px; font-weight: 600; }
    .state { font-variant-numeric: tabular-nums; }
    button { font: inherit; min-height: 64px; min-width: 120px; border-radius: 12px; border: 2px solid var(--border, #E4E0D8); background: transparent; color: var(--text, #2B2B2B); cursor: pointer; }
    button:focus-visible { outline: 3px solid var(--focus, #5A7BA6); outline-offset: 3px; }
    button.primary { background: var(--action, #C98B3C); border-color: var(--action, #C98B3C); color: #FFFFFF; }
    .pending { color: var(--text-dim, #6E6A63); } .error { color: var(--danger, #B5453A); }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const on = !!p.on;
    return html`<div class="tile ${on ? 'on' : ''}" role="group" aria-label=${String(p.label)}>
      <div class="row">
        <span class="label">${p.label}</span>
        <span class="state" aria-live="polite">${on ? 'On' : 'Off'}</span>
        ${p.pending ? html`<span class="pending">checking…</span>` : nothing}
      </div>
      ${p.error ? html`<div class="error" role="status">${p.error}</div>` : nothing}
      <div class="row">
        <button class="primary" data-act="toggle" @click=${() => p.onToggle?.()}>${on ? 'Turn off' : 'Turn on'}</button>
      </div>
    </div>`;
  }
}

export class SceneTileElement extends A2uiLitElement<typeof SceneTileApi> {
  static readonly tagName = 'mc-scene-tile';
  protected override readonly api = SceneTileApi;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 20px; min-height: 180px; display: grid; gap: 12px; background: var(--panel, #FFFFFF); font: 500 20px/1.3 system-ui, sans-serif; color: var(--text, #2B2B2B); }
    .tile.active { border-color: var(--accent, #6B8F71); background: rgb(107 143 113 / 0.08); }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .label { font-size: 24px; font-weight: 600; }
    .state { font-variant-numeric: tabular-nums; }
    button { font: inherit; min-height: 64px; min-width: 120px; border-radius: 12px; border: 2px solid var(--border, #E4E0D8); background: transparent; color: var(--text, #2B2B2B); cursor: pointer; }
    button:focus-visible { outline: 3px solid var(--focus, #5A7BA6); outline-offset: 3px; }
    button.primary { background: var(--action, #C98B3C); border-color: var(--action, #C98B3C); color: #FFFFFF; }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const active = !!p.active;
    return html`<div class="tile ${active ? 'active' : ''}" role="group" aria-label=${String(p.label)}>
      <div class="row">
        <span class="label">${p.label}</span>
        <span class="state" aria-live="polite">${active ? 'Active' : 'Inactive'}</span>
      </div>
      <div class="row">
        <button class="primary" data-act="activate" @click=${() => p.onActivate?.()}>Activate</button>
      </div>
    </div>`;
  }
}

export class ConnectTileElement extends A2uiLitElement<typeof ConnectTileApi> {
  static readonly tagName = 'mc-connect-tile';
  protected override readonly api = ConnectTileApi;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px dashed var(--border, #E4E0D8); border-radius: 16px; padding: 20px; min-height: 180px; display: grid; gap: 12px; background: var(--panel-2, #F1EEE6); font: 500 20px/1.3 system-ui, sans-serif; color: var(--text, #2B2B2B); align-content: center; justify-items: start; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    button { font: inherit; min-height: 64px; min-width: 140px; border-radius: 12px; border: 2px solid var(--action, #C98B3C); background: var(--action, #C98B3C); color: #FFFFFF; cursor: pointer; }
    button:focus-visible { outline: 3px solid var(--focus, #5A7BA6); outline-offset: 3px; }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const label = p.label ? String(p.label) : 'Connect a device';
    return html`<div class="tile" role="group" aria-label=${label}>
      <div class="row">
        <button class="primary" data-act="connect" @click=${() => p.onConnect?.()}>${label}</button>
      </div>
    </div>`;
  }
}

// ---- layout containers: light DOM (like A2uiColumn above), so a nested
// tree's elements land as real descendants in the plain DOM tree — that's
// what lets canvasApp.ts's Edit-mode discovery (a containment filter, not a
// shadow-root walk) find top-level items regardless of nesting depth. ----

export class RowTileElement extends A2uiLitElement<typeof RowApi> {
  static readonly tagName = 'mc-row';
  protected override readonly api = RowApi;
  override createRenderRoot() { return this; }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const children = Array.isArray(p.children) ? p.children : [];
    this.style.display = 'flex';
    this.style.flexWrap = 'wrap';
    this.style.gap = '16px';
    return html`${children.map((c) => this.renderNode(c as never))}`;
  }
}

export class GridTileElement extends A2uiLitElement<typeof GridApi> {
  static readonly tagName = 'mc-grid';
  protected override readonly api = GridApi;
  override createRenderRoot() { return this; }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const children = Array.isArray(p.children) ? p.children : [];
    const cols = typeof p.columns === 'number' ? p.columns : 2;
    this.style.display = 'grid';
    this.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.style.gap = '16px';
    return html`${children.map((c) => this.renderNode(c as never))}`;
  }
}

export class CardTileElement extends A2uiLitElement<typeof CardApi> {
  static readonly tagName = 'mc-card';
  protected override readonly api = CardApi;
  override createRenderRoot() { return this; }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const children = Array.isArray(p.children) ? p.children : [];
    this.style.display = 'grid';
    this.style.gap = '12px';
    this.style.padding = '16px';
    this.style.border = '2px solid #E4E0D8';
    this.style.borderRadius = '16px';
    this.style.background = '#FFFFFF';
    return html`${p.title ? html`<h3 class="mc-card-title" style="margin:0;color:#2B2B2B;font:600 20px/1.3 system-ui,sans-serif">${p.title}</h3>` : nothing}
      ${children.map((c) => this.renderNode(c as never))}`;
  }
}

export class TabsTileElement extends A2uiLitElement<typeof TabsApi> {
  static readonly tagName = 'mc-tabs';
  protected override readonly api = TabsApi;
  private active = 0;
  override createRenderRoot() { return this; }
  override render() {
    const p = this.controller?.props;
    if (!p || !Array.isArray(p.tabs)) return nothing;
    const tabs = p.tabs as Array<{ label: string; children: string[] }>;
    if (this.active >= tabs.length) this.active = 0;
    return html`<div style="display:grid;gap:16px">
      <div role="tablist" style="display:flex;gap:8px;border-bottom:2px solid #E4E0D8;flex-wrap:wrap">
        ${tabs.map((tab, i) => html`<button
          type="button" role="tab" aria-selected=${i === this.active}
          style="font:inherit;min-height:48px;padding:8px 16px;border:none;border-bottom:3px solid ${i === this.active ? '#C98B3C' : 'transparent'};background:transparent;color:${i === this.active ? '#2B2B2B' : '#6E6A63'};font-weight:${i === this.active ? '700' : '500'};cursor:pointer"
          @click=${() => { this.active = i; this.requestUpdate(); }}>${tab.label}</button>`)}
      </div>
      ${tabs.map((tab, i) => html`<div ?hidden=${i !== this.active} style="display:grid;gap:16px">
        ${tab.children.map((c) => this.renderNode(c as never))}
      </div>`)}
    </div>`;
  }
}

export class SplitTileElement extends A2uiLitElement<typeof SplitApi> {
  static readonly tagName = 'mc-split';
  protected override readonly api = SplitApi;
  override createRenderRoot() { return this; }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const children = Array.isArray(p.children) ? p.children : [];
    const firstCount = typeof p.firstCount === 'number' ? p.firstCount : 0;
    const direction = p.direction === 'column' ? 'column' : 'row';
    const first = children.slice(0, firstCount);
    const second = children.slice(firstCount);
    return html`<div style="display:flex;flex-direction:${direction};gap:16px">
      <div style="flex:1;display:grid;gap:16px;align-content:start">${first.map((c) => this.renderNode(c as never))}</div>
      <div style="flex:1;display:grid;gap:16px;align-content:start">${second.map((c) => this.renderNode(c as never))}</div>
    </div>`;
  }
}

// ---- general-purpose widgets: leaves, default shadow DOM like the device tiles above ----

export class StatTileElement extends A2uiLitElement<typeof StatTileApi> {
  static readonly tagName = 'mc-stat-tile';
  protected override readonly api = StatTileApi;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 20px; min-height: 120px; display: grid; gap: 6px; background: var(--panel, #FFFFFF); font: 500 16px/1.3 system-ui, sans-serif; color: var(--text, #2B2B2B); }
    .label { color: var(--text-dim, #6E6A63); font-size: 15px; }
    .value { font-size: 30px; font-weight: 700; }
    .delta { font-size: 14px; font-weight: 600; }
    .sparkline { width: 100px; height: 24px; }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const trendColor = p.trend === 'up' ? '#6B8F71' : p.trend === 'down' ? '#B5453A' : '#6E6A63';
    const spark = Array.isArray(p.spark) ? (p.spark as number[]) : [];
    const max = Math.max(...spark, 1);
    const min = Math.min(...spark, 0);
    const range = Math.max(max - min, 1);
    const pts = spark.length > 1 ? spark.map((v, i) => `${(i / (spark.length - 1)) * 100},${24 - ((v - min) / range) * 24}`).join(' ') : '';
    return html`<div class="tile" role="group" aria-label=${String(p.label || 'Stat')}>
      <div class="label">${p.label}</div>
      <div class="value">${p.value}</div>
      ${p.delta ? html`<div class="delta" style="color:${trendColor}">${p.trend === 'up' ? '▲' : p.trend === 'down' ? '▼' : ''} ${p.delta}</div>` : nothing}
      ${pts ? html`<svg class="sparkline" viewBox="0 0 100 24" aria-hidden="true"><polyline points=${pts} fill="none" stroke=${trendColor} stroke-width="2" /></svg>` : nothing}
    </div>`;
  }
}

export class ChartTileElement extends A2uiLitElement<typeof ChartTileApi> {
  static readonly tagName = 'mc-chart-tile';
  protected override readonly api = ChartTileApi;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 20px; min-height: 160px; display: grid; gap: 10px; background: var(--panel, #FFFFFF); font: 500 16px/1.3 system-ui, sans-serif; color: var(--text, #2B2B2B); }
    .label { color: var(--text-dim, #6E6A63); font-size: 15px; }
    svg { width: 100%; height: 100px; }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const series = Array.isArray(p.series) ? (p.series as Array<{ label: string; value: number }>) : [];
    const max = Math.max(...series.map((s) => s.value), 1);
    const ariaLabel = series.map((s) => `${s.label}: ${s.value}`).join(', ');
    // Use lit's `svg` tag (not `html`) so <rect>/<circle>/<polyline>
    // actually mint SVG elements. A nested html`` template inside <svg>
    // creates inert HTMLUnknownElements — the bars never paint.
    let shapes = nothing as unknown;
    if (p.chartType === 'ring') {
      const total = series.reduce((a, s) => a + Math.max(s.value, 0), 0) || 1;
      let acc = 0;
      const colors = ['#6B8F71', '#C98B3C', '#5A7BA6', '#6E6A63'];
      const circumference = 2 * Math.PI * 24;
      shapes = svg`${series.map((s, i) => {
        const frac = Math.max(s.value, 0) / total;
        const offset = -acc * circumference;
        acc += frac;
        return svg`<circle cx="30" cy="30" r="24" fill="none" stroke=${colors[i % colors.length]} stroke-width="10" stroke-dasharray=${`${frac * circumference} ${circumference}`} stroke-dashoffset=${offset} />`;
      })}`;
    } else if (p.chartType === 'line') {
      const pts = series.map((s, i) => `${(i / Math.max(series.length - 1, 1)) * 110 + 5},${55 - (s.value / max) * 50}`).join(' ');
      shapes = svg`<polyline points=${pts} fill="none" stroke="#5A7BA6" stroke-width="2" />`;
    } else {
      const barWidth = 100 / Math.max(series.length, 1);
      shapes = svg`${series.map((s, i) => svg`<rect x=${5 + i * barWidth} y=${55 - (s.value / max) * 50} width=${barWidth * 0.7} height=${(s.value / max) * 50} fill="#C98B3C" />
        <text x=${5 + i * barWidth + barWidth * 0.35} y="68" text-anchor="middle" fill="#6E6A63" font-size="7">${s.label.slice(0, 2)}</text>`)}`;
    }
    const viewBox = p.chartType === 'bar' || !p.chartType ? '0 0 120 72' : '0 0 120 60';
    return html`<div class="tile" role="group" aria-label=${String(p.title || 'Chart')}>
      <div class="label">${p.title}</div>
      <svg viewBox=${viewBox} role="img" aria-label=${ariaLabel}>${shapes}</svg>
    </div>`;
  }
}

export class TableTileElement extends A2uiLitElement<typeof TableTileApi> {
  static readonly tagName = 'mc-table-tile';
  protected override readonly api = TableTileApi;
  private sortCol: number | null = null;
  private sortAsc = true;
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 20px; display: grid; gap: 10px; background: var(--panel, #FFFFFF); font: 500 16px/1.3 system-ui, sans-serif; color: var(--text, #2B2B2B); }
    .label { color: var(--text-dim, #6E6A63); font-size: 15px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border, #E4E0D8); }
    button { font: inherit; min-height: 44px; border-radius: 10px; border: 2px solid var(--border, #E4E0D8); background: transparent; color: var(--text, #2B2B2B); cursor: pointer; }
    button.sort { border: none; background: transparent; font-weight: 700; padding: 0; min-height: 32px; }
  `;
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const columns = Array.isArray(p.columns) ? (p.columns as string[]) : [];
    let rows = Array.isArray(p.rows) ? (p.rows as string[][]).slice() : [];
    if (p.sortable && this.sortCol !== null) {
      const col = this.sortCol;
      rows = rows.slice().sort((a, b) => (this.sortAsc ? 1 : -1) * a[col].localeCompare(b[col]));
    }
    return html`<div class="tile" role="group" aria-label=${String(p.title || 'Table')}>
      <div class="label">${p.title}</div>
      <table>
        <thead><tr>
          ${columns.map((colLabel, ci) => html`<th>${p.sortable
            ? html`<button type="button" class="sort" @click=${() => { this.sortAsc = this.sortCol === ci ? !this.sortAsc : true; this.sortCol = ci; this.requestUpdate(); }}>${colLabel}</button>`
            : colLabel}</th>`)}
          ${p.sortable || p.rowActionLabel ? html`<th></th>` : nothing}
        </tr></thead>
        <tbody>
          ${rows.map((row) => html`<tr>
            ${row.map((cell) => html`<td>${cell}</td>`)}
            ${p.rowActionLabel ? html`<td><button type="button" @click=${() => p.onRowAction?.({ metadata: { row } } as never)}>${p.rowActionLabel}</button></td>` : nothing}
          </tr>`)}
        </tbody>
      </table>
    </div>`;
  }
}

export class FormTileElement extends A2uiLitElement<typeof FormTileApi> {
  static readonly tagName = 'mc-form-tile';
  protected override readonly api = FormTileApi;
  private values: Record<string, boolean | number | string> = {};
  static override styles = css`
    :host { display: block; }
    .tile { border: 2px solid var(--border, #E4E0D8); border-radius: 16px; padding: 20px; display: grid; gap: 14px; background: var(--panel, #FFFFFF); font: 500 16px/1.3 system-ui, sans-serif; color: var(--text, #2B2B2B); }
    .label { color: var(--text-dim, #6E6A63); font-size: 15px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
    .fieldLabel { font-weight: 600; }
    input[type="range"] { flex: 1; min-width: 120px; }
    input[type="checkbox"] { width: 24px; height: 24px; }
    button { font: inherit; min-height: 56px; min-width: 100px; border-radius: 12px; border: 2px solid var(--border, #E4E0D8); background: transparent; color: var(--text, #2B2B2B); cursor: pointer; }
    button.choice.active { border-color: var(--accent, #6B8F71); background: rgb(107 143 113 / 0.12); }
    button.primary { background: var(--action, #C98B3C); border-color: var(--action, #C98B3C); color: #FFFFFF; }
    button:focus-visible { outline: 3px solid var(--focus, #5A7BA6); outline-offset: 3px; }
  `;
  private valueFor(f: FormField): boolean | number | string {
    if (f.id in this.values) return this.values[f.id];
    return f.kind === 'toggle' ? !!f.value : f.kind === 'slider' ? (f.value ?? f.min ?? 0) : (f.value ?? f.options?.[0] ?? '');
  }
  private renderControl(f: FormField) {
    if (f.kind === 'toggle') {
      return html`<input type="checkbox" aria-label=${f.label} .checked=${!!this.valueFor(f)} @change=${(e: Event) => { this.values[f.id] = (e.target as HTMLInputElement).checked; this.requestUpdate(); }} />`;
    }
    if (f.kind === 'slider') {
      return html`<input type="range" aria-label=${f.label} min=${f.min ?? 0} max=${f.max ?? 100} .value=${String(this.valueFor(f))} @input=${(e: Event) => { this.values[f.id] = Number((e.target as HTMLInputElement).value); this.requestUpdate(); }} />`;
    }
    return html`<span style="display:flex;gap:8px;flex-wrap:wrap">
      ${f.options.map((opt) => html`<button type="button" class="choice ${this.valueFor(f) === opt ? 'active' : ''}" aria-pressed=${this.valueFor(f) === opt} @click=${() => { this.values[f.id] = opt; this.requestUpdate(); }}>${opt}</button>`)}
    </span>`;
  }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    const fields = Array.isArray(p.fields) ? (p.fields as FormField[]) : [];
    return html`<div class="tile" role="group" aria-label=${String(p.title || 'Form')}>
      <div class="label">${p.title}</div>
      ${fields.map((f) => html`<div class="row">
        <span class="fieldLabel">${f.label}</span>
        ${this.renderControl(f)}
      </div>`)}
      <div class="row">
        <button type="button" class="primary" @click=${() => p.onSubmit?.({ metadata: { values: { ...this.values } } } as never)}>${p.submitLabel || 'Submit'}</button>
      </div>
    </div>`;
  }
}

export class VisualTileElement extends A2uiLitElement<typeof VisualTileApi> {
  static readonly tagName = 'mc-visual-tile';
  protected override readonly api = VisualTileApi;
  private mountedMarkup: string | null = null;
  override createRenderRoot() { return this; }
  override render() {
    const p = this.controller?.props;
    if (!p) return nothing;
    return html`<div class="mc-visual-tile" role="group" aria-label=${String(p.title || 'Visual')} style="border:2px solid #E4E0D8;border-radius:16px;padding:16px;display:grid;gap:10px;background:#FFFFFF;color:#2B2B2B;font:500 16px/1.3 system-ui,sans-serif">
      <div style="color:#6E6A63;font-size:15px">${p.title}</div>
      <div class="mc-visual-frame"></div>
    </div>`;
  }
  override updated() {
    const p = this.controller?.props;
    const frame = this.querySelector<HTMLElement>('.mc-visual-frame');
    if (!p || !frame) return;
    const markup = String(p.markup || '');
    if (this.mountedMarkup === markup) return;
    this.mountedMarkup = markup;
    frame.textContent = '';
    // Never innerHTML, even though `markup` is already sanitized (and
    // sanitized again here, belt and suspenders) — build real DOM nodes one
    // at a time via visualMount.ts, same as the fallback renderer.
    const { nodes } = sanitizeVisualMarkup(markup);
    const doc = {
      createElement: (tag: string) => document.createElement(tag),
      createElementNS: (ns: string, tag: string) => document.createElementNS(ns, tag),
      createTextNode: (text: string) => document.createTextNode(text),
    };
    const built = buildVisualDom(nodes, doc, ({ action, label }) => p.onAction?.({ metadata: { action, label } } as never));
    for (const n of built) frame.appendChild(n as Node);
  }
}

// Same shape as web_core's (internal) toWebComponentImplementation.
export const LampTile = { ...LampTileApi, tagName: LampTileElement.tagName, element: LampTileElement as unknown as CustomElementConstructor };
export const PlanBoard = { ...PlanBoardApi, tagName: PlanBoardElement.tagName, element: PlanBoardElement as unknown as CustomElementConstructor };
export const MusicTile = { ...MusicTileApi, tagName: MusicTileElement.tagName, element: MusicTileElement as unknown as CustomElementConstructor };
export const SwitchTile = { ...SwitchTileApi, tagName: SwitchTileElement.tagName, element: SwitchTileElement as unknown as CustomElementConstructor };
export const SceneTile = { ...SceneTileApi, tagName: SceneTileElement.tagName, element: SceneTileElement as unknown as CustomElementConstructor };
export const ConnectTile = { ...ConnectTileApi, tagName: ConnectTileElement.tagName, element: ConnectTileElement as unknown as CustomElementConstructor };
export const RowTile = { ...RowApi, tagName: RowTileElement.tagName, element: RowTileElement as unknown as CustomElementConstructor };
export const GridTile = { ...GridApi, tagName: GridTileElement.tagName, element: GridTileElement as unknown as CustomElementConstructor };
export const CardTile = { ...CardApi, tagName: CardTileElement.tagName, element: CardTileElement as unknown as CustomElementConstructor };
export const TabsTile = { ...TabsApi, tagName: TabsTileElement.tagName, element: TabsTileElement as unknown as CustomElementConstructor };
export const SplitTile = { ...SplitApi, tagName: SplitTileElement.tagName, element: SplitTileElement as unknown as CustomElementConstructor };
export const StatTile = { ...StatTileApi, tagName: StatTileElement.tagName, element: StatTileElement as unknown as CustomElementConstructor };
export const ChartTile = { ...ChartTileApi, tagName: ChartTileElement.tagName, element: ChartTileElement as unknown as CustomElementConstructor };
export const TableTile = { ...TableTileApi, tagName: TableTileElement.tagName, element: TableTileElement as unknown as CustomElementConstructor };
export const FormTile = { ...FormTileApi, tagName: FormTileElement.tagName, element: FormTileElement as unknown as CustomElementConstructor };
export const VisualTile = { ...VisualTileApi, tagName: VisualTileElement.tagName, element: VisualTileElement as unknown as CustomElementConstructor };

export const smartCanvasCatalog = new Catalog(ROOM_CATALOG_ID, '0.9', [
  A2uiColumn,
  A2uiText,
  LampTile,
  PlanBoard,
  MusicTile,
  SwitchTile,
  SceneTile,
  ConnectTile,
  RowTile,
  GridTile,
  CardTile,
  TabsTile,
  SplitTile,
  StatTile,
  ChartTile,
  TableTile,
  FormTile,
  VisualTile,
] as never);
