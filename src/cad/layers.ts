// Layer visibility for the plan view (a VIEW setting — the drawing itself is
// untouched, so hiding a layer is never a change in the log).

import type { PlanDoc } from '../plan/doc';
import { fixtureSpec } from '../plan/fixtures';

export const LAYERS = ['furniture', 'stairs', 'structure', 'openings', 'dims', 'text'] as const;
export type LayerId = (typeof LAYERS)[number];

export const LAYER_LABEL: Record<LayerId, string> = {
  furniture: 'Furniture and fittings', stairs: 'Stairs', structure: 'Columns',
  openings: 'Doors and windows', dims: 'Dimensions', text: 'Notes and labels',
};

export function isLayerId(v: unknown): v is LayerId {
  return typeof v === 'string' && (LAYERS as readonly string[]).includes(v);
}

/** "hide the furniture" → 'furniture', "dimensions" → 'dims'. */
export function layerFromWords(text: string): LayerId | null {
  const t = text.toLowerCase();
  if (/\b(furniture|fittings|fixtures|sofa|bed)s?\b/.test(t)) return 'furniture';
  if (/\bstair/.test(t)) return 'stairs';
  if (/\bcolumns?\b/.test(t)) return 'structure';
  if (/\b(doors?|windows?|openings?)\b/.test(t)) return 'openings';
  if (/\b(dims?|dimensions?|measurements?)\b/.test(t)) return 'dims';
  if (/\b(text|notes?|labels?|legend)\b/.test(t)) return 'text';
  return null;
}

/** The doc the renderer draws: hidden layers filtered out. */
export function filterLayers(doc: PlanDoc, hidden: ReadonlySet<LayerId>): PlanDoc {
  if (hidden.size === 0) return doc;
  return {
    ...doc,
    openings: hidden.has('openings') ? [] : doc.openings,
    dims: hidden.has('dims') ? [] : doc.dims,
    texts: hidden.has('text') ? [] : doc.texts,
    fixtures: doc.fixtures.filter((f) => {
      if (f.kind.includes('stair')) return !hidden.has('stairs');
      const g = fixtureSpec(f.kind).group;
      if (g === 'structure') return !hidden.has('structure');
      return !hidden.has('furniture');
    }),
  };
}
