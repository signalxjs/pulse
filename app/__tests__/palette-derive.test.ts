/**
 * Palette "Jump to issue" filtering (overlays/palette-derive.ts): the same
 * filterIssues helper the views use, over the recorded lumen dataset,
 * capped at the prototype's 6 rows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitHubIssue } from '@pulse/github';
import { PALETTE_JUMP_LIMIT, jumpMatches } from '../src/board/overlays/palette-derive';

const issues = JSON.parse(readFileSync(
    join(process.cwd(), 'packages', 'github', 'fixtures', 'issues', 'lumen', 'lumen.json'), 'utf-8'
)) as GitHubIssue[];

describe('jumpMatches', () => {
    it('caps an empty query at the first 6 issues', () => {
        const rows = jumpMatches(issues, '');
        expect(rows).toHaveLength(PALETTE_JUMP_LIMIT);
    });

    it('matches a title substring case-insensitively', () => {
        const rows = jumpMatches(issues, 'focus-trap');
        expect(rows.map((i) => i.number)).toEqual([495]);
    });

    it('matches an issue-number prefix, with or without #', () => {
        expect(jumpMatches(issues, '509').map((i) => i.number)).toEqual([509]);
        expect(jumpMatches(issues, '#4').map((i) => i.number).every((n) => String(n).startsWith('4'))).toBe(true);
    });

    it('answers empty on a no-match query (section hidden)', () => {
        expect(jumpMatches(issues, 'zzz-no-such-issue')).toEqual([]);
    });
});
