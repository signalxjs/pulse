// The /api/github proxy — the ONLY place tokens touch GitHub. The browser
// talks to these endpoints; SSR code calls the same client directly.
//
// Adapter per request: a signed-in session's token gets a live client (all
// sessions share one ETag cache); without a session the DEFAULT applies —
// fixtures when PULSE_FIXTURES=1 or no GITHUB_TOKEN, else a live client on
// the env token (single-user dev convenience).
import express from 'express';
import { createLiveClient, createDbEtagCache } from '@pulse/github';
import { createFixturesClient } from '@pulse/github/fixtures';

export function createGitHubApi({ db, getSession, fixtures } = {}) {
    // Fixtures mode never talks to GitHub — no ETag cache to keep. The db
    // arrives migrated (server.mjs applies app/migrations before serving).
    const etagCache = fixtures ? null : createDbEtagCache(db);
    const fallback = fixtures
        ? createFixturesClient()
        : (process.env.GITHUB_TOKEN
            ? createLiveClient({ token: process.env.GITHUB_TOKEN, etagCache })
            : null);

    /**
     * Client for one request: session token > env fallback. In a live setup
     * (OAuth configured, no env token) an unauthenticated request gets NO
     * client — the route layer answers 401 instead of silently serving
     * fixtures data.
     */
    const clientFor = async (req) => {
        const session = await getSession?.(req);
        if (session) {
            // The mode gates the shortcut — in LIVE mode a literal
            // 'fixtures' token is just an (invalid) PAT, never a bypass.
            // (fallback IS the shared fixtures client in fixtures mode.)
            if (fixtures) return fallback;
            return createLiveClient({ token: session.token, etagCache });
        }
        return fallback;
    };

    const api = express.Router();

    /** Wrap a handler: JSON result, GitHub errors mapped to real statuses. */
    const route = (fn) => async (req, res) => {
        try {
            const client = await clientFor(req);
            if (!client) {
                res.status(401).json({ error: 'sign in required' });
                return;
            }
            const data = await fn(req, client);
            if (data === null) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json(data);
        } catch (err) {
            if (err?.name === 'GitHubApiError' && typeof err.status === 'number') {
                res.status(err.rateLimited ? 429 : err.status).json({
                    error: err.rateLimited ? 'GitHub rate limit exhausted' : err.message
                });
                return;
            }
            console.error('[pulse] /api/github error:', err);
            res.status(500).json({ error: 'internal error' });
        }
    };

    api.get('/viewer', route((_req, gh) => gh.viewer()));
    api.get('/viewer/orgs', route((_req, gh) => gh.viewerOrgs()));
    api.get('/viewer/repos', route((_req, gh) => gh.viewerRepos()));
    api.get('/owners/:owner/repos', route((req, gh) => gh.ownerRepos(req.params.owner)));
    api.get('/repos/:owner/:name', route((req, gh) => gh.repo(req.params.owner, req.params.name)));

    return {
        api,
        clientFor,
        makeClient: (token) => fixtures
            ? createFixturesClient()
            : createLiveClient({ token, etagCache })
    };
}
