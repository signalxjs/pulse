import { component, signal, useData, type Define } from 'sigx';
import type { BoardConfig } from '@pulse/db';
import type { GitHubIssue, GitHubTimelineEvent } from '@pulse/github';
import { IconIssue, IconPr } from '../../components/icons';
import { PRIORITIES, STATUSES, avatarColor, personHue } from '../colors';
import { boardKeys } from '../keys';
import { issueDetail } from '../../server/board.server';
import { addComment } from '../../server/mutations.server';
import { cardLabels, initialsOf, priorityOf, statusOf } from '../derive';
import { useBoardUiStore } from '../../stores/boardUi';
import { LabelPill } from '../components/LabelPill';
import { PRIORITY_NAMES, STATUS_HUES, activityFrom, linkedPr } from './detail-derive';

type IssueDetailProps =
    Define.Prop<'owner', string, true> &
    Define.Prop<'repo', string, true> &
    Define.Prop<'number', number, true> &
    Define.Prop<'config', BoardConfig, true> &
    /** Close = a router navigation dropping the ?issue param (BoardPage). */
    Define.Prop<'onClose', () => void, true>;

/** The PR glyph violet (handoff — fixed hue, not the accent). */
const PR_COLOR = 'oklch(0.7 0.15 285)';

/** §9 meta-grid label column. */
const metaLabel = 'text-[12.5px] text-tf';

/**
 * The issue detail slide-over (handoff §9): backdrop + a min(480px,92vw)
 * right panel — header (type icon, mono ref, tinted status pill, ✕), a
 * scrolling body (title, label pills, meta grid, body text, linked-PR card,
 * Activity timeline), and the comment footer. Data is the issueDetail read
 * (issue + timeline), client-only like every board cell; posting a comment
 * refreshes the cell EXPLICITLY (findings F15 — declared invalidations
 * don't reach mounted cells).
 */
