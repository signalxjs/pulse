import { defineApp } from 'sigx';
import { cachePlugin } from '@sigx/cache';
import { App } from './App';
import { createServerRouter } from './routes';
import { useSessionStore } from './stores/session';
import type { SessionUser } from './session';
import './styles.css';

/**
 * The per-request app factory (the entry contract — core
 * docs/router-ssr-contract.md §1): a FRESH app + router scoped to this URL,
 * so concurrent SSR can't interleave. Both request handlers consume this
 * export. The second parameter is the request's signed-in user (resolved
 * from the session cookie by server.mjs) — the store seeds from it before
 * the router resolves, so the auth guard sees the truth. `null` renders
 * signed-out.
 *
 * NOTE: the dev handler currently drops the second argument (core#304) —
 * server.mjs carries an AsyncLocalStorage workaround until that ships.
 */
export async function createApp(url: string, user: SessionUser | null = null) {
    const app = defineApp(<App />);
    app.use(cachePlugin());

    // Seed the session store for THIS request before any guard runs. The
    // store transfers to the client via ssrState (store:session slice).
    app.runWithContext(() => {
        useSessionStore().setUser(user ?? globalThis.__PULSE_DEV_SESSION__?.() ?? null);
    });

    const router = createServerRouter(url);
    app.use(router);
    await router.isReady();

    return app;
}
