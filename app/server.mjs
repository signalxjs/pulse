// The Pulse server — plain Node, no transpiler: dev is Vite middleware +
// one SSR handler, prod is static assets + one handler (the reference
// pattern from sigx core's rfc-ssr-platform §3.3). Run production with
// `--conditions production` for the NODE_ENV-stripped dists.
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createSessionStore, createAuthRouter, getSession } from '@pulse/auth';
import { createGitHubApi } from './server/github-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 4823;

if (isProd && !process.env.PULSE_SECRET) {
    // A well-known secret makes every session forgeable — refuse to serve.
    console.error('[pulse] PULSE_SECRET is required in production (sessions are signed and encrypted with it).');
    process.exit(1);
}
const secret = process.env.PULSE_SECRET ?? 'pulse-dev-secret-do-not-use-in-production';

// Crawlers and AI agents get the blocking document: complete content
// inline, nothing for the client to execute.
const isBot = (ua) => /bot|crawl|spider|slurp|gptbot|claudebot|perplexity|headless/i.test(ua);

async function createServer() {
    const app = express();
    const dbPath = process.env.PULSE_DB || ':memory:';

    const sessions = createSessionStore({ dbPath, secret });
    // OAuth needs BOTH credentials; the fixtures decision keys off the SAME
    // resolution so a half-configured OAuth app can't silently flip modes.
    const oauth = process.env.PULSE_OAUTH_CLIENT_ID && process.env.PULSE_OAUTH_CLIENT_SECRET
        ? { clientId: process.env.PULSE_OAUTH_CLIENT_ID, clientSecret: process.env.PULSE_OAUTH_CLIENT_SECRET }
        : undefined;
    if (process.env.PULSE_OAUTH_CLIENT_ID && !oauth) {
        console.warn('[pulse] PULSE_OAUTH_CLIENT_ID is set without PULSE_OAUTH_CLIENT_SECRET — OAuth disabled.');
    }
    // Fixtures is EXPLICIT-only: a bare server with neither token nor OAuth
    // is live PAT-only — a real user's PAT must reach real GitHub, never be
    // silently swallowed by fixtures. CI smokes set PULSE_FIXTURES=1.
    const fixtures = process.env.PULSE_FIXTURES === '1';
    const { api, clientFor, makeClient } = createGitHubApi({
        dbPath,
        fixtures,
        getSession: (req) => getSession(req, sessions, secret)
    });

    app.use('/auth', createAuthRouter({ sessions, secret, fixtures, makeClient, oauth }));
    app.use('/api/github', api);
    console.log(`[pulse] GitHub adapter: ${fixtures ? 'fixtures (tokenless)' : 'live'}; OAuth: ${oauth ? 'configured' : 'off (PAT only)'}`);

    // Per-request SSR context: the signed-in user + a PulseApi over the
    // request's GitHub client (session token > env fallback). When
    // clientFor() is null (live setup, unauthenticated), /api/github
    // answers 401 and the SSR entry provides NO PulseApi — the auth guard
    // redirects before any page could reach for it.
    const requestCtx = (req) => {
        const user = getSession(req, sessions, secret)?.user ?? null;
        const gh = clientFor(req);
        return {
            user,
            api: gh && {
                viewer: () => gh.viewer(),
                viewerOrgs: () => gh.viewerOrgs(),
                viewerRepos: () => gh.viewerRepos(),
                ownerRepos: (owner) => gh.ownerRepos(owner),
                repo: (owner, name) => gh.repo(owner, name)
            }
        };
    };

    if (!isProd) {
        const { createServer: createViteServer } = await import('vite');
        const { createDevRequestHandler } = await import('@sigx/vite/ssr');

        const vite = await createViteServer({
            root: __dirname,
            server: { middlewareMode: true },
            appType: 'custom'
        });
        app.use(vite.middlewares);
        const handler = await createDevRequestHandler(vite, {
            entry: '/src/entry-server.tsx',
            isBot
        });
        // The dev handler forwards the request to the factory since
        // @sigx/vite 0.13.0 (core#304) — as the raw IncomingMessage, where
        // prod passes a resolved context. Decorate the request so the
        // factory's normalizer finds the same shape either way.
        app.use((req, res, next) => {
            req.pulseCtx = requestCtx(req);
            handler(req, res, next);
        });
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
            // The factory's second parameter is this request's context
            // ({ user, api }) — prod passes it directly (router-SSR
            // contract §1 allows extra factory parameters).
            app: (url, req) => createApp(url, requestCtx(req)),
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
