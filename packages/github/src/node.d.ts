/**
 * @pulse/github/node — typed surface of the node-only subpath. Split out of
 * the root export so `.` stays WinterCG-clean; shared types live in
 * `index.d.ts`.
 */
import type { EtagCache } from './index.js';

/** node:sqlite-backed EtagCache (also used for sessions later). */
export function createSqliteEtagCache(dbPath?: string): EtagCache;
