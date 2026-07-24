/**
 * @pulse/db — typed surface. The implementation is plain ESM JavaScript
 * (JSDoc-typed) because it runs under the no-transpiler `app/server.mjs`;
 * these declarations serve the Vite-processed app code that imports it.
 *
 * The root export is WinterCG-clean (no `node:*` imports) so it can run on
 * Cloudflare Workers; the node-only pieces live behind `./sqlite` and
 * `./migrate`.
 */

/** The parameter types both node:sqlite and D1 accept. */
export type SqlParam = string | number | bigint | null | Uint8Array;

/**
 * Pulse's ONE async SQL seam — D1-shaped so the Workers driver is a thin
 * pass-through and the node:sqlite driver resolves synchronously produced
 * results through the same promises.
 */
export interface PulseDb {
    /** First row of the result, or null when the query matches nothing. */
    first<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): Promise<T | null>;
    /** All rows of the result ([] when the query matches nothing). */
    all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): Promise<T[]>;
    /** Execute a statement, discarding any result rows. */
    run(sql: string, ...params: SqlParam[]): Promise<void>;
    /** Execute statements atomically — all apply, or none do. */
    batch(stmts: { sql: string; params?: SqlParam[] }[]): Promise<void>;
}

/** Well-known board columns; the ids are fixed, the label mapping is not. */
export type BoardStatusId = 'backlog' | 'todo' | 'inprogress' | 'inreview' | 'done';

export interface BoardStatus {
    id: BoardStatusId;
    /**
     * GitHub label name that puts an issue in this column (e.g. `status:
     * in progress`). null = no label mapped: the column is then derived from
     * issue state only (closed → done, open → todo, PR → inreview).
     */
    label: string | null;
}

/** GitHub label name mapped to each priority; null = priority unused. */
export interface BoardPriorities {
    p0: string | null;
    p1: string | null;
    p2: string | null;
    p3: string | null;
}

/** Per-repo board configuration, v1. Stored as JSON in `board_config.config`. */
export interface BoardConfig {
    version: 1;
    owner: string;
    repo: string;
    statuses: BoardStatus[];
    priorities: BoardPriorities;
    cycleSource: 'milestones' | 'none';
    /** Close the GitHub issue when its card reaches the done column. */
    closeOnDone: boolean;
    /** Login of whoever created the board; preserved across updates. */
    createdBy: string | null;
}

export interface ConfigStore {
    /**
     * The board for one repo, or null when none exists — or when the stored
     * config has an unknown version (written by a newer Pulse).
     */
    getBoard(owner: string, repo: string): Promise<BoardConfig | null>;
    /** Insert or update ((owner, repo) is the key); refreshes updated_at. */
    putBoard(config: BoardConfig): Promise<void>;
    /** Every stored board with a readable config, ordered by owner then repo. */
    listBoards(): Promise<BoardConfig[]>;
}

/** Board-config store over any PulseDb (requires the board_config table). */
export function createConfigStore(db: PulseDb): ConfigStore;
