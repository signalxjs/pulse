/**
 * @pulse/auth — typed surface. Implementation is JSDoc-typed ESM (it runs
 * under the no-transpiler `app/server.mjs`).
 */
import type { GitHubClient, GitHubUser } from '@pulse/github';
import type { PulseDb } from '@pulse/db';

export interface SessionUser extends GitHubUser {}

export interface Session {
    sid: string;
    user: SessionUser;
    /** Decrypted GitHub token for this user (never leaves the server). */
    token: string;
}

export interface SessionStore {
    create(user: SessionUser, token: string): Promise<string>;
    get(sid: string): Promise<Session | null>;
    destroy(sid: string): Promise<void>;
}

/**
 * Session store over any PulseDb; tokens encrypted at rest (AES-256-GCM
 * via WebCrypto, key HKDF-derived from the secret). Requires the
 * `sessions` table — apply the app migrations first.
 */
export function createSessionStore(options: { db: PulseDb; secret: string; ttlMs?: number }): SessionStore;

export interface AuthHandlerOptions {
    sessions: SessionStore;
    secret: string;
    /** Fixtures mode: PAT sign-in accepts anything and grants the fixtures viewer. */
    fixtures: boolean;
    /** Build a GitHub client for a candidate token (PAT validation, OAuth viewer fetch). */
    makeClient(token: string): GitHubClient;
    /** GitHub OAuth app credentials; omit to run PAT-only. */
    oauth?: { clientId: string; clientSecret: string };
    /**
     * Set the Secure attribute on every cookie this handler issues. The
     * caller decides (e.g. isProd && not an insecure-cookie opt-out) — the
     * package never sniffs env vars. Default false.
     */
    secureCookies?: boolean;
    /** OAuth token exchange fetch override (tests). */
    fetch?: typeof fetch;
    /** Path prefix the handler owns. Default '/auth'. */
    base?: string;
}

/**
 * WinterCG fetch handler: GET <base>/login (OAuth redirect), GET
 * <base>/callback (code exchange), POST <base>/pat (PAT sign-in), POST
 * <base>/logout. Resolves to null for any other path/method — the caller
 * falls through to its next handler.
 */
export function createAuthHandler(options: AuthHandlerOptions): (request: Request) => Promise<Response | null>;

/**
 * Resolve the request's session from the signed cookie, or null. Accepts
 * the raw `cookie` header value (`request.headers.get('cookie')`) or a
 * structural request ({ headers: { cookie } }).
 */
export function getSession(source: string | null | undefined | { headers: { cookie?: string } }, sessions: SessionStore, secret: string): Promise<Session | null>;

/**
 * Same-origin relative paths only — an absolute or protocol-relative
 * `returnTo`, one carrying control characters (CR/LF header injection), or
 * one over 1 KB collapses to '/'. Exported so the `form: true` sign-in
 * server function validates the redirect target with the SAME rule the
 * OAuth flow uses.
 */
export function safeReturnTo(value: unknown): string;

/** A sign-in failure carrying the HTTP status the caller maps to a response. */
export class SignInError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}

/**
 * PAT sign-in primitive shared by the `/auth/pat` JSON route and the
 * `form: true` `submitPat` server function: validate the token, prove it by
 * fetching the viewer, create a session, and return the signed session
 * `Set-Cookie` value. Throws {@link SignInError} (status 400/401/502) on
 * failure. Fixtures mode is tokenless and stores the literal `'fixtures'`
 * token.
 */
export function signInWithPat(args: {
    sessions: SessionStore;
    secret: string;
    fixtures: boolean;
    makeClient(token: string): GitHubClient;
    token: string;
    /** Set the Secure attribute on the issued cookie. Default false. */
    secureCookies?: boolean;
}): Promise<{ cookie: string; user: SessionUser }>;
