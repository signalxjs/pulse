/**
 * @pulse/auth — session storage (encryption at rest), signed cookies, and
 * the request→session resolution path the proxy and SSR entries rely on.
 * Stores run over the @pulse/db seam; the schema comes from the real
 * app/migrations set — no inline DDL anywhere.
 */
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStore, getSession } from '@pulse/auth';
import { createSqliteDb } from '@pulse/db/sqlite';
import { applyMigrations } from '@pulse/db/migrate';
import { sign, verify, cookieHeader, SESSION_COOKIE } from '../src/cookies.js';

const USER = { login: 'octo', name: 'Octo Cat', avatarUrl: 'https://a/u' };

// Vitest runs from the repo root.
const APP_MIGRATIONS = join(process.cwd(), 'app', 'migrations');

/** A PulseDb with the real app schema applied — what server.mjs boots with. */
async function migratedDb(dbPath?: string) {
    const db = createSqliteDb(dbPath);
    await applyMigrations(db, APP_MIGRATIONS);
    return db;
}

describe('session store', () => {
    it('round-trips a session with the token encrypted at rest', async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const path = join(tmpdir(), `pulse-auth-atrest-${process.pid}.db`);
        const db = await migratedDb(path);
        const sessions = createSessionStore({ db, secret: 's3cret' });
        const sid = await sessions.create(USER, 'ghp_supersecret');

        const session = await sessions.get(sid);
        expect(session?.user).toEqual(USER);
        expect(session?.token).toBe('ghp_supersecret');

        // REAL at-rest check: read the raw row — the stored token_enc must
        // not contain the plaintext token.
        const raw = new DatabaseSync(path);
        const row = raw.prepare('SELECT token_enc FROM sessions WHERE sid = ?').get(sid) as { token_enc: string };
        expect(row.token_enc).not.toContain('ghp_supersecret');
        expect(row.token_enc.length).toBeGreaterThan(20);
        raw.close();
    });

    it('a fresh empty file db gets a working schema from migrations alone', async () => {
        // The boot path server.mjs takes: empty PULSE_DB file → migrations →
        // working store, with no inline DDL anywhere.
        const path = join(tmpdir(), `pulse-auth-boot-${process.pid}-${Date.now()}.db`);
        const db = createSqliteDb(path);
        const applied = await applyMigrations(db, APP_MIGRATIONS);
        expect(applied).toContain('0001_sessions.sql');
        const sessions = createSessionStore({ db, secret: 's3cret' });
        const sid = await sessions.create(USER, 'tok');
        expect((await sessions.get(sid))?.user.login).toBe('octo');
        // Re-running the migrations is a no-op, not a crash.
        expect(await applyMigrations(db, APP_MIGRATIONS)).toEqual([]);
    });

    it('destroy() invalidates the sid', async () => {
        const sessions = createSessionStore({ db: await migratedDb(), secret: 's3cret' });
        const sid = await sessions.create(USER, 't');
        await sessions.destroy(sid);
        expect(await sessions.get(sid)).toBeNull();
    });

    it('expired sessions are dead server-side', async () => {
        const sessions = createSessionStore({ db: await migratedDb(), secret: 's3cret', ttlMs: -1 });
        const sid = await sessions.create(USER, 't');
        expect(await sessions.get(sid)).toBeNull();
    });

    it('an undecryptable row is an invalid session, not a throw', async () => {
        // Same db, different secret — simulates secret rotation.
        const db = await migratedDb();
        const first = createSessionStore({ db, secret: 'old' });
        const sid = await first.create(USER, 'tok');
        const rotated = createSessionStore({ db, secret: 'new' });
        expect(await rotated.get(sid)).toBeNull();
    });

    it('requires a secret', async () => {
        const db = await migratedDb();
        expect(() => createSessionStore({ db, secret: '' })).toThrow(/secret/);
    });

    it('requires a db', () => {
        expect(() => createSessionStore({ secret: 's3cret' } as never)).toThrow(/PulseDb/);
    });
});

describe('signed cookies', () => {
    it('verify() accepts its own signature and rejects tampering', () => {
        const signed = sign('abc-123', 'k');
        expect(verify(signed, 'k')).toBe('abc-123');
        expect(verify(signed + 'x', 'k')).toBeNull();
        expect(verify('abc-124.' + signed.split('.')[1], 'k')).toBeNull();
        expect(verify(signed, 'other-key')).toBeNull();
        expect(verify(undefined, 'k')).toBeNull();
    });

    it('malformed percent-encoding reads as an absent cookie, not a throw', async () => {
        const { readCookie } = await import('../src/cookies.js');
        const req = { headers: { cookie: 'pulse_sid=%E0%A4' } };
        expect(readCookie(req, 'pulse_sid')).toBeUndefined();
    });

    it('cookieHeader is HttpOnly + SameSite=Lax and clearable', () => {
        const header = cookieHeader('a', 'b');
        expect(header).toContain('HttpOnly');
        expect(header).toContain('SameSite=Lax');
        expect(cookieHeader('a', '', { clear: true })).toContain('Max-Age=0');
    });
});

describe('getSession', () => {
    it('resolves a signed cookie to the stored session', async () => {
        const secret = 'k';
        const sessions = createSessionStore({ db: await migratedDb(), secret });
        const sid = await sessions.create(USER, 'tok');
        const req = { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sign(sid, secret))}` } };
        expect((await getSession(req, sessions, secret))?.user.login).toBe('octo');
    });

    it('rejects unsigned or forged sids', async () => {
        const secret = 'k';
        const sessions = createSessionStore({ db: await migratedDb(), secret });
        const sid = await sessions.create(USER, 'tok');
        expect(await getSession({ headers: { cookie: `${SESSION_COOKIE}=${sid}` } }, sessions, secret)).toBeNull();
        expect(await getSession({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sign(sid, 'wrong'))}` } }, sessions, secret)).toBeNull();
        expect(await getSession({ headers: {} }, sessions, secret)).toBeNull();
    });
});
