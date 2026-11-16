import { describe, expect, it } from 'vitest';
import { validateRecipe } from '../src/recipes/model';
import { DEFAULT_PINCH_ON, pinchGapRatio } from '../src/input/handLogic';
import { OPEN, PINCH, POINT, place } from './helpers/hands';
import {
  parseReferenceIntent,
  parsePickNumber,
  topicLooksFuzzy,
  parseRefinedQuery,
  pageItems,
  layoutGrid,
  snapHover,
  itemByIndex,
  stepHover,
  searchReferences,
  mergeHits,
  webSearchUrl,
  OPENVERSE_API,
  WIKIMEDIA_API,
  fixtureHits,
  fixtureSearch,
  DRAWING_REFERENCES_RECIPE,
  isReferenceRecipe,
  recipeSearchQuery,
  stepRefGestures,
  emptyRefGestureState,
  isPinching,
  isOpenPalm,
  WEB_SEARCH_ID,
  type RefHit,
  type GridBox,
} from '../src/references';

describe('intent parsing', () => {
  it('parses find / show / references-for search phrases', () => {
    expect(parseReferenceIntent('find me references for drawings')).toEqual({
      type: 'search', query: 'drawings', raw: 'find me references for drawings', fuzzy: false,
    });
    expect(parseReferenceIntent('show me pictures of a sitting cat')?.query).toBe('sitting cat');
    expect(parseReferenceIntent('references for flower studies')?.query).toBe('flower studies');
    expect(parseReferenceIntent('find me references for drawings!')?.query).toBe('drawings');
  });

  it('recognises the drawing-references demo phrase', () => {
    expect(parseReferenceIntent('do drawing references')?.query).toBe('drawings');
    expect(parseReferenceIntent('drawing references')?.query).toBe('drawings');
  });

  it('does not steal designer or music phrases when the grid is closed', () => {
    expect(parseReferenceIntent('next')).toBeNull();
    expect(parseReferenceIntent('the second one')).toBeNull();
    expect(parseReferenceIntent('make this wall 4 meters')).toBeNull();
    expect(parseReferenceIntent('play some old Kannada songs')).toBeNull();
    expect(parseReferenceIntent('close')).toBeNull();
  });

  it('navigates, picks by number, places, and closes only while the grid is open', () => {
    const ctx = { gridOpen: true };
    expect(parseReferenceIntent('more', ctx)?.type).toBe('more');
    expect(parseReferenceIntent('next page', ctx)?.type).toBe('more');
    expect(parseReferenceIntent('previous page', ctx)?.type).toBe('prevPage');
    expect(parseReferenceIntent('the second one', ctx)).toEqual({ type: 'pick', index: 2 });
    expect(parseReferenceIntent('number three', ctx)).toEqual({ type: 'pick', index: 3 });
    expect(parseReferenceIntent('pick this', ctx)?.type).toBe('pickHover');
    expect(parseReferenceIntent('place it', ctx)?.type).toBe('place');
    expect(parseReferenceIntent('bigger', ctx)?.type).toBe('bigger');
    expect(parseReferenceIntent('close references', ctx)?.type).toBe('close');
    expect(parseReferenceIntent('search on the web', ctx)?.type).toBe('webSearch');
    expect(parseReferenceIntent('next', ctx)?.type).toBe('next');
  });

  it('parses ordinals and bare numbers', () => {
    expect(parsePickNumber('the first one')).toBe(1);
    expect(parsePickNumber('2nd')).toBe(2);
    expect(parsePickNumber('number 7')).toBe(7);
    expect(parsePickNumber('the last one')).toBe(-1);
    expect(parsePickNumber('hello')).toBeNull();
  });

  it('treats non-English reference keywords as a fuzzy search', () => {
    const kn = parseReferenceIntent('ಚಿತ್ರಗಳ ಉಲ್ಲೇಖ ತೋರಿಸು');
    expect(kn?.type).toBe('search');
    expect(kn && kn.type === 'search' && kn.fuzzy).toBe(true);
    const es = parseReferenceIntent('busca referencias de flores');
    expect(es?.type).toBe('search');
  });

  it('marks vague topics as fuzzy so Gemini can refine them', () => {
    expect(topicLooksFuzzy('drawings')).toBe(false);
    expect(topicLooksFuzzy('something like those flowers')).toBe(true);
  });
});

describe('query refinement parsing', () => {
  it('reads a JSON query from a model reply', () => {
    expect(parseRefinedQuery('{"query":"pencil drawing of a hand"}')).toBe('pencil drawing of a hand');
    expect(parseRefinedQuery('```json\n{"query":"lotus flower study"}\n```')).toBe('lotus flower study');
  });

  it('falls back to the first line and rejects empty replies', () => {
    expect(parseRefinedQuery('hand sketches')).toBe('hand sketches');
    expect(parseRefinedQuery('   ')).toBeNull();
  });
});

