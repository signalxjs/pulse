/**
 * PAT sign-in — the reusable primitive behind BOTH transports (pulse#57):
 * the `/auth/pat` JSON route in `handler.js` and the `form: true` server
 * function `submitPat` (the zero-JS native-form sign-in). The token
 * validation, viewer fetch, session create, and signed-cookie mint live
 * here ONCE so the two paths can never drift.
 *
 * Server-only, JSDoc-typed ESM (runs under the no-transpiler
 * `app/server.mjs` and inside the resume server fn); typed in `index.d.ts`.
 */
import { sign, cookieHeader, SESSION_COOKIE } from './cookies.js';

/**
 * A sign-in failure with an HTTP status the caller maps to its transport's
 * response (400 empty token, 401 invalid token, 502 upstream/GitHub error).
 * A typed error rather than an ad-hoc `{ error }` so both callers branch on
 * `.status` the same way.
 */
export class SignInError extends Error {
    /** @param {number} status @param {string} message */
    constructor(status, message) {
        super(message);
        this.name = 'SignInError';
        /** @type {number} */
        this.status = status;
    }
}

/**
 * Sign a candidate PAT in: validate the token, prove it by fetching the
 * viewer, create a session, and return the signed session `Set-Cookie`
 * value. Throws {@link SignInError} on any failure — never returns a
 * partial result.
 *
 * Fixtures mode is tokenless and deterministic (CI smokes): the raw input
 * is ignored and the session stores the literal `'fixtures'` token, so the
 * GitHub seam keeps returning the fixtures viewer.
 *
 * @param {object} args
 * @param {import('./index.js').SessionStore} args.sessions
 * @param {string} args.secret cookie-signing secret
 * @param {boolean} args.fixtures tokenless deterministic mode
 * @param {(token: string) => import('@pulse/github').GitHubClient} args.makeClient
 * @param {string} args.token the candidate PAT (trimmed here)
 * @param {boolean} [args.secureCookies] set the cookie's Secure attribute
 * @returns {Promise<{ cookie: string, user: import('./index.js').SessionUser }>}
 */
export async function signInWithPat({ sessions, secret, fixtures, makeClient, token, secureCookies = false }) {
    if (!secret) throw new Error('signInWithPat: a secret is required — an empty secret makes cookies forgeable');
    if (typeof makeClient !== 'function') throw new Error('signInWithPat: makeClient(token) is required');
    const clean = typeof token === 'string' ? token.trim() : '';
    if (!fixtures && !clean) throw new SignInError(400, 'a token is required');
    // Fixtures mode must stay tokenless end-to-end: storing the raw input
    // would make the GitHub seam build a LIVE client on the next request.
    const storedToken = fixtures ? 'fixtures' : clean;
    let user;
    try {
        // The PAT proves itself by fetching the viewer (live); fixtures
        // returns the deterministic viewer regardless of the token.
        user = await makeClient(storedToken).viewer();
    } catch (err) {
        const status = /** @type {any} */ (err)?.status === 401 ? 401 : 502;
        throw new SignInError(status, status === 401 ? 'invalid token' : 'sign-in failed');
    }
    const sid = await sessions.create(user, storedToken);
    const cookie = cookieHeader(SESSION_COOKIE, await sign(sid, secret), { secure: secureCookies });
    return { cookie, user };
}
