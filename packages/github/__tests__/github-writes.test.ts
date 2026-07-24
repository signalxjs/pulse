/**
 * The write surface (issue #30): `send()`'s wire behavior on the live
 * adapter — method/path/body/auth, no ETag involvement, 422 field-error
 * mapping — and the fixtures adapter's per-instance write overlay
 * (create/update/comment/label semantics, FIXTURES map integrity).
 */
import { describe, it, expect, vi } from 'vitest';
import { createLiveClient, GitHubApiError } from '@pulse/github';
import { createFixturesClient } from '@pulse/github/fixtures';
import { createSqliteEtagCache } from '@pulse/github/node';

function fetchStub(sequence: Array<{ status: number; body?: unknown; etag?: string; headers?: Record<string, string> }>) {
    let call = 0;
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | undefined }> = [];
    const stub = vi.fn(async (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => {
        calls.push({ url, method: init.method ?? 'GET', headers: init.headers, body: init.body });
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

const RAW_CREATED_ISSUE = {
    number: 512,
    title: 'New issue',
    body: 'Details',
    state: 'open',
    labels: [{ name: 'bug', color: 'e5533b', description: "Something isn't working" }],
    assignees: [{ login: 'mira', avatar_url: 'https://a/mira' }],
    milestone: { number: 24, title: 'Cycle 24' },
    comments: 0,
    user: { login: 'octo', avatar_url: 'https://a/octo' },
    created_at: '2026-07-24T00:00:00Z',
    updated_at: '2026-07-24T00:00:00Z',
    closed_at: null,
    html_url: 'https://github.com/o/r/issues/512'
};

describe('createLiveClient — send() wire behavior', () => {
    it('createIssue POSTs the input as JSON with auth headers and maps the response', async () => {
        const { stub, calls } = fetchStub([{ status: 201, body: RAW_CREATED_ISSUE }]);
        const gh = createLiveClient({ token: 'tok123', fetch: stub as unknown as typeof fetch });
        const issue = await gh.createIssue('o', 'r', {
            title: 'New issue', body: 'Details', labels: ['bug'], assignees: ['mira'], milestone: 24
        });

        expect(calls[0]!.method).toBe('POST');
        expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/issues');
        expect(calls[0]!.headers.authorization).toBe('Bearer tok123');
        expect(calls[0]!.headers['x-github-api-version']).toBe('2022-11-28');
        expect(calls[0]!.headers['content-type']).toBe('application/json');
        expect(JSON.parse(calls[0]!.body!)).toEqual({
            title: 'New issue', body: 'Details', labels: ['bug'], assignees: ['mira'], milestone: 24
        });

        // Mapped through toIssue like the reads.
        expect(issue.number).toBe(512);
        expect(issue.isPr).toBe(false);
        expect(issue.labels).toEqual([{ name: 'bug', color: 'e5533b', description: "Something isn't working" }]);
        expect(issue.author).toEqual({ login: 'octo', avatarUrl: 'https://a/octo' });
        expect(issue.milestone).toEqual({ number: 24, title: 'Cycle 24' });
    });

    it('updateIssue PATCHes the issue path with the patch body', async () => {
        const { stub, calls } = fetchStub([{ status: 200, body: { ...RAW_CREATED_ISSUE, state: 'closed' } }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const issue = await gh.updateIssue('o', 'r', 512, { state: 'closed', labels: ['status: done'] });

        expect(calls[0]!.method).toBe('PATCH');
        expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/issues/512');
        expect(JSON.parse(calls[0]!.body!)).toEqual({ state: 'closed', labels: ['status: done'] });
        expect(issue.state).toBe('closed');
    });

    it('createComment POSTs {body} to the comments path and maps the comment', async () => {
        const { stub, calls } = fetchStub([{
            status: 201,
            body: { id: 987, body: 'A comment', created_at: '2026-07-24T01:00:00Z', user: { login: 'octo', avatar_url: 'https://a/octo' } }
        }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const comment = await gh.createComment('o', 'r', 42, 'A comment');

        expect(calls[0]!.method).toBe('POST');
        expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/issues/42/comments');
        expect(JSON.parse(calls[0]!.body!)).toEqual({ body: 'A comment' });
        expect(comment).toEqual({
            id: 987,
            body: 'A comment',
            createdAt: '2026-07-24T01:00:00Z',
            author: { login: 'octo', avatarUrl: 'https://a/octo' }
        });
    });

    it('createLabel POSTs to /labels (color without leading #) and maps the label', async () => {
        const { stub, calls } = fetchStub([{
            status: 201,
            body: { name: 'status: done', color: '2da44e', description: 'Planner status: Done' }
        }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const label = await gh.createLabel('o', 'r', { name: 'status: done', color: '2da44e', description: 'Planner status: Done' });

        expect(calls[0]!.method).toBe('POST');
        expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/labels');
        expect(JSON.parse(calls[0]!.body!)).toEqual({ name: 'status: done', color: '2da44e', description: 'Planner status: Done' });
        expect(label).toEqual({ name: 'status: done', color: '2da44e', description: 'Planner status: Done' });
    });

    it('writes never touch the ETag cache: no If-None-Match, nothing stored', async () => {
        const cache = createSqliteEtagCache();
        const { stub, calls } = fetchStub([
            { status: 201, body: RAW_CREATED_ISSUE, etag: 'W/"write"' },
            { status: 201, body: RAW_CREATED_ISSUE, etag: 'W/"write"' }
        ]);
        const gh = createLiveClient({ token: 't', etagCache: cache, fetch: stub as unknown as typeof fetch });
        await gh.createIssue('o', 'r', { title: 'a' });
        await gh.createIssue('o', 'r', { title: 'b' });
        expect(calls[0]!.headers['if-none-match']).toBeUndefined();
        // Even though the first response carried an etag, the second write
        // must not send a validator — writes bypass the cache entirely.
        expect(calls[1]!.headers['if-none-match']).toBeUndefined();
        expect(cache.get('https://api.github.com/repos/o/r/issues')).toBeUndefined();
    });

    it('folds 422 errors[] field details into the GitHubApiError message', async () => {
        const { stub } = fetchStub([{
            status: 422,
            body: {
                message: 'Validation Failed',
                errors: [
                    { resource: 'Issue', field: 'milestone', code: 'invalid' },
                    { message: 'body is too long (maximum is 65536 characters)' }
                ]
            }
        }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const err = await gh.createIssue('o', 'r', { title: 'x' }).catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err).toBeInstanceOf(GitHubApiError);
        expect(err.status).toBe(422);
        expect(err.message).toContain('Validation Failed');
        expect(err.message).toContain('Issue milestone invalid');
        expect(err.message).toContain('body is too long');
    });

    it('a write 404 throws instead of answering null like the reads do', async () => {
        const { stub } = fetchStub([{ status: 404, body: { message: 'Not Found' } }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const err = await gh.updateIssue('nope', 'nope', 1, { title: 'x' }).catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err).toBeInstanceOf(GitHubApiError);
        expect(err.status).toBe(404);
    });
});

describe('fixtures adapter — write overlay', () => {
    it('updateIssue label roundtrip: the next repoIssues/issue reads reflect the move', async () => {
        const gh = createFixturesClient();
        const before = (await gh.issue('lumen', 'lumen', 511))!;
        expect(before.labels.map((l) => l.name)).toContain('status: todo');

        const updated = await gh.updateIssue('lumen', 'lumen', 511, {
            labels: ['security', 'bug', 'P0', 'status: in progress']
        });
        expect(updated.labels.map((l) => l.name)).toContain('status: in progress');
        expect(updated.labels.map((l) => l.name)).not.toContain('status: todo');
        // Label names resolve to the repo's full label definitions.
        expect(updated.labels.find((l) => l.name === 'status: in progress')?.color).not.toBe('');
        expect(updated.updatedAt > before.updatedAt).toBe(true);

        const again = (await gh.issue('lumen', 'lumen', 511))!;
        expect(again.labels.map((l) => l.name)).toContain('status: in progress');
        const page = await gh.repoIssues('lumen', 'lumen');
        expect(page.items[0]!.number).toBe(511); // freshest update sorts first
        expect(page.items[0]!.labels.map((l) => l.name)).toContain('status: in progress');

        // The timeline gained one unlabeled + one labeled synthetic event.
        const timeline = await gh.issueTimeline('lumen', 'lumen', 511);
        const tail = timeline.slice(-2);
        expect(tail.map((e) => e.event).sort()).toEqual(['labeled', 'unlabeled']);
        expect(tail.find((e) => e.event === 'unlabeled')?.label?.name).toBe('status: todo');
        expect(tail.find((e) => e.event === 'labeled')?.label?.name).toBe('status: in progress');
    });

    it('updateIssue state handling: closed stamps closedAt, reopen clears it', async () => {
        const gh = createFixturesClient();
        const closed = await gh.updateIssue('lumen', 'lumen', 511, { state: 'closed' });
        expect(closed.state).toBe('closed');
        expect(closed.closedAt).not.toBeNull();
        const closedPage = await gh.repoIssues('lumen', 'lumen', { state: 'closed' });
        expect(closedPage.items.map((i) => i.number)).toContain(511);

        const reopened = await gh.updateIssue('lumen', 'lumen', 511, { state: 'open' });
        expect(reopened.state).toBe('open');
        expect(reopened.closedAt).toBeNull();
    });

    it('createIssue allocates max(number)+1 and is visible to subsequent reads', async () => {
        const gh = createFixturesClient();
        const countBefore = (await gh.repoIssues('lumen', 'lumen')).items.length;
        const created = await gh.createIssue('lumen', 'lumen', {
            title: 'Fresh from the overlay', body: 'Body', labels: ['bug'], assignees: ['mira'], milestone: 24
        });
        expect(created.number).toBe(514); // dataset max is 513
        expect(created.state).toBe('open');
        expect(created.author?.login).toBe('rin'); // first recorded collaborator
        expect(created.labels[0]!.name).toBe('bug');
        expect(created.labels[0]!.color).toBe('e5533b'); // resolved against repo labels
        expect(created.assignees).toEqual([{ login: 'mira', avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4' }]);
        expect(created.milestone).toEqual({ number: 24, title: 'Cycle 24' });
        expect(created.createdAt).toBe(created.updatedAt);

        expect((await gh.issue('lumen', 'lumen', 514))?.title).toBe('Fresh from the overlay');
        const page = await gh.repoIssues('lumen', 'lumen');
        expect(page.items).toHaveLength(countBefore + 1);
        expect(page.items[0]!.number).toBe(514);

        // The next allocation continues past the overlay, not the recording.
        const second = await gh.createIssue('lumen', 'lumen', { title: 'Another' });
        expect(second.number).toBe(515);
    });

    it('createIssue rejects an unknown milestone with a 422', async () => {
        const gh = createFixturesClient();
        const err = await gh.createIssue('lumen', 'lumen', { title: 'x', milestone: 999 })
            .catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err).toBeInstanceOf(GitHubApiError);
        expect(err.status).toBe(422);
        expect(err.message).toContain('milestone');
    });

    it('createComment bumps the comment count and appends a commented timeline event', async () => {
        const gh = createFixturesClient();
        const before = (await gh.issue('lumen', 'lumen', 482))!;
        const timelineBefore = await gh.issueTimeline('lumen', 'lumen', 482);

        const comment = await gh.createComment('lumen', 'lumen', 482, 'Ship it');
        expect(comment.body).toBe('Ship it');
        expect(comment.author.login).toBe('rin');
        expect(comment.id).toBeGreaterThan(0);

        const after = (await gh.issue('lumen', 'lumen', 482))!;
        expect(after.comments).toBe(before.comments + 1);
        expect(after.updatedAt > before.updatedAt).toBe(true);

        const timeline = await gh.issueTimeline('lumen', 'lumen', 482);
        expect(timeline).toHaveLength(timelineBefore.length + 1);
        const last = timeline.at(-1)!;
        expect(last.event).toBe('commented');
        expect(last.body).toBe('Ship it');
        expect(last.actor?.login).toBe('rin');
    });

    it('createLabel appends to the listing and rejects duplicates with a 422', async () => {
        const gh = createFixturesClient();
        const label = await gh.createLabel('lumen', 'lumen', { name: 'status: blocked', color: 'd93f0b' });
        expect(label).toEqual({ name: 'status: blocked', color: 'd93f0b', description: null });
        expect((await gh.repoLabels('lumen', 'lumen')).map((l) => l.name)).toContain('status: blocked');

        // Duplicate names — case-insensitively, like GitHub — are rejected.
        for (const dup of ['status: blocked', 'BUG']) {
            const err = await gh.createLabel('lumen', 'lumen', { name: dup, color: '000000' })
                .catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
            expect(err).toBeInstanceOf(GitHubApiError);
            expect(err.status).toBe(422);
            expect(err.message).toContain('already_exists');
        }
    });

    it('writes against an unknown repo throw 404 instead of inventing data', async () => {
        const gh = createFixturesClient();
        for (const attempt of [
            gh.createIssue('nobody', 'nothing', { title: 'x' }),
            gh.updateIssue('nobody', 'nothing', 1, { title: 'x' }),
            gh.createComment('nobody', 'nothing', 1, 'x'),
            gh.createLabel('nobody', 'nothing', { name: 'x', color: '000000' }),
            gh.updateIssue('..', '..', 1, { title: 'x' }) // traversal segments too
        ]) {
            const err = await attempt.catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
            expect(err).toBeInstanceOf(GitHubApiError);
            expect(err.status).toBe(404);
        }
        // …and a write to a missing issue in a KNOWN repo is a 404 too.
        const err = await gh.updateIssue('lumen', 'lumen', 99999, { title: 'x' })
            .catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err.status).toBe(404);
    });

    it('the overlay is per instance — a fresh client still sees pristine FIXTURES', async () => {
        const dirty = createFixturesClient();
        await dirty.createIssue('lumen', 'lumen', { title: 'overlay-only', labels: ['bug'] });
        await dirty.updateIssue('lumen', 'lumen', 511, { labels: ['bug'], state: 'closed' });
        await dirty.createComment('lumen', 'lumen', 482, 'overlay-only');
        await dirty.createLabel('lumen', 'lumen', { name: 'overlay-only', color: '123456' });

        const fresh = createFixturesClient();
        expect(await fresh.issue('lumen', 'lumen', 514)).toBeNull();
        expect((await fresh.repoIssues('lumen', 'lumen')).items).toHaveLength(22);
        const issue511 = (await fresh.issue('lumen', 'lumen', 511))!;
        expect(issue511.state).toBe('open');
        expect(issue511.labels.map((l) => l.name)).toContain('status: todo');
        const issue482 = (await fresh.issue('lumen', 'lumen', 482))!;
        expect((await dirty.issue('lumen', 'lumen', 482))!.comments).toBe(issue482.comments + 1);
        expect((await fresh.repoLabels('lumen', 'lumen')).map((l) => l.name)).not.toContain('overlay-only');
        expect((await fresh.issueTimeline('lumen', 'lumen', 482)).at(-1)?.body).not.toBe('overlay-only');
    });

    it('mutating a write result never leaks back into the overlay', async () => {
        const gh = createFixturesClient();
        const created = await gh.createIssue('lumen', 'lumen', { title: 'stable' });
        created.title = 'mutated';
        created.labels.push({ name: 'sneaky', color: '000000', description: null });
        const reread = (await gh.issue('lumen', 'lumen', created.number))!;
        expect(reread.title).toBe('stable');
        expect(reread.labels).toEqual([]);

        const comment = await gh.createComment('lumen', 'lumen', 482, 'hi');
        comment.author.login = 'mutated';
        expect((await gh.issueTimeline('lumen', 'lumen', 482)).at(-1)?.actor?.login).toBe('rin');
    });
});
