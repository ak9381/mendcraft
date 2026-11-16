// Picture-reference search: shared types. Pure data, no DOM, no network.

export type RefSource = 'Openverse' | 'Wikimedia Commons' | 'Google Images' | 'Pinterest' | 'Gemini';

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

export type SearchEngine = 'google' | 'pinterest';
export type GenerateKind = 'drawing' | 'layout';
export type RefPath = 'search' | 'generate';

export type SearchIntent = {
  type: 'search';
  query: string;
  raw: string;
  fuzzy: boolean;
  engine: SearchEngine;
  preferred: RefPath;
  generateKind: GenerateKind;
  /** She already named the path (e.g. “on Pinterest”, “draw me”, “generate”). */
  explicit: boolean;
};

export type ReferenceIntent =
  | SearchIntent
  | { type: 'chooseSearch' }
  | { type: 'chooseGenerate' }
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
  /** A real Google Images / Pinterest tab is being driven hands-free. */
  browserOpen?: boolean;
  /** The Search vs Generate chooser is on the canvas. */
  chooserOpen?: boolean;
  /** A card or a placed image is selected. */
  hasSelection?: boolean;
}
