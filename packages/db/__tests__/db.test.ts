/**
 * @pulse/db — one conformance suite run against every driver (sqlite
 * in-memory, sqlite on disk, and the D1 driver over a D1-shaped stub), plus
 * the migration runner and the board-config store. The D1 stub is backed by
 * the sqlite driver, which proves the two drivers expose interchangeable
 * behavior through the same PulseDb shape.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigStore, type BoardConfig, type PulseDb, type SqlParam } from '@pulse/db';
import { createSqliteDb } from '@pulse/db/sqlite';
import { createD1Db, type D1DatabaseLike, type D1PreparedStatementLike } from '@pulse/db/d1';
import { applyMigrations, splitStatements } from '@pulse/db/migrate';

// Vitest runs from the repo root (import.meta.url is rewritten under the
// happy-dom environment, so resolve from cwd instead).
const APP_MIGRATIONS = join(process.cwd(), 'app', 'migrations');

const tempRoots: string[] = [];
afterAll(() => {
    for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-db-'));
    tempRoots.push(dir);
    return dir;
}

/** A minimal D1Database stub backed by the sqlite driver. */
function d1Stub(): D1DatabaseLike {
    const inner = createSqliteDb();
    type BoundStmt = D1PreparedStatementLike & { sql: string; params: SqlParam[] };
    function make(sql: string, params: SqlParam[]): BoundStmt {
        return {
            sql,
            params,
            bind: (...next: SqlParam[]) => make(sql, next),
            first: () => inner.first(sql, ...params),
            all: async () => ({ results: await inner.all(sql, ...params) }),
            run: () => inner.run(sql, ...params)
        };
    }
    return {
        prepare: (sql: string) => make(sql, []),
        // D1 batches are one implicit transaction — model that with the
        // sqlite driver's transactional batch.
        batch: (stmts) => inner.batch(stmts.map((s) => {
            const bound = s as BoundStmt;
            return { sql: bound.sql, params: bound.params };
        }))
    };
}

/** Shared conformance suite — every PulseDb implementation must pass it. */
function conformance(name: string, makeDb: () => PulseDb) {
    describe(`PulseDb conformance — ${name}`, () => {
        let db: PulseDb;
        beforeEach(async () => {
            db = makeDb();
            await db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
        });

        it('run + first roundtrip; first returns null on no match', async () => {
            await db.run('INSERT INTO t (id, label) VALUES (?, ?)', 1, 'one');
            const row = await db.first<{ id: number; label: string }>('SELECT * FROM t WHERE id = ?', 1);
            expect(row).toEqual({ id: 1, label: 'one' });
            expect(await db.first('SELECT * FROM t WHERE id = ?', 999)).toBeNull();
        });

        it('all returns every row in query order, [] on no match', async () => {
            await db.run('INSERT INTO t (id, label) VALUES (?, ?)', 2, 'two');
            await db.run('INSERT INTO t (id, label) VALUES (?, ?)', 1, 'one');
            const rows = await db.all<{ id: number }>('SELECT id FROM t ORDER BY id');
            expect(rows.map((r) => r.id)).toEqual([1, 2]);
            expect(await db.all('SELECT * FROM t WHERE id > ?', 10)).toEqual([]);
        });

        it('binds null and Uint8Array params', async () => {
            await db.run('CREATE TABLE b (id INTEGER PRIMARY KEY, data BLOB, note TEXT)');
            await db.run('INSERT INTO b (id, data, note) VALUES (?, ?, ?)', 1, new Uint8Array([1, 2, 3]), null);
            const row = await db.first<{ data: Uint8Array; note: string | null }>('SELECT data, note FROM b WHERE id = ?', 1);
            expect(Array.from(row!.data)).toEqual([1, 2, 3]);
            expect(row!.note).toBeNull();
        });

        it('batch applies all statements', async () => {
            await db.batch([
                { sql: 'INSERT INTO t (id, label) VALUES (?, ?)', params: [1, 'one'] },
                { sql: 'INSERT INTO t (id, label) VALUES (?, ?)', params: [2, 'two'] },
                { sql: 'UPDATE t SET label = ? WHERE id = ?', params: ['TWO', 2] }
            ]);
            const rows = await db.all<{ label: string }>('SELECT label FROM t ORDER BY id');
            expect(rows.map((r) => r.label)).toEqual(['one', 'TWO']);
        });

        it('batch is atomic — a failing statement rolls back the earlier ones', async () => {
            await db.run('INSERT INTO t (id, label) VALUES (?, ?)', 1, 'kept');
            await expect(
                db.batch([
                    { sql: 'INSERT INTO t (id, label) VALUES (?, ?)', params: [2, 'doomed'] },
                    { sql: 'INSERT INTO t (id, label) VALUES (?, ?)', params: [1, 'dupe pk'] }
                ])
            ).rejects.toThrow();
            const rows = await db.all<{ id: number }>('SELECT id FROM t');
            expect(rows.map((r) => r.id)).toEqual([1]);
        });
    });
}

conformance('sqlite (:memory:)', () => createSqliteDb());
conformance('sqlite (file)', () => createSqliteDb(join(tempDir(), 'pulse.db')));
conformance('d1 driver over a D1-shaped stub', () => createD1Db(d1Stub()));

describe('splitStatements', () => {
    it('splits on line-ending semicolons, dropping comments and empties', () => {
        const stmts = splitStatements(
            '-- header comment\nCREATE TABLE a (x);\n\nCREATE TABLE b (\n    y TEXT -- trailing; not a terminator\n);\n-- footer\n'
        );
        expect(stmts).toHaveLength(2);
        expect(stmts[0]).toContain('CREATE TABLE a');
        expect(stmts[1]).toContain('CREATE TABLE b');
    });
});

