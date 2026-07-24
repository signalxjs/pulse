import type { PulseDb } from './index.js';

/**
 * PulseDb over `node:sqlite`'s DatabaseSync with an internal
 * prepared-statement cache. `batch` runs inside BEGIN/COMMIT and rolls back
 * on the first error. Node-only. `close()` releases the underlying database
 * handle (D1 has no equivalent, so it lives on the driver, not on PulseDb).
 */
export function createSqliteDb(dbPath?: string): PulseDb & { close(): void };
