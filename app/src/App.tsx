import { component } from 'sigx';
import { RouterView, Link, useRoute, useRouter } from '@sigx/router';
import { useResponse } from '@sigx/server-renderer';
import { useSessionStore } from './stores/session';
import { useRequestUser } from './session';

/**
 * The Pulse app shell. Two layouts (pulse#39): board routes (/b/…) render
 * bare — BoardPage owns the full-viewport planner chrome (handoff §Global
 * Layout: no page scroll, panes scroll internally) — while everything else
 * (login, dashboard, 404) gets the minimal top bar. daisyUI is retired;
 * styling is the token utilities from styles.css.
 */
export const App = component(() => {
    const route = useRoute();
    const router = useRouter();
    // First store touch happens HERE, inside component resolution, so
    // ssrState registers the transfer slice; then seed from the request.
    const session = useSessionStore();
    const requestUser = useRequestUser();
    if (requestUser && !session.user) {
        session.setUser(requestUser);
    }

    // Guard-driven HTTP redirect (router-SSR contract §3): when the initial
    // server-side resolution was redirected (auth guard → /login), surface
    // it as a real 302 instead of rendering the destination under the
    // requested URL. Inert on the client.
    const response = useResponse();
    if (route.redirectedFrom) {
        response.redirect(router.currentRoute.fullPath, 302);
    }

    async function signOut(e: Event) {
        e.preventDefault();
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    }

    return () => {
        // The planner shell is the whole viewport — no app chrome around it.
        if (route.path.startsWith('/b/')) {
            return <RouterView />;
        }
        return (
            <div class="min-h-dvh bg-bg0 text-tx">
                <div data-app-header class="flex items-center justify-between border-b border-bd bg-bg1 px-4 py-2.5">
                    <Link to="/" class="flex items-center gap-2.5 text-tx hover:text-tx">
                        <span class="flex size-[26px] items-center justify-center rounded-[8px] bg-ac shadow-[0_0_0_1px_rgba(255,255,255,.06)_inset]">
                            <span class="size-2 animate-pulse-dot rounded-full bg-white" />
                        </span>
                        <span class="flex flex-col leading-[1.1]">
                            <span class="text-[15px] font-bold tracking-[-.01em]">Pulse</span>
                            <span class="text-[11px] font-normal text-tf">Planning workspace</span>
                        </span>
                    </Link>
                    <div class="flex items-center gap-3">
                        {session.user ? (
                            <>
                                <img
                                    src={session.user.avatarUrl}
                                    alt={session.user.login}
                                    class="size-[26px] rounded-full shadow-[0_0_0_2px_var(--color-bg1)]"
                                />
                                <span class="text-[12.5px] text-tm">{session.user.login}</span>
                                <button
                                    class="cursor-pointer rounded-lg border border-bd bg-bg2 px-2.5 py-1.5 text-[12.5px] text-tm hover:border-bds hover:text-tx"
                                    onClick={signOut}
                                >
                                    Sign out
                                </button>
                            </>
                        ) : (
                            <Link
                                to="/login"
                                class="rounded-lg border border-bd bg-bg2 px-2.5 py-1.5 text-[12.5px] text-tm hover:border-bds hover:text-tx"
                            >
                                Sign in
                            </Link>
                        )}
                    </div>
                </div>
                <main class="p-4">
                    {/* The route table's '/*rest' catch-all renders NotFound
                        for anything unmatched (router#58 fixed in 0.9.0). */}
                    <RouterView />
                </main>
            </div>
        );
    };
}, { name: 'App' });
