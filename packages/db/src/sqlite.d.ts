import type { PulseDb } from './index.js';

/**
 * PulseDb over `node:sqlite`'s DatabaseSync with an internal
 * prepared-statement cache. `batch` runs inside BEGIN/COMMIT and rolls back
 * on the first error. Node-only.
 */
export function createSqliteDb(dbPath?: string): PulseDb;
