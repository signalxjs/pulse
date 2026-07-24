/**
 * Data keys for the board reads (pulse#40). The board server fns take one
 * input OBJECT (serverFn's validated-input form), so their useData cells
 * key on explicit primitive tuples instead of fn-ref keys (tuple elements
 * must be JSON primitives). ONE module owns the tuple shapes: the pages'
 * `useData(() => boardKeys.x(...))` getters and the mutations'
 * `invalidates` patterns must agree byte-for-byte, and importing both from
 * here is what guarantees they do.
 */

export const boardKeys = {
    config: (owner: string, repo: string) => ['board-config', owner, repo] as const,
    issues: (owner: string, repo: string) => ['board-issues', owner, repo] as const,
    labels: (owner: string, repo: string) => ['board-labels', owner, repo] as const,
    milestones: (owner: string, repo: string) => ['board-milestones', owner, repo] as const,
    people: (owner: string, repo: string) => ['board-people', owner, repo] as const,
    detect: (owner: string, repo: string) => ['board-detect', owner, repo] as const,
    issueDetail: (owner: string, repo: string, n: number) => ['issue-detail', owner, repo, n] as const
};
