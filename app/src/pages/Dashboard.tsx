import { component, useData, useHead } from 'sigx';
import { Link } from '@sigx/router';
import { viewerOrgs, viewerRepos } from '../server/repos.server';
import { useSessionStore } from '../stores/session';

/**
 * The org/repo picker — the signed-in landing page. Data flows through
 * server functions (rfc-server): `useData(fn)` keys the cell on the fn's
 * build-stamped stable id. SSR calls the fn in-process with the ambient
 * request (streamed), the client joins the same cells from the
 * __SIGX_ASYNC__ transfer and only refetches — through the typed fetch
 * stubs — on later navigations. Repo cards are the board entry points:
 * each links to /b/:owner/:repo (pulse#39). Link keeps the custom class —
 * F4 (router#30, Link dropping `class`) is fixed in @sigx/router 0.10.
 */
export const Dashboard = component(() => {
    useHead({ title: 'Pulse — your repos' });
    const session = useSessionStore();
    const orgs = useData(viewerOrgs);
    const repos = useData(viewerRepos);

    return () => (
        <div class="mx-auto max-w-5xl space-y-6 py-4">
            <div class="flex items-baseline justify-between">
                <h1 class="text-xl font-bold tracking-[-.01em]">
                    {session.user ? `Hey ${session.user.login} —` : ''} your repos
                </h1>
                <div class="flex gap-2">
                    {orgs.match({
                        pending: () => <span class="text-[11px] text-tf">…</span>,
                        error: () => null,
                        ready: (list) => (
                            <>
                                {list.map((org) => (
                                    <span
                                        class="flex items-center gap-1.5 rounded-full border border-bd px-2.5 py-1 text-[11.5px] text-tm"
                                        key={org.login}
                                    >
                                        <img src={org.avatarUrl} alt="" class="size-4 rounded" />
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
                    <div class="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div class="h-28 animate-pulse rounded-[10px] border border-bd bg-bg1" key={i} />
                        ))}
                    </div>
                ),
                error: (err) => (
                    <div class="flex items-center justify-between rounded-[10px] border border-[oklch(0.65_0.19_25_/_0.3)] bg-[oklch(0.65_0.19_25_/_0.1)] px-4 py-3 text-[12.5px] text-[oklch(0.82_0.11_25)]">
                        <span>Couldn't load repos: {err instanceof Error ? err.message : String(err)}</span>
                        <button
                            class="cursor-pointer rounded-lg border border-bd bg-bg2 px-2.5 py-1.5 text-tm hover:border-bds hover:text-tx"
                            onClick={() => repos.refresh()}
                        >
                            Retry
                        </button>
                    </div>
                ),
                ready: (list) => (
                    <div class="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3" data-repo-grid>
                        {/* Note: Link forwards only its typed props
                            (class/style survive — F4 fixed in router 0.10 —
                            but data-* attributes are dropped), so the smoke
                            targets `a[href^="/b/"]`. */}
                        {list.map((repo) => (
                            <Link
                                to={`/b/${repo.owner}/${repo.name}`}
                                key={repo.fullName}
                                class="group flex flex-col gap-2 rounded-[10px] border border-bd bg-bg2 p-3.5 text-tx transition-colors duration-100 hover:border-bds hover:bg-bg3 hover:text-tx"
                            >
                                <span class="flex items-center gap-2">
                                    <span class="truncate text-[13px] font-semibold">{repo.name}</span>
                                    {repo.private && (
                                        <span class="rounded-full border border-bd px-2 py-px text-[10.5px] text-tf">private</span>
                                    )}
                                </span>
                                <span class="line-clamp-2 min-h-10 text-[12.5px] leading-[1.4] text-tm">
                                    {repo.description ?? 'No description'}
                                </span>
                                <span class="flex items-center justify-between">
                                    <span class="rounded-full border border-[oklch(0.62_0.14_285_/_0.3)] bg-[oklch(0.62_0.14_285_/_0.15)] px-2 py-px font-mono text-[10.5px] text-[oklch(0.82_0.11_285)]">
                                        {repo.openIssues} open issues
                                    </span>
                                    <span class="text-[11px] text-tf transition-colors group-hover:text-tm">open board →</span>
                                </span>
                            </Link>
                        ))}
                    </div>
                )
            })}
        </div>
    );
}, { name: 'Dashboard' });
