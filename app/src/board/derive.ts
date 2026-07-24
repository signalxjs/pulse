/**
 * Board derivations (pulse#40) — pure functions turning raw GitHub data
 * (issues, labels, milestones, collaborators) + a BoardConfig into what the
 * views render: column statuses, priorities, cycles/sprints, roadmap slots,
 * and the chrome's label/people lists. No fetching, no globals — every
 * function is matrix-tested against the lumen fixture dataset.
 */
import type { BoardConfig, BoardStatusId } from '@pulse/db';
import type { GitHubIssue, GitHubLabel, GitHubMilestone, GitHubPerson } from '@pulse/github';
import { hexToOklchHue, personHue } from './colors';
import type { BoardLabel, BoardPerson } from './types';

const DAY = 86_400_000;
/** Cycles are two-week windows: a milestone's start = dueOn − 14 days. */
const CYCLE_MS = 14 * DAY;

function eqName(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

/**
 * The column an issue lands in. A closed issue is done, whatever stale
 * status label it still carries; an open issue follows its mapped status
 * label (first match in column order); with no mapped label the state
 * decides — PR → inreview, plain issue → todo (the BoardStatus contract,
 * @pulse/db).
 */
export function statusOf(issue: GitHubIssue, config: BoardConfig): BoardStatusId {
    if (issue.state === 'closed') return 'done';
    for (const status of config.statuses) {
        if (status.label !== null && issue.labels.some((l) => eqName(l.name, status.label!))) {
            return status.id;
        }
    }
    return issue.isPr ? 'inreview' : 'todo';
}

/** Priority 0–3 from the mapped priority labels; null when unmapped/unlabeled. */
export function priorityOf(issue: GitHubIssue, config: BoardConfig): 0 | 1 | 2 | 3 | null {
    const order = [config.priorities.p0, config.priorities.p1, config.priorities.p2, config.priorities.p3];
    for (let p = 0; p < order.length; p++) {
        const label = order[p];
        if (label != null && issue.labels.some((l) => eqName(l.name, label))) {
            return p as 0 | 1 | 2 | 3;
        }
    }
    return null;
}

/** What a card move patches on the GitHub issue. */
export interface MovePatch {
    /** FULL replacement label set (updateIssue's contract). */
    labels: string[];
    /** Present when the move must also change the issue state. */
    state?: 'open' | 'closed';
}

/**
 * Compute the label/state patch that moves an issue to `targetStatusId`:
 * every mapped status label is dropped, the target's label (when mapped) is
 * added. Moving INTO done closes the issue when the config says so; moving
 * anywhere else always patches `state: 'open'` (a no-op on open issues,
 * the reopen on cards dragged out of Done).
 */
export function moveLabels(
    config: BoardConfig,
    currentLabels: readonly string[],
    targetStatusId: BoardStatusId
): MovePatch {
    const mapped = config.statuses
        .map((s) => s.label)
        .filter((l): l is string => l !== null)
        .map((l) => l.toLowerCase());
    const labels = currentLabels.filter((l) => !mapped.includes(l.toLowerCase()));
    const target = config.statuses.find((s) => s.id === targetStatusId);
    if (target?.label != null) labels.push(target.label);
    if (targetStatusId === 'done') {
        return config.closeOnDone ? { labels, state: 'closed' } : { labels };
    }
    return { labels, state: 'open' };
}

/**
 * Whether a drop on this column can PERSIST. A label-mapped column always
 * can; unmapped `done` (close) and `todo` (the open-issue default) derive
 * from state alone. Any other unmapped column would silently land the
 * issue back in the default status on reload — so it must not accept
 * drops (and the server rejects it) until setup maps a label to it.
 */
export function canRepresent(config: BoardConfig, targetStatusId: BoardStatusId): boolean {
    const target = config.statuses.find((s) => s.id === targetStatusId);
    if (target?.label != null) return true;
    // Unmapped `done` persists only through CLOSING the issue — with
    // closeOnDone off, nothing would record the move.
    if (targetStatusId === 'done') return config.closeOnDone;
    return targetStatusId === 'todo';
}

/** The mapped status/priority label names (lowercased) — represented by
 *  columns and P-chips, so never rendered as tag pills. */
function mappedLabelSet(config: BoardConfig | null): Set<string> {
    if (!config) return new Set();
    return new Set(
        [
            ...config.statuses.map((s) => s.label),
            config.priorities.p0, config.priorities.p1, config.priorities.p2, config.priorities.p3
        ]
            .filter((l): l is string => l !== null)
            .map((l) => l.toLowerCase())
    );
}

/**
 * The tag pills one card/row renders: the issue's labels minus the ones the
 * config maps to statuses/priorities (those surface as the column and the
 * P-chip), hue-derived from each label's real hex. Greys (and malformed
 * colors) carry `hue: null` — the pill renders in the neutral tokens.
 */
export function cardLabels(
    issue: GitHubIssue,
    config: BoardConfig | null
): { key: string; name: string; hue: number | null }[] {
    const mapped = mappedLabelSet(config);
    return issue.labels
        .filter((l) => !mapped.has(l.name.toLowerCase()))
        .map((l) => {
            let hue: number | null = null;
            try {
                hue = hexToOklchHue(l.color);
            } catch { /* malformed color — neutral pill */ }
            return { key: l.name, name: l.name, hue };
        });
}

/** The live filter state both views apply (boardUi store shape). */
export interface IssueFilter {
    /** Title substring (case-insensitive) OR `#number` / number prefix. */
    query: string;
    /** Single active label-name filter, or null. */
    filterLabel: string | null;
}

/**
 * Apply the chrome's live filters to the working set — ONE helper for
 * Board and List so the two views can never drift. Query matches a
 * case-insensitive title substring or an issue-number prefix (`#51` and
 * `51` both reach #51x; anything else falls back to the title search);
 * the label filter matches issues carrying that label name.
 */
export function filterIssues(issues: readonly GitHubIssue[], filter: IssueFilter): GitHubIssue[] {
    const q = filter.query.trim().toLowerCase();
    const digits = q.startsWith('#') ? q.slice(1) : q;
    const numeric = /^\d+$/.test(digits) ? digits : null;
    const label = filter.filterLabel;
    return issues.filter((issue) => {
        if (label !== null && !issue.labels.some((l) => eqName(l.name, label))) return false;
        if (!q) return true;
        if (numeric !== null && String(issue.number).startsWith(numeric)) return true;
        return issue.title.toLowerCase().includes(q);
    });
}

/**
 * Card/row order within a column or group: priority ascending (P0 first,
 * unprioritized last), then number DESCENDING (newest first) — the
 * prototype's board order.
 */
export function sortByPriority(issues: readonly GitHubIssue[], config: BoardConfig): GitHubIssue[] {
    // Precompute — sort comparators must not rescan labels O(n log n) times.
    const prio = new Map<number, number>();
    for (const issue of issues) {
        prio.set(issue.number, priorityOf(issue, config) ?? 4);
    }
    return [...issues].sort(
        (a, b) => (prio.get(a.number)! - prio.get(b.number)!) || (b.number - a.number)
    );
}

/** A milestone as the roadmap/sprint views consume it. */
export interface BoardCycle {
    /** The milestone number — the issue.milestone join key. */
    number: number;
    title: string;
    /** ISO start (derived: dueOn − 14 days — cycles are two-week windows). */
    start: string;
    /** ISO end (the milestone's dueOn). */
    end: string;
    state: 'done' | 'active' | 'planned';
    /** Closed / total issue counts from the milestone itself. */
    done: number;
    total: number;
}

/**
 * Cycles from a repo's milestones: only milestones WITH a due date qualify
 * (a cycle is a time window), ordered by due date. A closed milestone is
 * done; an open one whose window has started is active; the rest are
 * planned.
 */
export function cyclesFrom(milestones: readonly GitHubMilestone[], now: Date = new Date()): BoardCycle[] {
    return milestones
        .filter((m): m is GitHubMilestone & { dueOn: string } => m.dueOn !== null)
        .sort((a, b) => Date.parse(a.dueOn) - Date.parse(b.dueOn))
        .map((m) => {
            const end = Date.parse(m.dueOn);
            const start = end - CYCLE_MS;
            return {
                number: m.number,
                title: m.title,
                start: new Date(start).toISOString(),
                end: m.dueOn,
                state: m.state === 'closed' ? 'done' : start <= now.getTime() ? 'active' : 'planned',
                done: m.closedIssues,
                total: m.openIssues + m.closedIssues
            };
        });
}

/** The sprint view's cycle: the active cycle still inside its window,
 *  falling back to any active (overdue) one, then the next planned one. */
export function currentCycle(cycles: readonly BoardCycle[], now: Date = new Date()): BoardCycle | null {
    return (
        cycles.find((c) => c.state === 'active' && now.getTime() <= Date.parse(c.end)) ??
        cycles.find((c) => c.state === 'active') ??
        cycles.find((c) => c.state === 'planned') ??
        null
    );
}

/** The sprint summary numbers (handoff §Sprint stat grid). */
export interface SprintStats {
    /** Issues in the cycle (issue.milestone joins the cycle's number). */
    scope: number;
    /** inprogress + inreview. */
    inFlight: number;
    /** done. */
    completed: number;
    /** backlog + todo. */
    notStarted: number;
    /** completed / scope, 0–100 (0 for an empty scope). */
    pctComplete: number;
}

export function sprintStats(
    issues: readonly GitHubIssue[],
    config: BoardConfig,
    cycle: BoardCycle
): SprintStats {
    const scoped = issues.filter((i) => i.milestone?.number === cycle.number);
    let inFlight = 0;
    let completed = 0;
    let notStarted = 0;
    for (const issue of scoped) {
        const s = statusOf(issue, config);
        if (s === 'done') completed++;
        else if (s === 'inprogress' || s === 'inreview') inFlight++;
        else notStarted++;
    }
    return {
        scope: scoped.length,
        inFlight,
        completed,
        notStarted,
        pctComplete: scoped.length === 0 ? 0 : Math.round((completed / scoped.length) * 100)
    };
}

/** Slots in the roadmap window: 6 columns of 2 weeks = a 12-week span. */
export const ROADMAP_SLOTS = 6;

/**
 * The rolling roadmap window's start: the Monday five weeks before `now`
 * (UTC midnight) — recent history fills the first slots, the near future
 * the rest, and slot boundaries land on Mondays like real cycles do.
 */
export function roadmapWindowStart(now: Date = new Date()): Date {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    const sinceMonday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - sinceMonday - 35);
    return d;
}

