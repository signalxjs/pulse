/**
 * Board data — server functions (rfc-server), the read surface behind the
 * planner views. Same posture as repos.server.ts: the import IS the seam,
 * every fn lists withAuth definition-level (no transport can skip it), and
 * GitHub internals never cross the wire outside the ServerFnError channel.
 * Inputs are valibot-validated (Standard Schema → serverFn's `input`):
 * owner/repo arrive from URLs, so the wire can carry anything.
 */
import { serverFn } from '@sigx/server';
import * as v from 'valibot';
import type { BoardConfig } from '@pulse/db';
import type {
    GitHubIssue, GitHubLabel, GitHubMilestone, GitHubPerson, GitHubTimelineEvent
} from '@pulse/github';
import { detectBoard, type DetectedConventions } from '../board/detect';
import { authed, withAuth } from './auth.server';
import { services } from './services.server';

/** GitHub owner/repo segments: word chars, dots, dashes (the same shape
 *  @pulse/github's fixtures adapter accepts). */
const segment = v.pipe(v.string(), v.regex(/^(?!\.{1,2}$)[A-Za-z0-9._-]+$/));

export const RepoRef = v.object({ owner: segment, repo: segment });
export type RepoRefInput = v.InferOutput<typeof RepoRef>;

const IssueRef = v.object({ owner: segment, repo: segment, number: v.pipe(v.number(), v.integer(), v.minValue(1)) });

/** The stored board config for a repo — null means "not set up yet" (the
 *  BoardPage guard redirects to /setup on it). */
export const getBoard = serverFn({
    use: [withAuth],
    input: RepoRef,
    handler(rq, { owner, repo }): Promise<BoardConfig | null> {
        return services().configStore.getBoard(owner, repo);
    }
});

/** How many pages boardIssues walks before cutting off (4 × 100 = 400
 *  issues) — a working-set cap, not pagination UI (that is a later PR). */
const MAX_ISSUE_PAGES = 4;

/** The board's working set: issues AND PRs, flattened across pages (most
 *  recently updated first, capped at 400). */
export const boardIssues = serverFn({
    use: [withAuth],
    input: RepoRef,
    async handler(rq, { owner, repo }): Promise<GitHubIssue[]> {
        const { gh } = authed(rq);
        const issues: GitHubIssue[] = [];
        let page: number | null = 1;
        for (let i = 0; i < MAX_ISSUE_PAGES && page !== null; i++) {
            const res = await gh.repoIssues(owner, repo, { state: 'all', page });
            issues.push(...res.items);
            page = res.nextPage;
        }
        return issues;
    }
});

/** All labels defined on the repo (setup selects + chrome tags). */
export const boardLabels = serverFn({
    use: [withAuth],
    input: RepoRef,
    handler(rq, { owner, repo }): Promise<GitHubLabel[]> {
        return authed(rq).gh.repoLabels(owner, repo);
    }
});

/** All milestones (open and closed) — the cycle source. */
export const boardMilestones = serverFn({
    use: [withAuth],
    input: RepoRef,
    handler(rq, { owner, repo }): Promise<GitHubMilestone[]> {
        return authed(rq).gh.repoMilestones(owner, repo);
    }
});

/** Repo collaborators — the team/avatar data ([] without push access). */
export const boardPeople = serverFn({
    use: [withAuth],
    input: RepoRef,
    handler(rq, { owner, repo }): Promise<GitHubPerson[]> {
        return authed(rq).gh.repoCollaborators(owner, repo);
    }
});

/** One issue + its timeline for the detail panel; issue null when it does
 *  not exist (the panel renders its own not-found state). */
export const issueDetail = serverFn({
    use: [withAuth],
    input: IssueRef,
    async handler(rq, { owner, repo, number }): Promise<{
        issue: GitHubIssue | null;
        timeline: GitHubTimelineEvent[];
    }> {
        const { gh } = authed(rq);
        // Issue first, timeline only when it exists — a missing issue must
        // not spend a second request of the rate-limit budget.
        const issue = await gh.issue(owner, repo, number);
        if (!issue) return { issue: null, timeline: [] };
        return { issue, timeline: await gh.issueTimeline(owner, repo, number) };
    }
});

/**
 * Setup-flow detection: fetch the repo's labels + milestones through this
 * session's client and run the pure heuristics (board/detect.ts) — a
 * read-shaped fn (no writes), so it lives with the reads.
 */
export const detectConventions = serverFn({
    use: [withAuth],
    input: RepoRef,
    async handler(rq, { owner, repo }): Promise<DetectedConventions> {
        const { gh } = authed(rq);
        const [labels, milestones] = await Promise.all([
            gh.repoLabels(owner, repo),
            gh.repoMilestones(owner, repo)
        ]);
        return detectBoard(owner, repo, labels, milestones);
    }
});
