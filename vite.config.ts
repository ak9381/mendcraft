import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { assertFirebaseBuildEnv } from './src/firebase/envGuard';
import { NO_DEBUG_TOKEN_HINT, resolveAppCheckDebugToken } from './src/firebase/debugToken';

const root = path.dirname(fileURLToPath(import.meta.url));

/** One stable debug token for every local address: process env, then the
 *  .env files (APPCHECK_DEBUG_TOKEN or VITE_APPCHECK_DEBUG_TOKEN), then the
 *  secrets file. Logs where it came from, never the value. */
function loadLocalDebugToken(mode: string, log: boolean): string | null {
  const got = resolveAppCheckDebugToken({
    envs: [process.env, loadEnv(mode, root, ['APPCHECK_', 'VITE_APPCHECK_'])],
    files: [
      path.join(os.homedir(), '.secrets', 'mendcraft-appcheck-debug'),
      path.join(root, '.secrets', 'mendcraft-appcheck-debug'),
    ],
    readFile: (file) => fs.readFileSync(file, 'utf8'),
  });
  if (log) {
    for (const where of got.rejected) console.warn(`[mendcraft] App Check: the debug token in ${where} is not a UUID — ignored.`);
    if (got.token) console.info(`[mendcraft] App Check: using the debug token from ${got.source} (it must be registered in the Firebase console).`);
    else console.warn(NO_DEBUG_TOKEN_HINT);
  }
  return got.token;
}

function isLocalHost(hostHeader: string | undefined): boolean {
  const host = (hostHeader ?? '').split(',')[0].trim();
  const name = host.startsWith('[')
    ? (host.slice(1).split(']')[0] ?? '')
    : (host.split(':')[0] ?? '');
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

function injectDebugToken(html: string, token: string): string {
  if (html.includes('FIREBASE_APPCHECK_DEBUG_TOKEN')) return html;
  const tag = `<script>self.FIREBASE_APPCHECK_DEBUG_TOKEN=${JSON.stringify(token)};</script>`;
  if (html.includes('<head>')) return html.replace('<head>', `<head>\n    ${tag}`);
  return `${tag}\n${html}`;
}

/** Inject the box App Check debug token into HTML for local dev, and for
 *  `vite preview` only when the request is localhost + `?debug`. The token
 *  is never written into `dist` during `vite build`. */
function appCheckDebugLocalPlugin(mode: string, command: 'build' | 'serve'): Plugin {
  const token = command === 'serve' ? loadLocalDebugToken(mode, mode !== 'test') : null;
  return {
    name: 'appcheck-debug-local-only',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!token || !ctx.server) return html;
        return injectDebugToken(html, token);
      },
    },
    configureServer(server) {
      // Dev-only page that draws synthetic hand/face landmarks straight onto
      // handOverlay.ts/faceOverlay.ts (no camera, no MediaPipe) so the
      // tracking visuals are reproducible for screenshots and manual review.
      // ?pose=open|point|pinch|thumbs-up|fist, ?variant=solo|crowd.
      server.middlewares.use((req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/__tracking-sim') return next();
          if (req.method !== 'GET' && req.method !== 'HEAD') return next();
          if (!isLocalHost(typeof req.headers.host === 'string' ? req.headers.host : undefined)) {
            res.statusCode = 404;
            res.end('not found');
            return;
          }
          const pose = /^[a-z-]{1,20}$/.test(url.searchParams.get('pose') ?? '') ? url.searchParams.get('pose') : 'open';
          const variant = url.searchParams.get('variant') === 'crowd' ? 'crowd' : 'solo';
          const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Mendcraft tracking sim</title>
    <style>
      html, body { margin: 0; height: 100%; background: #1a1c22; }
      #viewport { position: relative; width: 100%; height: 100%; overflow: hidden; background: #1a1c22; }
      .hand-overlay, .face-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
      .hand-overlay { z-index: 3; }
      .face-overlay { z-index: 2; }
    </style>
  </head>
  <body>
    <div id="viewport"></div>
    <script type="module">
      import { createHandOverlay } from '/src/ui/handOverlay.ts';
      import { createFaceOverlay } from '/src/ui/faceOverlay.ts';
      import { buildScene } from '/src/dev/trackingSim.ts';
      const viewport = document.getElementById('viewport');
      // reducedMotion: true — a single draw() call should render the settled
      // (fully faded-in) look, not one tick of an opacity ramp.
      const handOverlay = createHandOverlay(viewport, { reducedMotion: true });
      const faceOverlay = createFaceOverlay(viewport, { reducedMotion: true });
      const scene = buildScene(${JSON.stringify(pose)}, ${JSON.stringify(variant)});
      handOverlay.draw(scene.hands);
      faceOverlay.draw(scene.faces, scene.rejectedHands);
      document.body.dataset.ready = '1';
    </script>
  </body>
</html>`;
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (req.method === 'HEAD') { res.end(); return; }
          res.end(html);
        } catch {
          next();
        }
      });
      // Dev-only lightweight page that loads hybrid.ts without the studio shell.
      server.middlewares.use((req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/__cloud-probe') return next();
          if (req.method !== 'GET' && req.method !== 'HEAD') return next();
          if (!isLocalHost(typeof req.headers.host === 'string' ? req.headers.host : undefined)) {
            res.statusCode = 404;
            res.end('not found');
            return;
          }
          let html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Mendcraft cloud probe</title>
  </head>
  <body>
    <script type="module">
      import {
        prepareHybrid,
        getHybridStatus,
        warmCloud,
        askCopilot,
        condenseUtterance,
        draftClientEmail,
        proposeMaterials,
        explainAccessibility,
      } from '/src/ai/hybrid.ts';
      import { createSpeculativeEngine } from '/src/cad/speculative.ts';
      globalThis.__mcCloudProbe = {
        prepareHybrid,
        getHybridStatus,
        warmCloud,
        askCopilot,
        condenseUtterance,
        draftClientEmail,
        proposeMaterials,
        explainAccessibility,
        createSpeculativeEngine,
      };
      document.body.dataset.ready = '1';
    </script>
  </body>
</html>`;
          if (token) html = injectDebugToken(html, token);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (req.method === 'HEAD') { res.end(); return; }
          res.end(html);
        } catch {
          next();
        }
      });
    },
    configurePreviewServer(server) {
      if (!token) return;
      const indexPath = path.resolve(server.config.root, server.config.build.outDir, 'index.html');
      server.middlewares.use((req, res, next) => {
        try {
          if (req.method !== 'GET' && req.method !== 'HEAD') return next();
          if (!isLocalHost(typeof req.headers.host === 'string' ? req.headers.host : undefined)) {
            return next();
          }
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (!url.searchParams.has('debug')) return next();
          if (/\.(js|css|map|json|png|jpe?g|svg|ico|webp|woff2?|webmanifest|wasm|mp3|mp4)$/i.test(url.pathname)) {
            return next();
          }
          if (!fs.existsSync(indexPath)) return next();
          const html = injectDebugToken(fs.readFileSync(indexPath, 'utf8'), token);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          res.end(html);
        } catch {
          next();
        }
      });
    },
  };
}


