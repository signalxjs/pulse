import { component, useHead } from 'sigx';

/**
 * The org/repo picker dashboard — skeleton. The real picker (current user,
 * orgs, recent repos via `all()`) lands with packages/github + auth
 * (pulse#1, M1 steps 2-4).
 */
export const Dashboard = component(() => {
    useHead({ title: 'Pulse — planning on top of GitHub' });
    return () => (
        <div class="hero min-h-96">
            <div class="hero-content text-center">
                <div class="max-w-md">
                    <h1 class="text-5xl font-bold">
                        <span class="text-primary">●</span> Pulse
                    </h1>
                    <p class="py-6">
                        Linear-style planning on top of GitHub — boards, issues, and
                        milestones over the repos you already have. Built on SignalX.
                    </p>
                    <div class="badge badge-outline">M1 skeleton — sign in arrives next</div>
                </div>
            </div>
        </div>
    );
}, { name: 'Dashboard' });
