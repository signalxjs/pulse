// The Pulse server — plain Node, no transpiler: dev is Vite middleware +
// one SSR handler, prod is static assets + one handler (the reference
// pattern from sigx core's rfc-ssr-platform §3.3). Run production with
// `--conditions production` for the NODE_ENV-stripped dists.
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;

// Crawlers and AI agents get the blocking document: complete content
// inline, nothing for the client to execute.
const isBot = (ua) => /bot|crawl|spider|slurp|gptbot|claudebot|perplexity|headless/i.test(ua);

async function createServer() {
    const app = express();

    // GitHub proxy — shared by dev and prod; adapter chosen by env (see
    // app/server/github-api.mjs).
    const { createGitHubApi } = await import('./server/github-api.mjs');
    const { api, fixtures } = createGitHubApi({
        dbPath: process.env.PULSE_DB || ':memory:'
    });
    app.use('/api/github', api);
    console.log(`[pulse] GitHub adapter: ${fixtures ? 'fixtures (tokenless)' : 'live'}`);

    if (!isProd) {
        const { createServer: createViteServer } = await import('vite');
        const { createDevRequestHandler } = await import('@sigx/vite/ssr');

        const vite = await createViteServer({
            root: __dirname,
            server: { middlewareMode: true },
            appType: 'custom'
        });
        app.use(vite.middlewares);
        app.use(await createDevRequestHandler(vite, {
            entry: '/src/entry-server.tsx',
            isBot
        }));
    } else {
        const { createRequestHandler } = await import('@sigx/server-renderer/node');
        const { collectAssets } = await import('@sigx/vite/ssr');

        const clientDir = resolve(__dirname, 'dist/client');
        const template = await readFile(resolve(clientDir, 'index.html'), 'utf-8');
        const manifest = JSON.parse(
            await readFile(resolve(clientDir, '.vite/manifest.json'), 'utf-8')
        );
        const { createApp } = await import(
            pathToFileURL(resolve(__dirname, 'dist/server/entry-server.js')).href
        );

        app.use(express.static(clientDir, { index: false }));
        app.use(createRequestHandler({
            template,
            app: (url) => createApp(url),
            isBot,
            document: {
                // Route-chunk preloads (contract §2) join here once routes
                // go lazy (M2) — for now the entry's own assets suffice.
                assets: collectAssets(manifest, [])
            }
        }));
    }

    app.listen(port, () => {
        console.log(`[pulse] ${isProd ? 'production' : 'dev'} server on http://localhost:${port}`);
    });
}

createServer().catch((err) => {
    console.error('[pulse] failed to start:', err);
    process.exitCode = 1;
});
