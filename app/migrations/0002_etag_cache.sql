-- ETag cache (packages/github). Column definitions are IDENTICAL to the
-- inline DDL in packages/github/src/etag-cache.js — when the github package
-- adopts @pulse/db this migration is a no-op over an existing dev database.
CREATE TABLE IF NOT EXISTS etag_cache (
    url TEXT PRIMARY KEY,
    etag TEXT NOT NULL,
    body TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
