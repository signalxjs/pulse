import { component, type Define } from 'sigx';
import type { BoardConfig } from '@pulse/db';
import type { GitHubIssue } from '@pulse/github';
import { IconIssue, IconPr } from '../../components/icons';
import { PRIORITIES } from '../colors';
import { cardLabels, priorityOf } from '../derive';
import { Avatar } from './Avatar';
import { LabelPill } from './LabelPill';

type IssueCardProps =
    Define.Prop<'issue', GitHubIssue, true> &
    Define.Prop<'config', BoardConfig, true> &
    /** Fired when the drag ends however it ends (drop or cancel) — the
     *  board clears its column highlight here. */
    Define.Prop<'onDragEnd', () => void> &
    /** Fired on click (a completed drag suppresses the click natively) —
     *  opens the detail slide-over. */
    Define.Prop<'onOpen', () => void>;

/** The PR type-glyph violet (handoff §4 — fixed hue, not the accent). */
const PR_COLOR = 'oklch(0.7 0.15 285)';

/**
 * One board card (handoff §4): priority mono label + mono ref + type icon,
 * 13px/500 title, tag pills, comment count + overlapping assignee avatars.
 * Natively draggable — dataTransfer carries the issue number as text; the
 * column's drop list owns dragover/drop. Padding rides --cardpad (density).
 */
export const IssueCard = component<IssueCardProps>(({ props }) => {
    const onDragStart = (e: DragEvent) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(props.issue.number));
    };

    return () => {
        const issue = props.issue;
        const prio = priorityOf(issue, props.config);
        const labels = cardLabels(issue, props.config);
        return (
            <article
                data-card={issue.number}
                draggable
                onDragStart={onDragStart}
                onDragEnd={() => props.onDragEnd?.()}
                onClick={() => props.onOpen?.()}
                class={
                    'flex shrink-0 cursor-grab flex-col gap-2 rounded-[10px] border border-bd bg-bg2 ' +
                    'transition-[background-color,border-color] duration-[.12s] hover:border-bds hover:bg-bg3'
                }
                style="padding:var(--cardpad)"
            >
                <div class="flex items-center gap-[7px]">
                    {prio !== null && (
                        <span
                            class="font-mono text-[10px] font-semibold tracking-[.02em]"
                            style={`color:${PRIORITIES[prio]!.color}`}
                        >
                            {PRIORITIES[prio]!.label}
                        </span>
                    )}
                    <span class="font-mono text-[11px] text-tf">
                        {issue.isPr ? `PR #${issue.number}` : `#${issue.number}`}
                    </span>
                    <div class="flex-1" />
                    <span class="flex items-center" style={`color:${issue.isPr ? PR_COLOR : 'var(--color-tf)'}`}>
                        {issue.isPr ? <IconPr /> : <IconIssue />}
                    </span>
                </div>
                <div class="text-[13px] font-medium leading-[1.35] text-tx">{issue.title}</div>
                {labels.length > 0 && (
                    <div class="flex flex-wrap gap-[5px]">
                        {labels.map((lb) => (
                            <LabelPill key={lb.key} name={lb.name} hue={lb.hue} size="card" />
                        ))}
                    </div>
                )}
                <div class="mt-px flex items-center gap-2.5">
                    {issue.comments > 0 && (
                        <span class="flex items-center gap-1 text-[11px] text-tf">
                            <span class="inline-block h-2.5 w-3 rounded-[3px] border-[1.4px] border-current" />
                            <span class="font-mono">{issue.comments}</span>
                        </span>
                    )}
                    <div class="flex-1" />
                    <div class="flex">
                        {issue.assignees.map((a) => (
                            <Avatar key={a.login} login={a.login} size={20} ring="var(--color-bg2)" overlap />
                        ))}
                    </div>
                </div>
            </article>
        );
    };
}, { name: 'IssueCard' });
