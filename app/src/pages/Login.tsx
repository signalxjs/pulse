import { component, useHead } from 'sigx';
import { useQuery, Link } from '@sigx/router';
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
        // Mirror the server's safeReturnTo: relative-only, no control chars.
        // eslint-disable-next-line no-control-regex
        if (!target.startsWith('/') || target.startsWith('//') || /[\u0000-\u001f\u007f]/.test(target) || target.length > 1024) {
            return '/';
        }
        return target;
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
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                error.value = body.error ?? `sign-in failed (${res.status})`;
                return;
            }
            window.location.href = returnTo();
        } catch {
            error.value = 'network error — is the server reachable?';
        } finally {
            pending.value = false;
        }
    }

    return () => (
        <div class="flex justify-center pt-16">
            <div class="flex w-96 flex-col items-center gap-4 rounded-[14px] border border-bd bg-bg1 px-6 py-7 text-center">
                <span class="flex size-9 items-center justify-center rounded-[10px] bg-ac shadow-[0_0_0_1px_rgba(255,255,255,.06)_inset]">
                    <span class="size-2.5 animate-pulse-dot rounded-full bg-white" />
                </span>
                <h2 class="text-[17px] font-bold tracking-[-.01em]">Sign in to Pulse</h2>
                {session.user ? (
                    <p class="text-[12.5px] text-tm">
                        Signed in as <b class="text-tx">{session.user.login}</b> — <Link to="/">go to the dashboard</Link>.
                    </p>
                ) : (
                    <>
                        {/* ?pat=1 = the server told us OAuth isn't
                            configured — the OAuth button would bounce
                            straight back here. */}
                        {query.pat !== '1' && (
                            <>
                                <a
                                    class="w-full rounded-lg bg-ac px-3 py-2 text-center text-[12.5px] font-semibold text-white hover:text-white hover:brightness-[1.08]"
                                    href={`/auth/login?returnTo=${encodeURIComponent(returnTo())}`}
                                >
                                    Continue with GitHub
                                </a>
                                <div class="flex w-full items-center gap-3 text-[10.5px] uppercase tracking-[.08em] text-tf">
                                    <span class="h-px flex-1 bg-bd" />
                                    or use a token
                                    <span class="h-px flex-1 bg-bd" />
                                </div>
                            </>
                        )}
                        {query.pat === '1' && (
                            <p class="text-[11px] text-tf">OAuth isn't configured on this server — sign in with a token.</p>
                        )}
                        <form class="w-full space-y-2" onSubmit={signInWithPat}>
                            {/* Two-way: the sigx vite transform compiles
                                the model getter into a get/set pair —
                                verified: typed input reaches the POST. */}
                            <input
                                class="w-full rounded-lg border border-bd bg-bg2 px-2.5 py-2 text-[12.5px] text-tx outline-none placeholder:text-tf focus:border-ac"
                                type="password"
                                placeholder="GitHub personal access token"
                                model={() => token.value}
                            />
                            <button
                                class="w-full cursor-pointer rounded-lg border border-bd bg-bg2 px-3 py-2 text-[12.5px] font-semibold text-tm hover:border-bds hover:text-tx disabled:opacity-60"
                                type="submit"
                                disabled={pending.value}
                            >
                                {pending.value ? 'Signing in…' : 'Sign in with token'}
                            </button>
                        </form>
                        {error.value && <p class="text-[12px] text-[oklch(0.72_0.16_25)]">{error.value}</p>}
                    </>
                )}
            </div>
        </div>
    );
}, { name: 'Login' });
