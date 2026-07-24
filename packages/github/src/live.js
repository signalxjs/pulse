/**
 * The live GitHub REST v3 adapter.
 *
 * Every GET goes through `cachedGet`: when the EtagCache holds an entry for
 * the URL, the request carries `If-None-Match` and a 304 answer is served
 * from the cache — GitHub does not charge rate limit for 304s, which is
 * what lets Pulse browse comfortably inside the 5000/h authenticated
 * budget.
 */
import { clampPaging } from './paging.js';

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
 * Build the GitHubApiError for a non-ok response. The body's message tells
 * rate-limit 403s apart from plain permission 403s when the headers alone
 * don't (secondary limits sometimes ship neither budget header). A 422's
 * `errors[]` field details are folded into the message — "Validation
 * Failed" alone never tells a caller WHICH field was rejected.
 * @param {Response} res
 * @param {string} path
 */
async function toApiError(res, path) {
    let message = '';
    try {
        const parsed = JSON.parse(await res.text());
        message = parsed?.message ?? '';
        if (res.status === 422 && Array.isArray(parsed?.errors)) {
            const details = parsed.errors
                .map((/** @type {any} */ e) => typeof e === 'string'
                    ? e
                    : e?.message ?? [e?.resource, e?.field, e?.code].filter(Boolean).join(' '))
                .filter(Boolean);
            if (details.length) {
                message = `${message || 'Validation Failed'} (${details.join('; ')})`;
            }
        }
    } catch {
        // Non-JSON error body — the status alone will have to do.
    }
    return new GitHubApiError(
        `GitHub ${res.status} for ${path}${message ? `: ${message}` : ''}`,
        res.status,
        isRateLimited(res) || /rate limit/i.test(message)
    );
}

/** Timeline event types the planner renders; everything else is dropped. */
const TIMELINE_EVENTS = new Set([
    'labeled', 'unlabeled', 'assigned', 'closed', 'reopened',
    'commented', 'cross-referenced', 'merged', 'committed'
]);

/**
 * The rel="next" page number out of a Link header, or null on the last page.
 * @param {string | null} linkHeader
 * @returns {number | null}
 */
function nextPageOf(linkHeader) {
    if (!linkHeader) return null;
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(linkHeader);
    if (!match) return null;
    // A malformed next URL (unparseable, or no numeric page param) must
    // read as "last page", never leak NaN or a throw into the caller.
    try {
        const page = Number(new URL(match[1]).searchParams.get('page'));
        return Number.isInteger(page) && page > 0 ? page : null;
    } catch {
        return null;
    }
}

/**
 * @param {import('./index.js').LiveClientOptions} options
 * @returns {import('./index.js').GitHubClient}
 */
