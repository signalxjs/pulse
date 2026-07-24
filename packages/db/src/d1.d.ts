import type { PulseDb, SqlParam } from './index.js';

/**
 * Structural subset of Cloudflare's D1PreparedStatement — kept local so the
 * package has zero dependencies; any real D1 binding satisfies it.
 */
export interface D1PreparedStatementLike {
    bind(...params: SqlParam[]): D1PreparedStatementLike;
    first(): Promise<Record<string, unknown> | null>;
    all(): Promise<{ results: Record<string, unknown>[] }>;
    run(): Promise<unknown>;
}

/** Structural subset of Cloudflare's D1Database used by the driver. */
export interface D1DatabaseLike {
    prepare(sql: string): D1PreparedStatementLike;
    batch(stmts: D1PreparedStatementLike[]): Promise<unknown>;
}

/**
 * PulseDb over a Cloudflare D1 binding. `batch` maps onto `d1.batch`, which
 * D1 runs as one implicit transaction. WinterCG-clean.
 */
export function createD1Db(d1: D1DatabaseLike): PulseDb;
