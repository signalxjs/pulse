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
 */
import { FIXTURES } from './fixtures-data.js';
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
 * @param {string} rel
 * @returns {any}
 */
function load(rel) {
    // FIXTURES is a module-level singleton (the generated static-import
    // map) — clone at the boundary so no caller can mutate shared state
    // across reads, matching the fresh-parse behavior of the old fs path.
    return Object.hasOwn(FIXTURES, rel) ? structuredClone(FIXTURES[rel]) : null;
}

/**
 * @returns {import('./index.js').GitHubClient}
 */
export function createFixturesClient() {
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
        }
    };
}
