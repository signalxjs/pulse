/**
 * The live GitHub REST v3 adapter.
 *
 * Every GET goes through `cachedGet`: when the EtagCache holds an entry for
 * the URL, the request carries `If-None-Match` and a 304 answer is served
 * from the cache — GitHub does not charge rate limit for 304s, which is
 * what lets Pulse browse comfortably inside the 5000/h authenticated
 * budget.
 */

/** Error carrying the GitHub status; `rateLimited` marks 403/429 budget exhaustion. */
export class GitHubApiError extends Error {
    /**
     * @param {string} message
     * @param {number} status
     * @param {boolean} rateLimited
     */
    constructor(message, status, rateLimited = false) {
        super(message);
        this.name = 'GitHubApiError';
        this.status = status;
        this.rateLimited = rateLimited;
    }
}

/** @param {Response} res */
function isRateLimited(res) {
    // 429 IS rate limiting (secondary limits often omit the remaining
    // header); a 403 only counts when the primary budget shows exhausted —
    // plain 403s are permissions.
    if (res.status === 429) return true;
    return res.status === 403 && (
        res.headers.get('x-ratelimit-remaining') === '0'
        || res.headers.has('retry-after')
    );
}

/**
 * @param {import('./index.js').LiveClientOptions} options
 * @returns {import('./index.js').GitHubClient}
 */
export function createLiveClient(options) {
    const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
    const doFetch = options.fetch ?? fetch;
    const cache = options.etagCache;

    /**
     * GET a REST path with conditional-request caching.
     * @param {string} path
     * @returns {Promise<any>}
     */
    async function cachedGet(path) {
        const url = `${baseUrl}${path}`;
        const cached = cache?.get(url);
        /** @type {Record<string, string>} */
        const headers = {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${options.token}`,
            // GitHub requires a User-Agent identifying the app.
            'user-agent': 'pulse (github.com/signalxjs/pulse)',
            'x-github-api-version': '2022-11-28'
        };
        if (cached) headers['if-none-match'] = cached.etag;

        const res = await doFetch(url, { headers });

        if (res.status === 304 && cached) {
            return JSON.parse(cached.body);
        }
        if (res.status === 404) {
            return null;
        }
        if (!res.ok) {
            throw new GitHubApiError(
                `GitHub ${res.status} for ${path}`,
                res.status,
                isRateLimited(res)
            );
        }
        const body = await res.text();
        const etag = res.headers.get('etag');
        if (etag && cache) cache.set(url, etag, body);
        return JSON.parse(body);
    }

    /** @param {any} r @returns {import('./index.js').GitHubRepo} */
    const toRepo = (r) => ({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        description: r.description ?? null,
        private: Boolean(r.private),
        openIssues: r.open_issues_count ?? 0,
        updatedAt: r.pushed_at ?? r.updated_at
    });

    return {
        async viewer() {
            const u = await cachedGet('/user');
            return { login: u.login, name: u.name ?? null, avatarUrl: u.avatar_url };
        },

        async viewerOrgs() {
            const orgs = await cachedGet('/user/orgs');
            return orgs.map((/** @type {any} */ o) => ({
                login: o.login,
                avatarUrl: o.avatar_url,
                description: o.description ?? null
            }));
        },

        async viewerRepos() {
            const repos = await cachedGet('/user/repos?sort=pushed&per_page=30');
            return repos.map(toRepo);
        },

        async ownerRepos(owner) {
            const repos = await cachedGet(`/users/${encodeURIComponent(owner)}/repos?sort=pushed&per_page=30`);
            return (repos ?? []).map(toRepo);
        },

        async repo(owner, name) {
            const r = await cachedGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
            return r ? toRepo(r) : null;
        }
    };
}
