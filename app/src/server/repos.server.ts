/**
 * Dashboard data — server functions (rfc-server). The import IS the seam:
 * components call these as plain typed async functions; the client build
 * swaps this module for fetch stubs (POST /_sigx/fn/<symbol>), SSR calls
 * in-process with the ambient request context. GitHub errors thrown by the
 * client (GitHubApiError) surface as the generic 500 envelope — internals
 * never cross the wire; the deliberate channel is ServerFnError. Access is
 * the app default (`requireAuthenticated`, via src/server-app.ts) — the
 * identity gate runs on every transport before the handler.
 */
import { serverFn } from '@sigx/server';
import type { PulseOrg, PulseRepo } from '../types';
import { authed } from './auth.server';

/** Repos the signed-in viewer can access, most recently pushed first. */
export const viewerRepos = serverFn({
    async handler(rq): Promise<PulseRepo[]> {
        return (await authed(rq)).gh.viewerRepos();
    }
});

/** Organizations the signed-in viewer belongs to. */
export const viewerOrgs = serverFn({
    async handler(rq): Promise<PulseOrg[]> {
        return (await authed(rq)).gh.viewerOrgs();
    }
});
