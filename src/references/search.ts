// Free, no-key image search: Openverse + Wikimedia Commons. CORS-friendly.
// Only the search text leaves the device. Each hit carries source + licence.

import type { RefHit, SearchPage } from './types';

export const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
export const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
export const OPENVERSE_WEB = 'https://openverse.org/search/';

/** Shown on the "Search on the web" card and used as the fallback tab URL. */
export function webSearchUrl(query: string): string {
  const q = query.trim() || 'drawings';
  return `${OPENVERSE_WEB}?q=${encodeURIComponent(q)}&t=image`;
}

const PAGE = 7; // images per page; the web-search card makes 8 targets
const UA = 'Mendcraft/0.1 (https://mendcraft.web.app; hands-free reference search)';

export interface SearchDeps {
  fetch: typeof fetch;
}

function headers(): HeadersInit {
  return { Accept: 'application/json', 'Api-User-Agent': UA };
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function ccLicense(license: string, version?: string): string {
  const body = license.trim();
  if (!body) return 'Unknown licence';
  if (/^pd$/i.test(body) || /public domain/i.test(body)) return 'Public domain';
  if (/^cc0$/i.test(body)) return 'CC0';
  const pretty = body.replace(/^by/i, 'BY').replace(/-/g, '-').toUpperCase().replace('BY', 'BY');
  const label = body.toLowerCase().startsWith('by') ? `CC ${body.toUpperCase()}` : pretty;
  return version ? `${label} ${version}` : label;
}

function openverseHits(data: unknown, limit: number): RefHit[] {
  if (!data || typeof data !== 'object') return [];
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: RefHit[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url : '';
    const thumb = typeof r.thumbnail === 'string' ? r.thumbnail : url;
    if (!url && !thumb) continue;
    const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : 'Untitled';
    const creator = typeof r.creator === 'string' ? r.creator.trim() : '';
    const license = ccLicense(String(r.license ?? ''), typeof r.license_version === 'string' ? r.license_version : undefined);
    const pageUrl = typeof r.foreign_landing_url === 'string' ? r.foreign_landing_url : url;
    const attribution = typeof r.attribution === 'string' ? r.attribution.trim() : '';
    const credit = attribution || [title, creator && `by ${creator}`, license, 'Openverse'].filter(Boolean).join(' · ');
    out.push({
      id: `ov:${String(r.id ?? url)}`,
      title,
      thumbUrl: thumb || url,
      fullUrl: url || thumb,
      pageUrl,
      creator,
      source: 'Openverse',
      license,
      credit,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function wikiVal(meta: Record<string, unknown> | undefined, key: string): string {
  const v = meta?.[key];
  if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'string') {
    return stripHtml((v as { value: string }).value);
  }
  return '';
}

function wikimediaHits(data: unknown, limit: number): RefHit[] {
  if (!data || typeof data !== 'object') return [];
  const pages = (data as { query?: { pages?: Record<string, unknown> } }).query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  const rows = Object.values(pages)
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  const out: RefHit[] = [];
  for (const p of rows) {
    const infos = Array.isArray(p.imageinfo) ? p.imageinfo : [];
    const info = infos[0] && typeof infos[0] === 'object' ? infos[0] as Record<string, unknown> : null;
    if (!info) continue;
    const mime = typeof info.mime === 'string' ? info.mime : '';
    if (mime && !mime.startsWith('image/')) continue;
    const thumb = typeof info.thumburl === 'string' ? info.thumburl : '';
    const url = typeof info.url === 'string' ? info.url : thumb;
    if (!url) continue;
    const titleRaw = typeof p.title === 'string' ? p.title.replace(/^File:/, '') : 'Untitled';
    const title = titleRaw.replace(/\.[a-z0-9]+$/i, '').trim() || titleRaw;
    const ext = (info.extmetadata && typeof info.extmetadata === 'object')
      ? info.extmetadata as Record<string, unknown>
      : undefined;
    const creator = wikiVal(ext, 'Artist') || 'Wikimedia Commons';
    const short = wikiVal(ext, 'LicenseShortName') || wikiVal(ext, 'License') || 'Wikimedia licence';
    const license = /public domain/i.test(short) || short.toLowerCase() === 'pd' ? 'Public domain' : short;
    const pageUrl = typeof info.descriptionurl === 'string'
      ? info.descriptionurl
      : `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title ?? title))}`;
    const credit = [title, creator && `by ${creator}`, license, 'Wikimedia Commons'].filter(Boolean).join(' · ');
    out.push({
      id: `wm:${String(p.pageid ?? url)}`,
      title,
      thumbUrl: thumb || url,
      fullUrl: url,
      pageUrl,
      creator,
      source: 'Wikimedia Commons',
      license,
      credit,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function dedupe(hits: RefHit[]): RefHit[] {
  const seen = new Set<string>();
  const out: RefHit[] = [];
  for (const h of hits) {
    const key = `${h.title.toLowerCase()}|${h.creator.toLowerCase()}`;
    const urlKey = h.fullUrl.replace(/\?.*$/, '');
    if (seen.has(key) || seen.has(urlKey)) continue;
    seen.add(key);
    seen.add(urlKey);
    out.push(h);
  }
  return out;
}

/** Interleave two lists so each page shows both sources when possible. */
export function mergeHits(a: RefHit[], b: RefHit[], limit: number): RefHit[] {
  const merged: RefHit[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) merged.push(a[i]);
    if (i < b.length) merged.push(b[i]);
  }
  return dedupe(merged).slice(0, limit);
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { headers: headers() });
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  return res.json();
}

export async function searchOpenverse(query: string, page: number, deps: SearchDeps): Promise<{ hits: RefHit[]; pages: number }> {
  const url = `${OPENVERSE_API}?q=${encodeURIComponent(query)}&page=${Math.max(1, page)}&page_size=${PAGE}&mature=false`;
  const data = await getJson(deps.fetch, url);
  const pages = data && typeof data === 'object' && typeof (data as { page_count?: unknown }).page_count === 'number'
    ? (data as { page_count: number }).page_count
    : 1;
  return { hits: openverseHits(data, PAGE), pages };
}

export async function searchWikimedia(query: string, page: number, deps: SearchDeps): Promise<{ hits: RefHit[]; hasMore: boolean }> {
  const offset = (Math.max(1, page) - 1) * PAGE;
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(PAGE),
    gsroffset: String(offset),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  });
  const data = await getJson(deps.fetch, `${WIKIMEDIA_API}?${params.toString()}`);
  const hasMore = !!(data && typeof data === 'object' && (data as { continue?: unknown }).continue);
  return { hits: wikimediaHits(data, PAGE), hasMore };
}

/**
 * Search both sources in parallel. One failing source does not fail the page.
 * `page` is 1-based.
 */
export async function searchReferences(
  query: string,
  page = 1,
  deps: SearchDeps = { fetch: globalThis.fetch.bind(globalThis) },
): Promise<SearchPage> {
  const q = query.trim();
  const p = Math.max(1, page);
  if (!q) return { query: q, page: p, hits: [], hasMore: false };

  const [ov, wm] = await Promise.allSettled([
    searchOpenverse(q, p, deps),
    searchWikimedia(q, p, deps),
  ]);
  const ovHits = ov.status === 'fulfilled' ? ov.value.hits : [];
  const wmHits = wm.status === 'fulfilled' ? wm.value.hits : [];
  const hits = mergeHits(ovHits, wmHits, PAGE);
  const hasMore =
    (ov.status === 'fulfilled' && ov.value.pages > p)
    || (wm.status === 'fulfilled' && wm.value.hasMore)
    || hits.length >= PAGE;
  return { query: q, page: p, hits, hasMore };
}
