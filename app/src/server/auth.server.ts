/**
 * withAuth — the auth seam for server functions. Definition-level `use:`
 * middleware runs on EVERY transport (RPC and in-process SSR calls alike),
 * so a function that lists it can never be reached unauthenticated —
 * unlike route-level middleware, which a new mount could forget.
 *
 * Cookie → session → `rq.locals.user` + `rq.locals.gh` (this session's
 * GitHub client), or a thrown 401 `ServerFnError` (the deliberate error
 * channel: passes the wire verbatim, never masked to a 500).
 */
import { ServerFnError } from '@sigx/server';
import type { ServerFnContext, ServerFnGuard } from '@sigx/server';
import { getSession } from '@pulse/auth';
import type { SessionUser } from '@pulse/auth';
import type { GitHubClient } from '@pulse/github';
import { services } from './services.server';

/** What `withAuth` guarantees is on `rq.locals` for the handler. */
export interface AuthedLocals {
    user: SessionUser;
    gh: GitHubClient;
}

export const withAuth: ServerFnGuard = async (rq) => {
    const { sessions, secret, makeGitHubClient } = services();
    // `rq.request` is the WinterCG Request — over RPC it is the HTTP
    // request; in-process (SSR) it resolves from the ambient scope the
    // document handler opened (rfc-server §7). getSession is structural
    // ({ headers: { cookie } }), so bridge the Headers object explicitly.
    const cookie = rq.request.headers.get('cookie') ?? undefined;
    const session = await getSession({ headers: { cookie } }, sessions, secret);
    if (!session) throw new ServerFnError(401, 'sign in required');
    rq.locals.user = session.user;
    rq.locals.gh = makeGitHubClient(session.token);
};

/** Typed view of what {@link withAuth} stashed — for handlers using it. */
export function authed(rq: ServerFnContext): AuthedLocals {
    return rq.locals as unknown as AuthedLocals;
}
