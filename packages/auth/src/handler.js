/**
 * The auth HTTP surface as a WinterCG fetch handler — one
 * `(Request) => Promise<Response | null>` usable from a Cloudflare Worker
 * entry AND from Express locally via a tiny bridge (`app/server/web-bridge.mjs`).
 * `null` means "not mine" (path/method outside the handled routes) — the
 * caller falls through to its next handler, exactly like the old Express
 * router calling next().
 *
 * Routes (default base '/auth'):
 *
 * - GET  /login     → GitHub OAuth authorize redirect (CSRF state cookie);
 *                     303 to /login?pat=1 when no OAuth app is configured.
 * - GET  /callback  → state check, code→token exchange, session + cookie.
 * - POST /pat       → PAT sign-in (dev fallback; fixtures mode accepts
 *                     anything and grants the fixtures viewer).
 * - POST /logout    → destroy session, clear cookie.
 */
import { sign, verify, readCookie, cookieHeader, SESSION_COOKIE, STATE_COOKIE } from './cookies.js';

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

// /pat carries one small token — no reason to accept large bodies. Matches
// the old Express router's `express.json({ limit: '4kb' })`.
const BODY_LIMIT = 4096;

/**
 * Same-origin relative paths only — an absolute returnTo is an open
 * redirect, and control characters (CR/LF) would inject headers when the
 * value round-trips through the state cookie into a Location header.
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
 * POSTs — when present it must match the request's own host. Requests
 * without an Origin (curl, server-to-server, some same-origin cases) pass.
 * @param {Request} request
 * @param {URL} url
 */
function sameOrigin(request, url) {
    const origin = request.headers.get('origin');
    if (!origin) return true;
    try {
        return normalizeHost(new URL(origin).host) === normalizeHost(url.host);
    } catch {
        return false;
    }
}

/**
 * @param {number} status
 * @param {unknown} body
 * @param {string[]} [cookies] set-cookie headers to append
 */
function jsonResponse(status, body, cookies = []) {
    const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return new Response(JSON.stringify(body), { status, headers });
}

/**
 * @param {number} status
 * @param {string} location
 * @param {string[]} [cookies] set-cookie headers to append
 */
function redirect(status, location, cookies = []) {
    const headers = new Headers({ location });
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return new Response(null, { status, headers });
}

/**
 * Bounded JSON body read: reject on the DECLARED size (content-length) and
 * again on the ACTUAL bytes read — a client can lie either way.
 * @param {Request} request
 * @returns {Promise<{ body?: any, error?: Response }>}
 */