/**
 * Which 2-week slot (0–5) a cycle's bar starts in, or null when the cycle
 * lies entirely outside the window. A cycle that started before the window
 * but is still running clamps to slot 0.
 */
export function roadmapSlot(cycle: BoardCycle, windowStart: Date): number | null {
    const start = Date.parse(cycle.start);
    const offset = start - windowStart.getTime();
    const slot = Math.floor(offset / CYCLE_MS);
    if (slot < 0) return Date.parse(cycle.end) > windowStart.getTime() ? 0 : null;
    return slot < ROADMAP_SLOTS ? slot : null;
}

/**
 * A milestone-style cycle (handoff §6: the v3.0 marker): the milestone
 * itself reports zero issues, so it is a due-date marker, not a two-week
 * work window — the roadmap renders it as the narrow red marker instead
 * of a cycle bar.
 */
export function isMilestoneCycle(cycle: BoardCycle): boolean {
    return cycle.total === 0;
}

/**
 * The continuous position of a cycle's END (its due date) inside the
 * roadmap window, as a 0–1 fraction of the 12-week span — where the
 * milestone marker sits (a point date deserves a real position, not a
 * 2-week slot). Null when the due date lies outside the window.
 */
export function roadmapEndFraction(cycle: BoardCycle, windowStart: Date): number | null {
    const f = (Date.parse(cycle.end) - windowStart.getTime()) / (ROADMAP_SLOTS * CYCLE_MS);
    return f >= 0 && f <= 1 ? f : null;
}

