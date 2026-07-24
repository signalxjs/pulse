import { component, type Define } from 'sigx';
import type { BoardConfig } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { PRIORITIES } from '../colors';
import { cardLabels, priorityOf } from '../derive';
import { Avatar } from './Avatar';
import { LabelPill } from './LabelPill';

type IssueRowProps =
    Define.Prop<'issue', GitHubIssue, true> &
    Define.Prop<'config', BoardConfig, true> &
    /** Fired on click — opens the detail slide-over (pulse#54). */
    Define.Prop<'onOpen', () => void>;

/**
 * One List-view row (handoff §5): CSS grid `30px 66px 1fr auto auto`,
 * `--rowh` tall (40/34px by density) — `[priority] [ref] [title + inline
 * pills] [comment count] [avatars]`. Clicking opens the issue's detail
 * slide-over (cursor-pointer per the handoff).
 */
export const IssueRow = component<IssueRowProps>(({ props }) => () => {
    const issue = props.issue;
    const prio = priorityOf(issue, props.config);
    const labels = cardLabels(issue, props.config);
    return (
        <div
            data-list-row={issue.number}
            onClick={() => props.onOpen?.()}
            class="grid cursor-pointer grid-cols-[30px_66px_1fr_auto_auto] items-center gap-3 border-b border-bd px-5 hover:bg-bg1"
            style="height:var(--rowh)"
        >
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
            <span class="flex min-w-[34px] items-center justify-end gap-1 text-[11px] text-tf">
                {issue.comments > 0 && <span class="font-mono">{issue.comments} ✎</span>}
            </span>
            <div class="flex justify-end">
                {issue.assignees.map((a) => (
                    <Avatar key={a.login} login={a.login} size={22} ring="var(--color-bg0)" overlap />
                ))}
            </div>
        </div>
    );
}, { name: 'IssueRow' });
