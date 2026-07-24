/**
 * @pulse/github — typed surface. The implementation is plain ESM JavaScript
 * (JSDoc-typed) because it runs under the no-transpiler `app/server.mjs`;
 * these declarations serve the Vite-processed app code that imports it.
 */

export interface GitHubUser {
    login: string;
    name: string | null;
    avatarUrl: string;
}

export interface GitHubOrg {
    login: string;
    avatarUrl: string;
    description: string | null;
}

export interface GitHubRepo {
    owner: string;
    name: string;
    fullName: string;
    description: string | null;
    private: boolean;
    openIssues: number;
    updatedAt: string;
}

export interface GitHubLabel {
    name: string;
    /** Hex color without the leading '#'. */
    color: string;
    description: string | null;
}

/** A user in a lightweight reference position (assignee, author, actor). */
export interface GitHubPerson {
    login: string;
    avatarUrl: string;
}

export interface GitHubMilestone {
    number: number;
    title: string;
    state: 'open' | 'closed';
    description: string | null;
    /** ISO date, or null for milestones without a due date. */
    dueOn: string | null;
    openIssues: number;
    closedIssues: number;
}

/** An issue OR a pull request — GitHub's issues list carries both; `isPr` tells them apart. */
export interface GitHubIssue {
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    isPr: boolean;
    draft: boolean;
    labels: GitHubLabel[];
    assignees: GitHubPerson[];
    milestone: { number: number; title: string } | null;
    comments: number;
    author: GitHubPerson | null;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    htmlUrl: string;
}

/** One mapped timeline entry; event types outside this union are filtered out. */
export interface GitHubTimelineEvent {
    event: 'labeled' | 'unlabeled' | 'assigned' | 'closed' | 'reopened'
        | 'commented' | 'cross-referenced' | 'merged' | 'committed';
    /** null for commits (git authors are not GitHub accounts). */
    actor: GitHubPerson | null;
    createdAt: string | null;
    /** labeled / unlabeled. */
    label?: { name: string; color: string };
    /** assigned. */
    assignee?: GitHubPerson;
    /** commented (comment body) and committed (commit message). */
    body?: string;
    /** cross-referenced: the issue/PR that mentioned this one. */
    source?: { number: number; title: string; isPr: boolean; repo: string | null };
}

/** One page of a paginated listing; `nextPage` is null on the last page. */
export interface Page<T> {
    items: T[];
    nextPage: number | null;
}

export interface RepoIssuesOptions {
    /** Defaults to 'all'. */
    state?: 'open' | 'closed' | 'all';
    /** 1-based page number (GitHub's default is 1). */
    page?: number;
    /** Defaults to 100 (GitHub's maximum). */
    perPage?: number;
    /** Comma-separated label names; issues must carry all of them. */
    labels?: string;
    /** A milestone number, '*' (any milestone) or 'none'. */
    milestone?: number | '*' | 'none';
    /** ISO timestamp — only issues updated at or after it. */
    since?: string;
}

/** One adapter interface, two implementations: live and fixtures. */
export interface GitHubClient {
    /** The authenticated user. */
    viewer(): Promise<GitHubUser>;
    /** Organizations the authenticated user belongs to. */
    viewerOrgs(): Promise<GitHubOrg[]>;
    /** Repos the viewer can access, most recently pushed first. */
    viewerRepos(): Promise<GitHubRepo[]>;
    /** Repos of one owner (user or org), most recently pushed first. */
    ownerRepos(owner: string): Promise<GitHubRepo[]>;
    /** A single repo, or null when it does not exist / is not accessible. */
    repo(owner: string, name: string): Promise<GitHubRepo | null>;
    /**
     * One page of a repo's issues AND pull requests, most recently updated
     * first. Callers loop on `nextPage` — the client never auto-pages.
     * Unknown repo → empty first page.
     */
    repoIssues(owner: string, name: string, opts?: RepoIssuesOptions): Promise<Page<GitHubIssue>>;
    /** All labels defined on a repo. */
    repoLabels(owner: string, name: string): Promise<GitHubLabel[]>;
    /** All milestones on a repo (open and closed). */
    repoMilestones(owner: string, name: string): Promise<GitHubMilestone[]>;
    /**
     * Collaborators on a repo. Listing requires push access — a plain 403
     * answers `[]` (rate-limit 403s still throw).
     */
    repoCollaborators(owner: string, name: string): Promise<GitHubPerson[]>;
    /** A single issue/PR, or null when it does not exist. */
    issue(owner: string, name: string, n: number): Promise<GitHubIssue | null>;
    /** First 100 timeline events of an issue, unknown event types filtered out. */
    issueTimeline(owner: string, name: string, n: number): Promise<GitHubTimelineEvent[]>;
}

export interface LiveClientOptions {
    token: string;
    /** Base URL override (tests). Defaults to https://api.github.com */
    baseUrl?: string;
    /** Conditional-request cache; omit to fetch uncached. */
    etagCache?: EtagCache;
    /** fetch override (tests). */
    fetch?: typeof fetch;
}

export interface EtagCache {
    get(key: string): { etag: string; body: string } | undefined;
    set(key: string, etag: string, body: string): void;
}

/** GitHub REST v3 over fetch with If-None-Match conditional requests. */
export function createLiveClient(options: LiveClientOptions): GitHubClient;

/** HTTP error carrying the GitHub status (rate limits, permissions). */
export class GitHubApiError extends Error {
    status: number;
    rateLimited: boolean;
}
