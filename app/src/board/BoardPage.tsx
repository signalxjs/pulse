import { component, useHead } from 'sigx';
import { useRoute } from '@sigx/router';
import { NotFound } from '../pages/NotFound';
import { Sidebar } from './chrome/Sidebar';
import { Header } from './chrome/Header';
import { FilterBar } from './chrome/FilterBar';
import { useBoardUiStore, DEFAULT_ACCENT_HUE } from '../stores/boardUi';
import { STATUSES } from './colors';
import { VIEWS, isViewKey } from './views';

/**
 * The planner shell (pulse#39 — handoff §Global Layout): a full-viewport
 * flex app — sidebar + main column (header → filter bar → view area), no
 * page scroll, panes scroll internally. Lazy route for both
 * `/b/:owner/:repo` and `/b/:owner/:repo/:view`; an unknown :view is a
 * real 404. This PR ships the chrome and an empty board scaffold — the
 * five data views land in the next PRs.
 */
const BoardPage = component(() => {
    const route = useRoute();
    const ui = useBoardUiStore();
    // Title from the initial params — a full navigation to another board
    // remounts the page (per-route-record keying), so setup-time is enough.
    useHead({ title: `${route.params.owner}/${route.params.repo} — Pulse` });

    return () => {
        const owner = route.params.owner ?? '';
        const repo = route.params.repo ?? '';
        const viewParam = route.params.view ?? 'board';
        if (!isViewKey(viewParam)) {
            return <NotFound />;
        }
        const view = VIEWS.find((v) => v.key === viewParam)!;

        // The tweak props (handoff §State Management): accentHue re-derives
        // --ac inline on the shell root so every accent utility below
        // follows (--ac2 keeps the palette's -75° offset — 285 → 210);
        // density swaps the metric vars via the data attribute.
        const hue = ui.accentHue;
        const accentStyle = hue === DEFAULT_ACCENT_HUE
            ? undefined
            : `--ac:oklch(0.64 0.16 ${hue});--ac2:oklch(0.72 0.11 ${(hue - 75 + 360) % 360})`;

        return (
            <div
                data-board-root
                data-density={ui.density}
                style={accentStyle}
                class="relative flex h-dvh w-full overflow-hidden bg-bg0 text-tx"
            >
                {/* Off-canvas scrim (<900px, handoff §Responsive) */}
                {ui.navOpen && (
                    <div
                        onClick={() => ui.setNavOpen(false)}
                        class="fixed inset-0 z-[55] animate-fade-in bg-[rgba(4,5,8,.55)] min-[900px]:hidden"
                    />
                )}
                <Sidebar owner={owner} repo={repo} view={view.key} labels={[]} team={[]} />
                <main class="flex h-full min-w-0 flex-1 flex-col bg-bg0">
                    <Header owner={owner} repo={repo} viewTitle={view.title} avatars={[]} />
                    <FilterBar labels={[]} />
                    <div class="relative min-h-0 flex-1 overflow-hidden">
                        {view.key === 'board' ? (
                            /* Empty board scaffold — the real kanban (cards,
                               drag-and-drop) is the next PR. */
                            <div class="flex h-full items-start gap-3.5 overflow-x-auto px-[18px] py-4">
                                {STATUSES.map((s) => (
                                    <section key={s.id} class="flex h-full w-[292px] shrink-0 flex-col">
                                        <div class="flex items-center gap-2 px-1 pt-0.5 pb-2.5">
                                            <span class="size-[9px] rounded-full" style={`background:${s.dot}`} />
                                            <span class="text-[12.5px] font-semibold">{s.name}</span>
                                            <span class="rounded-full bg-bg2 px-[7px] py-px font-mono text-[11px] text-tf">0</span>
                                            <div class="flex-1" />
                                            <button
                                                type="button"
                                                class="size-[22px] cursor-pointer rounded-md text-base leading-none text-tf hover:bg-bg2 hover:text-tx"
                                            >
                                                +
                                            </button>
                                        </div>
                                        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-[9px] overflow-y-auto rounded-xl bg-bg1 p-2">
                                            <span class="text-[11.5px] text-tf">No issues yet</span>
                                        </div>
                                    </section>
                                ))}
                            </div>
                        ) : (
                            <div class="flex h-full items-center justify-center">
                                <span class="text-[12.5px] text-tf">The {view.title} view lands in an upcoming PR.</span>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        );
    };
}, { name: 'BoardPage' });

export default BoardPage;
