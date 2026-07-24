/**
 * @vitest-environment node
 *
 * The auth router's security-critical paths over a REAL express listener:
 * OAuth state (CSRF), returnTo sanitization (open redirect / header
 * injection), code validation, and the PAT flow.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createSessionStore, createAuthRouter } from '@pulse/auth';
import { createSqliteDb } from '@pulse/db/sqlite';
import { applyMigrations } from '@pulse/db/migrate';
import { sign, STATE_COOKIE } from '../src/cookies.js';

const USER = { login: 'octo', name: null, avatarUrl: 'https://a/u' };
const SECRET = 'test-secret';

let server: Server;
let base: string;

beforeAll(async () => {
    const app = express();
    const db = createSqliteDb();
    await applyMigrations(db, join(process.cwd(), 'app', 'migrations'));
    const sessions = createSessionStore({ db, secret: SECRET });
    app.use('/auth', createAuthRouter({
        sessions,
        secret: SECRET,
        fixtures: false,
        makeClient: () => ({
            viewer: async () => USER,
            viewerOrgs: async () => [],
            viewerRepos: async () => [],
            ownerRepos: async () => [],
            repo: async () => null,
            repoIssues: async () => ({ items: [], nextPage: null }),
            repoLabels: async () => [],
            repoMilestones: async () => [],
            repoCollaborators: async () => [],
            issue: async () => null,
            issueTimeline: async () => [],
            // The auth flow only ever calls viewer(); writes are unreachable.
            createIssue: async () => { throw new Error('unused'); },
            updateIssue: async () => { throw new Error('unused'); },
            createComment: async () => { throw new Error('unused'); },
            createLabel: async () => { throw new Error('unused'); }
        }),
        oauth: { clientId: 'cid', clientSecret: 'cs' },
        fetch: (async () => ({
            ok: true,
            json: async () => ({ access_token: 'gho_test' })
        })) as unknown as typeof fetch
    }));
    await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
    });
});

const get = (path: string, cookie?: string) =>
    fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

describe('GET /auth/login', () => {
    it('redirects to GitHub authorize with a state param and cookie', async () => {
        const res = await get('/auth/login?returnTo=/projects');
        expect(res.status).toBe(302);
        const location = res.headers.get('location')!;
        expect(location).toContain('github.com/login/oauth/authorize');
        expect(location).toContain('state=');
        expect(res.headers.get('set-cookie')).toContain(STATE_COOKIE);
    });

    it.each([
        // Already-encoded query values — express decodes exactly once, so
        // the third case delivers LITERAL CR/LF bytes to the sanitizer.
        encodeURIComponent('https://evil.example'),
        encodeURIComponent('//evil.example'),
        '/ok%0d%0aSet-Cookie:%20x=1'
    ])('sanitizes returnTo %s to /', async (evil) => {
        const res = await get(`/auth/login?returnTo=${evil}`);
        const cookie = res.headers.get('set-cookie')!;
        // The staged state cookie carries "<state>:<returnTo>"; a hostile
        // returnTo must have collapsed to '/'.
        const staged = decodeURIComponent(cookie.split(';')[0]!.split('=').slice(1).join('='));
        expect(staged.split('.')[0]!.split(':').slice(1).join(':')).toBe('/');
    });
});

describe('GET /auth/callback', () => {
    it('403s on state mismatch', async () => {
        const staged = await sign('right-state:/', SECRET);
        const res = await get(`/auth/callback?state=wrong-state&code=abc`, `${STATE_COOKIE}=${encodeURIComponent(staged)}`);
        expect(res.status).toBe(403);
    });

    it('403s with no state cookie at all', async () => {
        const res = await get('/auth/callback?state=whatever&code=abc');
        expect(res.status).toBe(403);
    });

    it('400s when the code is missing', async () => {
        const staged = await sign('st-1:/', SECRET);
        const res = await get('/auth/callback?state=st-1', `${STATE_COOKIE}=${encodeURIComponent(staged)}`);
        expect(res.status).toBe(400);
    });

    it('signs in and redirects to the staged returnTo on the happy path', async () => {
        const staged = await sign('st-2:/projects', SECRET);
        const res = await get('/auth/callback?state=st-2&code=abc', `${STATE_COOKIE}=${encodeURIComponent(staged)}`);
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe('/projects');
        const setCookie = res.headers.get('set-cookie')!;
        expect(setCookie).toContain('pulse_sid');
        // This router was built without secureCookies — no Secure attribute
        // (a Secure cookie over plain http would be dropped by the client).
        expect(setCookie).not.toContain('Secure');
    });
});

describe('secureCookies', () => {
    it('marks issued cookies Secure when enabled', async () => {
        const app2 = express();
        const db2 = createSqliteDb();
        await applyMigrations(db2, join(process.cwd(), 'app', 'migrations'));
        app2.use('/auth', createAuthRouter({
            sessions: createSessionStore({ db: db2, secret: SECRET }),
            secret: SECRET,
            fixtures: false,
            secureCookies: true,
            makeClient: (() => { throw new Error('unused — /login never builds a client'); }) as never,
            oauth: { clientId: 'cid', clientSecret: 'cs' }
        }));
        const srv = await new Promise<Server>((resolve) => {
            const s = app2.listen(0, () => resolve(s));
        });
        const address = srv.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        try {
            const res = await fetch(`http://127.0.0.1:${port}/auth/login`, { redirect: 'manual' });
            expect(res.headers.get('set-cookie')).toContain('; Secure');
        } finally {
            await new Promise<void>((resolve) => srv.close(() => resolve()));
        }
    });
});

describe('POST /auth/pat', () => {
    it('rejects cross-origin POSTs (login CSRF)', async () => {
        const res = await fetch(`${base}/auth/pat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
            body: JSON.stringify({ token: 'x' })
        });
        expect(res.status).toBe(403);
    });

    it('rejects cross-origin logout (logout CSRF)', async () => {
        const res = await fetch(`${base}/auth/logout`, {
            method: 'POST',
            headers: { origin: 'https://evil.example' }
        });
        expect(res.status).toBe(403);
    });

    it('rejects an empty token outside fixtures mode', async () => {
        const res = await fetch(`${base}/auth/pat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: '' })
        });
        expect(res.status).toBe(400);
    });
});
