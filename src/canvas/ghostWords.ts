// What the draft (ghost) preview calls each tile while a reply streams in.
// Every tile type says what it really is: a devices table drafts as
// "Devices table", never as an unrelated "Floor plan" placeholder (live
// finding, 27 Nov: "show my devices" drafted a Floor plan tile).

import type { TileSpec } from './surfacePlan';

export interface GhostWords {
  /** The short kind word (first fill stage, the swarm cursor names). */
  kind: string;
  /** The full label (second fill stage). Plain text: the caller escapes it. */
  full: string;
}

const named = (kind: string, name: string | undefined): GhostWords => {
  const n = (name ?? '').trim();
  return { kind, full: n ? `${kind} · ${n}` : kind };
};

export function ghostWords(t: TileSpec): GhostWords {
  switch (t.type) {
    case 'lamp': return named('Lamp', t.label);
    case 'music': return named('Music', t.label);
    case 'switch': return named('Switch', t.label);
    case 'scene': return named('Scene', t.label);
    case 'connect': return { kind: 'Connect', full: 'Connect a device' };
    case 'gimbal': return named('Stand', t.label);
    case 'plan': return { kind: 'Plan', full: 'Floor plan' };
    case 'stat': return named('Stat', t.label);
    case 'chart': return named('Chart', t.title);
    case 'table': return t.source === 'devices' ? named('Devices table', t.title) : named('Table', t.title);
    case 'form': return named('Form', t.title);
    case 'visual': return named('Visual', t.title);
    case 'card': return named('Card', t.title);
    case 'row': case 'grid': case 'tabs': case 'split': return { kind: 'Group', full: 'Group of tiles' };
    default: {
      // A type added later still drafts as a neutral tile, never as another kind.
      const _never: never = t;
      void _never;
      return { kind: 'Tile', full: 'Tile' };
    }
  }
}

/** The tiles the draft shows: containers (a card, a row, tabs…) open up to
 *  the tiles they hold, so a card around a devices table drafts the table. */
export function ghostLeaves(tiles: readonly TileSpec[], max = 24): TileSpec[] {
  const out: TileSpec[] = [];
  const walk = (list: readonly TileSpec[]): void => {
    for (const t of list) {
      if (out.length >= max) return;
      switch (t.type) {
        case 'row': case 'grid': case 'card': walk(t.children); break;
        case 'tabs': for (const tab of t.tabs) walk(tab.children); break;
        case 'split': walk(t.first); walk(t.second); break;
        default: out.push(t);
      }
    }
  };
  walk(tiles);
  return out;
}
