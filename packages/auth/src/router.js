/**
 * The auth HTTP surface (mount under /auth):
 *
 * - GET  /login     → GitHub OAuth authorize redirect (CSRF state cookie);
 *                     303 to /login?pat=1 when no OAuth app is configured.
 * - GET  /callback  → state check, code→token exchange, session + cookie.
 * - POST /pat       → PAT sign-in (dev fallback; fixtures mode accepts
 *                     anything and grants the fixtures viewer).
 * - POST /logout    → destroy session, clear cookie.
 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { sign, verify, readCookie, cookieHeader, SESSION_COOKIE, STATE_COOKIE } from './cookies.js';

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/**
 * Same-origin relative paths only — an absolute returnTo is an open
 * redirect, and control characters (CR/LF) would throw inside
 * res.redirect() when the value round-trips through the state cookie.
 */
function safeReturnTo(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
    // The value rides inside the signed state cookie and a Location header —
    // bound it well under common 4-8 KB header limits.
    if (value.length > 1024) return '/';
    return value;
}

/**
 * Drop explicit default ports so 'example.com:443' == 'example.com'.
 * @param {string} host
 */
function normalizeHost(host) {
    return host.toLowerCase().replace(/:(443|80)$/, '');
}

/**
 * Login/logout CSRF guard: browsers send an Origin header on cross-site
 * POSTs — when present it must match the request Host. Requests without an
 * Origin (curl, server-to-server, some same-origin cases) pass.
 * @param {import('express').Request} req
 */
function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = req.headers.host;
    if (!host) return false;
    try {
        return normalizeHost(new URL(origin).host) === normalizeHost(host);
    } catch {
        return false;
    }
}

/**
 * @param {import('./index.js').AuthRouterOptions} options
 * @returns {import('express').Router}
 */
export function createAuthRouter(options) {
    const { sessions, secret, fixtures, makeClient, oauth } = options;
    if (!secret) throw new Error('createAuthRouter: a secret is required — an empty secret makes cookies forgeable');
    if (!sessions) throw new Error('createAuthRouter: a SessionStore is required');
    if (typeof makeClient !== 'function') throw new Error('createAuthRouter: makeClient(token) is required');
    const doFetch = options.fetch ?? fetch;
    const router = express.Router();
    // /pat carries one small token — no reason to accept large bodies.
    router.use(express.json({ limit: '4kb' }));

    /** @param {import('express').Response} res @param {string} sid */
    function setSessionCookie(res, sid) {
        res.append('set-cookie', cookieHeader(SESSION_COOKIE, sign(sid, secret)));
    }

    router.get('/login', (req, res) => {
        const returnTo = safeReturnTo(req.query.returnTo);
        if (!oauth) {
            res.redirect(303, `/login?pat=1&returnTo=${encodeURIComponent(returnTo)}`);
            return;
        }
        const state = randomUUID();
        res.append('set-cookie', cookieHeader(STATE_COOKIE, sign(`${state}:${returnTo}`, secret), { maxAge: 600 }));
        const url = new URL(GITHUB_AUTHORIZE);
        url.searchParams.set('client_id', oauth.clientId);
        url.searchParams.set('scope', 'repo read:org');
        url.searchParams.set('state', state);
        res.redirect(302, url.href);
    });

    router.get('/callback', async (req, res) => {
        try {
            if (!oauth) {
                res.status(404).json({ error: 'OAuth is not configured' });
                return;
            }
            const staged = verify(readCookie(req, STATE_COOKIE), secret);
            const [state, ...rest] = (staged ?? '').split(':');
            const returnTo = safeReturnTo(rest.join(':'));
            if (!state || req.query.state !== state) {
                // A mismatched state is spent — clear it so a retry starts
                // from a freshly issued state cookie, never a replay.
                res.append('set-cookie', cookieHeader(STATE_COOKIE, '', { clear: true }));
                res.status(403).json({ error: 'OAuth state mismatch' });
                return;
            }
            // The state is SPENT the moment it validates — a later failure
            // (missing code, exchange error) must not leave it replayable.
            res.append('set-cookie', cookieHeader(STATE_COOKIE, '', { clear: true }));
            if (typeof req.query.code !== 'string' || !req.query.code) {
                res.status(400).json({ error: 'missing OAuth code' });
                return;
            }
            const exchange = await doFetch(GITHUB_TOKEN_URL, {
                method: 'POST',
                // The documented shape: form-encoded body, JSON accept.
                headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: oauth.clientId,
                    client_secret: oauth.clientSecret,
                    code: req.query.code
                }).toString()
            });
            // Defensive parse: an upstream/proxy error body may be non-JSON
            // — that's still a 502, not a 500.
            const payload = await exchange.json().catch(() => null);
            if (!exchange.ok || !payload?.access_token) {
                res.status(502).json({ error: 'OAuth token exchange failed' });
                return;
            }
            // Fixtures mode must stay tokenless end-to-end: a real OAuth
            // token stored here would make /api/github build a LIVE client.
            const storedToken = fixtures ? 'fixtures' : payload.access_token;
            const user = await makeClient(storedToken).viewer();
            const sid = sessions.create(user, storedToken);
            setSessionCookie(res, sid);
            res.redirect(303, returnTo);
        } catch (err) {
            console.error('[pulse] OAuth callback failed:', err);
            res.status(500).json({ error: 'sign-in failed' });
        }
    });

    router.post('/pat', async (req, res) => {
        try {
            if (!sameOrigin(req)) {
                res.status(403).json({ error: 'cross-origin sign-in rejected' });
                return;
            }
            const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
            if (!fixtures && !token) {
                res.status(400).json({ error: 'a token is required' });
                return;
            }
            // Fixtures mode: tokenless deterministic sign-in (CI smokes).
            // Live: the PAT proves itself by fetching the viewer.
            const client = makeClient(fixtures ? 'fixtures' : token);
            const user = await client.viewer();
            const sid = sessions.create(user, fixtures ? 'fixtures' : token);
            setSessionCookie(res, sid);
            res.json({ ok: true, user });
        } catch (err) {
            const status = /** @type {any} */ (err)?.status === 401 ? 401 : 502;
            res.status(status).json({ error: status === 401 ? 'invalid token' : 'sign-in failed' });
        }
    });

    router.post('/logout', (req, res) => {
        if (!sameOrigin(req)) {
            res.status(403).json({ error: 'cross-origin logout rejected' });
            return;
        }
        const sid = verify(readCookie(req, SESSION_COOKIE), secret);
        if (sid) sessions.destroy(sid);
        res.append('set-cookie', cookieHeader(SESSION_COOKIE, '', { clear: true }));
        res.json({ ok: true });
    });

    return router;
}

/**
 * @param {{ headers: { cookie?: string } }} req
 * @param {import('./index.js').SessionStore} sessions
 * @param {string} secret
 * @returns {import('./index.js').Session | null}
 */
export function getSession(req, sessions, secret) {
    if (!secret) throw new Error('getSession: a secret is required — an empty secret makes cookies forgeable');
    const sid = verify(readCookie(req, SESSION_COOKIE), secret);
    return sid ? sessions.get(sid) : null;
}
