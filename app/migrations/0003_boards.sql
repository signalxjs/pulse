-- Per-repo board configuration (@pulse/db config store). `config` is
-- versioned JSON (BoardConfig v1); owner/repo/created_by live in columns.
CREATE TABLE IF NOT EXISTS board_config (
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    config TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner, repo)
);
