/**
 * Detail-panel derivations (overlays/detail-derive.ts): linked-PR
 * extraction from REAL recorded timelines, the Activity mapping, and the
 * relative-time formatter.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitHubIssue, GitHubTimelineEvent } from '@pulse/github';
import { activityFrom, linkedPr, relTime } from '../src/board/overlays/detail-derive';

const fixture = <T>(rel: string): T =>
    JSON.parse(readFileSync(join(process.cwd(), 'packages', 'github', 'fixtures', rel), 'utf-8')) as T;

const issues = fixture<GitHubIssue[]>('issues/lumen/lumen.json');
const issue = (n: number) => issues.find((i) => i.number === n)!;

describe('linkedPr', () => {
    it('finds the cross-referenced PR in a recorded timeline (#487 → PR #492)', () => {
        const timeline = fixture<GitHubTimelineEvent[]>('timeline/lumen/lumen/487.json');
        expect(linkedPr(timeline)).toEqual({
            number: 492,
            title: 'perf: tree-shake icon exports',
            repo: 'lumen/lumen'
        });
    });

    it('answers null when no cross-reference carries a PR (#482)', () => {
        const timeline = fixture<GitHubTimelineEvent[]>('timeline/lumen/lumen/482.json');
        expect(linkedPr(timeline)).toBeNull();
        expect(linkedPr([])).toBeNull();
    });

    it('ignores plain-issue cross-references and takes the LATEST PR', () => {
        const ev = (n: number, isPr: boolean): GitHubTimelineEvent => ({
            event: 'cross-referenced',
            actor: null,
            createdAt: null,
            source: { number: n, title: `t${n}`, isPr, repo: null }
        });
        expect(linkedPr([ev(1, false)])).toBeNull();
        expect(linkedPr([ev(1, true), ev(2, false), ev(3, true)])?.number).toBe(3);
    });
});

describe('activityFrom', () => {
    const now = new Date('2026-07-24T12:00:00Z');

    it('prepends the synthesized "opened" event and maps every entry', () => {
        const timeline = fixture<GitHubTimelineEvent[]>('timeline/lumen/lumen/487.json');
        const rows = activityFrom(issue(487), timeline, now);
        expect(rows).toHaveLength(timeline.length + 1);
        expect(rows[0]!.text).toBe('opened this issue');
        expect(rows[0]!.login).toBe(issue(487).author!.login);
        expect(rows.map((r) => r.text)).toEqual([
            'opened this issue',
            'added the performance label',
            'self-assigned this',
            'left a comment',
            'referenced this from PR #492'
        ]);
        // Every recorded event carries a timestamp → a relative time.
        expect(rows.every((r) => r.time !== '')).toBe(true);
    });

    it('says "opened this pull request" for PRs and falls back to ghost on missing actors', () => {
        const pr = issue(492);
        const rows = activityFrom(pr, [
            { event: 'committed', actor: null, createdAt: null, body: 'wip' }
        ], now);
        expect(rows[0]!.text).toBe('opened this pull request');
        expect(rows[1]).toMatchObject({ login: 'ghost', text: 'pushed a commit', time: '' });
    });

    it('distinguishes self-assignment from assigning someone else', () => {
        const actor = { login: 'rin', avatarUrl: '' };
        const rows = activityFrom(issue(487), [
            { event: 'assigned', actor, createdAt: '2026-07-20T00:00:00Z', assignee: { login: 'mira', avatarUrl: '' } },
            { event: 'assigned', actor, createdAt: '2026-07-20T00:00:00Z', assignee: { login: 'rin', avatarUrl: '' } }
        ], now);
        expect(rows[1]!.text).toBe('assigned mira');
        expect(rows[2]!.text).toBe('self-assigned this');
    });
});

describe('relTime', () => {
    const now = new Date('2026-07-24T12:00:00Z');
    it('formats each magnitude compactly', () => {
        expect(relTime('2026-07-24T11:59:40Z', now)).toBe('just now');
        expect(relTime('2026-07-24T11:15:00Z', now)).toBe('45m ago');
        expect(relTime('2026-07-24T08:00:00Z', now)).toBe('4h ago');
        expect(relTime('2026-07-18T12:00:00Z', now)).toBe('6d ago');
        expect(relTime('2026-05-01T12:00:00Z', now)).toBe('2mo ago');
        expect(relTime('2024-07-01T12:00:00Z', now)).toBe('2y ago');
    });
});
