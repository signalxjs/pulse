/**
 * The fixtures adapter — recorded JSON, deterministic and tokenless. CI
 * smokes and offline dev run against this; `scripts/record-fixtures.mjs`
 * refreshes the recordings from the live API.
 *
 * The JSON files under `packages/github/fixtures/` are the diffable source
 * of truth, but the adapter never touches the filesystem: the generated
 * `fixtures-data.js` statically imports every recording into one map (keys
 * mirror the client methods):
 *   viewer.json, viewer-orgs.json, viewer-repos.json,
 *   owner-repos/<owner>.json, repo/<owner>/<name>.json,
 *   issues/<owner>/<name>.json, labels/<owner>/<name>.json,
 *   milestones/<owner>/<name>.json, collaborators/<owner>/<name>.json,
 *   timeline/<owner>/<name>/<n>.json
 *
 * Writes land in a per-client-instance overlay: mutations patch the arrays
 * that instance serves, while the module-level FIXTURES map stays pristine
 * (writes clone before storing, reads clone before returning) — a fresh
 * client always starts from the recorded data. `app/server/github-api.mjs`
 * shares ONE fixtures client per process, so a smoke's writes persist
 * across requests until the server restarts — which is exactly what lets
 * smokes exercise create/drag/comment end-to-end.
 */
import { FIXTURES } from './fixtures-data.js';
import { GitHubApiError } from './live.js';
import { clampPaging } from './paging.js';

// GitHub logins/repo names: word chars, dots, dashes — and never a pure
// dot-segment. Anything else (path separators, '..') must not reach the
// map lookup: the adapter sits behind the /api proxy, where owner/name
// arrive straight from the URL.
const SAFE_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** @param {string} segment */
function isSafeSegment(segment) {
    return SAFE_SEGMENT.test(segment);
}

/**
 * A fresh clone of one pristine recording — FIXTURES is a module-level
 * singleton (the generated static-import map), so cloning at the boundary
 * is what keeps it immutable.
 * @param {string} rel
 * @returns {any}
 */
function pristine(rel) {
    return Object.hasOwn(FIXTURES, rel) ? structuredClone(FIXTURES[rel]) : null;
}

/** Acting user for synthetic writes when a repo records no collaborators. */
const FALLBACK_WRITER = { login: 'pulse-dev', avatarUrl: '' };

/**
 * @returns {import('./index.js').GitHubClient}
 */
