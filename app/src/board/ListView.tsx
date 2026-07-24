import { component, type Define } from 'sigx';
import type { BoardConfig } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { STATUSES } from './colors';
import { sortByPriority, statusOf } from './derive';
import { IssueRow } from './components/IssueRow';

type ListViewProps =
    /** The working set AFTER the chrome filters (BoardPage applies them). */
    Define.Prop<'issues', GitHubIssue[], true> &
    Define.Prop<'config', BoardConfig, true> &
    Define.Prop<'loading', boolean>;

/**
 * The List view ("Issues", handoff §5): one full-height scroll, grouped by
 * status in column order — each group a sticky header (dot + name + mono
 * count) over bg0 and its rows sorted priority-then-number. Empty groups
 * are dropped (prototype behavior).
 */
export const ListView = component<ListViewProps>(({ props }) => () => {
    const config = props.config;
    const groups = STATUSES
        .map((s) => ({
            ...s,
            rows: sortByPriority(props.issues.filter((i) => statusOf(i, config) === s.id), config)
        }))
        .filter((g) => g.rows.length > 0);
    if (groups.length === 0) {
        return (
            <div class="flex h-full items-center justify-center">
                <span class="text-[11.5px] text-tf">{props.loading ? 'Loading issues…' : 'No issues'}</span>
            </div>
        );
    }
    return (
        <div data-list-view class="h-full overflow-y-auto pt-1.5 pb-6">
            {groups.map((g) => (
                <div key={g.id} data-list-group={g.id}>
                    <div class="sticky top-0 z-[2] flex items-center gap-2 bg-bg0 px-5 pt-2.5 pb-1.5">
                        <span class="size-[9px] rounded-full" style={`background:${g.dot}`} />
                        <span class="text-[12.5px] font-semibold">{g.name}</span>
                        <span class="font-mono text-[11px] text-tf">{g.rows.length}</span>
                    </div>
                    {g.rows.map((issue) => (
                        <IssueRow key={issue.number} issue={issue} config={config} />
                    ))}
                </div>
            ))}
        </div>
    );
}, { name: 'ListView' });
