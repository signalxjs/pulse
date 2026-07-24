import { component, type Define } from 'sigx';
import { Link } from '@sigx/router';
import { IconSearch, IconRepo } from '../../components/icons';
import { labelStyle, avatarColor } from '../colors';
import { VIEWS, type ViewKey } from '../views';
import { useBoardUiStore } from '../../stores/boardUi';
import type { BoardLabel, BoardPerson } from '../types';

type SidebarProps =
    Define.Prop<'owner', string, true> &
    Define.Prop<'repo', string, true> &
    Define.Prop<'view', ViewKey, true> &
    Define.Prop<'description', string> &
    Define.Prop<'labels', BoardLabel[]> &
    Define.Prop<'team', BoardPerson[]>;

/** Section header — 10.5px/600 uppercase .08em faint (handoff §Sidebar). */
const sectionHeader = 'mx-2 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em] text-tf';

/**
 * The persistent sidebar (handoff §Screens 1): brand, search button, the
 * scrollable nav (Repository → Views → Labels → Team) and the sync-status
 * footer. 248px fixed; below 900px it goes off-canvas, translated in by
 * the store's navOpen (the header's hamburger) with the scrim rendered by
 * BoardPage. Labels/team arrive via props — empty in this PR, live data
 * follows.
 */
export const Sidebar = component<SidebarProps>(({ props }) => {
    const ui = useBoardUiStore();

    return () => {
        const labels = props.labels ?? [];
        const team = props.team ?? [];
        const base = `/b/${props.owner}/${props.repo}`;
        return (
            <aside
                data-board-sidebar
                class={
                    'flex h-full w-[248px] shrink-0 flex-col border-r border-bd bg-bg1 ' +
                    'max-[899px]:fixed max-[899px]:inset-y-0 max-[899px]:left-0 max-[899px]:z-[56] ' +
                    'max-[899px]:shadow-[24px_0_60px_rgba(0,0,0,.4)] max-[899px]:transition-transform max-[899px]:duration-200 ' +
                    (ui.navOpen ? 'max-[899px]:translate-x-0' : 'max-[899px]:-translate-x-full')
                }
            >
                {/* Brand */}
                <div class="flex items-center gap-2.5 px-4 pt-4 pb-3">
                    <div class="flex size-[26px] items-center justify-center rounded-[8px] bg-ac shadow-[0_0_0_1px_rgba(255,255,255,.06)_inset]">
                        <span class="size-2 animate-pulse-dot rounded-full bg-white" />
                    </div>
                    <div class="flex flex-col leading-[1.1]">
                        <span class="text-[15px] font-bold tracking-[-.01em]">Pulse</span>
                        <span class="text-[11px] text-tf">Planning workspace</span>
                    </div>
                </div>

                {/* Search / command-palette button (⌘K, pulse#54) */}
                <div class="px-3 pb-2">
                    <button
                        type="button"
                        onClick={() => {
                            ui.setNavOpen(false);
                            ui.openPalette();
                        }}
                        class="flex w-full cursor-pointer items-center gap-[9px] rounded-[9px] border border-bd bg-bg2 px-2.5 py-2 text-left text-[12.5px] leading-[1.25] text-tm hover:border-bds hover:text-tx"
                    >
                        <IconSearch />
                        <span class="flex-1">Search or jump to…</span>
                        <span class="rounded-[5px] border border-bd bg-bg0 px-[5px] py-[2px] font-mono text-[10px] text-tf">⌘K</span>
                    </button>
                </div>

                {/* Scrollable nav */}
                <div class="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3">
                    <div class={`${sectionHeader} mt-2.5`}>Repository</div>
                    <div class="flex items-center gap-[9px] rounded-lg border border-bd bg-bg2 px-2 py-[7px]">
                        <span class="flex text-tm"><IconRepo /></span>
                        <div class="flex min-w-0 flex-1 flex-col leading-[1.15]">
                            <span class="truncate text-[12.5px] font-semibold">{props.owner}/{props.repo}</span>
                            {props.description && (
                                <span class="truncate text-[10.5px] text-tf">{props.description}</span>
                            )}
                        </div>
                    </div>

                    <div class={`${sectionHeader} mt-4`}>Views</div>
                    {VIEWS.map((v) => {
                        const active = props.view === v.key;
                        return (
                            <Link
                                key={v.key}
                                to={v.key === 'board' ? base : `${base}/${v.key}`}
                                onClick={() => ui.setNavOpen(false)}
                                class={
                                    'flex w-full items-center gap-[11px] rounded-lg px-2 py-[7px] text-[12.5px] ' +
                                    (active ? 'bg-bg2 font-semibold text-tx' : 'text-tm hover:bg-bg2 hover:text-tm')
                                }
                            >
                                <span class={'flex items-center ' + (active ? 'text-ac' : 'text-tm')}>
                                    <v.icon />
                                </span>
                                <span class="flex-1 text-left">{v.label}</span>
                                <span class="font-mono text-[10px] text-tf">{v.kbd}</span>
                            </Link>
                        );
                    })}

                    {labels.length > 0 && (
                        <>
                            <div class={`${sectionHeader} mt-4`}>Labels</div>
                            <div class="flex flex-col gap-px">
                                {labels.map((lb) => {
                                    const active = ui.filterLabel === lb.key;
                                    return (
                                        <button
                                            type="button"
                                            key={lb.key}
                                            onClick={() => ui.toggleFilterLabel(lb.key)}
                                            class={
                                                'flex w-full cursor-pointer items-center gap-[9px] rounded-lg px-2 py-[5px] text-[12.5px] ' +
                                                (active ? 'bg-bg2 text-tx' : 'text-tm hover:bg-bg2')
                                            }
                                        >
                                            <span
                                                class="size-[9px] shrink-0 rounded-full"
                                                style={`background:${labelStyle(lb.hue).dot}`}
                                            />
                                            <span class="flex-1 text-left">{lb.name}</span>
                                            <span class="font-mono text-[10.5px] text-tf">{lb.count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {team.length > 0 && (
                        <>
                            <div class={`${sectionHeader} mt-4`}>Team</div>
                            {team.map((p) => (
                                <div key={p.name} class="flex items-center gap-[9px] rounded-lg px-2 py-[5px] hover:bg-bg2">
                                    <span
                                        class="flex size-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium text-white"
                                        style={`background:${avatarColor(p.hue)}`}
                                    >
                                        {p.initials}
                                    </span>
                                    <span class="flex-1 text-[12.5px] text-tm">{p.name}</span>
                                    <span class="font-mono text-[10.5px] text-tf">{p.count ?? 0}</span>
                                </div>
                            ))}
                        </>
                    )}
                </div>

                {/* Sync-status footer */}
                <div class="flex items-center gap-2 border-t border-bd px-3.5 py-2.5">
                    <span class="size-[7px] shrink-0 animate-pulse-dot-slow rounded-full bg-[oklch(0.7_0.15_150)]" />
                    <span class="flex-1 text-[11px] text-tm">Synced with GitHub</span>
                    <span class="font-mono text-[10px] text-tf">just now</span>
                </div>
            </aside>
        );
    };
}, { name: 'Sidebar' });
