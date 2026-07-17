import { defineApp } from 'sigx';
import { cachePlugin } from '@sigx/cache';
import { App } from './App';
import { createServerRouter } from './routes';
import { usePulseApi, type PulseApi } from './api';
import { useRequestUser, type SessionUser } from './session';
import './styles.css';

/** Everything the server resolves per request before the render. */
export interface RequestContext {
    user: SessionUser | null;
    /** The per-request GitHub client wrapped as the PulseApi seam. */
    api: PulseApi | null;
}

/**
 * The per-request app factory (the entry contract — core
 * docs/router-ssr-contract.md §1): a FRESH app + router scoped to this URL,
 * so concurrent SSR can't interleave. Both request handlers consume this
 * export. The second parameter is the request's context — the signed-in
 * user plus the PulseApi seam over the request's GitHub client — resolved
 * by server.mjs. The user rides DI (useRequestUser) so the auth guard sees
 * it pre-render, and App's setup seeds the session store during component
 * resolution (the only place ssrState can register — store#63). `null`
 * renders signed-out.
 *
 * NOTE: the dev handler currently drops the second argument (core#304) —
 * server.mjs carries an AsyncLocalStorage workaround until that ships.
 */
export async function createApp(url: string, ctx: RequestContext | null = null) {
    const app = defineApp(<App />);
    app.use(cachePlugin());

    const resolved = ctx ?? globalThis.__PULSE_DEV_CTX__?.() ?? null;

    // The request's user travels via DI: the guard reads it pre-render, and
    // App's setup seeds the session store INSIDE component resolution — the
    // only place ssrState can register the transfer slice (store#63).
    app.defineProvide(useRequestUser, () => resolved?.user ?? null);
    if (resolved?.api) {
        app.defineProvide(usePulseApi, () => resolved.api!);
    }

    const router = createServerRouter(url);
    app.use(router);
    await router.isReady();

    return app;
}
