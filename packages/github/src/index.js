/**
 * @pulse/github — GitHub API access behind ONE adapter interface.
 *
 * Plain ESM JavaScript (JSDoc-typed): this package is server-only and must
 * run under the no-transpiler `app/server.mjs`. Types for app code live in
 * `index.d.ts`.
 *
 * Two adapters:
 * - `createLiveClient({ token })` — REST v3 over fetch, with If-None-Match
 *   conditional requests against an EtagCache (a 304 costs no rate-limit
 *   budget on GitHub's side).
 * - `createFixturesClient(dir)` — recorded JSON responses, deterministic
 *   and tokenless; what CI smokes run against.
 */

export { createLiveClient, GitHubApiError } from './live.js';
export { createFixturesClient } from './fixtures.js';
export { createSqliteEtagCache } from './etag-cache.js';
