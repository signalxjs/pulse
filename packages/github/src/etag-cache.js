/**
 * node:sqlite-backed EtagCache — persists conditional-request validators
 * and bodies across server restarts. One row per URL; last write wins.
 */
import { DatabaseSync } from 'node:sqlite';

/**
 * @param {string} [dbPath] Defaults to in-memory (dev); pass a file path in
 *   production so the cache survives restarts.
 * @returns {import('./index.js').EtagCache}
 */
export function createSqliteEtagCache(dbPath = ':memory:') {
    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS etag_cache (
            url TEXT PRIMARY KEY,
            etag TEXT NOT NULL,
            body TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        )
    `);
    const getStmt = db.prepare('SELECT etag, body FROM etag_cache WHERE url = ?');
    const setStmt = db.prepare(`
        INSERT INTO etag_cache (url, etag, body, fetched_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, body = excluded.body, fetched_at = excluded.fetched_at
    `);

    return {
        get(key) {
            const row = /** @type {{ etag: string, body: string } | undefined} */ (getStmt.get(key));
            return row;
        },
        set(key, etag, body) {
            setStmt.run(key, etag, body, Date.now());
        }
    };
}
