import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { assertFirebaseBuildEnv } from './src/firebase/envGuard';

const root = path.dirname(fileURLToPath(import.meta.url));

function loadLocalDebugToken(): string | null {
  const fromEnv = process.env.APPCHECK_DEBUG_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const files = [
    path.join(os.homedir(), '.secrets', 'mendcraft-appcheck-debug'),
    path.join(root, '.secrets', 'mendcraft-appcheck-debug'),
  ];
  for (const file of files) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {
      // missing or unreadable — try the next source
    }
  }
  return null;
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
function appCheckDebugLocalPlugin(): Plugin {
  const token = loadLocalDebugToken();
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

export default defineConfig({
  plugins: [firebaseEnvGuardPlugin(), appCheckDebugLocalPlugin()],
});
