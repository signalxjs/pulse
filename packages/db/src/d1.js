/**
 * Cloudflare D1 driver — PulseDb as a thin pass-through over a D1Database.
 * No runtime imports (WinterCG-clean); the D1 binding is typed structurally
 * below rather than via @cloudflare/workers-types to keep this package
 * dependency-free.
 */

/**
 * The subset of D1PreparedStatement this driver uses.
 * @typedef {object} D1PreparedStatementLike
 * @property {(...params: import('./index.js').SqlParam[]) => D1PreparedStatementLike} bind
 * @property {() => Promise<Record<string, unknown> | null>} first
 * @property {() => Promise<{ results: Record<string, unknown>[] }>} all
 * @property {() => Promise<unknown>} run
 */

/**
 * The subset of D1Database this driver uses.
 * @typedef {object} D1DatabaseLike
 * @property {(sql: string) => D1PreparedStatementLike} prepare
 * @property {(stmts: D1PreparedStatementLike[]) => Promise<unknown>} batch
 */

/**
 * @param {D1DatabaseLike} d1 The D1 binding from the Worker env.
 * @returns {import('./index.js').PulseDb}
 */
export function createD1Db(d1) {
    return {
        async first(sql, ...params) {
            const row = await d1.prepare(sql).bind(...params).first();
            return /** @type {any} */ (row ?? null);
        },
        async all(sql, ...params) {
            const { results } = await d1.prepare(sql).bind(...params).all();
            return /** @type {any} */ (results);
        },
        async run(sql, ...params) {
            await d1.prepare(sql).bind(...params).run();
        },
        async batch(stmts) {
            // D1 runs a batch as one implicit transaction — atomic like the
            // sqlite driver's BEGIN/COMMIT.
            await d1.batch(stmts.map(({ sql, params = [] }) => d1.prepare(sql).bind(...params)));
        }
    };
}
