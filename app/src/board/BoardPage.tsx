import { component, effect, onMounted, onUnmounted, signal, useData, useHead } from 'sigx';
import { useRoute, useRouter } from '@sigx/router';
import type { BoardConfig, BoardStatusId } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { NotFound } from '../pages/NotFound';
import { Sidebar } from './chrome/Sidebar';
import { Header } from './chrome/Header';
import { FilterBar } from './chrome/FilterBar';
import { useBoardUiStore, DEFAULT_ACCENT_HUE } from '../stores/boardUi';
import { boardIssues, boardLabels, boardPeople, getBoard } from '../server/board.server';
import { moveIssue } from '../server/mutations.server';
import { filterIssues, labelsFor, moveLabels, peopleFor, statusOf } from './derive';
import { boardKeys } from './keys';
import { SetupPage } from './SetupPage';
import { BoardView } from './BoardView';
import { ListView } from './ListView';
import { Toasts } from './components/Toast';
import { IssueDetail } from './overlays/IssueDetail';
import { CommandPalette } from './overlays/CommandPalette';
import { NewIssue } from './overlays/NewIssue';
import { isTypingTarget, shortcutAction } from './shortcuts';
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
    useHead({ title: `${route.params.owner ?? ''}/${route.params.repo ?? ''} — Pulse` });

    const params = () => ({ owner: route.params.owner ?? '', repo: route.params.repo ?? '' });

    /** The single pending setup-redirect tick (null = none queued). */
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

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
            // ONE pending redirect at a time — reactive re-runs while the
            // repo stays unconfigured must not queue duplicate replaces.
            if (redirectTimer !== null) return;
            redirectTimer = setTimeout(() => {
                redirectTimer = null;
                // Re-check — a save/navigation may have raced the tick.
                if (cfg.state === 'ready' && cfg.value?.config === null && route.params.view !== 'setup') {
                    const { owner, repo } = params();
                    if (owner && repo) void router.replace(`/b/${owner}/${repo}/setup`);
                }
            }, 0);
        }
    });

    // ---- Detail slide-over (pulse#54): ?issue=N IS the open state — the
    // panel is shareable and the back button closes it (opening pushed a
    // history entry; closing pushes one without the param).
    const detailNum = (): number | null => {
        const raw = route.query.issue;
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (value === undefined) return null;
        const n = Number(value);
        return Number.isInteger(n) && n > 0 ? n : null;
    };
    const openDetail = (number: number) => {
        void router.push({ path: route.path, query: { ...route.query, issue: String(number) } });
    };
    const closeDetail = () => {
        const query = { ...route.query };
        delete query.issue;
        // REPLACE, not push: opening pushed the ?issue entry, so replacing
        // it on close means Back returns to the pre-open state instead of
        // re-opening the panel (the "back-button closes" contract).
        void router.replace({ path: route.path, query });
    };

    // ---- New-issue modal (pulse#54): local state — nothing else reads it.
    const newIssue = signal<{ open: boolean; status: BoardStatusId | null }>({ open: false, status: null });
    const openNewIssue = (status: BoardStatusId | null = null) => {
        newIssue.status = status;
        newIssue.open = true;
    };

    // ---- Keyboard shortcuts (handoff §Interactions): ONE window keydown,
    // decisions in the pure dispatcher (shortcuts.ts), execution here.
    const onKeydown = (e: KeyboardEvent) => {
        const action = shortcutAction(
            e.key,
            { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey },
            {
                typing: isTypingTarget(e.target),
                paletteOpen: ui.paletteOpen,
                newIssueOpen: newIssue.open,
                detailOpen: detailNum() !== null,
                navOpen: ui.navOpen
            }
        );
        if (action === null) return;
        e.preventDefault();
        switch (action.type) {
            case 'toggle-palette': ui.togglePalette(); break;
            case 'close-palette': ui.closePalette(); break;
            case 'close-new-issue': newIssue.open = false; break;
            case 'close-detail': closeDetail(); break;
            case 'close-nav': ui.setNavOpen(false); break;
            case 'focus-filter':
                document.querySelector<HTMLInputElement>('input[aria-label="Filter issues"]')?.focus();
                break;
            case 'go-view': {
                const { owner, repo } = params();
                void router.push(action.view === 'board' ? `/b/${owner}/${repo}` : `/b/${owner}/${repo}/${action.view}`);
                break;
            }
            case 'new-issue': openNewIssue(); break;
        }
    };
    onMounted(() => {
        if (import.meta.env.SSR) return;
        window.addEventListener('keydown', onKeydown);
    });
    onUnmounted(() => {
        if (import.meta.env.SSR) return;
        window.removeEventListener('keydown', onKeydown);
    });

    /** Optimistic write-through to the issues cell (@sigx/cache mutate —
     *  present with the cache pack installed; a silent no-op otherwise). */
    const mutateIssues = (up: (list: GitHubIssue[]) => GitHubIssue[]): boolean => {
        if (!issues.mutate) return false;
        issues.mutate((current: GitHubIssue[] | null) => up(current ?? []));
        return true;
    };

    /**
     * A card was dropped on a column: patch the issues cell IMMEDIATELY
     * (the same moveLabels derivation the server applies, so statusOf lands
     * the card in the target column), then persist through moveIssue and
     * reconcile from its response — the mutation's declared `invalidates`
     * does not reach mounted cells (findings F15), so reconciliation is
     * explicit. On failure: refetch server truth + toast.
     */
    const onMove = async (config: BoardConfig, number: number, target: BoardStatusId) => {
        const { owner, repo } = params();
        const current = (issues.value ?? []).find((i) => i.number === number);
        if (!current || statusOf(current, config) === target) return;
        const patch = moveLabels(config, current.labels.map((l) => l.name), target);
        // Rebuild label OBJECTS from the patch's names: keep the issue's
        // own, look the added status label up in the repo labels, and as a
        // last resort synthesize a grey — render-only until reconciled.
        const repoLabels = new Map((labels.value ?? []).map((l) => [l.name.toLowerCase(), l]));
        const state = patch.state ?? current.state;
        const optimistic: GitHubIssue = {
            ...current,
            state,
            closedAt: state === 'closed' ? (current.closedAt ?? new Date().toISOString()) : null,
            labels: patch.labels.map((name) =>
                current.labels.find((l) => l.name.toLowerCase() === name.toLowerCase())
                ?? repoLabels.get(name.toLowerCase())
                ?? { name, color: '5f6472', description: null })
        };
        const applied = mutateIssues((list) => list.map((i) => (i.number === number ? optimistic : i)));
        try {
            const updated = await moveIssue({ owner, repo, number, target });
            if (applied) {
                mutateIssues((list) => list.map((i) => (i.number === number ? updated : i)));
            } else {
                issues.refresh();
            }
        } catch (err) {
            // Roll back to server truth — the optimistic value is stale.
            issues.refresh();
            // Errors hold longer than the 2s default — they carry a reason.
            ui.showToast(`Couldn't move #${number}: ${err instanceof Error ? err.message : String(err)}`, 4000);
        }
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
        const boardConfig = cfg.value?.config ?? null;
        const chromeLabels = labels.value ? labelsFor(labels.value, issueList, boardConfig) : [];
        const team = people.value ? peopleFor(people.value, issueList) : [];
        const detail = detailNum();

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
                    <Header
                        owner={owner}
                        repo={repo}
                        viewTitle={view?.title ?? 'Setup'}
                        avatars={team.slice(0, 4)}
                        onNewIssue={() => openNewIssue()}
                    />
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
                                        Couldn't load the board: {err instanceof Error ? err.message : String(err)}
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
                                // Both primary views render the SAME
                                // filtered working set (shared helper —
                                // they can never drift).
                                const working = filterIssues(issueList, {
                                    query: ui.query,
                                    filterLabel: ui.filterLabel
                                });
                                const loading = issues.state !== 'ready';
                                if (view!.key === 'board') {
                                    return (
                                        <BoardView
                                            issues={working}
                                            config={config}
                                            loading={loading}
                                            onMove={(number, target) => void onMove(config, number, target)}
                                            onOpen={openDetail}
                                            onNew={(status) => openNewIssue(status)}
                                        />
                                    );
                                }
                                if (view!.key === 'list') {
                                    return <ListView issues={working} config={config} loading={loading} onOpen={openDetail} />;
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
                {/* ---- Overlays (pulse#54) — over the whole shell ---- */}
                {boardConfig && detail !== null && (
                    <IssueDetail
                        owner={owner}
                        repo={repo}
                        number={detail}
                        config={boardConfig}
                        onClose={closeDetail}
                    />
                )}
                {ui.paletteOpen && (
                    <CommandPalette
                        owner={owner}
                        repo={repo}
                        issues={issueList}
                        config={boardConfig}
                        onOpenIssue={(n) => {
                            ui.closePalette();
                            openDetail(n);
                        }}
                        onNewIssue={() => {
                            ui.closePalette();
                            openNewIssue();
                        }}
                        onSync={() => {
                            ui.closePalette();
                            issues.refresh();
                            ui.showToast('Synced with GitHub');
                        }}
                    />
                )}
                {boardConfig && newIssue.open && (
                    <NewIssue
                        owner={owner}
                        repo={repo}
                        config={boardConfig}
                        initialStatus={newIssue.status}
                        onClose={() => { newIssue.open = false; }}
                        onCreated={(created) => {
                            newIssue.open = false;
                            // Optimistic append; refetch when no cache pack.
                            if (!mutateIssues((list) => [created, ...list])) issues.refresh();
                            ui.showToast(`Issue #${created.number} created`);
                        }}
                    />
                )}
                <Toasts />
            </div>
        );
    };
}, { name: 'BoardPage' });

export default BoardPage;
