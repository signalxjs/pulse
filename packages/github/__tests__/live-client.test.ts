/**
 * The live adapter's conditional-request behavior — the part that guards
 * GitHub's rate budget: 200 responses populate the EtagCache, subsequent
 * requests carry If-None-Match, and 304s are served from the cache.
 */
import { describe, it, expect, vi } from 'vitest';
import { createLiveClient, GitHubApiError, createSqliteEtagCache } from '@pulse/github';

const USER = { login: 'octo', name: 'Octo', avatar_url: 'https://a/u' };

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

describe('createLiveClient — conditional requests', () => {
    it('stores the etag on 200 and serves 304s from the cache', async () => {
        const cache = createSqliteEtagCache();
        const { stub, calls } = fetchStub([
            { status: 200, body: USER, etag: 'W/"abc"' },
            { status: 304 }
        ]);
        const gh = createLiveClient({ token: 't', etagCache: cache, fetch: stub as unknown as typeof fetch });

        const first = await gh.viewer();
        expect(first.login).toBe('octo');
        expect(calls[0]!.headers['if-none-match']).toBeUndefined();

        const second = await gh.viewer();
        expect(second).toEqual(first);
        expect(calls[1]!.headers['if-none-match']).toBe('W/"abc"');
        expect(stub).toHaveBeenCalledTimes(2);
    });

    it('returns null for 404 repos instead of throwing', async () => {
        const { stub } = fetchStub([{ status: 404 }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        expect(await gh.repo('nope', 'nope')).toBeNull();
    });

    it('marks exhausted-budget 403s as rateLimited', async () => {
        const { stub } = fetchStub([
            { status: 403, headers: { 'x-ratelimit-remaining': '0' } }
        ]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const err = await gh.viewer().catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err).toBeInstanceOf(GitHubApiError);
        expect(err.status).toBe(403);
        expect(err.rateLimited).toBe(true);
    });

    it('flags 429 as rateLimited even without the remaining header', async () => {
        const { stub } = fetchStub([{ status: 429 }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const err = await gh.viewer().catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err.rateLimited).toBe(true);
    });

    it('plain 403s (permissions) are NOT rateLimited', async () => {
        const { stub } = fetchStub([{ status: 403 }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const err = await gh.viewer().catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err.rateLimited).toBe(false);
    });

    it('403 + Retry-After counts as rate limiting (secondary limits)', async () => {
        const { stub } = fetchStub([{ status: 403, headers: { 'retry-after': '60' } }]);
        const gh = createLiveClient({ token: 't', fetch: stub as unknown as typeof fetch });
        const err = await gh.viewer().catch((e: unknown) => e) as InstanceType<typeof GitHubApiError>;
        expect(err.rateLimited).toBe(true);
    });

    it('sends auth + api-version headers', async () => {
        const { stub, calls } = fetchStub([{ status: 200, body: USER, etag: '"x"' }]);
        const gh = createLiveClient({ token: 'tok123', fetch: stub as unknown as typeof fetch });
        await gh.viewer();
        expect(calls[0]!.headers.authorization).toBe('Bearer tok123');
        expect(calls[0]!.headers['x-github-api-version']).toBe('2022-11-28');
        expect(calls[0]!.headers['user-agent']).toContain('pulse');
    });
});

describe('createLiveClient — construction', () => {
    it('fails fast without a token', () => {
        expect(() => createLiveClient({ token: '' as string })).toThrow(/token is required/);
    });
});

describe('fixtures adapter', () => {
    it('serves the committed recordings, tokenless', async () => {
        const { createFixturesClient } = await import('@pulse/github');
        const gh = createFixturesClient();
        const viewer = await gh.viewer();
        expect(viewer.login).toBe('pulse-dev');
        const repos = await gh.ownerRepos('signalxjs');
        expect(repos.length).toBeGreaterThan(5);
        expect(repos[0]).toHaveProperty('fullName');
        const core = await gh.repo('signalxjs', 'core');
        expect(core?.fullName).toBe('signalxjs/core');
        expect(await gh.repo('nobody', 'nothing')).toBeNull();
    });

    it('rejects path-traversal segments instead of joining them', async () => {
        const { createFixturesClient } = await import('@pulse/github');
        const gh = createFixturesClient();
        expect(await gh.repo('..', '..')).toBeNull();
        expect(await gh.repo('../../../../etc', 'passwd')).toBeNull();
        expect(await gh.ownerRepos('../secrets')).toEqual([]);
        // Legit names with dots still work.
        expect(await gh.ownerRepos('signalxjs')).not.toEqual([]);
    });
});