/** Fail `vite build` if Firebase / reCAPTCHA env values are placeholders, so a
 *  rules-only production bundle cannot ship silently again. Never logs the
 *  key values. */
function firebaseEnvGuardPlugin(): Plugin {
  let command: 'build' | 'serve' = 'serve';
  let mode = 'production';
  return {
    name: 'firebase-env-guard',
    configResolved(config) {
      command = config.command;
      mode = config.mode;
    },
    buildStart() {
      if (command !== 'build') return;
      const env = loadEnv(mode, root, 'VITE_');
      assertFirebaseBuildEnv(env);
    },
  };
}

export default defineConfig(({ mode, command }) => {
  // A debug token must never be inlined into a production bundle: Vite inlines
  // every VITE_* value it finds, and an already-set process value wins over
  // the .env files, so blank it for `vite build`.
  if (command === 'build') process.env.VITE_APPCHECK_DEBUG_TOKEN = '';
  return {
  plugins: [firebaseEnvGuardPlugin(), appCheckDebugLocalPlugin(mode, command)],
  build: {
    rollupOptions: {
      // sim-main: the smart canvas and the A2UI spike ship as extra pages.
      input: {
        main: path.join(root, 'index.html'),
        canvas: path.join(root, 'canvas.html'),
        spike: path.join(root, 'spike.html'),
        mobile: path.join(root, 'mobile.html'),
        monitor: path.join(root, 'monitor.html'),
        activity: path.join(root, 'activity.html'),
      },
    },
  },
  };
});
