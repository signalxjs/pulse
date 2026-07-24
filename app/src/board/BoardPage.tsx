import { component, effect, useData, useHead } from 'sigx';
import { useRoute, useRouter } from '@sigx/router';
import type { BoardConfig } from '@pulse/db';
import { NotFound } from '../pages/NotFound';
import { Sidebar } from './chrome/Sidebar';
import { Header } from './chrome/Header';
import { FilterBar } from './chrome/FilterBar';
import { useBoardUiStore, DEFAULT_ACCENT_HUE } from '../stores/boardUi';
import { boardIssues, boardLabels, boardPeople, getBoard } from '../server/board.server';
import { labelsFor, peopleFor, statusOf } from './derive';
import { boardKeys } from './keys';
import { STATUSES } from './colors';
import { SetupPage } from './SetupPage';
import { VIEWS, isViewKey } from './views';

/**
 * The planner shell (pulse#39 chrome; pulse#40 config guard + live data):
 * a full-viewport flex app — sidebar + main column (header → filter bar →
 * view area), no page scroll, panes scroll internally. Lazy route for
 * `/b/:owner/:repo(/:view)`; `setup` rides the same chunk (SetupPage),
 * any other unknown :view is a real 404. A repo without a stored
 * BoardConfig redirects to setup; with one, the board columns carry REAL
 * per-status counts from the issue working set (cards are the next PR).
 *
 * Async posture: every board read is CLIENT-ONLY (`server: false`) and the
 * config renders through `match()`. Deliberate for now: a cell that
 * settles during streaming SSR makes the renderer emit a component-level
 * $SIGX_REPLACE patch, and hydrating over a replaced board tree leaves
 * vnodes without DOM — the next patch (any navigation) crashes with
 * `parentNode of null` (documented in docs/findings.md; owning-repo issue
 * filed from there). The SSR document therefore ships the static shell +
 * a pending state, and the hydrated client fetches and fills in.
 */
