/**
 * The fixtures adapter — recorded JSON, deterministic and tokenless. CI
 * smokes and offline dev run against this; `scripts/record-fixtures.mjs`
 * refreshes the recordings from the live API.
 *
 * File layout under the fixtures dir (keys mirror the client methods):
 *   viewer.json, viewer-orgs.json, viewer-repos.json,
 *   owner-repos/<owner>.json, repo/<owner>/<name>.json
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * @param {string} [fixturesDir]
 * @returns {import('./index.js').GitHubClient}
 */
export function createFixturesClient(fixturesDir = DEFAULT_DIR) {
    /**
     * @param {string} rel
     * @returns {any}
     */
    function load(rel) {
        const path = join(fixturesDir, rel);
        if (!existsSync(path)) return null;
        return JSON.parse(readFileSync(path, 'utf-8'));
    }

    return {
        async viewer() {
            return load('viewer.json');
        },
        async viewerOrgs() {
            return load('viewer-orgs.json') ?? [];
        },
        async viewerRepos() {
            return load('viewer-repos.json') ?? [];
        },
        async ownerRepos(owner) {
            return load(join('owner-repos', `${owner}.json`)) ?? [];
        },
        async repo(owner, name) {
            return load(join('repo', owner, `${name}.json`));
        }
    };
}
