/**
 * Board-config store — per-repo board settings as versioned JSON in the
 * board_config table ((owner, repo) primary key). WinterCG-clean: works over
 * any PulseDb, no node:* imports.
 */

/** The store reads/writes config JSON at this version. */
const CONFIG_VERSION = 1;

/**
 * @param {{ owner: string, repo: string, config: string, created_by: string | null }} row
 * @returns {import('./index.js').BoardConfig | null}
 */
function parseRow(row) {
    let parsed;
    try {
        parsed = JSON.parse(row.config);
    } catch {
        return null;
    }
    // Forward-compat: a config written by a newer Pulse (unknown version) is
    // treated as absent rather than misread — never a crash.
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== CONFIG_VERSION) {
        return null;
    }
    return { ...parsed, owner: row.owner, repo: row.repo, createdBy: row.created_by ?? null };
}

/**
 * @param {import('./index.js').PulseDb} db
 * @returns {import('./index.js').ConfigStore}
 */
export function createConfigStore(db) {
    return {
        async getBoard(owner, repo) {
            const row = /** @type {{ owner: string, repo: string, config: string, created_by: string | null } | null} */ (
                await db.first(
                    'SELECT owner, repo, config, created_by FROM board_config WHERE owner = ? AND repo = ?',
                    owner,
                    repo
                )
            );
            return row ? parseRow(row) : null;
        },

        async putBoard(config) {
            const { owner, repo, createdBy, ...settings } = config;
            // owner/repo/createdBy live in columns; only the settings JSON
            // (version, statuses, priorities, cycleSource, closeOnDone) is
            // stored in `config` — no duplicated keys to drift.
            await db.run(
                `INSERT INTO board_config (owner, repo, config, created_by) VALUES (?, ?, ?, ?)
                 ON CONFLICT(owner, repo) DO UPDATE SET config = excluded.config, updated_at = CURRENT_TIMESTAMP`,
                owner,
                repo,
                JSON.stringify(settings),
                createdBy ?? null
            );
        },

        async listBoards() {
            const rows = /** @type {{ owner: string, repo: string, config: string, created_by: string | null }[]} */ (
                await db.all('SELECT owner, repo, config, created_by FROM board_config ORDER BY owner, repo')
            );
            return rows.map(parseRow).filter((board) => board !== null);
        }
    };
}
