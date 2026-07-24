/**
 * Detail-panel derivations (handoff §9, pulse#54) — pure functions turning
 * an issue + its timeline into what the slide-over renders: the tinted
 * status pill, the linked-PR card, and the Activity rows. No fetching, no
 * DOM — unit-tested against the recorded lumen timelines.
 */
import type { BoardStatusId } from '@pulse/db';
import type { GitHubIssue, GitHubTimelineEvent } from '@pulse/github';

/**
 * The handoff's status-pill hues (§9: `oklch(0.62 0.13 <hue> / 0.14)` bg …)
 * — backlog is null: it renders in the neutral bg2 tokens instead.
 */
export const STATUS_HUES: Record<BoardStatusId, number | null> = {
    backlog: null,
    todo: 250,
    inprogress: 65,
    inreview: 210,
    done: 150
};

/** Priority display names (§9 meta grid: "P2 · Medium"), indexed 0–3. */
export const PRIORITY_NAMES: readonly string[] = ['Urgent', 'High', 'Medium', 'Low'];

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Compact relative time ("just now", "4h ago", "6d ago", "2mo ago"). */
export function relTime(iso: string, now: Date = new Date()): string {
    const diff = now.getTime() - Date.parse(iso);
    if (diff < MIN) return 'just now';
    if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
    if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
    if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}mo ago`;
    return `${Math.floor(diff / (365 * DAY))}y ago`;
}

/** The linked-PR card's data (§9) — from the timeline's cross-references. */
export interface LinkedPr {
    number: number;
    title: string;
    /** `owner/name`, or null when the event carried no repo. */
    repo: string | null;
}

/**
 * The PR to surface as "linked": the LATEST cross-referenced event whose
 * source is a pull request (GitHub emits one when a PR body/commits mention
 * the issue — the closing-PR signal this panel has). Null when none.
 */
export function linkedPr(timeline: readonly GitHubTimelineEvent[]): LinkedPr | null {
    for (let i = timeline.length - 1; i >= 0; i--) {
        const ev = timeline[i]!;
        if (ev.event === 'cross-referenced' && ev.source?.isPr) {
            return { number: ev.source.number, title: ev.source.title, repo: ev.source.repo };
        }
    }
    return null;
}

/** One Activity row: avatar login + "login text · time" (§9). */
export interface ActivityItem {
    /** Stable render key (index-based — timelines only append). */
    key: number;
    login: string;
    text: string;
    /** Relative time, '' when the event carries no timestamp (commits). */
    time: string;
}

/** GitHub's deleted-account placeholder — the actor-less fallback. */
const GHOST = 'ghost';

function eventText(ev: GitHubTimelineEvent): string {
    switch (ev.event) {
        case 'labeled': return `added the ${ev.label?.name ?? '?'} label`;
        case 'unlabeled': return `removed the ${ev.label?.name ?? '?'} label`;
        case 'assigned':
            return ev.assignee && ev.assignee.login !== ev.actor?.login
                ? `assigned ${ev.assignee.login}`
                : 'self-assigned this';
        case 'closed': return 'closed this';
        case 'reopened': return 'reopened this';
        case 'commented': return 'left a comment';
        case 'cross-referenced':
            return ev.source
                ? `referenced this from ${ev.source.isPr ? 'PR ' : ''}#${ev.source.number}`
                : 'referenced this';
        case 'merged': return 'merged this';
        case 'committed': return 'pushed a commit';
    }
}

/**
 * The Activity rows: a synthesized "opened this …" first (GitHub timelines
 * don't carry the open event), then every timeline event mapped to its
 * one-line text.
 */
export function activityFrom(
    issue: GitHubIssue,
    timeline: readonly GitHubTimelineEvent[],
    now: Date = new Date()
): ActivityItem[] {
    const opened: ActivityItem = {
        key: -1,
        login: issue.author?.login ?? GHOST,
        text: issue.isPr ? 'opened this pull request' : 'opened this issue',
        time: relTime(issue.createdAt, now)
    };
    return [
        opened,
        ...timeline.map((ev, i) => ({
            key: i,
            login: ev.actor?.login ?? GHOST,
            text: eventText(ev),
            time: ev.createdAt ? relTime(ev.createdAt, now) : ''
        }))
    ];
}