describe('applyMigrations', () => {
    function writeMigrations(files: Record<string, string>): string {
        const dir = join(tempDir(), 'migrations');
        mkdirSync(dir);
        for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
        return dir;
    }

    it('applies *.sql in name order and records them in d1_migrations', async () => {
        const dir = writeMigrations({
            '0002_second.sql': 'ALTER TABLE first ADD COLUMN extra TEXT;\n',
            '0001_first.sql': 'CREATE TABLE first (id INTEGER PRIMARY KEY);\nCREATE INDEX idx_first ON first (id);\n',
            'notes.txt': 'not a migration'
        });
        const db = createSqliteDb();
        const applied = await applyMigrations(db, dir);
        expect(applied).toEqual(['0001_first.sql', '0002_second.sql']);
        await db.run('INSERT INTO first (id, extra) VALUES (?, ?)', 1, 'x');
        const rows = await db.all<{ name: string }>('SELECT name FROM d1_migrations ORDER BY id');
        expect(rows.map((r) => r.name)).toEqual(['0001_first.sql', '0002_second.sql']);
    });

    it('is idempotent — a re-run applies nothing and only new files apply', async () => {
        const dir = writeMigrations({ '0001_first.sql': 'CREATE TABLE first (id INTEGER PRIMARY KEY);\n' });
        const db = createSqliteDb();
        await applyMigrations(db, dir);
        expect(await applyMigrations(db, dir)).toEqual([]);
        writeFileSync(join(dir, '0002_second.sql'), 'CREATE TABLE second (id INTEGER PRIMARY KEY);\n');
        expect(await applyMigrations(db, dir)).toEqual(['0002_second.sql']);
        const rows = await db.all('SELECT name FROM d1_migrations');
        expect(rows).toHaveLength(2);
    });

    it('a failing migration rolls back atomically and stays unapplied', async () => {
        const dir = writeMigrations({
            '0001_bad.sql': 'CREATE TABLE ok (id INTEGER PRIMARY KEY);\nCREATE TABLE broken (;\n'
        });
        const db = createSqliteDb();
        await expect(applyMigrations(db, dir)).rejects.toThrow();
        expect(await db.all('SELECT name FROM d1_migrations')).toEqual([]);
        expect(await db.first("SELECT name FROM sqlite_master WHERE name = 'ok'")).toBeNull();
    });

    it('applies the real app/migrations set (both drivers)', async () => {
        for (const db of [createSqliteDb(), createD1Db(d1Stub())]) {
            const applied = await applyMigrations(db, APP_MIGRATIONS);
            expect(applied).toEqual(['0001_sessions.sql', '0002_etag_cache.sql', '0003_boards.sql']);
            const tables = await db.all<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            );
            const names = tables.map((t) => t.name);
            expect(names).toEqual(expect.arrayContaining(['sessions', 'etag_cache', 'board_config', 'd1_migrations']));
        }
    });
});

describe('createConfigStore', () => {
    const board: BoardConfig = {
        version: 1,
        owner: 'signalxjs',
        repo: 'pulse',
        statuses: [
            { id: 'backlog', label: null },
            { id: 'todo', label: null },
            { id: 'inprogress', label: 'Doing' },
            { id: 'inreview', label: null },
            { id: 'done', label: null }
        ],
        priorities: { p0: 'urgent', p1: 'high', p2: 'medium', p3: null },
        cycleSource: 'milestones',
        closeOnDone: true,
        createdBy: 'andtii'
    };

    async function makeStore() {
        const db = createSqliteDb();
        await applyMigrations(db, APP_MIGRATIONS);
        return { db, store: createConfigStore(db) };
    }

    it('getBoard returns null for a repo without a board', async () => {
        const { store } = await makeStore();
        expect(await store.getBoard('nobody', 'nothing')).toBeNull();
    });

    it('putBoard + getBoard roundtrips the full config', async () => {
        const { store } = await makeStore();
        await store.putBoard(board);
        expect(await store.getBoard('signalxjs', 'pulse')).toEqual(board);
    });

    it('putBoard upserts — settings update, created_by is preserved', async () => {
        const { db, store } = await makeStore();
        await store.putBoard(board);
        await store.putBoard({ ...board, closeOnDone: false, createdBy: 'someone-else' });
        const updated = await store.getBoard('signalxjs', 'pulse');
        expect(updated!.closeOnDone).toBe(false);
        expect(updated!.createdBy).toBe('andtii');
        expect(await db.all('SELECT owner FROM board_config')).toHaveLength(1);
    });

    it('listBoards returns all boards ordered by owner then repo', async () => {
        const { store } = await makeStore();
        await store.putBoard({ ...board, owner: 'zeta', repo: 'a' });
        await store.putBoard(board);
        const boards = await store.listBoards();
        expect(boards.map((b) => `${b.owner}/${b.repo}`)).toEqual(['signalxjs/pulse', 'zeta/a']);
    });

    it('unknown config version reads as null (forward compatibility)', async () => {
        const { db, store } = await makeStore();
        await store.putBoard(board);
        await db.run(
            'INSERT INTO board_config (owner, repo, config, created_by) VALUES (?, ?, ?, ?)',
            'future', 'repo', JSON.stringify({ version: 2, shiny: true }), 'time-traveler'
        );
        await db.run(
            'INSERT INTO board_config (owner, repo, config, created_by) VALUES (?, ?, ?, ?)',
            'broken', 'repo', 'not json{', null
        );
        expect(await store.getBoard('future', 'repo')).toBeNull();
        expect(await store.getBoard('broken', 'repo')).toBeNull();
        // listBoards skips unreadable rows instead of failing the whole list.
        const boards = await store.listBoards();
        expect(boards.map((b) => b.owner)).toEqual(['signalxjs']);
    });
});
