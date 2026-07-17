import { defineApp } from 'sigx';
import { cachePlugin } from '@sigx/cache';
import { App } from './App';
import { createServerRouter } from './routes';
import './styles.css';

/**
 * The per-request app factory (the entry contract — core
 * docs/router-ssr-contract.md §1): a FRESH app + router scoped to this URL,
 * so concurrent SSR can't interleave. Both request handlers consume this
 * export: `createDevRequestHandler` (dev) and `createRequestHandler`
 * (prod). Async is fine — the handlers await the factory, which is where
 * `router.isReady()` (initial navigation + guards) settles.
 *
 * Guard-driven HTTP redirects (contract §3) arrive with the auth guard in
 * M1 step 3: after isReady(), `currentRoute.redirectedFrom` signals that a
 * guard rewrote the URL, and the render surfaces it through useResponse().
 */
export async function createApp(url: string) {
    const app = defineApp(<App />);
    app.use(cachePlugin());

    const router = createServerRouter(url);
    app.use(router);
    await router.isReady();

    return app;
}