/**
 * The sidebar/filter-bar label list: repo labels minus the ones the config
 * maps to statuses/priorities (those are columns and P-flags, not tags),
 * with the design hue derived from each label's real hex (greys fall back
 * to the faint-text look via hue 0 + count-only rendering upstream) and
 * open-issue counts.
 */
export function labelsFor(
    labels: readonly GitHubLabel[],
    issues: readonly GitHubIssue[],
    config: BoardConfig | null
): BoardLabel[] {
    const mapped = mappedLabelSet(config);
    // One pass over issues, not one per label — repos can carry hundreds
    // of labels against hundreds of issues.
    const openCounts = new Map<string, number>();
    for (const issue of issues) {
        if (issue.state !== 'open') continue;
        for (const il of issue.labels) {
            const key = il.name.toLowerCase();
            openCounts.set(key, (openCounts.get(key) ?? 0) + 1);
        }
    }
    return labels
        .filter((l) => !mapped.has(l.name.toLowerCase()))
        .map((l) => {
            let hue: number | null = null;
            try {
                hue = hexToOklchHue(l.color);
            } catch { /* malformed color — grey fallback below */ }
            return {
                key: l.name,
                name: l.name,
                hue: hue ?? 0,
                count: openCounts.get(l.name.toLowerCase()) ?? 0
            };
        });
}

/** Monogram initials for a login ("good-first" → "GF", "mira" → "MI"). */
export function initialsOf(login: string): string {
    const parts = login.split(/[-_.]+/).filter(Boolean);
    const raw = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : login.slice(0, 2);
    return raw.toUpperCase();
}

/** The team list: collaborators with stable derived hues and open-issue
 *  assignment counts, ready for the sidebar/avatar-stack components. */
export function peopleFor(
    collaborators: readonly GitHubPerson[],
    issues: readonly GitHubIssue[]
): BoardPerson[] {
    // One pass over issues, like labelsFor — never O(people × issues).
    const assigned = new Map<string, number>();
    for (const issue of issues) {
        if (issue.state !== 'open') continue;
        for (const a of issue.assignees) {
            assigned.set(a.login, (assigned.get(a.login) ?? 0) + 1);
        }
    }
    return collaborators.map((p) => ({
        name: p.login,
        initials: initialsOf(p.login),
        hue: personHue(p.login),
        count: assigned.get(p.login) ?? 0
    }));
}
