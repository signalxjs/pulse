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

/** Recorded-JSON adapter — deterministic, tokenless (CI smokes, dev). */
export function createFixturesClient(fixturesDir?: string): GitHubClient;

/** node:sqlite-backed EtagCache (also used for sessions later). */
export function createSqliteEtagCache(dbPath?: string): EtagCache;

/** HTTP error carrying the GitHub status (rate limits, permissions). */
export class GitHubApiError extends Error {
    status: number;
    rateLimited: boolean;
}
