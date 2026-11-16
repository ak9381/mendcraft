import { describe, expect, it } from 'vitest';
import { installMiniDom } from './helpers/minidom';
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
  googleImagesUrl,
  pinterestSearchUrl,
  searchPageUrl,
  bestImageUrl,
  collectResultImages,
  applyRefsCommand,
  emptyOverlay,
  pickByNumber,
  sanitizeSvg,
  parseGeneratedOptions,
  generatedToHits,
  fixtureGenerated,
  createReferenceBoard,
  makeSearch,
  type RefHit,
  type GridBox,
} from '../src/references';

describe('intent parsing', () => {
  it('parses find / show / references-for search phrases', () => {
    expect(parseReferenceIntent('find me references for drawings')).toEqual({
      type: 'search', query: 'drawings', raw: 'find me references for drawings', fuzzy: false,
      engine: 'google', preferred: 'search', generateKind: 'drawing', explicit: false,
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

describe('real-browser search vs generate path', () => {
  it('defaults photos / references to search, and inspirations / mockups to generate', () => {
    const photos = parseReferenceIntent('find me references for drawings');
    expect(photos).toMatchObject({ preferred: 'search', engine: 'google', explicit: false, query: 'drawings' });
    const cat = parseReferenceIntent('show me pictures of a sitting cat');
    expect(cat).toMatchObject({ preferred: 'search', query: 'sitting cat' });
    const insp = parseReferenceIntent('find me landing page inspirations for an AI company');
    expect(insp).toMatchObject({
      preferred: 'generate', generateKind: 'layout', query: 'ai company', explicit: false,
    });
    const mock = parseReferenceIntent('show me mockups of a meditation app');
    expect(mock).toMatchObject({ preferred: 'generate', generateKind: 'layout' });
  });

  it('treats “draw me a reference of …” as a Gemini drawing, not a web search', () => {
    const d = parseReferenceIntent('draw me a reference of a hand holding a cup');
    expect(d).toMatchObject({
      type: 'search', query: 'hand holding a cup', preferred: 'generate',
      generateKind: 'drawing', explicit: true,
    });
    expect(parseReferenceIntent('sketch me a pose reference of a sitting figure')).toMatchObject({
      preferred: 'generate', generateKind: 'drawing', explicit: true,
    });
  });

  it('opens Pinterest when she says “on Pinterest”, otherwise Google Images', () => {
    const pin = parseReferenceIntent('find me references for mid-century chairs on Pinterest');
    expect(pin).toMatchObject({ engine: 'pinterest', query: 'mid-century chairs', preferred: 'search' });
    expect(searchPageUrl(pin!.query, pin!.engine)).toBe(pinterestSearchUrl('mid-century chairs'));
    expect(googleImagesUrl('drawings')).toContain('google.com/search');
    expect(googleImagesUrl('drawings')).toContain('q=drawings');
    expect(parseReferenceIntent('show me pictures of lamps on Google')?.engine).toBe('google');
  });

  it('chooser phrases only match while the two-option card is open', () => {
    expect(parseReferenceIntent('search')).toBeNull();
    expect(parseReferenceIntent('generate')).toBeNull();
    expect(parseReferenceIntent('search', { chooserOpen: true })?.type).toBe('chooseSearch');
    expect(parseReferenceIntent('generate', { chooserOpen: true })?.type).toBe('chooseGenerate');
    expect(parseReferenceIntent('the second one', { chooserOpen: true })?.type).toBe('chooseGenerate');
    expect(parseReferenceIntent('number one', { chooserOpen: true })?.type).toBe('chooseSearch');
  });

  it('lets her drive a real-browser tab with next page, number 3, and close', () => {
    const ctx = { browserOpen: true };
    expect(parseReferenceIntent('next page', ctx)?.type).toBe('more');
    expect(parseReferenceIntent('number 3', ctx)).toEqual({ type: 'pick', index: 3 });
    expect(parseReferenceIntent('close', ctx)?.type).toBe('close');
    expect(parseReferenceIntent('number 3')).toBeNull();
  });
});

describe('extension overlay: numbered badges and pick', () => {
  const boxes = [
    { src: 'https://cdn.example/a.jpg', title: 'A', x: 10, y: 10, w: 200, h: 200 },
    { src: 'https://cdn.example/b.jpg', href: 'https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example%2Ffull-b.jpg', title: 'B', x: 220, y: 10, w: 200, h: 200 },
    { src: 'https://cdn.example/icon.png', title: 'icon', x: 10, y: 10, w: 16, h: 16 },
  ];

  it('numbers visible image results and skips tiny icons', () => {
    const imgs = collectResultImages(boxes, { w: 800, h: 600 });
    expect(imgs.map((i) => i.index)).toEqual([1, 2]);
    expect(imgs[1].src).toBe(bestImageUrl(boxes[1].src, boxes[1].href));
    expect(imgs[1].src).toBe('https://cdn.example/full-b.jpg');
  });

  it('picks by number, follows a dwell cursor, and closes', () => {
    let st = emptyOverlay();
    const images = collectResultImages(boxes, { w: 800, h: 600 });
    st = applyRefsCommand(st, { type: 'setImages', images });
    expect(st.highlighted).toBe(1);
    st = applyRefsCommand(st, { type: 'highlight', index: 2 });
    expect(pickByNumber(st, 2)?.title).toBe('B');
    st = applyRefsCommand(st, { type: 'pick', index: 2 });
    expect(st.picked?.src).toContain('full-b.jpg');
    st = applyRefsCommand(st, { type: 'cursor', x: 20, y: 20 });
    expect(st.highlighted).toBe(1);
    st = applyRefsCommand(st, { type: 'close' });
    expect(st.closed).toBe(true);
  });
});

describe('Gemini generated drawings and layouts (SVG, no billing)', () => {
  it('sanitizes SVG and drops scripts or javascript handlers', () => {
    const dirty = '<svg viewBox="0 0 10 10" onclick="alert(1)"><script>alert(1)</script><circle cx="5" cy="5" r="2"/></svg>';
    const clean = sanitizeSvg(dirty)!;
    expect(clean).toContain('<circle');
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(sanitizeSvg('<div>nope</div>')).toBeNull();
  });

  it('parses 3–4 numbered options and labels them Gemini · cloud', () => {
    const text = JSON.stringify([
      { title: 'Front view', kind: 'drawing', svg: '<svg viewBox="0 0 10 10"><circle cx="2" cy="2" r="1"/></svg>' },
      { title: 'Side view', kind: 'drawing', svg: '<svg viewBox="0 0 10 10"><circle cx="8" cy="2" r="1"/></svg>' },
      { title: 'Top view', kind: 'drawing', svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="8" r="1"/></svg>' },
    ]);
    const opts = parseGeneratedOptions(text, 'drawing');
    expect(opts).toHaveLength(3);
    const hits = generatedToHits(opts);
    expect(hits.every((h) => h.credit === 'Gemini · cloud')).toBe(true);
    expect(hits.every((h) => h.source === 'Gemini')).toBe(true);
    expect(hits[0].thumbUrl.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('fixture drawings for “a hand holding a cup” are numbered line-art cards', () => {
    const opts = fixtureGenerated('a hand holding a cup', 'drawing');
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(opts.every((o) => o.kind === 'drawing' && o.svg.includes('<svg'))).toBe(true);
    expect(generatedToHits(opts)[0].credit).toBe('Gemini · cloud');
  });
});

describe('chooser, fallback grid, and generate cards', () => {
  installMiniDom();
  it('shows a two-option card unless the path is explicit', async () => {
    const board = createReferenceBoard({ fixtures: true });
    document.body.append(board.element);
    const res = await board.apply(parseReferenceIntent('find me references for drawings')!);
    expect(res.ok).toBe(true);
    expect(board.isChooserOpen()).toBe(true);
    expect(board.element.querySelector('.mc-ref-chooser')?.hidden).toBe(false);
    expect(board.element.querySelectorAll('.mc-ref-choose-card')).toHaveLength(2);
    board.element.remove();
  });

  it('falls back to the picture grid and says so when the extension is missing', async () => {
    const board = createReferenceBoard({ fixtures: true, extensionConnected: () => false });
    document.body.append(board.element);
    const res = await board.apply(makeSearch('cats', 'search the web for pictures of cats', {
      explicit: true, preferred: 'search', fuzzy: false,
    }));
    expect(board.isChooserOpen()).toBe(false);
    const banner = board.element.querySelector('.mc-ref-fallback') as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toMatch(/extension/i);
    expect(res.ok).toBe(true);
    expect(res.detail).toMatch(/extension/i);
    expect(board.element.querySelectorAll('.mc-ref-card').length).toBeGreaterThan(0);
    board.element.remove();
  });

  it('opens a real tab when the extension is connected, instead of the Openverse grid', async () => {
    const calls: Array<[string, string]> = [];
    const board = createReferenceBoard({
      fixtures: true,
      extensionConnected: () => true,
      openBrowserSearch: async (q, e) => {
        calls.push([q, e]);
        return { ok: true, detail: `Opened Google Images for “${q}”.` };
      },
    });
    const res = await board.apply(makeSearch('drawings', 'search the web for drawings', {
      explicit: true, preferred: 'search', engine: 'google',
    }));
    expect(calls).toEqual([['drawings', 'google']]);
    expect(res.ok).toBe(true);
    expect(board.isGridOpen()).toBe(false);
    expect(board.isChooserOpen()).toBe(false);
  });

  it('generates numbered Gemini drawing cards and places one by number', async () => {
    const board = createReferenceBoard({ fixtures: true });
    document.body.append(board.element);
    const res = await board.apply(parseReferenceIntent('draw me a reference of a hand holding a cup')!);
    expect(res.ok).toBe(true);
    expect(board.isChooserOpen()).toBe(false);
    const cards = [...board.element.querySelectorAll('.mc-ref-card')];
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.every((c) => !c.classList.contains('mc-ref-card-web'))).toBe(true);
    expect(board.element.textContent).toMatch(/Gemini · cloud/);
    const pick = await board.apply({ type: 'pick', index: 2 });
    expect(pick.ok).toBe(true);
    expect(board.confirm()).toBe(true);
    expect(board.element.querySelector('.mc-ref-node-credit')?.textContent).toBe('Gemini · cloud');
    board.element.remove();
  });

  it('places a picture returned from the references tab', () => {
    const board = createReferenceBoard({ fixtures: true });
    document.body.append(board.element);
    const node = board.placeExternal({
      id: 'web-1',
      title: 'A cup',
      thumbUrl: 'https://cdn.example/cup.jpg',
      fullUrl: 'https://cdn.example/cup.jpg',
      pageUrl: 'https://cdn.example/cup.jpg',
      creator: '',
      source: 'Google Images',
      license: '',
      credit: 'Google Images',
    });
    expect(node.hit.credit).toBe('Google Images');
    expect(board.element.querySelector('.mc-ref-node-credit')?.textContent).toBe('Google Images');
    board.element.remove();
  });
});
