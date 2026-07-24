/**
 * Shared data shapes — what server functions return and pages render.
 * Mirrors @pulse/github's `GitHubRepo`/`GitHubOrg` (structurally identical)
 * so client code never imports the server-only package, even type-only.
 */

export interface PulseRepo {
    owner: string;
    name: string;
    fullName: string;
    description: string | null;
    private: boolean;
    openIssues: number;
    updatedAt: string;
}

export interface PulseOrg {
    login: string;
    avatarUrl: string;
    description: string | null;
}
