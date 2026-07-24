import type { PulseDb } from './index.js';

/**
 * Split a migration file into statements — `;` at end of line terminates a
 * statement; comment-only and empty chunks are dropped.
 */
export function splitStatements(sql: string): string[];

/**
 * Apply every not-yet-applied `*.sql` file in migrationsDir in file-name
 * order, tracking applied names in a wrangler-compatible `d1_migrations`
 * table. Each migration applies atomically; re-runs are no-ops. Node-only.
 * Resolves to the names applied by this call.
 */
export function applyMigrations(db: PulseDb, migrationsDir: string): Promise<string[]>;
