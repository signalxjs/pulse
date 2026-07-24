import { component } from 'sigx';
import { submitPat } from './pat.server';

/**
 * The PAT sign-in form as a RESUMABLE boundary (pulse#57). This is a
 * `*.resume.tsx` module, so `sigxResume()` extracts the submit handler into
 * a lazily-imported QRL chunk and renders the form with `hydrate: 'never'`:
 * the page ships zero JS for it, and the delegation loader wakes it on the
 * first submit.
 *
 * Because the submit handler captures the `form: true` `submitPat` (plus
 * only named signals and globals), the build ALSO stamps a native
 * `action="/_sigx/fn/…" method="post"` onto the `<form>`. So sign-in works
 * three ways from one definition:
 *
 * - JS off / loader not yet arrived → the browser POSTs the form natively;
 *   `submitPat` 303s to the returnTo target.
 * - JS on → the loader replays the submit through the QRL, which calls
 *   `submitPat` as RPC and navigates to the server-sanitized target.
 *
 * Named = transferred: `error`/`pending` are `ctx.signal(...)` so the
 * transform keys and serializes them; the handler upgrades this one boundary
 * on the first write (disabling the button, surfacing an error) without ever
 * hydrating the rest of the page differently.
 */
export const LoginForm = component<{ returnTo: string }>((ctx) => {
    const error = ctx.signal('');
    const pending = ctx.signal(false);

    return () => (
        <form
            class="w-full space-y-2"
            onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                pending.value = true;
                error.value = '';
                try {
                    const input = Object.fromEntries(new FormData(form)) as { token: string; returnTo?: string };
                    const { returnTo } = await submitPat(input);
                    window.location.href = returnTo;
                } catch (err) {
                    error.value = (err as { message?: string })?.message ?? 'sign-in failed';
                    pending.value = false;
                }
            }}
        >
            {/* The server re-sanitizes this, but carrying it lets the no-JS
                native POST land back on the intended page. */}
            <input type="hidden" name="returnTo" value={ctx.props.returnTo} />
            <input
                class="w-full rounded-lg border border-bd bg-bg2 px-2.5 py-2 text-[12.5px] text-tx outline-none placeholder:text-tf focus:border-ac"
                type="password"
                name="token"
                placeholder="GitHub personal access token"
            />
            <button
                class="w-full cursor-pointer rounded-lg border border-bd bg-bg2 px-3 py-2 text-[12.5px] font-semibold text-tm hover:border-bds hover:text-tx disabled:opacity-60"
                type="submit"
                disabled={pending.value}
            >
                {pending.value ? 'Signing in…' : 'Sign in with token'}
            </button>
            {error.value && <p class="text-[12px] text-[oklch(0.72_0.16_25)]">{error.value}</p>}
        </form>
    );
});
