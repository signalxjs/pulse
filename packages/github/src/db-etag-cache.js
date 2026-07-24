/**
 * EtagCache over the PulseDb seam (@pulse/db) — persists conditional-request
 * validators and bodies across server restarts. One row per URL; last write
 * wins. The `etag_cache` table comes from the shared migrations
 * (`app/migrations`) — apply them before constructing the cache.
 *
 * WinterCG-clean: depends only on the PulseDb interface (no `node:*`), so it
 * runs on Workers over D1 as well as on Node over node:sqlite.
 */

/**
 * @param {import('@pulse/db').PulseDb} db
 * @returns {import('./index.js').EtagCache}
 */
export function createDbEtagCache(db) {
    if (!db) {
        // Fail at construction with a named cause, not as a baffling
        // TypeError on the first cache read.
        throw new Error('createDbEtagCache: a PulseDb is required (create one with @pulse/db)');
    }
    return {
        async get(key) {
            return /** @type {any} */ (await db.first('SELECT etag, body FROM etag_cache WHERE url = ?', key));
        },
        async set(key, etag, body) {
            await db.run(
                `INSERT INTO etag_cache (url, etag, body, fetched_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, body = excluded.body, fetched_at = excluded.fetched_at`,
                key, etag, body, Date.now()
            );
        }
    };
}
