/**
 * node:sqlite driver — PulseDb over a DatabaseSync. Everything resolves
 * synchronously under the hood; the async signatures exist so app code is
 * written once against the D1-shaped interface.
 */
import { DatabaseSync } from 'node:sqlite';

/**
 * @param {string} [dbPath] Defaults to in-memory (dev/tests); pass a file
 *   path in production so data survives restarts.
 * @returns {import('./index.js').PulseDb & { close(): void }}
 */
export function createSqliteDb(dbPath = ':memory:') {
    const db = new DatabaseSync(dbPath);
    /** Prepared-statement cache — preparing is the expensive part. @type {Map<string, import('node:sqlite').StatementSync>} */
    const cache = new Map();

    /** @param {string} sql */
    function prepare(sql) {
        let stmt = cache.get(sql);
        if (!stmt) {
            stmt = db.prepare(sql);
            cache.set(sql, stmt);
        }
        return stmt;
    }

    return {
        async first(sql, ...params) {
            const row = prepare(sql).get(...params);
            return /** @type {any} */ (row ?? null);
        },
        async all(sql, ...params) {
            return /** @type {any} */ (prepare(sql).all(...params));
        },
        async run(sql, ...params) {
            prepare(sql).run(...params);
        },
        async batch(stmts) {
            db.exec('BEGIN');
            try {
                for (const { sql, params = [] } of stmts) {
                    prepare(sql).run(...params);
                }
                db.exec('COMMIT');
            } catch (err) {
                db.exec('ROLLBACK');
                throw err;
            }
        },
        close() {
            cache.clear();
            db.close();
        }
    };
}