const BoardPage = component(() => {
    const route = useRoute();
    const router = useRouter();
    const ui = useBoardUiStore();
    // Title from the initial params — a full navigation to another board
    // remounts the page (per-route-record keying), so setup-time is enough.
    useHead({ title: `${route.params.owner}/${route.params.repo} — Pulse` });

    const params = () => ({ owner: route.params.owner ?? '', repo: route.params.repo ?? '' });

    // The config guard's read: config null = no board yet → setup. The
    // fetcher WRAPS the null-able result in an object on purpose — a cell
    // value of null is indistinguishable from "no data" in the SSR
    // transfer. Client-only like the rest (see the module comment).
    const cfg = useData(
        () => {
            const { owner, repo } = params();
            return !!owner && !!repo && boardKeys.config(owner, repo);
        },
        async (key) => ({ config: await getBoard({ owner: key[1], repo: key[2] }) }),
        { server: false }
    );

    // Board data — client-only (see the module comment) and gated on a
    // stored config (idle until then; setup owns its own cells).
    const configured = () => cfg.value?.config != null;
    const issues = useData(
        () => configured() && boardKeys.issues(params().owner, params().repo),
        (key) => boardIssues({ owner: key[1], repo: key[2] }),
        { server: false }
    );
    const labels = useData(
        () => configured() && boardKeys.labels(params().owner, params().repo),
        (key) => boardLabels({ owner: key[1], repo: key[2] }),
        { server: false }
    );
    const people = useData(
        () => configured() && boardKeys.people(params().owner, params().repo),
        (key) => boardPeople({ owner: key[1], repo: key[2] }),
        { server: false }
    );

    // No config → the setup flow (client-side replace; SSR renders the
    // shell and the hydrated client navigates). The navigation is DEFERRED
    // a tick: on a fresh document the transferred cfg cell is ready during
    // setup, and navigating inside the hydration walk re-renders the tree
    // mid-walk and corrupts it.
    effect(() => {
        if (import.meta.env.SSR) return;
        if (route.params.view === 'setup') return;
        if (cfg.state === 'ready' && cfg.value?.config === null) {
            setTimeout(() => {
                // Re-check — a save/navigation may have raced the tick.
                if (cfg.state === 'ready' && cfg.value?.config === null && route.params.view !== 'setup') {
                    const { owner, repo } = params();
                    if (owner && repo) void router.replace(`/b/${owner}/${repo}/setup`);
                }
            }, 0);
        }
    });

    /** The board columns for one config, with REAL per-status counts —
     *  the cards themselves (and drag-and-drop) are the next PR. */
    const boardColumns = (config: BoardConfig) => {
        const issueList = issues.value ?? [];
        const counts = new Map<string, number>();
        for (const issue of issueList) {
            const id = statusOf(issue, config);
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        const loading = issues.state !== 'ready';
        return (
            <div class="flex h-full items-start gap-3.5 overflow-x-auto px-[18px] py-4">
                {STATUSES.map((s) => (
                    <section key={s.id} data-column={s.id} class="flex h-full w-[292px] shrink-0 flex-col">
                        <div class="flex items-center gap-2 px-1 pt-0.5 pb-2.5">
                            <span class="size-[9px] rounded-full" style={`background:${s.dot}`} />
                            <span class="text-[12.5px] font-semibold">{s.name}</span>
                            <span data-column-count class="rounded-full bg-bg2 px-[7px] py-px font-mono text-[11px] text-tf">
                                {counts.get(s.id) ?? 0}
                            </span>
                            <div class="flex-1" />
                            <button
                                type="button"
                                aria-label={`New issue in ${s.name}`}
                                class="size-[22px] cursor-pointer rounded-md text-base leading-none text-tf hover:bg-bg2 hover:text-tx"
                            >
                                +
                            </button>
                        </div>
                        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-[9px] overflow-y-auto rounded-xl bg-bg1 p-2">
                            <span class="text-[11.5px] text-tf">
                                {loading
                                    ? 'Loading issues…'
                                    : (counts.get(s.id) ?? 0) === 0
                                        ? 'No issues'
                                        : `${counts.get(s.id)} issue${counts.get(s.id) === 1 ? '' : 's'} — cards land in the next PR`}
                            </span>
                        </div>
                    </section>
                ))}
            </div>
        );
    };

    return () => {
        const { owner, repo } = params();
        const viewParam = route.params.view ?? 'board';
        const isSetup = viewParam === 'setup';
        if (!isSetup && !isViewKey(viewParam)) {
            return <NotFound />;
        }
        const view = isSetup ? null : VIEWS.find((v) => v.key === viewParam)!;

        // The tweak props (handoff §State Management): accentHue re-derives
        // --ac inline on the shell root so every accent utility below
        // follows (--ac2 keeps the palette's -75° offset — 285 → 210);
        // density swaps the metric vars via the data attribute.
        const hue = ui.accentHue;
        const accentStyle = hue === DEFAULT_ACCENT_HUE
            ? undefined
            : `--ac:oklch(0.64 0.16 ${hue});--ac2:oklch(0.72 0.11 ${(hue - 75 + 360) % 360})`;

        // Chrome data from the live reads (client-only cells — empty lists
        // until they arrive; every chrome component renders gracefully
        // without them).
        const issueList = issues.value ?? [];
        const chromeLabels = labels.value ? labelsFor(labels.value, issueList, cfg.value?.config ?? null) : [];
        const team = people.value ? peopleFor(people.value, issueList) : [];

        return (
            <div
                data-board-root
                data-density={ui.density}
                style={accentStyle}
                class="relative flex h-dvh w-full overflow-hidden bg-bg0 text-tx"
            >
                {/* Off-canvas scrim (<900px, handoff §Responsive) */}
                {ui.navOpen && (
                    <button
                        type="button"
                        aria-label="Close navigation"
                        onClick={() => ui.setNavOpen(false)}
                        class="fixed inset-0 z-[55] animate-fade-in cursor-default bg-[rgba(4,5,8,.55)] min-[900px]:hidden"
                    />
                )}
                <Sidebar owner={owner} repo={repo} view={view?.key ?? 'board'} labels={chromeLabels} team={team} />
                <main class="flex h-full min-w-0 flex-1 flex-col bg-bg0">
                    <Header owner={owner} repo={repo} viewTitle={view?.title ?? 'Setup'} avatars={team.slice(0, 4)} />
                    <FilterBar labels={chromeLabels} />
                    <div class="relative min-h-0 flex-1 overflow-hidden">
                        {cfg.match({
                            pending: () => (
                                <div class="flex h-full items-center justify-center">
                                    <span class="text-[11.5px] text-tf">Loading board…</span>
                                </div>
                            ),
                            error: (err, retry) => (
                                <div class="flex h-full flex-col items-center justify-center gap-3">
                                    <span class="text-[12.5px] text-tm">
                                        Couldn't load the board: {err.message}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={retry}
                                        class="cursor-pointer rounded-lg border border-bd bg-bg2 px-2.5 py-1.5 text-[12.5px] text-tm hover:border-bds hover:text-tx"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ),
                            ready: ({ config }) => {
                                if (isSetup) {
                                    return (
                                        <SetupPage
                                            owner={owner}
                                            repo={repo}
                                            existing={config}
                                            onSaved={async () => {
                                                // The guard cell must see the
                                                // new board BEFORE the board
                                                // route renders, or it would
                                                // bounce right back here off
                                                // the cached null.
                                                await cfg.refresh();
                                                void router.push(`/b/${owner}/${repo}`);
                                            }}
                                        />
                                    );
                                }
                                if (config === null) {
                                    // The effect above replaces to /setup a
                                    // tick later — render a quiet interim.
                                    return (
                                        <div class="flex h-full items-center justify-center">
                                            <span class="text-[11.5px] text-tf">
                                                This repo has no board yet — taking you to setup…
                                            </span>
                                        </div>
                                    );
                                }
                                if (view!.key === 'board') {
                                    return boardColumns(config);
                                }
                                return (
                                    <div class="flex h-full items-center justify-center">
                                        <span class="text-[12.5px] text-tf">The {view!.title} view lands in an upcoming PR.</span>
                                    </div>
                                );
                            }
                        })}
                    </div>
                </main>
            </div>
        );
    };
}, { name: 'BoardPage' });

export default BoardPage;
