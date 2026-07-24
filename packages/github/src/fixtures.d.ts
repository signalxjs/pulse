/**
 * @pulse/github/fixtures — typed surface of the fixtures subpath. Split out
 * of the root export so `.` stays WinterCG-clean; shared types live in
 * `index.d.ts`.
 */
import type { GitHubClient } from './index.js';

/**
 * Recorded-JSON adapter — deterministic, tokenless (CI smokes, dev). Reads
 * the generated `fixtures-data.js` module, never the filesystem.
 */
export function createFixturesClient(): GitHubClient;
