import { component, useData, useHead } from 'sigx';
import { usePulseApi } from '../api';
import { useSessionStore } from '../stores/session';

/**
 * The org/repo picker — the signed-in landing page. Data flows through the
 * PulseApi seam: SSR renders with the per-request GitHub client (streamed),
 * the client joins the same cells from the __SIGX_ASYNC__ transfer and only
 * refetches on later navigations.
 */
export const Dashboard = component(() => {
    useHead({ title: 'Pulse — your repos' });
    const api = usePulseApi();
    const session = useSessionStore();
    const orgs = useData('viewer-orgs', () => api.viewerOrgs());
    const repos = useData('viewer-repos', () => api.viewerRepos());

    return () => (
        <div class="mx-auto max-w-5xl space-y-6">
            <div class="flex items-baseline justify-between">
                <h1 class="text-2xl font-bold">
                    {session.user ? `Hey ${session.user.login} —` : ''} your repos
                </h1>
                <div class="flex gap-2">
                    {orgs.match({
                        pending: () => <span class="loading loading-dots loading-sm" />,
                        error: () => null,
                        ready: (list) => (
                            <>
                                {list.map((org) => (
                                    <span class="badge badge-outline gap-1" key={org.login}>
                                        <img src={org.avatarUrl} alt="" class="w-4 rounded" />
                                        {org.login}
                                    </span>
                                ))}
                            </>
                        )
                    })}
                </div>
            </div>

            {repos.match({
                pending: () => (
                    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div class="skeleton h-28" key={i} />
                        ))}
                    </div>
                ),
                error: (err) => (
                    <div class="alert alert-error">
                        <span>Couldn't load repos: {err instanceof Error ? err.message : String(err)}</span>
                        <button class="btn btn-sm" onClick={() => repos.refresh()}>Retry</button>
                    </div>
                ),
                ready: (list) => (
                    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-repo-grid>
                        {list.map((repo) => (
                            <div class="card bg-base-100 shadow-sm" key={repo.fullName}>
                                <div class="card-body p-4">
                                    <h2 class="card-title text-base">
                                        {repo.name}
                                        {repo.private && <span class="badge badge-ghost badge-sm">private</span>}
                                    </h2>
                                    <p class="line-clamp-2 min-h-10 text-sm opacity-70">{repo.description ?? 'No description'}</p>
                                    <div class="card-actions items-center justify-between">
                                        <span class="badge badge-primary badge-outline">{repo.openIssues} open issues</span>
                                        <span class="text-xs opacity-50">boards land in M2</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            })}
        </div>
    );
}, { name: 'Dashboard' });
