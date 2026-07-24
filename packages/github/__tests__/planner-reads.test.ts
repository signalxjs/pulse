/**
 * The planner read surface: pagination envelope + Link parsing (incl. the
 * 304 reconstruction that makes cached pages keep their cursor),
 * 403-tolerant collaborators, issue/timeline mapping — and the fixtures
 * adapter's fs-free dataset.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { createLiveClient, GitHubApiError } from '@pulse/github';
import { createFixturesClient } from '@pulse/github/fixtures';
import { createSqliteEtagCache } from '@pulse/github/node';

function fetchStub(sequence: Array<{ status: number; body?: unknown; etag?: string; headers?: Record<string, string> }>) {
    let call = 0;
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const stub = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, headers: init.headers });
        const step = sequence[Math.min(call++, sequence.length - 1)]!;
        return {
            ok: step.status >= 200 && step.status < 300,
            status: step.status,
            headers: new Headers({ ...(step.etag ? { etag: step.etag } : {}), ...step.headers }),
            text: async () => JSON.stringify(step.body ?? null)
        } as unknown as Response;
    });
    return { stub, calls };
}

const RAW_ISSUE = {
    number: 42,
    title: 'An issue',
    body: 'Details',
    state: 'open',
    draft: false,
    labels: [{ name: 'bug', color: 'e5533b', description: "Something isn't working" }],
    assignees: [{ login: 'mira', avatar_url: 'https://a/mira' }],
    milestone: { number: 24, title: 'Cycle 24', extra: 'dropped' },
    comments: 3,
    user: { login: 'rin', avatar_url: 'https://a/rin' },
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
    closed_at: null,
    html_url: 'https://github.com/o/r/issues/42'
};

describe('createLiveClient — repoIssues paging', () => {
    it('parses rel="next" from the Link header into the page envelope', async () => {
        const { stub, calls } = fetchStub([{
            status: 200,
            body: [RAW_ISSUE],
            etag: 'W/"p1"',
            headers: {
                link: '<https://api.github.com/repos/o/r/issues?state=all&page=2>; rel="next", '
                    + '<https://api.github.com/repos/o/r/issues?state=all&page=5>; rel="last"'
            }
        }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const page = await gh.repoIssues('o', 'r');
        expect(page.nextPage).toBe(2);
        expect(page.items).toHaveLength(1);
        // Query defaults: everything (issues+PRs), newest-updated first, max page size.
        expect(calls[0]!.url).toContain('/repos/o/r/issues?');
        expect(calls[0]!.url).toContain('state=all');
        expect(calls[0]!.url).toContain('sort=updated');
        expect(calls[0]!.url).toContain('per_page=100');
    });

    it.each([
        ['no numeric page param', '<https://api.github.com/repos/o/r/issues?cursor=abc>; rel="next"'],
        ['unparseable next URL', '<not a url at all>; rel="next"']
    ])('treats a malformed next-URL (%s) as the last page', async (_name, link) => {
        const { stub } = fetchStub([{
            status: 200,
            body: [RAW_ISSUE],
            etag: 'W/"p1"',
            headers: { link }
        }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const page = await gh.repoIssues('o', 'r');
        expect(page.nextPage).toBeNull();
    });

    it('clamps out-of-contract paging options before they reach the query', async () => {
        const { stub, calls } = fetchStub([
            { status: 200, body: [], etag: '"a"' },
            { status: 200, body: [], etag: '"b"' }
        ]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        await gh.repoIssues('o', 'r', { perPage: 500 });
        expect(calls[0]!.url).toContain('per_page=100');
        await gh.repoIssues('o', 'r', { page: 0, perPage: 0 });
        expect(calls[1]!.url).toContain('per_page=1');
        expect(calls[1]!.url).not.toContain('page=0');
    });

    it('passes state/page/labels/milestone/since through to the query', async () => {
        const { stub, calls } = fetchStub([{ status: 200, body: [], etag: '"x"' }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const page = await gh.repoIssues('o', 'r', {
            state: 'open', page: 3, perPage: 50, labels: 'bug,security', milestone: 24, since: '2026-07-01T00:00:00Z'
        });
        expect(page).toEqual({ items: [], nextPage: null });
        const url = calls[0]!.url;
        expect(url).toContain('state=open');
        expect(url).toContain('page=3');
        expect(url).toContain('per_page=50');
        expect(url).toContain(`labels=${encodeURIComponent('bug,security')}`);
        expect(url).toContain('milestone=24');
        expect(url).toContain(`since=${encodeURIComponent('2026-07-01T00:00:00Z')}`);
    });

    it('caches the {items, nextPage} envelope so a 304 reconstructs the full page', async () => {
        const cache = createSqliteEtagCache();
        const { stub, calls } = fetchStub([
            {
                status: 200,
                body: [RAW_ISSUE],
                etag: 'W/"p1"',
                headers: { link: '<https://api.github.com/repos/o/r/issues?page=2>; rel="next"' }
            },
            { status: 304 } // no body, no Link header — everything must come from the cache
        ]);
        const gh = createLiveClient({ token: 't', etagCache: cache, fetch: stub as unknown as typeof fetch });

        const first = await gh.repoIssues('o', 'r');
        const second = await gh.repoIssues('o', 'r');
        expect(calls[1]!.headers['if-none-match']).toBe('W/"p1"');
        expect(second).toEqual(first);
        expect(second.nextPage).toBe(2);
        expect(second.items[0]!.number).toBe(42);
    });

    it('answers an empty first page for a missing repo (404)', async () => {
        const { stub } = fetchStub([{ status: 404 }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        expect(await gh.repoIssues('nope', 'nope')).toEqual({ items: [], nextPage: null });
    });
});

describe('createLiveClient — issue mapping', () => {
    it('maps REST fields, flags PRs via the pull_request key', async () => {
        const raw = { ...RAW_ISSUE, pull_request: { url: 'https://api.github.com/...' }, draft: true };
        const { stub } = fetchStub([{ status: 200, body: raw, etag: '"i"' }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const issue = (await gh.issue('o', 'r', 42))!;
        expect(issue.isPr).toBe(true);
        expect(issue.draft).toBe(true);
        expect(issue.milestone).toEqual({ number: 24, title: 'Cycle 24' });
        expect(issue.author).toEqual({ login: 'rin', avatarUrl: 'https://a/rin' });
        expect(issue.assignees).toEqual([{ login: 'mira', avatarUrl: 'https://a/mira' }]);
        expect(issue.labels[0]).toEqual({ name: 'bug', color: 'e5533b', description: "Something isn't working" });
        expect(issue.closedAt).toBeNull();
        expect(issue.htmlUrl).toBe('https://github.com/o/r/issues/42');
    });

    it('plain issues are not PRs, missing milestone maps to null', async () => {
        const raw = { ...RAW_ISSUE, milestone: null };
        const { stub } = fetchStub([{ status: 200, body: raw, etag: '"i"' }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const issue = (await gh.issue('o', 'r', 42))!;
        expect(issue.isPr).toBe(false);
        expect(issue.milestone).toBeNull();
    });
});

describe('createLiveClient — repoCollaborators 403 tolerance', () => {
    it('answers [] on a plain permission 403', async () => {
        const { stub } = fetchStub([
            { status: 403, body: { message: 'Must have push access to view repository collaborators.' } }
        ]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        expect(await gh.repoCollaborators('o', 'r')).toEqual([]);
    });

    it('still throws on a budget-exhausted 403 (headers)', async () => {
        const { stub } = fetchStub([
            { status: 403, headers: { 'x-ratelimit-remaining': '0' } }
        ]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const err = await gh.repoCollaborators('o', 'r').catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err).toBeInstanceOf(GitHubApiError);
        expect(err.rateLimited).toBe(true);
    });

    it('still throws when only the body message reveals the rate limit', async () => {
        const { stub } = fetchStub([
            { status: 403, body: { message: 'You have exceeded a secondary rate limit. Please wait.' } }
        ]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const err = await gh.repoCollaborators('o', 'r').catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err).toBeInstanceOf(GitHubApiError);
        expect(err.rateLimited).toBe(true);
    });

    it('maps collaborator users on success', async () => {
        const { stub } = fetchStub([
            { status: 200, body: [{ login: 'mira', avatar_url: 'https://a/mira', permissions: {} }], etag: '"c"' }
        ]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        expect(await gh.repoCollaborators('o', 'r')).toEqual([{ login: 'mira', avatarUrl: 'https://a/mira' }]);
    });
});

describe('createLiveClient — issueTimeline', () => {
    it('maps known events and filters unknown ones', async () => {
        const { stub } = fetchStub([{
            status: 200,
            etag: '"t"',
            body: [
                { event: 'labeled', actor: { login: 'mira', avatar_url: 'https://a/mira' }, created_at: '2026-07-01T00:00:00Z', label: { name: 'bug', color: 'e5533b' } },
                { event: 'assigned', actor: { login: 'rin', avatar_url: 'https://a/rin' }, created_at: '2026-07-02T00:00:00Z', assignee: { login: 'mira', avatar_url: 'https://a/mira' } },
                { event: 'commented', user: { login: 'devon', avatar_url: 'https://a/devon' }, created_at: '2026-07-03T00:00:00Z', body: 'A comment' },
                { event: 'cross-referenced', actor: { login: 'mira', avatar_url: 'https://a/mira' }, created_at: '2026-07-04T00:00:00Z', source: { type: 'issue', issue: { number: 7, title: 'A PR', pull_request: {}, repository: { full_name: 'o/r' } } } },
                { event: 'committed', author: { name: 'Mira', email: 'm@x', date: '2026-07-05T00:00:00Z' }, message: 'fix: the thing' },
                { event: 'subscribed', actor: { login: 'lee', avatar_url: 'https://a/lee' }, created_at: '2026-07-06T00:00:00Z' },
                { event: 'renamed', actor: { login: 'lee', avatar_url: 'https://a/lee' }, created_at: '2026-07-07T00:00:00Z', rename: { from: 'a', to: 'b' } }
            ]
        }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const events = await gh.issueTimeline('o', 'r', 42);
        expect(events.map((e) => e.event)).toEqual(['labeled', 'assigned', 'commented', 'cross-referenced', 'committed']);
        expect(events[0]!.label).toEqual({ name: 'bug', color: 'e5533b' });
        expect(events[1]!.assignee).toEqual({ login: 'mira', avatarUrl: 'https://a/mira' });
        expect(events[2]!.actor).toEqual({ login: 'devon', avatarUrl: 'https://a/devon' });
        expect(events[2]!.body).toBe('A comment');
        expect(events[3]!.source).toEqual({ number: 7, title: 'A PR', isPr: true, repo: 'o/r' });
        // Commits have a git author, not a GitHub account.
        expect(events[4]!.actor).toBeNull();
        expect(events[4]!.createdAt).toBe('2026-07-05T00:00:00Z');
        expect(events[4]!.body).toBe('fix: the thing');
    });

    it('answers [] for a missing issue', async () => {
        const { stub } = fetchStub([{ status: 404 }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        expect(await gh.issueTimeline('o', 'r', 999)).toEqual([]);
    });
});

describe('fixtures adapter — planner dataset', () => {
    const gh = createFixturesClient();

    it('serves the full lumen/lumen demo dataset', async () => {
        const page = await gh.repoIssues('lumen', 'lumen');
        expect(page.items).toHaveLength(22);
        expect(page.nextPage).toBeNull();
        // Newest-updated first, like the live endpoint.
        const updated = page.items.map((i) => i.updatedAt);
        expect([...updated].sort().reverse()).toEqual(updated);
        // PRs ride along in the issues list.
        expect(page.items.filter((i) => i.isPr).map((i) => i.number).sort()).toEqual([492, 494]);
    });

    it('pages the dataset with a nextPage cursor', async () => {
        const p1 = await gh.repoIssues('lumen', 'lumen', { perPage: 10 });
        const p2 = await gh.repoIssues('lumen', 'lumen', { perPage: 10, page: 2 });
        const p3 = await gh.repoIssues('lumen', 'lumen', { perPage: 10, page: 3 });
        expect(p1.items).toHaveLength(10);
        expect(p1.nextPage).toBe(2);
        expect(p2.nextPage).toBe(3);
        expect(p3.items).toHaveLength(2);
        expect(p3.nextPage).toBeNull();
        const all = [...p1.items, ...p2.items, ...p3.items].map((i) => i.number);
        expect(new Set(all).size).toBe(22);
    });

    it('clamps out-of-contract paging (page < 1, perPage > 100) like the live endpoint', async () => {
        const zeroPage = await gh.repoIssues('lumen', 'lumen', { page: 0, perPage: 10 });
        const firstPage = await gh.repoIssues('lumen', 'lumen', { page: 1, perPage: 10 });
        expect(zeroPage.items.map((i) => i.number)).toEqual(firstPage.items.map((i) => i.number));
        const oversized = await gh.repoIssues('lumen', 'lumen', { perPage: 500 });
        expect(oversized.items).toHaveLength(22);
        expect(oversized.nextPage).toBeNull();
    });

    it('filters by state, labels and milestone', async () => {
        const closed = await gh.repoIssues('lumen', 'lumen', { state: 'closed' });
        expect(closed.items.map((i) => i.number).sort()).toEqual([444, 452, 460, 465]);
        const bugs = await gh.repoIssues('lumen', 'lumen', { labels: 'bug,security' });
        expect(bugs.items.map((i) => i.number).sort()).toEqual([482, 511]);
        const cycle25 = await gh.repoIssues('lumen', 'lumen', { milestone: 25 });
        expect(cycle25.items).toHaveLength(4);
        const noCycle = await gh.repoIssues('lumen', 'lumen', { milestone: 'none' });
        expect(noCycle.items.map((i) => i.number).sort()).toEqual([455, 476]);
    });

    it('answers empty pages / null / [] for unknown repos', async () => {
        expect(await gh.repoIssues('nobody', 'nothing')).toEqual({ items: [], nextPage: null });
        expect(await gh.repoLabels('nobody', 'nothing')).toEqual([]);
        expect(await gh.repoMilestones('nobody', 'nothing')).toEqual([]);
        expect(await gh.repoCollaborators('nobody', 'nothing')).toEqual([]);
        expect(await gh.issue('nobody', 'nothing', 1)).toBeNull();
        expect(await gh.issueTimeline('nobody', 'nothing', 1)).toEqual([]);
    });

    it('serves labels, milestones, collaborators, single issues and timelines', async () => {
        const labels = await gh.repoLabels('lumen', 'lumen');
        expect(labels.map((l) => l.name)).toContain('status: in progress');
        expect(labels.map((l) => l.name)).toContain('P0');

        const milestones = await gh.repoMilestones('lumen', 'lumen');
        expect(milestones.map((m) => m.number)).toEqual([22, 23, 24, 25, 26]);
        expect(milestones.find((m) => m.number === 24)?.state).toBe('open');

        const collaborators = await gh.repoCollaborators('lumen', 'lumen');
        expect(collaborators.map((p) => p.login).sort()).toEqual(['devon', 'lee', 'mira', 'rin', 'sana']);

        const issue = await gh.issue('lumen', 'lumen', 482);
        expect(issue?.title).toBe('Fix auth token refresh race condition');
        expect(issue?.milestone).toEqual({ number: 24, title: 'Cycle 24' });
        expect(await gh.issue('lumen', 'lumen', 99999)).toBeNull();

        const timeline = await gh.issueTimeline('lumen', 'lumen', 482);
        expect(timeline.length).toBeGreaterThanOrEqual(3);
        expect(timeline.some((e) => e.event === 'commented')).toBe(true);
        expect(await gh.issueTimeline('lumen', 'lumen', 511)).toEqual([]);
    });

    it('returns fresh objects per read — mutating a result never leaks into later reads', async () => {
        const labels = await gh.repoLabels('lumen', 'lumen');
        labels.pop();
        labels[0]!.name = 'mutated';
        const again = await gh.repoLabels('lumen', 'lumen');
        expect(again.length).toBe(labels.length + 1);
        expect(again[0]!.name).not.toBe('mutated');
    });

    it('keeps the signalxjs/pulse recordings working alongside the demo', async () => {
        const page = await gh.repoIssues('signalxjs', 'pulse');
        expect(page.items.length).toBeGreaterThanOrEqual(3);
        expect(await gh.repoLabels('signalxjs', 'pulse')).not.toEqual([]);
        expect((await gh.repoCollaborators('signalxjs', 'pulse'))[0]?.login).toBe('pulse-dev');
    });
});

describe('WinterCG purity', () => {
    it('the root export and the fixtures adapter never import node:*', () => {
        // import.meta.url is not a file: URL under the happy-dom environment;
        // vitest runs from the repo root.
        const src = join(process.cwd(), 'packages', 'github', 'src');
        for (const file of ['index.js', 'live.js', 'fixtures.js', 'fixtures-data.js']) {
            const code = readFileSync(join(src, file), 'utf-8');
            expect(code, `${file} must stay runtime-agnostic`).not.toMatch(/from\s+['"]node:/);
        }
    });
});
