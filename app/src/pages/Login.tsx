import { component, useHead } from 'sigx';
import { useQuery, Link } from '@sigx/router';
import { useSessionStore } from '../stores/session';
import { LoginForm } from './login/LoginForm.resume';

/**
 * Sign in — GitHub OAuth when the server has an OAuth app configured
 * (/auth/login redirects), with a PAT fallback for local dev. In fixtures
 * mode the PAT form accepts anything and grants the fixtures viewer.
 *
 * The shell (OAuth anchor, session state, router Links) hydrates normally;
 * the PAT `<form>` is a resume boundary (`LoginForm.resume.tsx`) that ships
 * zero JS on load and works as a native `form: true` POST with JS off
 * (pulse#57).
 */
export const Login = component(() => {
    useHead({ title: 'Sign in — Pulse' });
    const query = useQuery();
    const session = useSessionStore();

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
                        {/* The PAT form is a resume boundary: zero JS on
                            load, native `form: true` POST with JS off, RPC
                            upgrade with JS on (pulse#57). */}
                        <LoginForm returnTo={returnTo()} />
                    </>
                )}
            </div>
        </div>
    );
}, { name: 'Login' });
