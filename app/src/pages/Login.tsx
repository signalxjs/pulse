import { component, useHead } from 'sigx';

/**
 * Sign-in — skeleton. GitHub OAuth (CSRF state) + PAT fallback arrive with
 * packages/auth (pulse#1, M1 step 3).
 */
export const Login = component(() => {
    useHead({ title: 'Sign in — Pulse' });
    return () => (
        <div class="flex justify-center pt-16">
            <div class="card bg-base-100 w-96 shadow-xl">
                <div class="card-body items-center text-center">
                    <h2 class="card-title">Sign in to Pulse</h2>
                    <p class="text-sm opacity-70">
                        GitHub OAuth sign-in lands in the next milestone step.
                    </p>
                    <div class="card-actions">
                        <button class="btn btn-primary" disabled>
                            Continue with GitHub
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}, { name: 'Login' });
