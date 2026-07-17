import { defineInjectable } from 'sigx';

/** The user shape shared between the auth package and the app. */
export interface SessionUser {
    login: string;
    name: string | null;
    avatarUrl: string;
}

/**
 * The REQUEST's signed-in user — provided by the server entry per request,
 * default null on the client. Pre-render consumers (the auth guard) read
 * this instead of the session store: a store first created outside
 * component resolution can't register its ssrState transfer (store#63), so
 * the store must be first touched inside the component tree (App does it).
 */
export const useRequestUser = defineInjectable<SessionUser | null>(() => null);
