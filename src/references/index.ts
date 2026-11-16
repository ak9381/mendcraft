export type { ReferenceIntent, IntentContext, RefHit, GridItem, GridBox, PlacedRef, SearchPage } from './types';
export { WEB_SEARCH_ID } from './types';
export { parseReferenceIntent, parsePickNumber, topicLooksFuzzy, normUtterance } from './intent';
export { parseRefinedQuery, cleanQuery, refinePrompt, REFINE_PROMPT } from './query';
export { searchReferences, searchOpenverse, searchWikimedia, mergeHits, webSearchUrl, OPENVERSE_API, WIKIMEDIA_API } from './search';
export { pageItems, layoutGrid, snapHover, hitBox, itemByIndex, stepHover, IMAGES_PER_PAGE } from './grid';
export { stepRefGestures, emptyRefGestureState, isPinching, isOpenPalm, pinchPoint, DWELL_MS, PALM_HOLD_MS } from './gestures';
export { fixtureHits, fixtureSearch, DRAWING_REFERENCES_RECIPE, isReferenceRecipe, recipeSearchQuery } from './demo';
export { createReferenceBoard, type ReferenceBoard, type ReferenceBoardOpts, type ApplyResult } from './board';
