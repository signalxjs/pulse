/**
 * The Pulse route table — shared by both entries. Route components stay
 * EAGER in the skeleton; real pages arrive lazy (`component: () =>
 * import(...)`) so each route code-splits, per the router-SSR contract's
 * chunk clause (core docs/router-ssr-contract.md §2).
 */
import { createRouter, createWebHistory, createMemoryHistory } from '@sigx/router';
import type { Router } from '@sigx/router';
import { useSessionStore } from './stores/session';
import { useRequestUser } from './session';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';

export const routes = [
    { path: '/', name: 'dashboard', component: Dashboard, meta: { requiresAuth: true } },
    { path: '/login', name: 'login', component: Login }
    // No '/*rest' catch-all: a wildcard route outranks the literal '/'
    // (router#58, fixed upstream in router#59 — restore once released);
    // until then the app shell renders NotFound when nothing matched.
];

/** Auth guard. Server: reads ONLY the request-user injectable (touching
 * the session store pre-render would kill its ssrState registration —
 * store#63). Client: reads the blob-seeded store. Both resolve inside the
 * app context before the first await (router docs). Signed-out users
 * bounce to /login with a returnTo; on the server the redirect surfaces as
 * a real HTTP 302 (see App.tsx). */
function attachGuards(router: Router): Router {
    router.beforeEach((to) => {
        if (!to.meta?.requiresAuth) return;
        // Server: ONLY the request-user injectable — touching the store
        // here would create it outside component resolution and kill its
        // ssrState registration (store#63). Client: the store (seeded from
        // the blob); the injectable is null there by default.
        const user = import.meta.env.SSR ? useRequestUser() : useSessionStore().user;
        if (!user) {
            return `/login?returnTo=${encodeURIComponent(to.fullPath)}`;
        }
    });
    return router;
}

/** Per-request server router (memory history at the requested URL). */
export function createServerRouter(url: string): Router {
    return attachGuards(createRouter({
        history: createMemoryHistory({ initialLocation: url }),
        routes
    }));
}

/** The one client router, initialised from the current location. */
export function createClientRouter(): Router {
    return attachGuards(createRouter({
        history: createWebHistory(),
        routes
    }));
}
