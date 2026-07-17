import { component } from 'sigx';
import { RouterView, Link, useRoute } from '@sigx/router';
import { ThemeProvider } from '@sigx/daisyui';
import { NotFound } from './pages/NotFound';

/**
 * The Pulse app shell — top navigation + the routed page. Everything below
 * the navbar renders through RouterView; nested layouts (repo tabs, board)
 * mount their own RouterView per the route table.
 */
export const App = component(() => {
    const route = useRoute();
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
                        <Link to="/login" class="btn btn-ghost btn-sm">
                            Sign in
                        </Link>
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
