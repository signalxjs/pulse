import { component, type Define } from 'sigx';
import type { BoardConfig } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { PRIORITIES, STATUSES } from './colors';
import { cardLabels, priorityOf, sortByPriority, statusOf } from './derive';
import { Avatar } from './components/Avatar';
import { LabelPill } from './components/LabelPill';

type BacklogViewProps =
    /** The working set AFTER the chrome filters (BoardPage applies them). */
    Define.Prop<'issues', GitHubIssue[], true> &
    Define.Prop<'config', BoardConfig, true> &
    Define.Prop<'loading', boolean>;

/**
 * The Backlog view (handoff §8): "N unstarted issues · sorted by priority"
 * over a flat list of the backlog + todo issues in priority order
 * (sortByPriority — the board's shared row order). Rows are the
 * `16px 30px 66px 1fr auto auto` grid: drag handle, priority chip, mono
 * ref, title + inline label pills, mono status name, assignee avatars.
 * The drag handle is decorative for now (reordering is a later PR) —
 * aria-hidden, no drag wiring. Rows stay inert like the List view's until
 * the detail panel lands.
 */
export const BacklogView = component<BacklogViewProps>(({ props }) => () => {
    const config = props.config;
    const rows = sortByPriority(
        props.issues.filter((i) => {
            const s = statusOf(i, config);
            return s === 'backlog' || s === 'todo';
        }),
        config
    );
    if (rows.length === 0) {
        return (
            <div class="flex h-full items-center justify-center">
                <span class="text-[11.5px] text-tf">{props.loading ? 'Loading issues…' : 'No unstarted issues'}</span>
            </div>
        );
    }
    const statusName = new Map(STATUSES.map((s) => [s.id, s.name]));
    return (
        <div data-backlog-view class="h-full overflow-y-auto px-[22px] pt-3.5 pb-6">
            <div data-backlog-count class="mb-2 text-[12px] text-tm">
                {rows.length} unstarted issues · sorted by priority
            </div>
            <div class="flex flex-col">
                {rows.map((issue) => {
                    const prio = priorityOf(issue, config);
                    const labels = cardLabels(issue, config);
                    return (
                        <div
                            key={issue.number}
                            data-backlog-row={issue.number}
                            class="grid grid-cols-[16px_30px_66px_1fr_auto_auto] items-center gap-3 border-b border-bd px-1.5 hover:bg-bg1"
                            style="height:var(--rowh)"
                        >
                            <span aria-hidden="true" class="flex flex-col items-center gap-[2px] text-tf">
                                <span class="h-[1.4px] w-[11px] rounded-[2px] bg-current" />
                                <span class="h-[1.4px] w-[11px] rounded-[2px] bg-current" />
                            </span>
                            <span
                                class="font-mono text-[10.5px] font-semibold"
                                style={prio !== null ? `color:${PRIORITIES[prio]!.color}` : undefined}
                            >
                                {prio !== null ? PRIORITIES[prio]!.label : ''}
                            </span>
                            <span class="font-mono text-[11.5px] text-tf">
                                {issue.isPr ? `PR #${issue.number}` : `#${issue.number}`}
                            </span>
                            <div class="flex min-w-0 items-center gap-[9px]">
                                <span class="truncate text-[13px] text-tx">{issue.title}</span>
                                {labels.length > 0 && (
                                    <div class="flex flex-none gap-[5px]">
                                        {labels.map((lb) => (
                                            <LabelPill key={lb.key} name={lb.name} hue={lb.hue} size="row" />
                                        ))}
                                    </div>
                                )}
                            </div>
                            <span data-backlog-status class="font-mono text-[11px] text-tf">
                                {statusName.get(statusOf(issue, config))}
                            </span>
                            <div class="flex justify-end">
                                {issue.assignees.map((a) => (
                                    <Avatar key={a.login} login={a.login} size={22} ring="var(--color-bg0)" overlap />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}, { name: 'BacklogView' });