function hit(partial: Partial<RefHit> & { id: string; title: string }): RefHit {
  return {
    thumbUrl: 'https://example.com/t.jpg',
    fullUrl: 'https://example.com/f.jpg',
    pageUrl: 'https://example.com/p',
    creator: 'Ada',
    source: 'Openverse',
    license: 'CC BY 4.0',
    credit: 'Ada · CC BY 4.0 · Openverse',
    ...partial,
  };
}

describe('grid navigation', () => {
  const items = pageItems([
    hit({ id: 'a', title: 'A' }),
    hit({ id: 'b', title: 'B' }),
    hit({ id: 'c', title: 'C' }),
    hit({ id: 'd', title: 'D' }),
    hit({ id: 'e', title: 'E' }),
    hit({ id: 'f', title: 'F' }),
    hit({ id: 'g', title: 'G' }),
  ]);

  it('shows about 8 large numbered targets including Search on the web', () => {
    expect(items).toHaveLength(8);
    expect(items[0].index).toBe(1);
    expect(items[6].id).toBe('g');
    expect(items[7]).toMatchObject({ id: WEB_SEARCH_ID, kind: 'web', index: 8 });
  });

  it('lays out a well-spaced 2×4 grid of large cards', () => {
    const boxes = layoutGrid(items, 1200, 800);
    expect(boxes).toHaveLength(8);
    expect(boxes[0].w).toBeGreaterThanOrEqual(140);
    expect(boxes[0].h).toBeGreaterThanOrEqual(160);
    const gapX = boxes[1].x - (boxes[0].x + boxes[0].w);
    expect(gapX).toBeGreaterThanOrEqual(20);
  });

  it('snaps the hover cursor onto the nearest card', () => {
    const boxes = layoutGrid(items, 1200, 800);
    const b = boxes[2];
    expect(snapHover(b.x + b.w / 2, b.y + b.h / 2, boxes)).toBe(b.id);
    expect(snapHover(b.x - 10, b.y + b.h / 2, boxes)).toBe(b.id);
    expect(snapHover(0, 0, boxes, 8)).toBeNull();
  });

  it('picks a card by number, including the last one', () => {
    expect(itemByIndex(items, 2)?.id).toBe('b');
    expect(itemByIndex(items, 8)?.id).toBe(WEB_SEARCH_ID);
    expect(itemByIndex(items, -1)?.id).toBe(WEB_SEARCH_ID);
    expect(itemByIndex(items, 99)).toBeNull();
  });

  it('steps hover to the next and previous card, wrapping around', () => {
    expect(stepHover(null, items, 1)).toBe('a');
    expect(stepHover('a', items, 1)).toBe('b');
    expect(stepHover(WEB_SEARCH_ID, items, 1)).toBe('a');
    expect(stepHover('a', items, -1)).toBe(WEB_SEARCH_ID);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('search (mocked fetch)', () => {
  it('calls Openverse and Wikimedia and merges licensed hits', async () => {
    const seen: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('api.openverse.org')) {
        return jsonResponse({
          result_count: 1, page_count: 3, page: 1, page_size: 7,
          results: [{
            id: 'ov1', title: 'Tiger drawing', url: 'https://ex.test/tiger.jpg',
            thumbnail: 'https://ex.test/tiger-t.jpg', creator: 'onlypencil',
            license: 'by-nc-nd', license_version: '2.0',
            foreign_landing_url: 'https://ex.test/tiger',
            attribution: '"Tiger drawing" by onlypencil is licensed under CC BY-NC-ND 2.0.',
          }],
        });
      }
      if (url.includes('commons.wikimedia.org')) {
        return jsonResponse({
          query: {
            pages: {
              '1': {
                pageid: 1, title: 'File:Hand study.jpg', index: 1,
                imageinfo: [{
                  url: 'https://upload.wikimedia.org/hand.jpg',
                  thumburl: 'https://upload.wikimedia.org/hand-t.jpg',
                  mime: 'image/jpeg',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Hand_study.jpg',
                  extmetadata: {
                    Artist: { value: '<a href="https://ex.test">Ada</a>' },
                    LicenseShortName: { value: 'Public domain' },
                  },
                }],
              },
            },
          },
        });
      }
      return jsonResponse({}, 404);
    };

    const page = await searchReferences('drawings', 1, { fetch: fetchMock });
    expect(seen.some((u) => u.startsWith(OPENVERSE_API))).toBe(true);
    expect(seen.some((u) => u.startsWith(WIKIMEDIA_API))).toBe(true);
    expect(page.hits).toHaveLength(2);
    expect(page.hits[0].source).toBe('Openverse');
    expect(page.hits[0].license).toContain('CC');
    expect(page.hits[1].source).toBe('Wikimedia Commons');
    expect(page.hits[1].license).toBe('Public domain');
    expect(page.hits[1].creator).toBe('Ada');
    expect(page.hasMore).toBe(true);
  });

  it('survives one source failing', async () => {
    const fetchMock: typeof fetch = async (input) => {
      if (String(input).includes('openverse')) return jsonResponse({}, 500);
      return jsonResponse({
        query: {
          pages: {
            '2': {
              pageid: 2, title: 'File:Lotus.jpg', index: 1,
              imageinfo: [{
                url: 'https://upload.wikimedia.org/lotus.jpg',
                thumburl: 'https://upload.wikimedia.org/lotus-t.jpg',
                mime: 'image/jpeg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lotus.jpg',
                extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Lee' } },
              }],
            },
          },
        },
      });
    };
    const page = await searchReferences('lotus', 1, { fetch: fetchMock });
    expect(page.hits).toHaveLength(1);
    expect(page.hits[0].title).toBe('Lotus');
  });

  it('dedupes overlapping titles when merging', () => {
    const a = [hit({ id: '1', title: 'Same', creator: 'Ada' })];
    const b = [hit({ id: '2', title: 'Same', creator: 'Ada', source: 'Wikimedia Commons' })];
    expect(mergeHits(a, b, 7)).toHaveLength(1);
  });

  it('builds a full-page Openverse search URL', () => {
    expect(webSearchUrl('hand sketches')).toContain('openverse.org/search');
    expect(webSearchUrl('hand sketches')).toContain('hand%20sketches');
  });
});

describe('demo recipe and fixtures', () => {
  it('validates the built-in drawing-references recipe', () => {
    const v = validateRecipe(DRAWING_REFERENCES_RECIPE);
    expect(v.ok).toBe(true);
    expect(isReferenceRecipe(DRAWING_REFERENCES_RECIPE)).toBe(true);
    expect(recipeSearchQuery(DRAWING_REFERENCES_RECIPE)).toBe('drawings');
  });

  it('has seven fixture pictures with source and licence', () => {
    const hits = fixtureHits();
    expect(hits).toHaveLength(7);
    expect(hits.every((h) => h.license && h.source && h.credit && h.thumbUrl.startsWith('data:image/svg'))).toBe(true);
    expect(fixtureSearch('drawings').hits).toHaveLength(7);
  });
});

describe('pinch-select with synthetic landmarks', () => {
  const items = pageItems(fixtureHits());
  const boxes: GridBox[] = layoutGrid(items, 1000, 700);

  function toLandmarks(pose: ReturnType<typeof OPEN>, box: GridBox): ReturnType<typeof place> {
    // Landmarks in canvas pixels: place the hand so the pinch point sits on the card.
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return place(pose(), cx, cy, 80);
  }

  it('treats a thumb-index close as a pinch', () => {
    expect(isPinching(PINCH())).toBe(true);
    expect(pinchGapRatio(PINCH())).toBeLessThan(DEFAULT_PINCH_ON);
    expect(isPinching(POINT())).toBe(false);
    expect(isOpenPalm(OPEN())).toBe(true);
    expect(isOpenPalm(PINCH())).toBe(false);
  });

  it('selects the hovered card on a pinch tap over it', () => {
    const box = boxes[2];
    const pointer = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    let state = emptyRefGestureState();
    const hover = stepRefGestures(state, { landmarks: toLandmarks(POINT, box), pointer, now: 0, boxes });
    expect(hover.events.some((e) => e.type === 'hover' && e.id === box.id)).toBe(true);
    state = hover.state;
    state = stepRefGestures(state, { landmarks: toLandmarks(PINCH, box), pointer, now: 80, boxes }).state;
    const up = stepRefGestures(state, { landmarks: toLandmarks(POINT, box), pointer, now: 160, boxes });
    expect(up.events.some((e) => e.type === 'select' && e.id === box.id)).toBe(true);
    expect(up.state.selectedId).toBe(box.id);
  });

  it('closes the grid when an open palm is held', () => {
    const box = boxes[0];
    const pointer = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const lm = toLandmarks(OPEN, box);
    let state = emptyRefGestureState();
    state = stepRefGestures(state, { landmarks: lm, pointer, now: 0, boxes }).state;
    const held = stepRefGestures(state, { landmarks: lm, pointer, now: 450, boxes });
    expect(held.events.some((e) => e.type === 'close')).toBe(true);
  });

  it('does not select when the pinch happens far from every card', () => {
    const pointer = { x: 2, y: 2 };
    let state = emptyRefGestureState();
    state = stepRefGestures(state, { landmarks: place(PINCH(), 2, 2, 10), pointer, now: 0, boxes, snapRadius: 4 }).state;
    const up = stepRefGestures(state, { landmarks: place(POINT(), 2, 2, 10), pointer, now: 80, boxes, snapRadius: 4 });
    expect(up.events.some((e) => e.type === 'select')).toBe(false);
  });
});
