// Small yellow hand icons for the gesture badges (≈20 px). One inline SVG per
// fixed shape; the moving part (thumb / raised fingers) is its own group so
// CSS can animate just that (and stop it under prefers-reduced-motion).

import type { FixedShape } from './gestureHold';
import type { HandSide } from './handShape';

const FILL = '#FFC83D';
const INK = '#2B2B2B';
const S = `fill="${FILL}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"`;

/** Curled-finger fist block (knuckles to the right of the thumb). */
const FIST = `<rect x="6" y="8.5" width="14" height="13.5" rx="3.5" ${S}/>`
  + `<path d="M10.5 12.8h9.5M10.5 17.2h9.5" stroke="${INK}" stroke-width="1.3" stroke-linecap="round" fill="none"/>`;
const PALM = `<rect x="4.5" y="12" width="15" height="10.5" rx="3.5" ${S}/>`;
const finger = (x: number, y: number, h: number, rot = 0) =>
  `<rect x="${x}" y="${y}" width="4.4" height="${h}" rx="2.2" ${S}${rot ? ` transform="rotate(${rot} ${x + 2.2} ${y + h})"` : ''}/>`;

function body(shape: FixedShape): string {
  switch (shape) {
    case 'thumbsUp':
      return `<g class="mc-gi-move">${finger(5.8, 0.8, 11)}</g>${FIST}`;
    case 'thumbsDown':
      return `<g transform="rotate(180 12 12)"><g class="mc-gi-move">${finger(5.8, 0.8, 11)}</g>${FIST}</g>`;
    case 'one':
      return `<g class="mc-gi-move">${finger(6, 0.8, 13)}</g>${PALM}`;
    case 'peace':
      return `<g class="mc-gi-move">${finger(5.2, 1.5, 12.5, -12)}${finger(11.4, 1, 13, 12)}</g>${PALM}`;
    case 'three':
      return `<g class="mc-gi-move">${finger(4.7, 2, 12)}${finger(9.8, 0.8, 13)}${finger(14.9, 2, 12)}</g>${PALM}`;
  }
}

/** Inline SVG (decorative: aria-hidden) for a shape. */
export function handIconSvg(shape: FixedShape): string {
  return `<svg class="mc-gi mc-gi-${shape}" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">${body(shape)}</svg>`;
}

/** The side mark under the icon: L, R, or L+R for two hands. */
export function sideMark(side: HandSide | '2'): string {
  return side === '2' ? 'L+R' : side;
}