async function readJsonBody(request) {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > BODY_LIMIT) {
        return { error: jsonResponse(413, { error: 'request body too large' }) };
    }
    let bytes;
    try {
        bytes = await request.arrayBuffer();
    } catch {
        return { error: jsonResponse(400, { error: 'unreadable request body' }) };
    }
    if (bytes.byteLength > BODY_LIMIT) {
        return { error: jsonResponse(413, { error: 'request body too large' }) };
    }
    if (bytes.byteLength === 0) return { body: undefined };
    try {
        return { body: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch {
        return { error: jsonResponse(400, { error: 'invalid JSON body' }) };
    }
}

/**
 * @param {import('./index.js').AuthHandlerOptions} options
 * @returns {(request: Request) => Promise<Response | null>}
 */
export function createAuthHandler(options) {
    const { sessions, secret, fixtures, makeClient, oauth, secureCookies = false, base = '/auth' } = options;
    if (!secret) throw new Error('createAuthHandler: a secret is required — an empty secret makes cookies forgeable');
    if (!sessions) throw new Error('createAuthHandler: a SessionStore is required');
    if (typeof makeClient !== 'function') throw new Error('createAuthHandler: makeClient(token) is required');
    const doFetch = options.fetch ?? fetch;

    /** Per-handler shorthand: cookieHeader with this handler's Secure policy. */
    /** @type {typeof cookieHeader} */
    const setCookie = (name, value, opts = {}) => cookieHeader(name, value, { ...opts, secure: secureCookies });

    /** @param {string} sid */
    const sessionCookie = async (sid) => setCookie(SESSION_COOKIE, await sign(sid, secret));

    /** @param {URL} url */
    async function login(url) {
        const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
        if (!oauth) {
            return redirect(303, `/login?pat=1&returnTo=${encodeURIComponent(returnTo)}`);
        }
        const state = crypto.randomUUID();
        const staged = setCookie(STATE_COOKIE, await sign(`${state}:${returnTo}`, secret), { maxAge: 600 });
        const authorize = new URL(GITHUB_AUTHORIZE);
        authorize.searchParams.set('client_id', oauth.clientId);
        authorize.searchParams.set('scope', 'repo read:org');
        authorize.searchParams.set('state', state);
        return redirect(302, authorize.href, [staged]);
    }

    /** @param {Request} request @param {URL} url */
    async function callback(request, url) {
        /** Cookies accumulate like res.append() did — every later response carries them. @type {string[]} */
        const cookies = [];
        try {
            if (!oauth) return jsonResponse(404, { error: 'OAuth is not configured' });
            const staged = await verify(readCookie(request.headers.get('cookie'), STATE_COOKIE), secret);
            const [state, ...rest] = (staged ?? '').split(':');
            const returnTo = safeReturnTo(rest.join(':'));
            if (!state || url.searchParams.get('state') !== state) {
                // A mismatched state is spent — clear it so a retry starts
                // from a freshly issued state cookie, never a replay.
                cookies.push(setCookie(STATE_COOKIE, '', { clear: true }));
                return jsonResponse(403, { error: 'OAuth state mismatch' }, cookies);
            }
            // The state is SPENT the moment it validates — a later failure
            // (missing code, exchange error) must not leave it replayable.
            cookies.push(setCookie(STATE_COOKIE, '', { clear: true }));
            const code = url.searchParams.get('code');
            if (!code) return jsonResponse(400, { error: 'missing OAuth code' }, cookies);
            const exchange = await doFetch(GITHUB_TOKEN_URL, {
                method: 'POST',
                // The documented shape: form-encoded body, JSON accept.
                headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: oauth.clientId,
                    client_secret: oauth.clientSecret,
                    code
                }).toString()
            });
            // Defensive parse: an upstream/proxy error body may be non-JSON
            // — that's still a 502, not a 500.
            const payload = await exchange.json().catch(() => null);
            if (!exchange.ok || !payload?.access_token) {
                return jsonResponse(502, { error: 'OAuth token exchange failed' }, cookies);
            }
            // Fixtures mode must stay tokenless end-to-end: a real OAuth
            // token stored here would make the GitHub seam build a LIVE client.
            const storedToken = fixtures ? 'fixtures' : payload.access_token;
            const user = await makeClient(storedToken).viewer();
            const sid = await sessions.create(user, storedToken);
            cookies.push(await sessionCookie(sid));
            return redirect(303, returnTo, cookies);
        } catch (err) {
            console.error('[pulse] OAuth callback failed:', err);
            return jsonResponse(500, { error: 'sign-in failed' }, cookies);
        }
    }

    /** @param {Request} request @param {URL} url */
    async function pat(request, url) {
        try {
            if (!sameOrigin(request, url)) {
                return jsonResponse(403, { error: 'cross-origin sign-in rejected' });
            }
            const parsed = await readJsonBody(request);
            if (parsed.error) return parsed.error;
            const token = typeof parsed.body?.token === 'string' ? parsed.body.token.trim() : '';
            if (!fixtures && !token) {
                return jsonResponse(400, { error: 'a token is required' });
            }
            // Fixtures mode: tokenless deterministic sign-in (CI smokes).
            // Live: the PAT proves itself by fetching the viewer.
            const client = makeClient(fixtures ? 'fixtures' : token);
            const user = await client.viewer();
            const sid = await sessions.create(user, fixtures ? 'fixtures' : token);
            return jsonResponse(200, { ok: true, user }, [await sessionCookie(sid)]);
        } catch (err) {
            const status = /** @type {any} */ (err)?.status === 401 ? 401 : 502;
            return jsonResponse(status, { error: status === 401 ? 'invalid token' : 'sign-in failed' });
        }
    }

    /** @param {Request} request @param {URL} url */
    async function logout(request, url) {
        if (!sameOrigin(request, url)) {
            return jsonResponse(403, { error: 'cross-origin logout rejected' });
        }
        const sid = await verify(readCookie(request.headers.get('cookie'), SESSION_COOKIE), secret);
        if (sid) await sessions.destroy(sid);
        return jsonResponse(200, { ok: true }, [setCookie(SESSION_COOKIE, '', { clear: true })]);
    }

    return async function handleAuthRequest(request) {
        const url = new URL(request.url);
        if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null;
        switch (`${request.method} ${url.pathname.slice(base.length)}`) {
            case 'GET /login': return login(url);
            case 'GET /callback': return callback(request, url);
            case 'POST /pat': return pat(request, url);
            case 'POST /logout': return logout(request, url);
            // Unmatched path/method under the base falls through to the
            // caller's next handler — exactly what the Express router did.
            default: return null;
        }
    };
}

/**
 * Resolve a request's session from the signed cookie, or null. Accepts the
 * raw `cookie` header value (WinterCG callers: `request.headers.get('cookie')`)
 * or a structural request ({ headers: { cookie } } — Express and SSR callers).
 * @param {string | null | undefined | { headers: { cookie?: string } }} source
 * @param {import('./index.js').SessionStore} sessions
 * @param {string} secret
 * @returns {Promise<import('./index.js').Session | null>}
 */
export async function getSession(source, sessions, secret) {
    if (!secret) throw new Error('getSession: a secret is required — an empty secret makes cookies forgeable');
    const sid = await verify(readCookie(source, SESSION_COOKIE), secret);
    return sid ? sessions.get(sid) : null;
}
