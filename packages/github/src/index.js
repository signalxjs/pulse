/**
 * @pulse/github — GitHub API access behind ONE adapter interface.
 *
 * Plain ESM JavaScript (JSDoc-typed): this package is server-only and must
 * run under the no-transpiler `app/server.mjs`. Types for app code live in
 * `index.d.ts`.
 *
 * The root export is WinterCG-clean — fetch + Web APIs only, no `node:*`
 * imports — so the live client can run on edge runtimes (Workers). The
 * runtime-specific pieces live behind subpaths:
 * - `@pulse/github` — `createLiveClient({ token })`, REST v3 over fetch with
 *   If-None-Match conditional requests against an EtagCache (a 304 costs no
 *   rate-limit budget on GitHub's side).
 * - `@pulse/github/fixtures` — `createFixturesClient()`, recorded JSON via
 *   static imports (no fs), deterministic and tokenless; what CI smokes run
 *   against.
 * - `@pulse/github/node` — `createSqliteEtagCache(dbPath)`, node:sqlite.
 */

export { createLiveClient, GitHubApiError } from './live.js';
