import { component, useHead } from 'sigx';
import { useQuery } from '@sigx/router';
import { useSessionStore } from '../stores/session';

/**
 * Sign in — GitHub OAuth when the server has an OAuth app configured
 * (/auth/login redirects), with a PAT fallback for local dev. In fixtures
 * mode the PAT form accepts anything and grants the fixtures viewer.
 */
export const Login = component((ctx) => {
    useHead({ title: 'Sign in — Pulse' });
    const query = useQuery();
    const session = useSessionStore();
    const token = ctx.signal<string>('');
    const error = ctx.signal('');
    const pending = ctx.signal(false);

    const returnTo = () => {
        const value = query.returnTo;
        const target = typeof value === 'string' ? value : '/';
        return target.startsWith('/') && !target.startsWith('//') ? target : '/';
    };

    async function signInWithPat(e: Event) {
        e.preventDefault();
        pending.value = true;
        error.value = '';
        try {
            const res = await fetch('/auth/pat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token: token.value })
            });
            const body = await res.json();
            if (!res.ok) {
                error.value = body.error ?? 'sign-in failed';
                return;
            }
            window.location.href = returnTo();
        } finally {
            pending.value = false;
        }
    }

    return () => (
        <div class="flex justify-center pt-16">
            <div class="card bg-base-100 w-96 shadow-xl">
                <div class="card-body items-center text-center">
                    <h2 class="card-title">Sign in to Pulse</h2>
                    {session.user ? (
                        <p class="text-sm">
                            Signed in as <b>{session.user.login}</b> — <a class="link" href="/">go to the dashboard</a>.
                        </p>
                    ) : (
                        <>
                            <a
                                class="btn btn-primary w-full"
                                href={`/auth/login?returnTo=${encodeURIComponent(returnTo())}`}
                            >
                                Continue with GitHub
                            </a>
                            <div class="divider text-xs opacity-60">or use a token</div>
                            <form class="w-full space-y-2" onSubmit={signInWithPat}>
                                {/* Two-way: the sigx vite transform compiles
                                    the model getter into a get/set pair —
                                    verified: typed input reaches the POST. */}
                                <input
                                    class="input input-bordered w-full"
                                    type="password"
                                    placeholder="GitHub personal access token"
                                    model={() => token.value}
                                />
                                <button class="btn btn-outline w-full" type="submit" disabled={pending.value}>
                                    {pending.value ? 'Signing in…' : 'Sign in with token'}
                                </button>
                            </form>
                            {error.value && <p class="text-error text-sm">{error.value}</p>}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}, { name: 'Login' });
