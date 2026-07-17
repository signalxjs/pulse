import { defineStore } from '@sigx/store';
import { ssrState } from '@sigx/store/ssr';
import type { SessionUser } from '../session';

/**
 * The signed-in user — seeded on the server from the request's session (see
 * entry-server), transferred to the client via the store's `ssrState()`
 * (one `store:session` slice in the page's `__SIGX_ASYNC__` blob), and read
 * by the router guard and the navbar.
 */
export const useSessionStore = defineStore('session', (ctx) => {
    const { state, signals, patch } = ctx.defineState({
        user: null as SessionUser | null
    });
    ssrState(ctx, { state, patch });

    const actions = ctx.defineActions({
        setUser(user: SessionUser | null) {
            patch((s) => {
                s.user = user;
            });
        }
    });

    return { ...signals, ...actions };
});
