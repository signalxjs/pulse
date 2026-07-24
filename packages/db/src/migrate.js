/**
 * Migration runner — node-only (reads the migrations directory from disk).
 * Applied file names are tracked in a `d1_migrations` table with wrangler's
 * own schema, so `wrangler d1 migrations apply` and this runner agree on
 * what has been applied when the app moves to D1.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Split a migration file into statements: `;` at end of line terminates a
 * statement (the convention for files in app/migrations — no procedural SQL,
 * no semicolons inside string literals at line ends). Comment-only and empty
 * chunks are dropped.
 * @param {string} sql
 * @returns {string[]}
 */
export function splitStatements(sql) {
    return sql
        .split(/;[ \t]*(?:\r?\n|$)/)
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.replace(/^\s*--[^\n]*$/gm, '').trim().length > 0);
}

/**
 * Apply every not-yet-applied `*.sql` file in migrationsDir, in file-name
 * order. Each migration is applied atomically (statements + its tracking row
 * in one batch). Re-running is a no-op for already-applied files.
 * @param {import('./index.js').PulseDb} db
 * @param {string} migrationsDir
 * @returns {Promise<string[]>} Names of the migrations applied by this call.
 */
export async function applyMigrations(db, migrationsDir) {
    // Wrangler's own tracking-table DDL, verbatim.
    await db.run(`CREATE TABLE IF NOT EXISTS d1_migrations(
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT UNIQUE,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const rows = await db.all('SELECT name FROM d1_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.name));

    const applied = [];
    for (const file of files) {
        if (alreadyApplied.has(file)) continue;
        const sql = readFileSync(join(migrationsDir, file), 'utf-8');
        /** @type {{ sql: string, params?: import('./index.js').SqlParam[] }[]} */
        const stmts = splitStatements(sql).map((stmt) => ({ sql: stmt }));
        stmts.push({ sql: 'INSERT INTO d1_migrations (name) VALUES (?)', params: [file] });
        await db.batch(stmts);
        applied.push(file);
    }
    return applied;
}
