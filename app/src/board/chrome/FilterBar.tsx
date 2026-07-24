import { component, type Define } from 'sigx';
import { labelStyle } from '../colors';
import { useBoardUiStore } from '../../stores/boardUi';
import type { BoardLabel } from '../types';

type FilterBarProps = Define.Prop<'labels', BoardLabel[]>;

/**
 * The filter chip bar (handoff §Screens 3): one toggle chip per label —
 * inactive chips are outline/muted, the active chip takes the label's tint
 * formula — plus a "Clear ✕" button while a filter is active. Persistent
 * on every view; horizontally scrollable when chips overflow.
 */
export const FilterBar = component<FilterBarProps>(({ props }) => {
    const ui = useBoardUiStore();

    return () => (
        <div data-board-filterbar class="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-bd px-[18px] py-[9px]">
            <span class="mr-0.5 whitespace-nowrap text-[11px] text-tf">Filter</span>
            {(props.labels ?? []).map((lb) => {
                const active = ui.filterLabel === lb.key;
                const s = labelStyle(lb.hue);
                return (
                    <button
                        type="button"
                        key={lb.key}
                        onClick={() => ui.toggleFilterLabel(lb.key)}
                        class="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px]"
                        style={active
                            ? `color:${s.fg};background:${s.bg};border-color:${s.bd}`
                            : 'color:var(--color-tm);border-color:var(--color-bd)'}
                    >
                        <span class="size-2 rounded-full" style={`background:${s.dot}`} />
                        {lb.name}
                    </button>
                );
            })}
            {ui.filterLabel !== null && (
                <button
                    type="button"
                    onClick={() => ui.clearFilter()}
                    class="ml-0.5 cursor-pointer whitespace-nowrap rounded-full border border-bd px-[9px] py-1 text-[11.5px] text-tm hover:border-bds hover:text-tx"
                >
                    Clear ✕
                </button>
            )}
        </div>
    );
}, { name: 'FilterBar' });
