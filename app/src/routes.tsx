/**
 * The Pulse route table — shared by both entries. The board is the first
 * LAZY route: `lazy(() => import(...))` code-splits BoardPage into its own
 * chunk, per the router-SSR contract's chunk clause (core
 * docs/router-ssr-contract.md §2). Note router 0.10's lazy API: RouterView
 * requires a `lazy()`-wrapped factory — a bare `() => import(...)` record
 * (which RouteRecordRaw's type still admits) renders null with a console
 * warning. A beforeResolve hook preloads matched lazy components so
 * navigations (and the SSR render) settle only after the chunk is loaded —
 * SSR renders the real page, hydration matches, client-side switches never
 * flash a blank frame.
 */
import { lazy, isLazyComponent } from 'sigx';
import { createRouter, createWebHistory, createMemoryHistory } from '@sigx/router';
import type { Router } from '@sigx/router';
import { useSessionStore } from './stores/session';
import { useRequestUser } from './session';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';

const BoardPage = lazy(() => import('./board/BoardPage'));

export const routes = [
    { path: '/', name: 'dashboard', component: Dashboard, meta: { requiresAuth: true } },
    { path: '/login', name: 'login', component: Login },
    // ONE lazy page for both board shapes; BoardPage validates :view
    // (board|list|roadmap|sprint|backlog, default 'board') and renders
    // NotFound — a real 404 — for anything else.
    { path: '/b/:owner/:repo', name: 'board', component: BoardPage, meta: { requiresAuth: true } },
    { path: '/b/:owner/:repo/:view', name: 'board-view', component: BoardPage, meta: { requiresAuth: true } },
    // Real catch-all 404: router#58 (fixed in @sigx/router 0.9.0) means the
    // literal '/' now outranks this wildcard, so it no longer shadows the
    // home route. Anything unmatched renders NotFound (which sets HTTP 404).
    { path: '/*rest', name: 'not-found', component: NotFound }
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
    // Preload lazy route chunks BEFORE the navigation settles (see the
    // module comment) — router.isReady() therefore also waits for them.
    router.beforeResolve(async (to) => {
        await Promise.all(to.matched.map((m) => {
            const c = m.component;
            // isLazyComponent's `any` predicate can't narrow the record
            // union, so reach for preload() through a structural view.
            return c && isLazyComponent(c)
                ? (c as unknown as { preload(): Promise<unknown> }).preload()
                : Promise.resolve();
        }));
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
