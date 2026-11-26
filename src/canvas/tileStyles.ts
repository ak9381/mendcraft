// The shared look of every device tile and its discrete controls (the Lit
// side). Its own module so the tile elements and widgets.ts (which registers
// them in the catalog) can both import it without an import cycle;
// widgets.ts re-exports it.
import { css } from 'lit';

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
