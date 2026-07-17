// The /api/github proxy — the ONLY place tokens touch GitHub. The browser
// talks to these endpoints; SSR code calls the same client directly. The
// adapter is chosen once per process:
//   - PULSE_FIXTURES=1 (or no token source): fixtures — deterministic,
//     tokenless (CI smokes, offline dev).
//   - GITHUB_TOKEN set: live client with the sqlite ETag cache. Per-user
//     session tokens replace this env token in M1 step 3 (packages/auth).
import express from 'express';
import { createLiveClient, createFixturesClient, createSqliteEtagCache } from '@pulse/github';

export function createGitHubApi({ dbPath } = {}) {
    const fixtures = process.env.PULSE_FIXTURES === '1' || !process.env.GITHUB_TOKEN;
    const client = fixtures
        ? createFixturesClient()
        : createLiveClient({
            token: process.env.GITHUB_TOKEN,
            etagCache: createSqliteEtagCache(dbPath)
        });

    const api = express.Router();

    /** Wrap a handler: JSON result, GitHub errors mapped to real statuses. */
    const route = (fn) => async (req, res) => {
        try {
            const data = await fn(req);
            if (data === null) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.json(data);
        } catch (err) {
            if (err?.name === 'GitHubApiError') {
                res.status(err.rateLimited ? 429 : err.status).json({
                    error: err.rateLimited ? 'GitHub rate limit exhausted' : err.message
                });
                return;
            }
            console.error('[pulse] /api/github error:', err);
            res.status(500).json({ error: 'internal error' });
        }
    };

    api.get('/viewer', route(() => client.viewer()));
    api.get('/viewer/orgs', route(() => client.viewerOrgs()));
    api.get('/viewer/repos', route(() => client.viewerRepos()));
    api.get('/owners/:owner/repos', route((req) => client.ownerRepos(req.params.owner)));
    api.get('/repos/:owner/:name', route((req) => client.repo(req.params.owner, req.params.name)));

    return { api, client, fixtures };
}
