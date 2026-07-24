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

/** A request object decorated with the resolved context (dev path: the
 * handler forwards the raw IncomingMessage, and server.mjs middleware
 * stamps `pulseCtx` on it before rendering). */
interface CtxCarrier {
    pulseCtx?: RequestContext | null;
}

/**
 * The per-request app factory (the entry contract — core
 * docs/router-ssr-contract.md §1): a FRESH app + router scoped to this URL,
 * so concurrent SSR can't interleave. Both request handlers consume this
 * export. The second parameter is the request's context — the signed-in
 * user plus the PulseApi seam over the request's GitHub client — in one of
 * two shapes: the resolved context itself (prod handler, tests), or a
 * request carrying it as `pulseCtx` (dev — the handler forwards the raw
 * IncomingMessage since @sigx/vite 0.13.0, core#304). The user rides DI
 * (useRequestUser) so the auth guard sees it pre-render, and App's setup
 * seeds the session store during component resolution (the pattern
 * store 0.11 documents for request state — store#63). Signed-out semantics
 * are `user: null`.
 */
export async function createApp(url: string, ctxOrReq: RequestContext | CtxCarrier | null = null) {
    const app = defineApp(<App />);
    app.use(cachePlugin());

    const resolved: RequestContext | null =
        ctxOrReq && 'pulseCtx' in ctxOrReq ? ctxOrReq.pulseCtx ?? null
        : (ctxOrReq as RequestContext | null);

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
