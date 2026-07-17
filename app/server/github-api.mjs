// The /api/github proxy — the ONLY place tokens touch GitHub. The browser
// talks to these endpoints; SSR code calls the same client directly.
//
// Adapter per request: a signed-in session's token gets a live client (all
// sessions share one ETag cache); without a session the DEFAULT applies —
// fixtures when PULSE_FIXTURES=1 or no GITHUB_TOKEN, else a live client on
// the env token (single-user dev convenience).
import express from 'express';
import { createLiveClient, createFixturesClient, createSqliteEtagCache } from '@pulse/github';

export function createGitHubApi({ dbPath, getSession } = {}) {
    const fixtures = process.env.PULSE_FIXTURES === '1' || (!process.env.GITHUB_TOKEN && !process.env.PULSE_OAUTH_CLIENT_ID);
    const etagCache = createSqliteEtagCache(dbPath);
    const fallback = fixtures
        ? createFixturesClient()
        : (process.env.GITHUB_TOKEN
            ? createLiveClient({ token: process.env.GITHUB_TOKEN, etagCache })
            : null);

    /** Client for one request: session token > env fallback > fixtures. */
    const clientFor = (req) => {
        const session = getSession?.(req);
        if (session && session.token !== 'fixtures') {
            return createLiveClient({ token: session.token, etagCache });
        }
        if (session && session.token === 'fixtures') {
            return createFixturesClient();
        }
        return fallback ?? createFixturesClient();
    };

    const api = express.Router();

    /** Wrap a handler: JSON result, GitHub errors mapped to real statuses. */
    const route = (fn) => async (req, res) => {
        try {
            const data = await fn(req, clientFor(req));
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

    return { api, fixtures, makeClient: (token) => (token === 'fixtures' || fixtures)
        ? createFixturesClient()
        : createLiveClient({ token, etagCache }) };
}
