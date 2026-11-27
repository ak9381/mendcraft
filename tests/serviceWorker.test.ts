// public/sw.js: offline after one online load (the S5 shot: Wi-Fi off →
// reload → the canvas, the Kannada pack and hand tracking still work), and
// never in the way of Firebase / Gemini / App Check.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { FACE_MODEL_URL, HAND_MODEL_URL, TRACKING_ASSET_URLS, TRACKING_CACHE, WASM_BASE } from '../src/input/trackingAssets';
import { injectServiceWorker, precacheList, SHELL_URLS } from '../src/offline/swBuild';

const root = path.resolve(__dirname, '..');
const SW_SRC = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const ORIGIN = 'https://mendcraft.web.app';

describe('tracking asset URLs', () => {
  it('are the exact versioned files MediaPipe loads, in one place', () => {
    expect(TRACKING_ASSET_URLS).toEqual([
      `${WASM_BASE}/vision_wasm_internal.js`,
      `${WASM_BASE}/vision_wasm_internal.wasm`,
      HAND_MODEL_URL,
      FACE_MODEL_URL,
    ]);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8'));
    expect(WASM_BASE).toContain(`@mediapipe/tasks-vision@${pkg.version}/wasm`);
    expect(TRACKING_CACHE).toContain(pkg.version);
    for (const f of ['src/input/hands.ts', 'src/input/presence.ts']) {
      const s = fs.readFileSync(path.join(root, f), 'utf8');
      expect(s).not.toMatch(/https:\/\/(cdn\.jsdelivr\.net|storage\.googleapis\.com)/);
    }
  });
});

describe('swBuild', () => {
  it('precaches the shell and every built asset, never maps or the worker itself', () => {
    const list = precacheList(['assets/canvas-abc.js', 'assets/canvas-abc.js.map', 'assets/style-x.css', 'fonts/k.woff2', 'icons/icon-192.png', 'sw.js', 'canvas.html', 'index.html', 'demo-form.html', 'product-studio.png']);
    expect(list).toEqual(expect.arrayContaining([...SHELL_URLS, '/assets/canvas-abc.js', '/assets/style-x.css', '/fonts/k.woff2', '/icons/icon-192.png']));
    expect(list).not.toContain('/assets/canvas-abc.js.map');
    expect(list).not.toContain('/sw.js');
    expect(list).not.toContain('/demo-form.html');
    expect(new Set(list).size).toBe(list.length);
  });

  it('fills the markers and fails loudly when one is missing', () => {
    const out = injectServiceWorker(SW_SRC, { precache: ['/a.js'], tracking: TRACKING_ASSET_URLS, trackingCache: TRACKING_CACHE, build: 'b1' });
    expect(out).toContain('"/a.js"');
    expect(out).toContain(JSON.stringify(HAND_MODEL_URL));
    expect(out).not.toContain('__MC_');
    expect(() => injectServiceWorker('self.x = 1;', { precache: [], tracking: [], trackingCache: 'c', build: 'b' })).toThrow();
  });
});

