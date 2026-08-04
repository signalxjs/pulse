/**
 * The server app (rfc-server-v4 §3) — the ONE place app-wide server-fn
 * policy lives. Pulse needs only the authenticator: the default
 * authorization is the built-in `requireAuthenticated`, so every server
 * function denies anonymous callers on every transport unless it declares
 * `allowAnonymous: true` (the PAT sign-in is the one that does).
 *
 * Wiring: dev — `sigxServer({ serverApp: '/src/server-app.ts' })` loads
 * this module through the SSR module runner (edits apply without a
 * restart); prod — the build injects a side-effect import of it at the top
 * of `virtual:sigx-server-fns`, so both the node server (which imports the
 * emitted registry chunk) and the Cloudflare entry evaluate it before
 * serving. Hardening, not a dependency: an un-imported server-app module
 * DENIES (fail-closed), it never opens.
 */
import { createServerApp } from '@sigx/server/server';
import { authenticate, type Principal } from './server/auth.server';

export const app = createServerApp<Principal>({ authenticate });
