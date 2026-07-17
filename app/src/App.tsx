import { component } from 'sigx';
import { RouterView, Link, useRoute, useRouter } from '@sigx/router';
import { useResponse } from '@sigx/server-renderer';
import { ThemeProvider } from '@sigx/daisyui';
import { useSessionStore } from './stores/session';
import { useRequestUser } from './session';
import { NotFound } from './pages/NotFound';

/**
 * The Pulse app shell — top navigation + the routed page. Everything below
 * the navbar renders through RouterView; nested layouts (repo tabs, board)
 * mount their own RouterView per the route table.
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

    return () => (
        <ThemeProvider defaultTheme="dim" darkMode>
            <div class="min-h-screen bg-base-200">
                <div class="navbar bg-base-100 shadow-sm">
                    <div class="flex-1">
                        <Link to="/" class="btn btn-ghost text-xl">
                            <span class="text-primary">●</span> Pulse
                        </Link>
                    </div>
                    <div class="flex-none">
                        {session.user ? (
                            <div class="flex items-center gap-2">
                                <img
                                    src={session.user.avatarUrl}
                                    alt={session.user.login}
                                    class="w-8 rounded-full"
                                />
                                <span class="text-sm opacity-80">{session.user.login}</span>
                                <button class="btn btn-ghost btn-sm" onClick={signOut}>
                                    Sign out
                                </button>
                            </div>
                        ) : (
                            <Link to="/login" class="btn btn-ghost btn-sm">
                                Sign in
                            </Link>
                        )}
                    </div>
                </div>
                <main class="p-4">
                    {/* Catch-all fallback in the shell: a '/*rest' route
                        would outrank '/' (router#58) — swap back to a real
                        catch-all route when the matcher fix ships. */}
                    {route.matched.length === 0 ? <NotFound /> : <RouterView />}
                </main>
            </div>
        </ThemeProvider>
    );
}, { name: 'App' });
