// Picture-reference search: shared types. Pure data, no DOM, no network.

export type RefSource = 'Openverse' | 'Wikimedia Commons';

export interface RefHit {
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
  pageUrl: string;
  creator: string;
  source: RefSource;
  license: string;
  credit: string;
}

export const WEB_SEARCH_ID = 'web-search';

export interface GridItem {
  id: string;
  /** 1-based number shown on the card. The web-search card is last. */
  index: number;
  kind: 'image' | 'web';
  hit?: RefHit;
}

export interface GridBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedRef {
  id: string;
  hit: RefHit;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SearchPage {
  query: string;
  page: number;
  hits: RefHit[];
  hasMore: boolean;
}

export type ReferenceIntent =
  | { type: 'search'; query: string; raw: string; fuzzy: boolean }
  | { type: 'more' }
  | { type: 'prevPage' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'pick'; index: number }
  | { type: 'pickHover' }
  | { type: 'place' }
  | { type: 'bigger' }
  | { type: 'smaller' }
  | { type: 'close' }
  | { type: 'webSearch' };

export interface IntentContext {
  /** The numbered grid is on the canvas. */
  gridOpen?: boolean;
  /** A card or a placed image is selected. */
  hasSelection?: boolean;
}