// ---- a tiny service-worker world: caches, fetch, events ----
type Handler = (e: unknown) => void;
function world(opts: { online: () => boolean; serve: (url: string) => Response }) {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
  const fetched: string[] = [];
  const fetchFn = async (r: string | { url: string }) => {
    const url = keyOf(r);
    fetched.push(url);
    if (!opts.online()) throw new TypeError('Failed to fetch');
    return opts.serve(url);
  };
  const cacheOf = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      async match(r: string | { url: string }, o?: { ignoreSearch?: boolean }) {
        const k = keyOf(r);
        if (!o?.ignoreSearch) return m.get(k)?.clone();
        for (const [kk, v] of m) if (kk.split('?')[0] === k.split('?')[0]) return v.clone();
        return undefined;
      },
      async put(r: string | { url: string }, res: Response) { m.set(keyOf(r), res); },
      async add(r: string | { url: string }) { const res = await fetchFn(r); if (!res.ok) throw new Error('bad'); m.set(keyOf(r), res); },
      async addAll(list: string[]) { for (const u of list) await this.add(u); },
      async keys() { return [...m.keys()].map((url) => ({ url })); },
    };
  };
  const caches = {
    async open(n: string) { return cacheOf(n); },
    async keys() { return [...stores.keys()]; },
    async delete(n: string) { return stores.delete(n); },
    async has(n: string) { return stores.has(n); },
    async match(r: string | { url: string }, o?: { ignoreSearch?: boolean }) {
      for (const n of stores.keys()) { const hit = await cacheOf(n).match(r, o); if (hit) return hit; }
      return undefined;
    },
  };
  const listeners: Record<string, Handler[]> = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (t: string, h: Handler) => { (listeners[t] ??= []).push(h); },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const ctx = vm.createContext({ self, caches, fetch: fetchFn, Request, Response, URL, Headers, Promise, console, setTimeout, clearTimeout });
  const src = injectServiceWorker(SW_SRC, { precache: [...SHELL_URLS, '/assets/canvas-1.js'], tracking: TRACKING_ASSET_URLS, trackingCache: TRACKING_CACHE, build: 'test1' });
  vm.runInContext(src, ctx);
  const lifecycle = async (type: 'install' | 'activate') => {
    const waits: Promise<unknown>[] = [];
    for (const h of listeners[type] ?? []) h({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  /** Dispatch a fetch: the response, or null when the worker left it to the network. */
  const request = async (url: string, init: { mode?: string; method?: string } = {}) => {
    let p: Promise<Response> | null = null;
    const req = { url: new URL(url, ORIGIN).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers: new Headers() };
    for (const h of listeners.fetch ?? []) h({ request: req, respondWith: (r: Promise<Response>) => { p = r; } });
    return p ? await p : null;
  };
  return { stores, fetched, lifecycle, request };
}

const ok = (body: string, type = 'text/html') => new Response(body, { status: 200, headers: { 'Content-Type': type } });

describe('sw.js', () => {
  it('after one online load: offline navigation, assets and tracking files all come from the cache', async () => {
    let online = true;
    const w = world({ online: () => online, serve: (u) => ok(`body of ${new URL(u).pathname}`, u.endsWith('.wasm') ? 'application/wasm' : 'text/plain') });
    await w.lifecycle('install');
    await w.lifecycle('activate');
    // The tracking files were fetched once while online (precached at activate).
    for (const u of TRACKING_ASSET_URLS) expect(w.fetched).toContain(u);
    expect(w.stores.has(TRACKING_CACHE)).toBe(true);

    online = false;
    const nav = await w.request('/canvas?sim=0', { mode: 'navigate' });
    expect(await nav!.text()).toBe('body of /canvas');
    const root = await w.request('/', { mode: 'navigate' });
    expect(await root!.text()).toBe('body of /');
    expect(await (await w.request('/assets/canvas-1.js'))!.text()).toBe('body of /assets/canvas-1.js');
    const wasm = await w.request(`${WASM_BASE}/vision_wasm_internal.wasm`);
    expect(wasm!.headers.get('Content-Type')).toBe('application/wasm');
    expect(await (await w.request(HAND_MODEL_URL))!.text()).toContain('hand_landmarker.task');
  });

  it('tracking files are cache-first: a second load does not refetch them', async () => {
    const w = world({ online: () => true, serve: (u) => ok(u) });
    await w.lifecycle('install');
    await w.lifecycle('activate');
    const before = w.fetched.filter((u) => u === HAND_MODEL_URL).length;
    await w.request(HAND_MODEL_URL);
    expect(w.fetched.filter((u) => u === HAND_MODEL_URL).length).toBe(before);
  });

  it('never touches Firebase, Gemini, App Check, reCAPTCHA, Spotify or other cross-origin calls', async () => {
    const w = world({ online: () => true, serve: (u) => ok(u) });
    await w.lifecycle('install');
    await w.lifecycle('activate');
    for (const u of [
      'https://firebasevertexai.googleapis.com/v1beta/projects/p/models/gemini:streamGenerateContent',
      'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel',
      'https://content-firebaseappcheck.googleapis.com/v1/projects/p/apps/a:exchangeRecaptchaEnterpriseToken',
      'https://www.google.com/recaptcha/enterprise.js?render=k',
      'https://firebaseremoteconfig.googleapis.com/v1/projects/p/namespaces/firebase:fetch',
      'https://storage.googleapis.com/some-bucket/file.task',
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@9.9.9/wasm/vision_wasm_internal.wasm',
      'https://api.spotify.com/v1/me',
    ]) expect(await w.request(u)).toBeNull();
    // Firebase Hosting's reserved paths and non-GETs stay with the network too.
    expect(await w.request('/__/firebase/init.json')).toBeNull();
    expect(await w.request('/assets/x.js', { method: 'POST' })).toBeNull();
    for (const [name, m] of w.stores) for (const k of m.keys()) expect(k, `${name} holds ${k}`).not.toMatch(/firebase|recaptcha|spotify|firestore|\/__\//);
  });

  it('activate drops older mendcraft caches, keeps the current ones and anything not ours', async () => {
    const w = world({ online: () => true, serve: (u) => ok(u) });
    w.stores.set('mendcraft-rt-v2', new Map());
    w.stores.set('mendcraft-tracking-mp-0.0.1-v1', new Map());
    w.stores.set('someone-else', new Map());
    await w.lifecycle('install');
    await w.lifecycle('activate');
    const names = [...w.stores.keys()];
    expect(names).not.toContain('mendcraft-rt-v2');
    expect(names).not.toContain('mendcraft-tracking-mp-0.0.1-v1');
    expect(names).toContain('someone-else');
    expect(names).toContain(TRACKING_CACHE);
    expect(names.some((n) => n.startsWith('mendcraft-shell-') && n.includes('test1'))).toBe(true);
  });

  it('online, the network wins for app files (a deploy is never pinned to a stale bundle)', async () => {
    let body = 'v1';
    const w = world({ online: () => true, serve: () => ok(body) });
    await w.lifecycle('install');
    await w.lifecycle('activate');
    body = 'v2';
    expect(await (await w.request('/canvas', { mode: 'navigate' }))!.text()).toBe('v2');
    expect(await (await w.request('/assets/canvas-1.js'))!.text()).toBe('v2');
  });
});
