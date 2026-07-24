// The Cloudflare Worker entry (rfc-deploy §4.1) — user-owned, and THE
// documentation: the composition order is the app's routing policy and
// stays visible here, mirroring app/server.mjs's node composition:
//
//     static assets  →  /auth/*  →  server functions  →  document render
//
// Static assets never reach this code: wrangler's assets config (see
// wrangler.jsonc) serves matching files before the worker is invoked, and
// `html_handling: "none"` keeps the raw outlet index.html from answering
// GET / ahead of the worker.
//
// One deliberate difference from node: server.mjs builds its services at
// boot, but a worker only sees its bindings (env.DB) on a fetch — so the
// registry is built lazily on the FIRST fetch and cached for the isolate's
// lifetime (bindings are stable per isolate). Migrations are NOT applied
// here: `wrangler d1 migrations apply` owns the schema (deploy step; the
// smoke applies them `--local`) — packages/db's runner tracks the same
// `d1_migrations` table, so the two never disagree.
import { createFetchHandler } from '@sigx/server-renderer/server';
import { handleServerFnRequest, matchesServerFn } from '@sigx/server/server';
import { template, assets } from 'virtual:sigx-app';
import { serverFns } from 'virtual:sigx-server-fns';
import { createSessionStore, createAuthHandler, getSession } from '@pulse/auth';
import { createD1Db, type D1DatabaseLike } from '@pulse/db/d1';
import { createLiveClient, createDbEtagCache } from '@pulse/github';
import { createFixturesClient } from '@pulse/github/fixtures';
import { createApp } from './entry-server';
import type { PulseServerServices } from './server/services.server';

/** The Worker env — the D1 binding plus vars (wrangler.jsonc / dashboard). */
export interface Env {
    /** ONE db for the isolate: sessions and the ETag cache share it (like node). */
    DB: D1DatabaseLike;
    /** Cookie-signing / token-encryption secret. REQUIRED — a worker is always production. */
    PULSE_SECRET?: string;
    /** GitHub OAuth app — BOTH or neither (PAT-only sign-in without them). */
    PULSE_OAUTH_CLIENT_ID?: string;
    PULSE_OAUTH_CLIENT_SECRET?: string;
    /** Smoke-only: '1' → tokenless deterministic fixtures adapter. */
    PULSE_FIXTURES?: string;
    /** Smoke-only: '1' → session cookies over plain-http localhost. */
    PULSE_INSECURE_COOKIES?: string;
}

// Crawlers and AI agents get the blocking document: complete content
// inline, nothing for the client to execute. (Same regex as server.mjs.)
const isBot = (ua: string): boolean =>
    /bot|crawl|spider|slurp|gptbot|claudebot|perplexity|headless/i.test(ua);

interface Handlers {
    auth: (request: Request) => Promise<Response | null>;
    document: (request: Request) => Promise<Response>;
}

/** Per-isolate singletons, built on the first fetch from that fetch's env. */
let handlers: Handlers | null = null;

function init(env: Env): Handlers {
    if (handlers) return handlers;
    if (!env.PULSE_SECRET) {
        // A missing secret would make every session forgeable — refuse to serve.
        throw new Error('[pulse] PULSE_SECRET is required (sessions are signed and encrypted with it).');
    }
    const secret = env.PULSE_SECRET;
    // Secure cookies always — except the explicit plain-http localhost
    // opt-out (the smoke): a Secure cookie over http is silently dropped.
    const secureCookies = env.PULSE_INSECURE_COOKIES !== '1';

    const db = createD1Db(env.DB);
    const sessions = createSessionStore({ db, secret });

    // OAuth needs BOTH credentials; the fixtures decision keys off the SAME
    // resolution so a half-configured OAuth app can't silently flip modes.
    const oauth = env.PULSE_OAUTH_CLIENT_ID && env.PULSE_OAUTH_CLIENT_SECRET
        ? { clientId: env.PULSE_OAUTH_CLIENT_ID, clientSecret: env.PULSE_OAUTH_CLIENT_SECRET }
        : undefined;
    // Fixtures is EXPLICIT-only, exactly like node. There is deliberately
    // no GITHUB_TOKEN fallback on this target at all.
    const fixtures = env.PULSE_FIXTURES === '1';
    const etagCache = fixtures ? null : createDbEtagCache(db);
    const fixturesClient = fixtures ? createFixturesClient() : null;
    const makeGitHubClient: PulseServerServices['makeGitHubClient'] = (token) =>
        // etagCache is null exactly when fixturesClient is set — the live
        // arm always carries the cache (`?? undefined` narrows the type).
        fixturesClient ?? createLiveClient({ token, etagCache: etagCache ?? undefined });

    // The service registry server functions reach for at request time —
    // the SAME shape server.mjs publishes (src/server/services.server.ts is
    // the typed accessor); the `use:` chain (withAuth) reads it per call.
    globalThis.__PULSE_SERVER__ = { sessions, etagCache, makeGitHubClient, fixtures, secret };

    const auth = createAuthHandler({
        sessions, secret, fixtures, makeClient: makeGitHubClient, oauth, secureCookies
    });
    const document = createFetchHandler({
        template,
        // Per-request SSR context: the signed-in user, for the auth guard.
        // Page DATA travels through server functions — they resolve this
        // request from the ambient scope the document handler opens
        // (rfc-server §7), so nothing data-shaped needs threading here.
        app: async (url, request) => createApp(url, {
            user: (await getSession(request.headers.get('cookie'), sessions, secret))?.user ?? null
        }),
        isBot,
        document: { assets }
    });

    handlers = { auth, document };
    return handlers;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const { auth, document } = init(env);
        const authResponse = await auth(request);
        if (authResponse) return authResponse;
        if (matchesServerFn(request)) {
            return handleServerFnRequest(request, {
                // The build-emitted registry, explicitly passed, never
                // ambient (the resume-manifest posture). Unauthenticated
                // calls answer 401 from withAuth in each fn's `use:` chain
                // — definition-level, so no transport can skip it.
                resolve: (symbol) => serverFns[symbol]?.() ?? null
            });
        }
        return document(request);
    }
};