export const IssueDetail = component<IssueDetailProps>(({ props }) => {
    const ui = useBoardUiStore();
    const detail = useData(
        () => boardKeys.issueDetail(props.owner, props.repo, props.number),
        (key) => issueDetail({ owner: key[1], repo: key[2], number: key[3] }),
        { server: false }
    );

    const comment = signal({ body: '', posting: false });
    const postComment = async () => {
        const body = comment.body.trim();
        if (body === '' || comment.posting) return;
        comment.posting = true;
        try {
            await addComment({ owner: props.owner, repo: props.repo, number: props.number, body });
            comment.body = '';
            await detail.refresh();
            ui.showToast('Comment posted');
        } catch (err) {
            ui.showToast(`Couldn't comment: ${err instanceof Error ? err.message : String(err)}`, 4000);
        } finally {
            comment.posting = false;
        }
    };

    const panelBody = (issue: GitHubIssue | null, timeline: GitHubTimelineEvent[]) => {
        if (issue === null) {
            return (
                <div class="flex flex-1 items-center justify-center">
                    <span class="text-[12.5px] text-tm">Issue #{props.number} was not found in this repo.</span>
                </div>
            );
        }
        const prio = priorityOf(issue, props.config);
        const labels = cardLabels(issue, props.config);
        const pr = linkedPr(timeline);
        const activity = activityFrom(issue, timeline);
        return (
            <div class="min-h-0 flex-1 overflow-y-auto px-[18px] py-5">
                <h1 class="mb-3.5 text-[20px] font-semibold leading-[1.3] tracking-[-.01em] text-tx [text-wrap:pretty]">
                    {issue.title}
                </h1>
                {labels.length > 0 && (
                    <div class="mb-[18px] flex flex-wrap gap-1.5">
                        {labels.map((lb) => (
                            <LabelPill key={lb.key} name={lb.name} hue={lb.hue} size="card" />
                        ))}
                    </div>
                )}
                <div class="mb-4 grid grid-cols-[88px_1fr] items-center gap-x-3.5 gap-y-2.5 border-y border-bd py-3.5 text-[12.5px]">
                    <span class={metaLabel}>Priority</span>
                    {prio !== null ? (
                        <span
                            class="font-mono text-[11.5px] font-semibold"
                            style={`color:${PRIORITIES[prio]!.color}`}
                        >
                            {PRIORITIES[prio]!.label} · {PRIORITY_NAMES[prio]}
                        </span>
                    ) : (
                        <span class="text-tf">None</span>
                    )}
                    <span class={metaLabel}>Assignees</span>
                    <div class="flex flex-wrap items-center gap-[7px]">
                        {issue.assignees.length === 0 && <span class="text-tf">Unassigned</span>}
                        {issue.assignees.map((a) => (
                            <span key={a.login} class="inline-flex items-center gap-1.5 text-tx">
                                <span
                                    class="inline-flex size-5 items-center justify-center rounded-full font-mono text-[9px] text-white"
                                    style={`background:${avatarColor(personHue(a.login))}`}
                                >
                                    {initialsOf(a.login)}
                                </span>
                                {a.login}
                            </span>
                        ))}
                    </div>
                    <span class={metaLabel}>Cycle</span>
                    <span class="text-tx">{issue.milestone?.title ?? 'No cycle'}</span>
                    <span class={metaLabel}>Repo</span>
                    <span class="text-tx">{props.owner}/{props.repo}</span>
                </div>
                {issue.body && (
                    <div class="mb-5 whitespace-pre-wrap text-[13px] leading-[1.6] text-tm [text-wrap:pretty]">
                        {issue.body}
                    </div>
                )}
                {pr && (
                    <div
                        data-linked-pr={pr.number}
                        class="mb-5 flex items-center gap-2.5 rounded-[10px] border border-bd bg-bg2 px-[13px] py-[11px]"
                    >
                        <span class="flex" style={`color:${PR_COLOR}`}><IconPr /></span>
                        <span class="font-mono text-xs text-tm">PR #{pr.number}</span>
                        <span class="min-w-0 flex-1 truncate text-[12.5px] text-tx">{pr.title}</span>
                        {/* Neutral "linked" — the timeline cross-reference
                            carries no PR state, so claiming "open" would be
                            wrong for a merged/closed PR. */}
                        <span class="rounded-full border border-[oklch(0.7_0.15_285_/_0.3)] bg-[oklch(0.7_0.15_285_/_0.14)] px-2 py-[2px] text-[10.5px] text-[oklch(0.8_0.12_285)]">
                            linked
                        </span>
                    </div>
                )}
                <div class="mb-3 text-[10.5px] font-semibold uppercase tracking-[.08em] text-tf">Activity</div>
                <div class="flex flex-col">
                    {activity.map((ev) => (
                        <div key={ev.key} data-activity-item class="relative flex gap-[11px] pb-4">
                            <span
                                class="z-[1] flex size-6 flex-none items-center justify-center rounded-full font-mono text-[9px] text-white shadow-[0_0_0_3px_var(--color-bg1)]"
                                style={`background:${avatarColor(personHue(ev.login))}`}
                            >
                                {initialsOf(ev.login)}
                            </span>
                            <div class="pt-[3px] text-[12.5px] text-tm">
                                <span class="font-medium text-tx">{ev.login}</span> {ev.text}
                                {ev.time !== '' && <> · <span class="text-tf">{ev.time}</span></>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return () => {
        const value = detail.value;
        const issue = value?.issue ?? null;
        const sid = issue ? statusOf(issue, props.config) : null;
        const meta = sid ? STATUSES.find((s) => s.id === sid)! : null;
        const hue = sid ? STATUS_HUES[sid] : null;
        return (
            <>
                <button
                    type="button"
                    aria-label="Close issue detail"
                    onClick={() => props.onClose()}
                    class="fixed inset-0 z-[70] animate-fade-in cursor-default bg-[rgba(4,5,8,.5)]"
                />
                <div
                    data-issue-detail
                    role="dialog"
                    aria-label={`Issue #${props.number}`}
                    class={
                        'fixed inset-y-0 right-0 z-[71] flex w-[min(480px,92vw)] animate-slide-over flex-col ' +
                        'border-l border-bd bg-bg1 shadow-[-24px_0_60px_rgba(0,0,0,.4)]'
                    }
                >
                    <div class="flex shrink-0 items-center gap-2.5 border-b border-bd px-[18px] py-3.5">
                        <span class="flex" style={`color:${issue?.isPr ? PR_COLOR : 'var(--color-tf)'}`}>
                            {issue?.isPr ? <IconPr /> : <IconIssue />}
                        </span>
                        <span class="font-mono text-[12.5px] text-tm">
                            {issue?.isPr ? `PR #${props.number}` : `#${props.number}`}
                        </span>
                        {meta && (
                            <span
                                data-detail-status
                                class="flex items-center gap-1.5 rounded-full border px-2.5 py-[3px]"
                                style={hue === null
                                    ? 'background:var(--color-bg2);border-color:var(--color-bd)'
                                    : `background:oklch(0.62 0.13 ${hue} / 0.14);border-color:oklch(0.62 0.13 ${hue} / 0.3)`}
                            >
                                <span class="size-[7px] rounded-full" style={`background:${meta.dot}`} />
                                <span
                                    class="text-[11px]"
                                    style={hue === null ? 'color:var(--color-tm)' : `color:oklch(0.85 0.09 ${hue})`}
                                >
                                    {meta.name}
                                </span>
                            </span>
                        )}
                        <div class="flex-1" />
                        <button
                            type="button"
                            aria-label="Close"
                            onClick={() => props.onClose()}
                            class="size-[30px] cursor-pointer rounded-lg border border-bd text-sm text-tm hover:bg-bg2 hover:text-tx"
                        >
                            ✕
                        </button>
                    </div>
                    {detail.match({
                        pending: () => (
                            <div class="flex flex-1 items-center justify-center">
                                <span class="text-[11.5px] text-tf">Loading issue…</span>
                            </div>
                        ),
                        error: (err, retry) => (
                            <div class="flex flex-1 flex-col items-center justify-center gap-3">
                                <span class="text-[12.5px] text-tm">
                                    Couldn't load the issue: {err instanceof Error ? err.message : String(err)}
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
                        ready: ({ issue: i, timeline }) => panelBody(i, timeline)
                    })}
                    {issue && (
                        <div class="flex shrink-0 items-center gap-2 border-t border-bd px-[18px] py-3">
                            <input
                                value={comment.body}
                                onInput={(e: Event) => { comment.body = (e.target as HTMLInputElement).value; }}
                                onKeyDown={(e: KeyboardEvent) => {
                                    if (e.key === 'Enter') void postComment();
                                }}
                                placeholder="Leave a comment…"
                                aria-label="Leave a comment"
                                class="min-w-0 flex-1 rounded-[9px] border border-bd bg-bg2 px-3 py-[9px] text-[12.5px] text-tx outline-none focus:border-ac"
                            />
                            <button
                                type="button"
                                data-comment-submit
                                disabled={comment.posting || comment.body.trim() === ''}
                                onClick={() => void postComment()}
                                class={
                                    'shrink-0 rounded-[9px] bg-ac px-3.5 py-[9px] text-[12.5px] font-semibold text-white ' +
                                    'enabled:cursor-pointer enabled:hover:brightness-[1.08] disabled:opacity-50'
                                }
                            >
                                Comment
                            </button>
                        </div>
                    )}
                </div>
            </>
        );
    };
}, { name: 'IssueDetail' });
