-- Sessions (packages/auth). Column definitions are IDENTICAL to the inline
-- DDL in packages/auth/src/sessions.js — when auth adopts @pulse/db this
-- migration is a no-op over an existing dev database.
CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    token_enc TEXT NOT NULL,
    login TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
