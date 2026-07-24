import { component, type Define } from 'sigx';
import { IconSearch } from '../../components/icons';
import { avatarColor } from '../colors';
import { useBoardUiStore } from '../../stores/boardUi';
import type { BoardPerson } from '../types';

type HeaderProps =
    Define.Prop<'owner', string, true> &
    Define.Prop<'repo', string, true> &
    Define.Prop<'viewTitle', string, true> &
    Define.Prop<'avatars', BoardPerson[]>;

/**
 * The main-pane header bar (handoff §Screens 2, ~54px): hamburger (narrow
 * viewports), owner/repo breadcrumb + view title, the Live pill, the filter
 * input (wired to boardUi.query), the overlapping avatar stack (props —
 * empty until the data PRs), and the accent "+ New" button.
 */
export const Header = component<HeaderProps>(({ props }) => {
    const ui = useBoardUiStore();

    return () => (
        <header data-board-header class="flex shrink-0 items-center gap-3 border-b border-bd px-[18px] py-[11px]">
            <button
                type="button"
                aria-label="Open navigation"
                onClick={() => ui.setNavOpen(true)}
                class="flex size-8 shrink-0 cursor-pointer flex-col items-center justify-center gap-[3px] rounded-lg border border-bd bg-bg2 text-tm min-[900px]:hidden"
            >
                <span class="h-[1.6px] w-3.5 rounded-sm bg-current" />
                <span class="h-[1.6px] w-3.5 rounded-sm bg-current" />
                <span class="h-[1.6px] w-3.5 rounded-sm bg-current" />
            </button>

            <div class="flex min-w-0 items-center gap-2">
                <span class="whitespace-nowrap text-[13px] text-tm">{props.owner}/{props.repo}</span>
                <span class="text-tf">/</span>
                <span class="whitespace-nowrap text-sm font-semibold">{props.viewTitle}</span>
                <span class="ml-1.5 inline-flex items-center gap-[5px] rounded-full border border-[oklch(0.7_0.15_150_/_0.25)] bg-[oklch(0.7_0.15_150_/_0.12)] px-2 py-[2px]">
                    <span class="size-1.5 animate-pulse-dot-slow rounded-full bg-[oklch(0.72_0.15_150)]" />
                    <span class="text-[10.5px] text-[oklch(0.8_0.1_150)]">Live</span>
                </span>
            </div>

            <div class="flex-1" />

            <div class="relative flex items-center">
                <span class="pointer-events-none absolute left-[9px] flex text-tf"><IconSearch /></span>
                <input
                    value={ui.query}
                    onInput={(e: Event) => ui.setQuery((e.target as HTMLInputElement).value)}
                    placeholder="Filter…  /"
                    class="w-[190px] rounded-lg border border-bd bg-bg2 py-[7px] pr-2.5 pl-[26px] text-[12.5px] leading-[1.25] text-tx outline-none focus:border-ac"
                />
            </div>

            {(props.avatars ?? []).length > 0 && (
                <div class="flex items-center pl-1">
                    {(props.avatars ?? []).map((a) => (
                        <span
                            key={a.name}
                            title={a.name}
                            class="-ml-[7px] flex size-[26px] items-center justify-center rounded-full font-mono text-[10px] font-medium text-white shadow-[0_0_0_2px_var(--color-bg0)]"
                            style={`background:${avatarColor(a.hue)}`}
                        >
                            {a.initials}
                        </span>
                    ))}
                </div>
            )}

            <button
                type="button"
                class="flex shrink-0 cursor-pointer items-center gap-[7px] rounded-lg bg-ac px-3 py-[7px] text-[12.5px] leading-[1.25] font-semibold text-white hover:brightness-[1.08]"
            >
                <span class="-mt-px text-[15px] leading-none">+</span> New
            </button>
        </header>
    );
}, { name: 'Header' });