export function createLiveClient(options) {
    if (!options?.token) {
        // Fail at construction, not as a baffling 401 with 'Bearer undefined'.
        throw new Error("createLiveClient: a token is required (use createFixturesClient from '@pulse/github/fixtures' for tokenless mode)");
    }
    const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
    const doFetch = options.fetch ?? fetch;
    const cache = options.etagCache;

    /** @returns {Record<string, string>} */
    function baseHeaders() {
        return {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${options.token}`,
            // GitHub requires a User-Agent identifying the app.
            'user-agent': 'pulse (github.com/signalxjs/pulse)',
            'x-github-api-version': '2022-11-28'
        };
    }

    /**
     * Perform one conditional GET. Returns the raw Response plus the cache
     * entry that supplied the If-None-Match validator (if any).
     * @param {string} path
     */
    async function conditionalGet(path) {
        const url = `${baseUrl}${path}`;
        const cached = await cache?.get(url);
        const headers = baseHeaders();
        if (cached) headers['if-none-match'] = cached.etag;

        const res = await doFetch(url, { headers });
        return { url, res, cached };
    }

    /**
     * Send an authenticated write (POST/PATCH/…) as JSON. Same auth/headers
     * as the GETs minus If-None-Match — writes never touch the ETag cache:
     * their responses are single-use and GitHub charges the budget
     * regardless. Any non-2xx throws a GitHubApiError (a write 404 is an
     * error, never a "not found" data state).
     * @param {string} method
     * @param {string} path
     * @param {unknown} [body]
     * @returns {Promise<any>} Parsed JSON, or null on 204.
     */
    async function send(method, path, body) {
        const headers = baseHeaders();
        /** @type {RequestInit} */
        const init = { method, headers };
        if (body !== undefined) {
            headers['content-type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const res = await doFetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            throw await toApiError(res, path);
        }
        if (res.status === 204) return null;
        return JSON.parse(await res.text());
    }

    /**
     * GET a REST path with conditional-request caching.
     * @param {string} path
     * @returns {Promise<any>}
     */
    async function cachedGet(path) {
        const { url, res, cached } = await conditionalGet(path);

        if (res.status === 304 && cached) {
            return JSON.parse(cached.body);
        }
        if (res.status === 404) {
            return null;
        }
        if (!res.ok) {
            throw await toApiError(res, path);
        }
        const body = await res.text();
        const etag = res.headers.get('etag');
        // Await the write — a floating promise gets cancelled on Workers.
        if (etag && cache) await cache.set(url, etag, body);
        return JSON.parse(body);
    }

    /**
     * GET one page of a paginated listing. The Link header only exists on
     * the 200 response, so the `{items, nextPage}` envelope (not the raw
     * body) is what the cache stores — a later 304 reconstructs the page
     * WITH its paging cursor. 404 → null (missing repo, not an empty list).
     * @param {string} path
     * @returns {Promise<{ items: any[], nextPage: number | null } | null>}
     */
    async function cachedGetPage(path) {
        const { url, res, cached } = await conditionalGet(path);

        if (res.status === 304 && cached) {
            return JSON.parse(cached.body);
        }
        if (res.status === 404) {
            return null;
        }
        if (!res.ok) {
            throw await toApiError(res, path);
        }
        const envelope = {
            items: JSON.parse(await res.text()),
            nextPage: nextPageOf(res.headers.get('link'))
        };
        const etag = res.headers.get('etag');
        // Await the write — a floating promise gets cancelled on Workers.
        if (etag && cache) await cache.set(url, etag, JSON.stringify(envelope));
        return envelope;
    }

    /**
     * A COMPLETE listing: follows the Link cursor across pages so callers
     * that return plain arrays (labels, milestones, collaborators) never
     * silently truncate at 100. Capped at 10 pages (1000 items) as a
     * runaway guard — beyond that a repo needs the paginated API anyway.
     * @param {string} pathWithQuery Must already carry `per_page=100`.
     * @returns {Promise<any[]>}
     */
    async function listAll(pathWithQuery) {
        /** @type {any[]} */
        const items = [];
        /** @type {number | null} */
        let page = 1;
        for (let hops = 0; hops < 10 && page !== null; hops++) {
            const suffix = page > 1 ? `&page=${page}` : '';
            const envelope = await cachedGetPage(`${pathWithQuery}${suffix}`);
            if (!envelope) return items;
            items.push(...envelope.items);
            page = envelope.nextPage;
        }
        if (page !== null) {
            // Deliberately partial rather than failing the whole render: a
            // signal for debugging, not an error a board view must handle.
            console.warn(`[github] listing truncated at ${items.length} items (10-page cap): ${pathWithQuery}`);
        }
        return items;
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

    /** @param {any} u @returns {import('./index.js').GitHubPerson} */
    const toPerson = (u) => ({ login: u.login, avatarUrl: u.avatar_url });

    /** @param {any} l @returns {import('./index.js').GitHubLabel} */
    const toLabel = (l) => ({
        name: l.name,
        color: l.color ?? '',
        description: l.description ?? null
    });

    /** @param {any} m @returns {import('./index.js').GitHubMilestone} */
    const toMilestone = (m) => ({
        number: m.number,
        title: m.title,
        state: m.state,
        description: m.description ?? null,
        dueOn: m.due_on ?? null,
        openIssues: m.open_issues ?? 0,
        closedIssues: m.closed_issues ?? 0
    });

    /** @param {any} i @returns {import('./index.js').GitHubIssue} */
    const toIssue = (i) => ({
        number: i.number,
        title: i.title,
        body: i.body ?? null,
        state: i.state,
        // The issues list carries PRs too — the pull_request key is how
        // GitHub marks them.
        isPr: Boolean(i.pull_request),
        draft: Boolean(i.draft),
        labels: (i.labels ?? []).map(toLabel),
        assignees: (i.assignees ?? []).map(toPerson),
        milestone: i.milestone ? { number: i.milestone.number, title: i.milestone.title } : null,
        comments: i.comments ?? 0,
        author: i.user ? toPerson(i.user) : null,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        closedAt: i.closed_at ?? null,
        htmlUrl: i.html_url
    });

    /** @param {any} ev @returns {import('./index.js').GitHubTimelineEvent} */
    const toTimelineEvent = (ev) => {
        /** @type {import('./index.js').GitHubTimelineEvent} */
        const out = {
            event: ev.event,
            // 'commented' carries the user under `user`; 'committed' has a
            // git author (not a GitHub account) — actor stays null there.
            actor: ev.actor ? toPerson(ev.actor) : (ev.user ? toPerson(ev.user) : null),
            createdAt: ev.created_at ?? ev.author?.date ?? null
        };
        if (ev.label) out.label = { name: ev.label.name, color: ev.label.color ?? '' };
        if (ev.assignee) out.assignee = toPerson(ev.assignee);
        if (ev.event === 'commented') out.body = ev.body ?? '';
        if (ev.event === 'committed') out.body = ev.message ?? '';
        if (ev.event === 'cross-referenced' && ev.source?.issue) {
            out.source = {
                number: ev.source.issue.number,
                title: ev.source.issue.title,
                isPr: Boolean(ev.source.issue.pull_request),
                repo: ev.source.issue.repository?.full_name ?? null
            };
        }
        return out;
    };

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
        },

        async repoIssues(owner, name, opts = {}) {
            const paging = clampPaging(opts.page, opts.perPage);
            const params = new URLSearchParams({
                state: opts.state ?? 'all',
                sort: 'updated',
                per_page: String(paging.perPage)
            });
            if (paging.page > 1) params.set('page', String(paging.page));
            if (opts.labels) params.set('labels', opts.labels);
            if (opts.milestone !== undefined) params.set('milestone', String(opts.milestone));
            if (opts.since) params.set('since', opts.since);
            const page = await cachedGetPage(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?${params}`
            );
            if (!page) return { items: [], nextPage: null };
            return { items: page.items.map(toIssue), nextPage: page.nextPage };
        },

        async repoLabels(owner, name) {
            const labels = await listAll(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/labels?per_page=100`
            );
            return labels.map(toLabel);
        },

        async repoMilestones(owner, name) {
            const milestones = await listAll(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/milestones?state=all&per_page=100`
            );
            return milestones.map(toMilestone);
        },

        async repoCollaborators(owner, name) {
            try {
                const users = await listAll(
                    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/collaborators?per_page=100`
                );
                return users.map(toPerson);
            } catch (err) {
                // Listing collaborators needs push access — a plain 403 is an
                // expected answer for read-only viewers, not an error. Budget
                // 403s still throw so callers back off.
                if (err instanceof GitHubApiError && err.status === 403 && !err.rateLimited) {
                    return [];
                }
                throw err;
            }
        },

        async issue(owner, name, n) {
            const i = await cachedGet(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${n}`
            );
            return i ? toIssue(i) : null;
        },

        async issueTimeline(owner, name, n) {
            // First page only — 100 events cover the planner's detail view;
            // deep histories are not worth the extra budget.
            const events = await cachedGet(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${n}/timeline?per_page=100`
            );
            return (events ?? [])
                .filter((/** @type {any} */ ev) => TIMELINE_EVENTS.has(ev.event))
                .map(toTimelineEvent);
        },

        async createIssue(owner, name, input) {
            const i = await send(
                'POST',
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`,
                input
            );
            return toIssue(i);
        },

        async updateIssue(owner, name, n, patch) {
            const i = await send(
                'PATCH',
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${n}`,
                patch
            );
            return toIssue(i);
        },

        async createComment(owner, name, n, body) {
            const c = await send(
                'POST',
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${n}/comments`,
                { body }
            );
            return {
                id: c.id,
                body: c.body ?? '',
                createdAt: c.created_at,
                author: toPerson(c.user)
            };
        },

        async createLabel(owner, name, input) {
            const l = await send(
                'POST',
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/labels`,
                input
            );
            return toLabel(l);
        }
    };
}
