// Built-in demo: "find me references for drawings". Fixture pictures so the
// judge path and the sim screenshot work without a network. The recipe is a
// valid Recipe so it can be taught, listed, and replayed as "do drawing references".

import type { Recipe } from '../recipes/model';
import type { RefHit, SearchPage } from './types';

function svgThumb(bg: string, label: string, emoji: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">` +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="50%" y="46%" text-anchor="middle" font-size="72">${emoji}</text>` +
    `<text x="50%" y="78%" text-anchor="middle" font-size="28" fill="#f2f0ea" ` +
    `font-family="Georgia,serif">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const FIXTURES: ReadonlyArray<Omit<RefHit, 'id'> & { id?: string }> = [
  { title: 'Line studies', creator: 'Mendcraft demo', source: 'Openverse', license: 'CC0',
    pageUrl: 'https://openverse.org/', fullUrl: '', thumbUrl: '', credit: '' },
  { title: 'Hand sketches', creator: 'Mendcraft demo', source: 'Wikimedia Commons', license: 'Public domain',
    pageUrl: 'https://wikimedia.org/', fullUrl: '', thumbUrl: '', credit: '' },
  { title: 'Flower study', creator: 'Mendcraft demo', source: 'Openverse', license: 'CC BY 4.0',
    pageUrl: 'https://openverse.org/', fullUrl: '', thumbUrl: '', credit: '' },
  { title: 'Bird in flight', creator: 'Mendcraft demo', source: 'Wikimedia Commons', license: 'Public domain',
    pageUrl: 'https://wikimedia.org/', fullUrl: '', thumbUrl: '', credit: '' },
  { title: 'Still life fruit', creator: 'Mendcraft demo', source: 'Openverse', license: 'CC BY-SA 4.0',
    pageUrl: 'https://openverse.org/', fullUrl: '', thumbUrl: '', credit: '' },
  { title: 'Portrait lighting', creator: 'Mendcraft demo', source: 'Wikimedia Commons', license: 'CC BY 3.0',
    pageUrl: 'https://wikimedia.org/', fullUrl: '', thumbUrl: '', credit: '' },
  { title: 'Tree silhouettes', creator: 'Mendcraft demo', source: 'Openverse', license: 'CC0',
    pageUrl: 'https://openverse.org/', fullUrl: '', thumbUrl: '', credit: '' },
];

const COLORS = ['#3f3a7a', '#1f4a3d', '#7a3a3a', '#1e3a5f', '#5a3d1e', '#3a1e5a', '#1e5a4a'];
const EMOJI = ['✏️', '🤚', '🌸', '🕊️', '🍋', '🎭', '🌳'];

/** Seven fixture reference pictures (SVG data URLs — no network). */
export function fixtureHits(): RefHit[] {
  return FIXTURES.map((f, i) => {
    const thumb = svgThumb(COLORS[i], f.title, EMOJI[i]);
    const credit = `${f.title} · by ${f.creator} · ${f.license} · ${f.source}`;
    return { ...f, id: `demo:${i + 1}`, thumbUrl: thumb, fullUrl: thumb, credit };
  });
}

export function fixtureSearch(query: string, page = 1): SearchPage {
  return { query: query.trim() || 'drawings', page, hits: fixtureHits(), hasMore: page < 2 };
}

export const DRAWING_REFERENCES_RECIPE: Recipe = {
  id: 'demo-drawing-references',
  name: 'Drawing references',
  aliases: ['find drawing references', 'drawing references', 'find me references for drawings'],
  language: 'en',
  device: 'designer',
  mode: 'plan',
  taughtBy: 'mendcraft',
  steps: [{ op: { op: 'search_references', query: 'drawings' } }],
  createdAt: 0,
  updatedAt: 0,
};

/** True when a taught or demo recipe should open the on-canvas reference search. */
export function isReferenceRecipe(recipe: { id?: string; steps?: Array<{ op?: Record<string, unknown> }> }): boolean {
  if (recipe.id === DRAWING_REFERENCES_RECIPE.id) return true;
  const op = recipe.steps?.[0]?.op;
  return !!op && op.op === 'search_references';
}

export function recipeSearchQuery(recipe: { steps?: Array<{ op?: Record<string, unknown> }> }): string {
  const q = recipe.steps?.[0]?.op?.query;
  return typeof q === 'string' && q.trim() ? q.trim() : 'drawings';
}