export function createFixturesClient() {
    // The write overlay: rel key → this instance's current value. Reads
    // prefer it over FIXTURES; both paths clone on the way out, and writes
    // only ever store clones — the shared FIXTURES map is never mutated.
    /** @type {Map<string, any>} */
    const overlay = new Map();
    let nextCommentId = 9_000_001;

    /**
     * @param {string} rel
     * @returns {any}
     */
    function load(rel) {
        return overlay.has(rel) ? structuredClone(overlay.get(rel)) : pristine(rel);
    }

    /**
     * @param {string} rel
     * @param {any} value A clone the caller hands over — never a FIXTURES
     *   reference, and never returned to callers again without recloning.
     */
    function store(rel, value) {
        overlay.set(rel, value);
    }

    /** @param {string} path */
    const notFound = (path) => new GitHubApiError(`GitHub 404 for ${path}: Not Found`, 404);

    /**
     * The mutable issues array for a repo — or the 404 a live write gets
     * for an unknown repo (writes throw where reads answer null/empty).
     * @param {string} owner @param {string} name
     * @returns {{ rel: string, all: import('./index.js').GitHubIssue[] }}
     */
    function issuesFor(owner, name) {
        const rel = `issues/${owner}/${name}.json`;
        const all = isSafeSegment(owner) && isSafeSegment(name) ? load(rel) : null;
        if (!all) throw notFound(`/repos/${owner}/${name}/issues`);
        return { rel, all };
    }

    /**
     * The acting user for synthetic writes: first collaborator, else a stub.
     * @param {string} owner @param {string} name
     * @returns {import('./index.js').GitHubPerson}
     */
    function writer(owner, name) {
        return load(`collaborators/${owner}/${name}.json`)?.[0] ?? { ...FALLBACK_WRITER };
    }

    /**
     * Resolve label names against the repo's definitions; unknown names get
     * GitHub's default-ish gray (live create auto-creates them too).
     * @param {string} owner @param {string} name @param {string[]} names
     * @returns {import('./index.js').GitHubLabel[]}
     */
    function resolveLabels(owner, name, names) {
        /** @type {import('./index.js').GitHubLabel[]} */
        const defined = load(`labels/${owner}/${name}.json`) ?? [];
        return names.map((n) =>
            defined.find((l) => l.name.toLowerCase() === n.toLowerCase())
                ?? { name: n, color: 'ededed', description: null });
    }

    /**
     * @param {string} owner @param {string} name @param {string[]} logins
     * @returns {import('./index.js').GitHubPerson[]}
     */
    function resolveAssignees(owner, name, logins) {
        /** @type {import('./index.js').GitHubPerson[]} */
        const collaborators = load(`collaborators/${owner}/${name}.json`) ?? [];
        return logins.map((login) =>
            collaborators.find((p) => p.login === login) ?? { login, avatarUrl: '' });
    }

    /**
     * @param {string} owner @param {string} name @param {number} number
     * @returns {{ number: number, title: string }}
     */
    function resolveMilestone(owner, name, number) {
        /** @type {import('./index.js').GitHubMilestone[]} */
        const milestones = load(`milestones/${owner}/${name}.json`) ?? [];
        const m = milestones.find((ms) => ms.number === number);
        if (!m) {
            // Same answer live GitHub gives for a nonexistent milestone.
            throw new GitHubApiError(
                `GitHub 422 for /repos/${owner}/${name}/issues: Validation Failed (Issue milestone invalid)`,
                422
            );
        }
        return { number: m.number, title: m.title };
    }

    /**
     * @param {string} owner @param {string} name @param {number} number
     * @param {import('./index.js').GitHubTimelineEvent[]} events
     */
    function appendTimeline(owner, name, number, events) {
        if (events.length === 0) return;
        const rel = `timeline/${owner}/${name}/${number}.json`;
        const timeline = load(rel) ?? [];
        timeline.push(...events);
        store(rel, timeline);
    }

    return {
        async viewer() {
            const viewer = load('viewer.json');
            if (!viewer) {
                // The interface promises a user — a missing recording is a
                // broken fixtures build, not a data state. Fail loudly.
                throw new Error('fixtures have no viewer.json — run packages/github/scripts/record-fixtures.mjs');
            }
            return viewer;
        },
        async viewerOrgs() {
            return load('viewer-orgs.json') ?? [];
        },
        async viewerRepos() {
            return load('viewer-repos.json') ?? [];
        },
        async ownerRepos(owner) {
            if (!isSafeSegment(owner)) return [];
            return load(`owner-repos/${owner}.json`) ?? [];
        },
        async repo(owner, name) {
            if (!isSafeSegment(owner) || !isSafeSegment(name)) return null;
            return load(`repo/${owner}/${name}.json`);
        },

        async repoIssues(owner, name, opts = {}) {
            /** @type {import('./index.js').Page<import('./index.js').GitHubIssue>} */
            const empty = { items: [], nextPage: null };
            if (!isSafeSegment(owner) || !isSafeSegment(name)) return empty;
            /** @type {import('./index.js').GitHubIssue[] | null} */
            const all = load(`issues/${owner}/${name}.json`);
            if (!all) return empty;

            const state = opts.state ?? 'all';
            const wantLabels = opts.labels
                ? opts.labels.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean)
                : null;
            const filtered = all
                .filter((i) => {
                    if (state !== 'all' && i.state !== state) return false;
                    if (wantLabels) {
                        const have = i.labels.map((l) => l.name.toLowerCase());
                        if (!wantLabels.every((l) => have.includes(l))) return false;
                    }
                    if (opts.milestone !== undefined) {
                        if (opts.milestone === 'none') {
                            if (i.milestone) return false;
                        } else if (opts.milestone === '*') {
                            if (!i.milestone) return false;
                        } else if (i.milestone?.number !== Number(opts.milestone)) {
                            return false;
                        }
                    }
                    if (opts.since && i.updatedAt < opts.since) return false;
                    return true;
                })
                // Same order the live endpoint serves: sort=updated, desc.
                .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

            const { page, perPage } = clampPaging(opts.page, opts.perPage);
            const start = (page - 1) * perPage;
            return {
                items: filtered.slice(start, start + perPage),
                nextPage: start + perPage < filtered.length ? page + 1 : null
            };
        },

        async repoLabels(owner, name) {
            if (!isSafeSegment(owner) || !isSafeSegment(name)) return [];
            return load(`labels/${owner}/${name}.json`) ?? [];
        },

        async repoMilestones(owner, name) {
            if (!isSafeSegment(owner) || !isSafeSegment(name)) return [];
            return load(`milestones/${owner}/${name}.json`) ?? [];
        },

        async repoCollaborators(owner, name) {
            if (!isSafeSegment(owner) || !isSafeSegment(name)) return [];
            return load(`collaborators/${owner}/${name}.json`) ?? [];
        },

        async issue(owner, name, n) {
            if (!isSafeSegment(owner) || !isSafeSegment(name)) return null;
            /** @type {import('./index.js').GitHubIssue[] | null} */
            const all = load(`issues/${owner}/${name}.json`);
            return all?.find((i) => i.number === Number(n)) ?? null;
        },

        async issueTimeline(owner, name, n) {
            if (!isSafeSegment(owner) || !isSafeSegment(name) || !isSafeSegment(String(n))) return [];
            return load(`timeline/${owner}/${name}/${n}.json`) ?? [];
        },

        async createIssue(owner, name, input) {
            const { rel, all } = issuesFor(owner, name);
            const now = new Date().toISOString();
            // Allocate past the max — PRs share the number space too.
            const number = all.reduce((max, i) => Math.max(max, i.number), 0) + 1;
            const author = writer(owner, name);
            const labels = resolveLabels(owner, name, input.labels ?? []);
            /** @type {import('./index.js').GitHubIssue} */
            const issue = {
                number,
                title: input.title,
                body: input.body ?? null,
                state: 'open',
                isPr: false,
                draft: false,
                labels,
                assignees: resolveAssignees(owner, name, input.assignees ?? []),
                milestone: input.milestone !== undefined
                    ? resolveMilestone(owner, name, input.milestone)
                    : null,
                comments: 0,
                author,
                createdAt: now,
                updatedAt: now,
                closedAt: null,
                htmlUrl: `https://github.com/${owner}/${name}/issues/${number}`
            };
            all.push(issue);
            store(rel, all);
            appendTimeline(owner, name, number, labels.map((label) => ({
                event: /** @type {const} */ ('labeled'),
                actor: author,
                createdAt: now,
                label: { name: label.name, color: label.color }
            })));
            return structuredClone(issue);
        },

        async updateIssue(owner, name, n, patch) {
            const { rel, all } = issuesFor(owner, name);
            const issue = all.find((i) => i.number === Number(n));
            if (!issue) throw notFound(`/repos/${owner}/${name}/issues/${n}`);
            const now = new Date().toISOString();
            const actor = writer(owner, name);
            /** @type {import('./index.js').GitHubTimelineEvent[]} */
            const events = [];

            if (patch.title !== undefined) issue.title = patch.title;
            if (patch.body !== undefined) issue.body = patch.body;
            if (patch.assignees !== undefined) {
                issue.assignees = resolveAssignees(owner, name, patch.assignees);
            }
            if (patch.milestone !== undefined) {
                issue.milestone = patch.milestone === null
                    ? null
                    : resolveMilestone(owner, name, patch.milestone);
            }
            if (patch.labels !== undefined) {
                // Full replacement set, like the live PATCH — the timeline
                // gets one synthetic event per actual difference.
                const next = resolveLabels(owner, name, patch.labels);
                const beforeNames = new Set(issue.labels.map((l) => l.name));
                const nextNames = new Set(next.map((l) => l.name));
                for (const l of issue.labels) {
                    if (!nextNames.has(l.name)) {
                        events.push({ event: 'unlabeled', actor, createdAt: now, label: { name: l.name, color: l.color } });
                    }
                }
                for (const l of next) {
                    if (!beforeNames.has(l.name)) {
                        events.push({ event: 'labeled', actor, createdAt: now, label: { name: l.name, color: l.color } });
                    }
                }
                issue.labels = next;
            }
            if (patch.state !== undefined && patch.state !== issue.state) {
                issue.state = patch.state;
                issue.closedAt = patch.state === 'closed' ? now : null;
                events.push({ event: patch.state === 'closed' ? 'closed' : 'reopened', actor, createdAt: now });
            }
            issue.updatedAt = now;
            store(rel, all);
            appendTimeline(owner, name, issue.number, events);
            return structuredClone(issue);
        },

        async createComment(owner, name, n, body) {
            const { rel, all } = issuesFor(owner, name);
            const issue = all.find((i) => i.number === Number(n));
            if (!issue) throw notFound(`/repos/${owner}/${name}/issues/${n}/comments`);
            const now = new Date().toISOString();
            const author = writer(owner, name);
            issue.comments += 1;
            issue.updatedAt = now;
            store(rel, all);
            appendTimeline(owner, name, issue.number, [
                { event: 'commented', actor: author, createdAt: now, body }
            ]);
            return { id: nextCommentId++, body, createdAt: now, author: structuredClone(author) };
        },

        async createLabel(owner, name, input) {
            const rel = `labels/${owner}/${name}.json`;
            /** @type {import('./index.js').GitHubLabel[] | null} */
            const labels = isSafeSegment(owner) && isSafeSegment(name) ? load(rel) : null;
            if (!labels) throw notFound(`/repos/${owner}/${name}/labels`);
            // Label names are case-insensitively unique — duplicates get
            // the same 422 GitHub answers with.
            if (labels.some((l) => l.name.toLowerCase() === input.name.toLowerCase())) {
                throw new GitHubApiError(
                    `GitHub 422 for /repos/${owner}/${name}/labels: Validation Failed (Label name already_exists)`,
                    422
                );
            }
            /** @type {import('./index.js').GitHubLabel} */
            const label = {
                name: input.name,
                color: input.color,
                description: input.description ?? null
            };
            labels.push(label);
            store(rel, labels);
            return structuredClone(label);
        }
    };
}
