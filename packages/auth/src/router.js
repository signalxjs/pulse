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
    return value;
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
            if (typeof req.query.code !== 'string' || !req.query.code) {
                res.status(400).json({ error: 'missing OAuth code' });
                return;
            }
            const exchange = await doFetch(GITHUB_TOKEN_URL, {
                method: 'POST',
                headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify({
                    client_id: oauth.clientId,
                    client_secret: oauth.clientSecret,
                    code: req.query.code
                })
            });
            const payload = await exchange.json();
            if (!exchange.ok || !payload.access_token) {
                res.status(502).json({ error: 'OAuth token exchange failed' });
                return;
            }
            // Fixtures mode must stay tokenless end-to-end: a real OAuth
            // token stored here would make /api/github build a LIVE client.
            const storedToken = fixtures ? 'fixtures' : payload.access_token;
            const user = await makeClient(storedToken).viewer();
            const sid = sessions.create(user, storedToken);
            res.append('set-cookie', cookieHeader(STATE_COOKIE, '', { clear: true }));
            setSessionCookie(res, sid);
            res.redirect(303, returnTo);
        } catch (err) {
            console.error('[pulse] OAuth callback failed:', err);
            res.status(500).json({ error: 'sign-in failed' });
        }
    });

    router.post('/pat', async (req, res) => {
        try {
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
    const sid = verify(readCookie(req, SESSION_COOKIE), secret);
    return sid ? sessions.get(sid) : null;
}
