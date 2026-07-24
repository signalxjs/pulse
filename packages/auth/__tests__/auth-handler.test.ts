/**
 * @vitest-environment node
 *
 * The auth fetch handler's security-critical paths, driven with plain
 * `Request` objects — no HTTP listener, no Express: OAuth state (CSRF),
 * returnTo sanitization (open redirect / header injection), code
 * validation, the PAT flow (same-origin + bounded JSON body), logout, and
 * the null fall-through contract.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { createSessionStore, createAuthHandler, getSession, type SessionStore, type AuthHandlerOptions } from '@pulse/auth';
import { createSqliteDb } from '@pulse/db/sqlite';
import { applyMigrations } from '@pulse/db/migrate';
import { sign, SESSION_COOKIE, STATE_COOKIE } from '../src/cookies.js';

const USER = { login: 'octo', name: null, avatarUrl: 'https://a/u' };
const SECRET = 'test-secret';
const BASE = 'http://127.0.0.1:4823';

const makeClient = (() => ({
    viewer: async () => USER
})) as unknown as AuthHandlerOptions['makeClient'];

async function migratedSessions(): Promise<SessionStore> {
    const db = createSqliteDb();
    await applyMigrations(db, join(process.cwd(), 'app', 'migrations'));
    return createSessionStore({ db, secret: SECRET });
}

function makeHandler(sessions: SessionStore, overrides: Partial<AuthHandlerOptions> = {}) {
    return createAuthHandler({
        sessions,
        secret: SECRET,
        fixtures: false,
        makeClient,
        oauth: { clientId: 'cid', clientSecret: 'cs' },
        fetch: (async () => ({
            ok: true,
            json: async () => ({ access_token: 'gho_test' })
        })) as unknown as typeof fetch,
        ...overrides
    });
}

let sessions: SessionStore;
let handler: (request: Request) => Promise<Response | null>;

beforeAll(async () => {
    sessions = await migratedSessions();
    handler = makeHandler(sessions);
});

const get = (path: string, cookie?: string) =>
    handler(new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} }));

describe('GET /auth/login', () => {
    it('redirects to GitHub authorize with a state param and cookie', async () => {
        const res = (await get('/auth/login?returnTo=/projects'))!;
        expect(res.status).toBe(302);
        const location = res.headers.get('location')!;
        expect(location).toContain('github.com/login/oauth/authorize');
        expect(location).toContain('state=');
        expect(res.headers.get('set-cookie')).toContain(STATE_COOKIE);
    });

    it.each([
        // Already-encoded query values — URLSearchParams decodes exactly
        // once, so the third case delivers LITERAL CR/LF bytes to the
        // sanitizer (the same single-decode Express performed).
        encodeURIComponent('https://evil.example'),
        encodeURIComponent('//evil.example'),
        '/ok%0d%0aSet-Cookie:%20x=1'
    ])('sanitizes returnTo %s to /', async (evil) => {
        const res = (await get(`/auth/login?returnTo=${evil}`))!;
        const cookie = res.headers.get('set-cookie')!;
        // The staged state cookie carries "<state>:<returnTo>"; a hostile
        // returnTo must have collapsed to '/'.
        const staged = decodeURIComponent(cookie.split(';')[0]!.split('=').slice(1).join('='));
        expect(staged.split('.')[0]!.split(':').slice(1).join(':')).toBe('/');
    });

    it('303s to the PAT login page when no OAuth app is configured', async () => {
        const patOnly = makeHandler(sessions, { oauth: undefined });
        const res = (await patOnly(new Request(`${BASE}/auth/login?returnTo=/projects`)))!;
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe('/login?pat=1&returnTo=%2Fprojects');
    });
});

describe('GET /auth/callback', () => {
    it('403s on state mismatch and clears the state cookie', async () => {
        const staged = await sign('right-state:/', SECRET);
        const res = (await get('/auth/callback?state=wrong-state&code=abc', `${STATE_COOKIE}=${encodeURIComponent(staged)}`))!;
        expect(res.status).toBe(403);
        expect(res.headers.get('set-cookie')).toContain(`${STATE_COOKIE}=`);
        expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });

    it('403s with no state cookie at all', async () => {
        const res = (await get('/auth/callback?state=whatever&code=abc'))!;
        expect(res.status).toBe(403);
    });

    it('400s when the code is missing — the state is spent regardless', async () => {
        const staged = await sign('st-1:/', SECRET);
        const res = (await get('/auth/callback?state=st-1', `${STATE_COOKIE}=${encodeURIComponent(staged)}`))!;
        expect(res.status).toBe(400);
        expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    });

    it('502s when the token exchange fails', async () => {
        const failing = makeHandler(sessions, {
            fetch: (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
        });
        const staged = await sign('st-f:/', SECRET);
        const res = (await failing(new Request(`${BASE}/auth/callback?state=st-f&code=abc`, {
            headers: { cookie: `${STATE_COOKIE}=${encodeURIComponent(staged)}` }
        })))!;
        expect(res.status).toBe(502);
    });

    it('signs in and redirects to the staged returnTo on the happy path', async () => {
        const staged = await sign('st-2:/projects', SECRET);
        const res = (await get('/auth/callback?state=st-2&code=abc', `${STATE_COOKIE}=${encodeURIComponent(staged)}`))!;
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe('/projects');
        const cookies = res.headers.getSetCookie();
        // State spent + session issued.
        expect(cookies.some((c) => c.startsWith(`${STATE_COOKIE}=`) && c.includes('Max-Age=0'))).toBe(true);
        const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
        expect(session).toBeDefined();
        // This handler was built without secureCookies — no Secure attribute
        // (a Secure cookie over plain http would be dropped by the client).
        expect(session).not.toContain('Secure');
        // The issued cookie resolves to a real stored session.
        expect((await getSession(session.split(';')[0], sessions, SECRET))?.user.login).toBe('octo');
    });
});

describe('secureCookies', () => {
    it('marks issued cookies Secure when enabled', async () => {
        const secure = makeHandler(sessions, { secureCookies: true });
        const res = (await secure(new Request(`${BASE}/auth/login`)))!;
        expect(res.headers.get('set-cookie')).toContain('; Secure');
    });
});

describe('POST /auth/pat', () => {
    const post = (path: string, init: RequestInit = {}) =>
        handler(new Request(`${BASE}${path}`, { method: 'POST', ...init }));

    it('rejects cross-origin POSTs (login CSRF)', async () => {
        const res = (await post('/auth/pat', {
            headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
            body: JSON.stringify({ token: 'x' })
        }))!;
        expect(res.status).toBe(403);
    });

    it('rejects an empty token outside fixtures mode', async () => {
        const res = (await post('/auth/pat', {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: '' })
        }))!;
        expect(res.status).toBe(400);
    });

    it('413s a body over 4kb — declared via content-length', async () => {
        const res = (await post('/auth/pat', {
            headers: { 'content-type': 'application/json', 'content-length': '5000' }
        }))!;
        expect(res.status).toBe(413);
    });

    it('413s a body over 4kb — actual bytes, regardless of content-length', async () => {
        const res = (await post('/auth/pat', {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'x'.repeat(5000) })
        }))!;
        expect(res.status).toBe(413);
    });

    it('400s malformed JSON', async () => {
        const res = (await post('/auth/pat', {
            headers: { 'content-type': 'application/json' },
            body: '{not json'
        }))!;
        expect(res.status).toBe(400);
    });

    it('signs in with a valid token and a matching same-origin header', async () => {
        const res = (await post('/auth/pat', {
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ token: 'ghp_abc' })
        }))!;
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, user: USER });
        const cookie = res.headers.get('set-cookie')!;
        expect(cookie).toContain(SESSION_COOKIE);
        expect((await getSession(cookie.split(';')[0], sessions, SECRET))?.token).toBe('ghp_abc');
    });

    it('fixtures mode signs in tokenless and never stores the raw input', async () => {
        const fixtures = makeHandler(sessions, { fixtures: true });
        const res = (await fixtures(new Request(`${BASE}/auth/pat`, { method: 'POST' })))!;
        expect(res.status).toBe(200);
        const cookie = res.headers.get('set-cookie')!;
        expect((await getSession(cookie.split(';')[0], sessions, SECRET))?.token).toBe('fixtures');
    });
});

describe('POST /auth/logout', () => {
    it('rejects cross-origin logout (logout CSRF)', async () => {
        const res = (await handler(new Request(`${BASE}/auth/logout`, {
            method: 'POST',
            headers: { origin: 'https://evil.example' }
        })))!;
        expect(res.status).toBe(403);
    });

    it('destroys the session and clears the cookie', async () => {
        const sid = await sessions.create(USER, 'tok');
        const cookie = `${SESSION_COOKIE}=${encodeURIComponent(await sign(sid, SECRET))}`;
        const res = (await handler(new Request(`${BASE}/auth/logout`, {
            method: 'POST',
            headers: { cookie }
        })))!;
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
        expect(await sessions.get(sid)).toBeNull();
    });
});

describe('fall-through contract', () => {
    it('resolves null for paths outside the base', async () => {
        expect(await handler(new Request(`${BASE}/api/github/viewer`))).toBeNull();
        expect(await handler(new Request(`${BASE}/authx/login`))).toBeNull();
    });

    it('resolves null for unknown paths under the base', async () => {
        expect(await handler(new Request(`${BASE}/auth/nope`))).toBeNull();
        expect(await handler(new Request(`${BASE}/auth`))).toBeNull();
    });

    it('resolves null for a non-matching method on a matching path (Express fell through)', async () => {
        expect(await handler(new Request(`${BASE}/auth/login`, { method: 'POST' }))).toBeNull();
        expect(await handler(new Request(`${BASE}/auth/pat`))).toBeNull();
    });

    it('honors a custom base', async () => {
        const custom = makeHandler(sessions, { base: '/account', oauth: undefined });
        expect(await custom(new Request(`${BASE}/auth/login`))).toBeNull();
        expect((await custom(new Request(`${BASE}/account/login`)))!.status).toBe(303);
    });
});

describe('getSession (raw header form)', () => {
    it('accepts the raw cookie header string', async () => {
        const sid = await sessions.create(USER, 'tok');
        const header = `${SESSION_COOKIE}=${encodeURIComponent(await sign(sid, SECRET))}`;
        expect((await getSession(header, sessions, SECRET))?.user.login).toBe('octo');
        expect(await getSession(null, sessions, SECRET)).toBeNull();
    });
});
