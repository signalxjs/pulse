/**
 * The zero-JS PAT sign-in as a `form: true` server function (pulse#57,
 * rfc-server §6.4). One function, two transports:
 *
 * - **No JS / not-yet-loaded** — the native `<form>` POSTs
 *   `application/x-www-form-urlencoded` here (the build stamps
 *   `action="/_sigx/fn/…" method="post"` onto the resume form in
 *   `LoginForm.resume.tsx`); the endpoint validates, signs the viewer in,
 *   and 303s to the returnTo target.
 * - **JS on** — the resume form's submit handler calls this as plain RPC and
 *   redirects the browser itself after it resolves.
 *
 * The token→viewer→session→cookie work is the shared `signInWithPat`
 * primitive — the SAME path `/auth/pat` uses, so the two never drift.
 */
import { serverFn, ServerFnError } from '@sigx/server';
import * as v from 'valibot';
import { signInWithPat, safeReturnTo, SignInError } from '@pulse/auth';
import { services } from '../../server/services.server';

/**
 * Form fields arrive as attacker-typable strings (§5.2b) — the validator is
 * the boundary. `returnTo` is optional (present as a hidden field from the
 * form; omitted is fine over RPC) and re-sanitized server-side regardless.
 */
const PatFormInput = v.object({
    token: v.string(),
    returnTo: v.optional(v.string())
});

export const submitPat = serverFn({
    form: true,
    input: PatFormInput,
    async handler(rq, input: v.InferOutput<typeof PatFormInput>) {
        const { sessions, secret, fixtures, makeGitHubClient, secureCookies } = services();
        let cookie: string;
        try {
            ({ cookie } = await signInWithPat({
                sessions,
                secret,
                fixtures,
                makeClient: makeGitHubClient,
                token: input.token,
                secureCookies
            }));
        } catch (err) {
            // Surface the sign-in status verbatim on BOTH transports: over
            // RPC the message reaches the form's catch; on the native POST
            // it renders the endpoint's error page with the right status.
            if (err instanceof SignInError) throw new ServerFnError(err.status, err.message);
            throw err;
        }
        rq.responseHeaders.append('set-cookie', cookie);

        // Relative-only, control-char-free target — the same rule the OAuth
        // flow applies (never trust a client-supplied redirect).
        const target = safeReturnTo(input.returnTo);

        // Native form POST (no JS): answer a 303 POST-redirect-GET to the
        // target. Over RPC (JS on) the client navigates itself once this
        // resolves, so leave the JSON envelope a 200 — a 303 there would make
        // `fetch` follow it and the stub choke on the returned HTML.
        const contentType = rq.request.headers.get('content-type') ?? '';
        const isNativeForm =
            contentType.startsWith('application/x-www-form-urlencoded') ||
            contentType.startsWith('multipart/form-data');
        if (isNativeForm) {
            rq.responseHeaders.set('location', target);
            rq.status(303);
        }

        // The RPC caller uses this to navigate (the server's sanitized
        // target, not a value the client re-derives).
        return { returnTo: target };
    }
});
