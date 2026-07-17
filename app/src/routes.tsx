/**
 * The Pulse route table — shared by both entries. Route components stay
 * EAGER in the skeleton; real pages arrive lazy (`component: () =>
 * import(...)`) so each route code-splits, per the router-SSR contract's
 * chunk clause (core docs/router-ssr-contract.md §2).
 */
import { createRouter, createWebHistory, createMemoryHistory } from '@sigx/router';
import type { Router } from '@sigx/router';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';

export const routes = [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/login', name: 'login', component: Login }
    // No '/*rest' catch-all: a wildcard route outranks the literal '/'
    // (router#58) — until the matcher fix ships, the app shell renders
    // NotFound when nothing matched (see App.tsx).
];

/** Per-request server router (memory history at the requested URL). */
export function createServerRouter(url: string): Router {
    return createRouter({
        history: createMemoryHistory({ initialLocation: url }),
        routes
    });
}

/** The one client router, initialised from the current location. */
export function createClientRouter(): Router {
    return createRouter({
        history: createWebHistory(),
        routes
    });
}
