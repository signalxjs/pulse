import { component, useHead } from 'sigx';
import { useResponse } from '@sigx/server-renderer';
import { Link } from '@sigx/router';

/**
 * Catch-all 404 — a REAL not-found: the server response carries status 404
 * (useResponse is inert on the client), the page still renders and hydrates.
 */
export const NotFound = component(() => {
    useResponse().status(404);
    useHead({ title: 'Not found — Pulse' });
    return () => (
        <div class="hero min-h-96">
            <div class="hero-content text-center">
                <div>
                    <h1 class="text-6xl font-bold opacity-30">404</h1>
                    <p class="py-4">This page doesn't exist.</p>
                    <Link to="/" class="btn btn-primary btn-sm">
                        Back to the dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}, { name: 'NotFound' });
