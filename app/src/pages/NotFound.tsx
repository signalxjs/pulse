import { component, useHead } from 'sigx';
import { useResponse } from '@sigx/server-renderer';
import { Link } from '@sigx/router';

/**
 * Catch-all 404 — a REAL not-found: the server response carries status 404
 * (useResponse is inert on the client), the page still renders and hydrates.
 * Also rendered by BoardPage for an invalid :view param.
 */
export const NotFound = component(() => {
    useResponse().status(404);
    useHead({ title: 'Not found — Pulse' });
    return () => (
        <div class="flex min-h-96 items-center justify-center bg-bg0 text-tx">
            <div class="text-center">
                <h1 class="font-mono text-6xl font-bold text-tf opacity-60">404</h1>
                <p class="py-4 text-[12.5px] text-tm">This page doesn't exist.</p>
                <Link
                    to="/"
                    class="inline-block rounded-lg bg-ac px-3 py-1.5 text-[12.5px] font-semibold text-white hover:text-white hover:brightness-[1.08]"
                >
                    Back to the dashboard
                </Link>
            </div>
        </div>
    );
}, { name: 'NotFound' });
