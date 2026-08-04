/**
 * The auth seam for server functions (rfc-server-v4, core 0.15): the old
 * `withAuth` guard did three jobs — verify the cookie, throw 401, stash
 * `rq.locals` — and the guard split cuts it into the app's `authenticate`
 * (below, wired once in `src/server-app.ts`) plus the built-in
 * `requireAuthenticated` default policy. Every server function inherits the
 * identity gate from the app on EVERY transport (RPC and in-process SSR
 * calls alike) unless it declares `allowAnonymous: true`, so a function can
 * still never be reached unauthenticated — now without listing anything.
 *
 * Cookie → session → {@link Principal} (`user` + this session's GitHub
 * client), or `null` for anonymous — the pipeline's identity gate answers
 * the 401 (the deliberate error channel: passes the wire verbatim, never
 * masked to a 500).
 */
import { requirePrincipal } from '@sigx/server';
import type { ServerFnContext } from '@sigx/server';
import { getSession } from '@pulse/auth';
import type { SessionUser } from '@pulse/auth';
import type { GitHubClient } from '@pulse/github';
import { services } from './services.server';

/** The authenticated caller — what {@link authenticate} resolves. */
export interface Principal {
    user: SessionUser;
    gh: GitHubClient;
}

/** The app authenticator (`createServerApp({ authenticate })`) — memoized
 *  once per request store, so one SSR render with many cells decodes the
 *  session once. Returns `null` for anonymous, never throws for a bad
 *  cookie: the deny is the identity gate's job. */
export async function authenticate(rq: ServerFnContext): Promise<Principal | null> {
    const { sessions, secret, makeGitHubClient } = services();
    // `rq.request` is the WinterCG Request — over RPC it is the HTTP
    // request; in-process (SSR) it resolves from the ambient scope the
    // document handler opened (rfc-server §7). getSession is structural
    // ({ headers: { cookie } }), so bridge the Headers object explicitly.
    const cookie = rq.request.headers.get('cookie') ?? undefined;
    const session = await getSession({ headers: { cookie } }, sessions, secret);
    if (!session) return null;
    return { user: session.user, gh: makeGitHubClient(session.token) };
}

/** Typed view of this request's principal — for handlers. Inside a
 *  non-`allowAnonymous` handler the identity gate already ran, so the
 *  underlying throw is unreachable and this is a memo hit. */
export function authed(rq: ServerFnContext): Promise<Principal> {
    return requirePrincipal<Principal>(rq);
}
