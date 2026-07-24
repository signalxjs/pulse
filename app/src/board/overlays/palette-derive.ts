/**
 * Command-palette derivations (handoff §10, pulse#54) — pure. The "Jump to
 * issue" section reuses the SAME filterIssues helper the views apply (query
 * matches a title substring or an issue-number prefix), capped at 6 rows
 * like the prototype.
 */
import type { GitHubIssue } from '@pulse/github';
import { filterIssues } from '../derive';

export const PALETTE_JUMP_LIMIT = 6;

/** The palette's jump candidates for one query (no label filter — the
 *  palette searches the whole working set). */
export function jumpMatches(issues: readonly GitHubIssue[], query: string): GitHubIssue[] {
    return filterIssues(issues, { query, filterLabel: null }).slice(0, PALETTE_JUMP_LIMIT);
}
